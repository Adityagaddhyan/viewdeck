import { actions } from './store'
import { call } from './ipc'

/**
 * Copies text via main (app:writeClipboard) and shows a toast. Use this for
 * every in-app copy action, so feedback and reliability are consistent.
 */
export async function copyText(text: string, what = 'Copied'): Promise<void> {
  try {
    await call('app:writeClipboard', { text })
    actions.showToast(what)
  } catch (err) {
    actions.showToast(`Copy failed: ${(err as Error).message}`)
  }
}
