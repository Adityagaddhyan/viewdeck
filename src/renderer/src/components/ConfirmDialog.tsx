/**
 * Generic confirmation dialog for destructive or risky actions (delete a saved
 * connection, discard staged edits when switching...). Use it instead of
 * window.confirm, which blocks Electron's renderer and can't be styled.
 */
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogContent } from '@renderer/components/ui/dialog'

export interface ConfirmRequest {
  title: string
  body: React.ReactNode
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  if (!request) return null
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={request.title}>
        <div className="text-xs text-muted-foreground">{request.body}</div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            autoFocus
            variant={request.destructive ? 'destructive' : 'default'}
            onClick={() => {
              void Promise.resolve(request.onConfirm()).finally(onClose)
            }}
          >
            {request.confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
