import { describe, expect, it, vi } from 'vitest'
import { DescribeDBClustersCommand, DescribeDBInstancesCommand } from '@aws-sdk/client-rds'
import { RdsDiscoveryService } from './RdsDiscoveryService'

function fakeRds(pages: { instances: unknown[][]; clusters: unknown[][] }) {
  const send = vi.fn(async (cmd: unknown) => {
    const isInst = cmd instanceof DescribeDBInstancesCommand
    if (!isInst && !(cmd instanceof DescribeDBClustersCommand)) throw new Error('unexpected command')
    const list = isInst ? pages.instances : pages.clusters
    const marker = (cmd as { input: { Marker?: string } }).input.Marker
    const idx = marker ? Number(marker) : 0
    const next = idx + 1 < list.length ? String(idx + 1) : undefined
    return isInst ? { DBInstances: list[idx], Marker: next } : { DBClusters: list[idx], Marker: next }
  })
  return { send }
}

describe('RdsDiscoveryService', () => {
  it('lists pg instances + clusters, hides cluster members, follows pagination', async () => {
    const client = fakeRds({
      instances: [
        [
          {
            DBInstanceIdentifier: 'orders-db',
            Engine: 'postgres',
            EngineVersion: '16.4',
            DBInstanceStatus: 'available',
            Endpoint: { Address: 'orders-db.abc.us-east-1.rds.amazonaws.com', Port: 5432 },
            PubliclyAccessible: false,
            DBSubnetGroup: { VpcId: 'vpc-1' },
            IAMDatabaseAuthenticationEnabled: true,
            DBName: 'orders',
            MasterUsername: 'postgres'
          },
          { DBInstanceIdentifier: 'mysql-db', Engine: 'mysql' }
        ],
        [
          {
            DBInstanceIdentifier: 'analytics-1',
            Engine: 'aurora-postgresql',
            DBClusterIdentifier: 'analytics',
            PubliclyAccessible: true,
            DBSubnetGroup: { VpcId: 'vpc-2' }
          }
        ]
      ],
      clusters: [
        [
          {
            DBClusterIdentifier: 'analytics',
            Engine: 'aurora-postgresql',
            EngineVersion: '15.5',
            Status: 'available',
            Endpoint: 'analytics.cluster-abc.us-east-1.rds.amazonaws.com',
            ReaderEndpoint: 'analytics.cluster-ro-abc.us-east-1.rds.amazonaws.com',
            Port: 5432
          },
          { DBClusterIdentifier: 'aurora-mysql', Engine: 'aurora-mysql' }
        ]
      ]
    })
    const svc = new RdsDiscoveryService(() => client)
    const dbs = await svc.listPostgresDatabases('p', 'us-east-1')

    expect(dbs.map((d) => [d.identifier, d.kind])).toEqual([
      ['analytics', 'cluster'],
      ['orders-db', 'instance']
    ])
    expect(dbs[0]).toMatchObject({ publiclyAccessible: true, vpcId: 'vpc-2', readerEndpoint: expect.stringContaining('cluster-ro') })
    expect(dbs[1]).toMatchObject({
      endpoint: 'orders-db.abc.us-east-1.rds.amazonaws.com',
      publiclyAccessible: false,
      vpcId: 'vpc-1',
      iamAuthEnabled: true,
      databaseName: 'orders',
      region: 'us-east-1'
    })
    expect(client.send).toHaveBeenCalledTimes(3) // 2 instance pages + 1 cluster page
  })

  it('maps SDK errors to AppErrors', async () => {
    const svc = new RdsDiscoveryService(() => ({
      send: vi.fn().mockRejectedValue(Object.assign(new Error('not authorized to perform rds:DescribeDBInstances'), { name: 'AccessDenied' }))
    }))
    await expect(svc.listPostgresDatabases('p', 'us-east-1')).rejects.toMatchObject({ appError: { code: 'AWS_ACCESS_DENIED' } })
  })
})
