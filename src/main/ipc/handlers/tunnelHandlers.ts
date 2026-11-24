import { getServices } from '../../services'
import { registerHandler } from '../registry'
import { requirePort, requireString } from '../validate'

/** `tunnel:*` channels. State changes are also pushed via the `tunnel:status` event. */
export function registerTunnelHandlers(): void {
  const s = getServices()

  registerHandler('tunnel:open', (req) =>
    s.tunnels.open({
      profile: requireString(req?.profile, 'profile'),
      region: requireString(req?.region, 'region'),
      targetInstanceId: requireString(req?.targetInstanceId, 'targetInstanceId', /^(i|mi)-[0-9a-f]+$/),
      remoteHost: requireString(req?.remoteHost, 'remoteHost', /^[A-Za-z0-9.-]+$/),
      remotePort: requirePort(req?.remotePort)
    })
  )
  registerHandler('tunnel:close', (req) => s.tunnels.close(requireString(req?.id, 'id')))
  registerHandler('tunnel:list', () => s.tunnels.list())
}
