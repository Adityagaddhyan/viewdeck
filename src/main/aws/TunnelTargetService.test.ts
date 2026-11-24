import { describe, expect, it, vi } from 'vitest'
import { TunnelTargetService } from './TunnelTargetService'

describe('TunnelTargetService', () => {
  it('returns running same-VPC instances with an Online SSM agent', async () => {
    const ec2Send = vi.fn(async () => ({
      Reservations: [
        {
          Instances: [
            { InstanceId: 'i-a', VpcId: 'vpc-1', PrivateIpAddress: '10.0.0.5', Tags: [{ Key: 'Name', Value: 'bastion' }] },
            { InstanceId: 'i-b', VpcId: 'vpc-1' }
          ]
        }
      ]
    }))
    const ssmSend = vi.fn(async () => ({
      InstanceInformationList: [{ InstanceId: 'i-a', PlatformName: 'Amazon Linux', AgentVersion: '3.3' }, { InstanceId: 'i-z' }]
    }))
    const svc = new TunnelTargetService({ ec2: () => ({ send: ec2Send }) as never, ssm: () => ({ send: ssmSend }) as never })
    const targets = await svc.listTargets('p', 'us-east-1', 'vpc-1')
    expect(targets).toEqual([
      { instanceId: 'i-a', name: 'bastion', privateIp: '10.0.0.5', vpcId: 'vpc-1', platform: 'Amazon Linux', agentVersion: '3.3' }
    ])
    const ec2Input = (ec2Send.mock.calls[0] as unknown as [{ input: { Filters: unknown } }])[0].input
    expect(ec2Input.Filters).toEqual([
      { Name: 'vpc-id', Values: ['vpc-1'] },
      { Name: 'instance-state-name', Values: ['running'] }
    ])
  })
})
