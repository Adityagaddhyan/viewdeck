import { createServer } from 'node:net'

/**
 * Asks the OS for a free ephemeral port on 127.0.0.1 by binding port 0 and
 * releasing it again.
 *
 * Inherent race: another process can grab the port between release and the
 * plugin binding it. SsmTunnelManager retries with a new port when the plugin
 * reports "address already in use".
 */
export function allocateFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.once('error', reject)
    srv.listen(0, host, () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const { port } = addr
        srv.close(() => resolve(port))
      } else {
        srv.close(() => reject(new Error('Could not determine allocated port')))
      }
    })
  })
}
