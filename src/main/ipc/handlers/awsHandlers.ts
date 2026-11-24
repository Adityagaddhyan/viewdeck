import { GetCallerIdentityCommand } from '@aws-sdk/client-sts'
import { withAwsErrors } from '../../aws/awsErrors'
import { detectCliTools } from '../../aws/cliPath'
import { getServices } from '../../services'
import { registerHandler } from '../registry'
import { requireString } from '../validate'

/** `aws:*` channels: profile discovery, SSO, RDS and tunnel-target discovery. */
export function registerAwsHandlers(): void {
  const s = getServices()

  registerHandler('aws:listProfiles', () => s.profiles.listProfiles())

  registerHandler('aws:getSsoStatus', (req) => s.profiles.getSsoStatus(requireString(req?.profile, 'profile')))

  registerHandler('aws:ssoLogin', async (req) => {
    const profile = requireString(req?.profile, 'profile')
    const status = await s.profiles.ssoLogin(profile)
    // Role credentials cached for the old session are now stale.
    s.awsClients.invalidate(profile)
    return status
  })

  registerHandler('aws:cancelSsoLogin', (req) => s.profiles.cancelSsoLogin(requireString(req?.profile, 'profile')))

  registerHandler('aws:getCallerIdentity', async (req) => {
    const profile = requireString(req?.profile, 'profile')
    const region = requireString(req?.region, 'region')
    const out = await withAwsErrors(profile, () => s.awsClients.sts(profile, region).send(new GetCallerIdentityCommand({})))
    return { accountId: out.Account ?? '', arn: out.Arn ?? '', userId: out.UserId ?? '' }
  })

  registerHandler('aws:listRdsDatabases', (req) =>
    s.rdsDiscovery.listPostgresDatabases(requireString(req?.profile, 'profile'), requireString(req?.region, 'region'))
  )

  registerHandler('aws:listTunnelTargets', (req) =>
    s.tunnelTargets.listTargets(
      requireString(req?.profile, 'profile'),
      requireString(req?.region, 'region'),
      requireString(req?.vpcId, 'vpcId')
    )
  )

  registerHandler('aws:checkCliTools', () => detectCliTools())
}
