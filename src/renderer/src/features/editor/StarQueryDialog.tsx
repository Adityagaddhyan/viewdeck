/** Names a query and saves it to Starred (this connection, or all connections). */
import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogContent } from '@renderer/components/ui/dialog'
import { Field, Input } from '@renderer/components/ui/primitives'
import { asAppError, call } from '@renderer/lib/ipc'
import { actions } from '@renderer/lib/store'

/** Default name: first meaningful line of the SQL, trimmed. */
export function defaultQueryName(sql: string): string {
  const line = sql.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('--')) ?? 'Untitled query'
  return line.length > 60 ? `${line.slice(0, 57)}…` : line
}

export function StarQueryDialog({ sql, connectionId, onClose, onSaved }: { sql: string | null; connectionId: string | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [global, setGlobal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (sql) {
      setName(defaultQueryName(sql))
      setGlobal(false)
      setError(null)
    }
  }, [sql])
  if (sql === null) return null

  const save = async (): Promise<void> => {
    try {
      await call('queries:save', { name: name.trim() || defaultQueryName(sql), sql, connectionId: global ? null : connectionId })
      actions.showToast('Starred')
      onSaved()
      onClose()
    } catch (e) {
      setError(asAppError(e).message)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Star query" description="Starred queries appear in the Starred panel and in ⌘K.">
        <div className="space-y-3">
          <Field label="Name">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
          </Field>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} disabled={!connectionId} />
            Show on all connections
          </label>
          <pre className="max-h-32 overflow-auto rounded border bg-background p-2 font-mono text-[11px] select-text">{sql.trim()}</pre>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void save()}>
              <Star /> Star
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
