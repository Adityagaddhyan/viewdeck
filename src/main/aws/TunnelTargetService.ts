/**
 * Finds EC2 instances that can act as SSM port-forwarding hosts for a private
 * RDS database. A candidate must be running, in the same VPC as the database,
 * and report an `Online` SSM agent.
 *
 * Note: same-VPC is a heuristic. The instance's security group must also be
 * allowed to reach the DB port. We cannot verify that cheaply, so the tunnel
 * health check (TCP readiness through the tunnel) is the source of truth.
 */
import { DescribeInstancesCommand, type EC2Client, type Instance } from '@aws-sdk/client-ec2'
import {
  DescribeInstanceInformationCommand,
  type InstanceInformation,
  type SSMClient
} from '@aws-sdk/client-ssm'
import type { TunnelTarget } from '@shared/types/aws'
import { withAwsErrors } from './awsErrors'

export interface TunnelTargetClients {
  ec2: (profile: string, region: string) => Pick<EC2Client, 'send'>
  ssm: (profile: string, region: string) => Pick<SSMClient, 'send'>
}

export class TunnelTargetService {
  constructor(private readonly clients: TunnelTargetClients) {}

  async listTargets(profile: string, region: string, vpcId: string): Promise<TunnelTarget[]> {
    return withAwsErrors(profile, async () => {
      const [instances, online] = await Promise.all([
        this.runningInstancesInVpc(profile, region, vpcId),
        this.onlineSsmInstances(profile, region)
      ])
      return instances
        .filter((i) => i.InstanceId && online.has(i.InstanceId))
        .map((i): TunnelTarget => {
          const info = online.get(i.InstanceId as string)
          return {
            instanceId: i.InstanceId as string,
            name: i.Tags?.find((t) => t.Key === 'Name')?.Value ?? null,
            privateIp: i.PrivateIpAddress ?? null,
            vpcId: i.VpcId ?? null,
            platform: info?.PlatformName ?? i.PlatformDetails ?? null,
            agentVersion: info?.AgentVersion ?? null
          }
        })
        .sort((a, b) => (a.name ?? a.instanceId).localeCompare(b.name ?? b.instanceId))
    })
  }

  private async runningInstancesInVpc(profile: string, region: string, vpcId: string): Promise<Instance[]> {
    const client = this.clients.ec2(profile, region)
    const out: Instance[] = []
    let NextToken: string | undefined
    do {
      const page = await client.send(
        new DescribeInstancesCommand({
          Filters: [
            { Name: 'vpc-id', Values: [vpcId] },
            { Name: 'instance-state-name', Values: ['running'] }
          ],
          NextToken
        })
      )
      for (const r of page.Reservations ?? []) out.push(...(r.Instances ?? []))
      NextToken = page.NextToken
    } while (NextToken)
    return out
  }

  /** Online SSM-managed instances, keyed by id. Filtering by PingStatus avoids the 50-id filter limit. */
  private async onlineSsmInstances(profile: string, region: string): Promise<Map<string, InstanceInformation>> {
    const client = this.clients.ssm(profile, region)
    const out = new Map<string, InstanceInformation>()
    let NextToken: string | undefined
    do {
      const page = await client.send(
        new DescribeInstanceInformationCommand({
          Filters: [{ Key: 'PingStatus', Values: ['Online'] }],
          NextToken
        })
      )
      for (const info of page.InstanceInformationList ?? []) {
        if (info.InstanceId) out.set(info.InstanceId, info)
      }
      NextToken = page.NextToken
    } while (NextToken)
    return out
  }
}
