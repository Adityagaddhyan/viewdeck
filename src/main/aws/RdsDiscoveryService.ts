/**
 * Lists Postgres-compatible RDS databases (standalone instances and clusters).
 *
 * Subtleties:
 * - Aurora cluster members are also returned by DescribeDBInstances. We list the
 *   *cluster* (writer endpoint) and hide its member instances, so users connect
 *   to the stable cluster endpoint instead of an instance that may fail over.
 * - Aurora clusters carry no `PubliclyAccessible` or VPC of their own. Both come
 *   from member instances. Multi-AZ DB clusters (non-Aurora) do carry
 *   `PubliclyAccessible`, so prefer it when present.
 * - Pagination is done by hand (Marker loop), which keeps the service testable
 *   with a plain fake `send`.
 */
import {
  DescribeDBClustersCommand,
  DescribeDBInstancesCommand,
  type DBCluster,
  type DBInstance,
  type RDSClient
} from '@aws-sdk/client-rds'
import type { RdsDatabase } from '@shared/types/aws'
import { withAwsErrors } from './awsErrors'

/** Engines that speak the Postgres wire protocol. */
export const POSTGRES_ENGINES = new Set(['postgres', 'aurora-postgresql'])

type RdsSender = Pick<RDSClient, 'send'>

export class RdsDiscoveryService {
  constructor(private readonly getClient: (profile: string, region: string) => RdsSender) {}

  async listPostgresDatabases(profile: string, region: string): Promise<RdsDatabase[]> {
    return withAwsErrors(profile, async () => {
      const client = this.getClient(profile, region)
      const [instances, clusters] = await Promise.all([listInstances(client), listClusters(client)])
      const pgInstances = instances.filter((i) => POSTGRES_ENGINES.has(i.Engine ?? ''))
      const pgClusters = clusters.filter((c) => POSTGRES_ENGINES.has(c.Engine ?? ''))

      const membersByCluster = new Map<string, DBInstance[]>()
      for (const inst of pgInstances) {
        if (!inst.DBClusterIdentifier) continue
        const list = membersByCluster.get(inst.DBClusterIdentifier) ?? []
        list.push(inst)
        membersByCluster.set(inst.DBClusterIdentifier, list)
      }

      const result: RdsDatabase[] = [
        ...pgClusters.map((c) => clusterToDto(c, membersByCluster.get(c.DBClusterIdentifier ?? '') ?? [], region)),
        ...pgInstances.filter((i) => !i.DBClusterIdentifier).map((i) => instanceToDto(i, region))
      ]
      return result.sort((a, b) => a.identifier.localeCompare(b.identifier))
    })
  }
}

async function listInstances(client: RdsSender): Promise<DBInstance[]> {
  const out: DBInstance[] = []
  let Marker: string | undefined
  do {
    const page = await client.send(new DescribeDBInstancesCommand({ Marker, MaxRecords: 100 }))
    out.push(...(page.DBInstances ?? []))
    Marker = page.Marker
  } while (Marker)
  return out
}

async function listClusters(client: RdsSender): Promise<DBCluster[]> {
  const out: DBCluster[] = []
  let Marker: string | undefined
  do {
    const page = await client.send(new DescribeDBClustersCommand({ Marker, MaxRecords: 100 }))
    out.push(...(page.DBClusters ?? []))
    Marker = page.Marker
  } while (Marker)
  return out
}

function instanceToDto(i: DBInstance, region: string): RdsDatabase {
  return {
    identifier: i.DBInstanceIdentifier ?? '(unknown)',
    kind: 'instance',
    engine: i.Engine ?? 'postgres',
    engineVersion: i.EngineVersion ?? '',
    status: i.DBInstanceStatus ?? 'unknown',
    endpoint: i.Endpoint?.Address ?? null,
    readerEndpoint: null,
    port: i.Endpoint?.Port ?? i.DbInstancePort ?? 5432,
    publiclyAccessible: i.PubliclyAccessible ?? false,
    vpcId: i.DBSubnetGroup?.VpcId ?? null,
    iamAuthEnabled: i.IAMDatabaseAuthenticationEnabled ?? false,
    databaseName: i.DBName ?? null,
    masterUsername: i.MasterUsername ?? null,
    region
  }
}

function clusterToDto(c: DBCluster, members: DBInstance[], region: string): RdsDatabase {
  return {
    identifier: c.DBClusterIdentifier ?? '(unknown)',
    kind: 'cluster',
    engine: c.Engine ?? 'aurora-postgresql',
    engineVersion: c.EngineVersion ?? '',
    status: c.Status ?? 'unknown',
    endpoint: c.Endpoint ?? null,
    readerEndpoint: c.ReaderEndpoint ?? null,
    port: c.Port ?? 5432,
    publiclyAccessible: c.PubliclyAccessible ?? members.some((m) => m.PubliclyAccessible === true),
    vpcId: members.find((m) => m.DBSubnetGroup?.VpcId)?.DBSubnetGroup?.VpcId ?? null,
    iamAuthEnabled: c.IAMDatabaseAuthenticationEnabled ?? false,
    databaseName: c.DatabaseName ?? null,
    masterUsername: c.MasterUsername ?? null,
    region
  }
}
