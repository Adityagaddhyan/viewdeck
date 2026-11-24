/**
 * Cmd/Ctrl+S: review the EXACT parameterised statements (from
 * driver.previewChanges, the same builder commitChanges uses) wrapped in
 * BEGIN … COMMIT, with bound values listed under each statement. Nothing runs
 * until "Commit" is pressed (ADR-003).
 */
import { useEffect, useState } from 'react'
import { GitCommitHorizontal } from 'lucide-react'
import type { CellValue, PreparedStatement, StagedChangeset } from '@shared/types/driver'
import type { AppError } from '@shared/types/result'
import { Button } from '@renderer/components/ui/button'
import { Dialog, SheetContent } from '@renderer/components/ui/dialog'
import { Spinner } from '@renderer/components/ui/primitives'
import { ErrorBanner } from '@renderer/components/ErrorBanner'
import { asAppError, call } from '@renderer/lib/ipc'

function literal(v: CellValue): string {
  if (v === null) return 'NULL'
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`
  return String(v)
}

export function SqlDiffDrawer({
  open,
  onOpenChange,
  sessionId,
  changeset,
  onCommitted
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  sessionId: string
  changeset: StagedChangeset | null
  onCommitted: (rows: number) => void
}) {
  const [statements, setStatements] = useState<PreparedStatement[] | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [committing, setCommitting] = useState(false)

  useEffect(() => {
    if (!open || !changeset) return
    setStatements(null)
    setError(null)
    call('db:previewChanges', { sessionId, changeset })
      .then(setStatements)
      .catch((err: unknown) => setError(asAppError(err)))
  }, [open, sessionId, changeset])

  async function commit(): Promise<void> {
    if (!changeset) return
    setCommitting(true)
    setError(null)
    try {
      const res = await call('db:commitChanges', { sessionId, changeset })
      onCommitted(res.rowsAffected)
      onOpenChange(false)
    } catch (err) {
      setError(asAppError(err))
    } finally {
      setCommitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="Review staged changes"
        description={`${changeset?.changes.length ?? 0} change(s) to ${changeset?.schema}.${changeset?.table}. All statements run in one transaction.`}
      >
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {!statements && !error && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner /> Building SQL…
            </div>
          )}
          {statements && (
            <pre className="rounded-md border bg-background p-3 font-mono text-[12px] leading-relaxed select-text">
              <span className="text-sky-400">BEGIN;</span>
              {'\n'}
              {statements.map((s, i) => (
                <span key={i}>
                  {'\n'}
                  <span className={s.sql.startsWith('DELETE') ? 'text-red-600 dark:text-red-300' : s.sql.startsWith('INSERT') ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-200'}>
                    {s.sql};
                  </span>
                  {s.params.length > 0 && (
                    <span className="text-muted-foreground">
                      {'\n'}
                      {'  -- '}
                      {s.params.map((p, j) => `$${j + 1} = ${literal(p)}`).join(', ')}
                    </span>
                  )}
                  {s.expectRows !== undefined && (
                    <span className="text-muted-foreground/60">
                      {'\n'}
                      {`  -- must affect exactly ${s.expectRows} row, or everything rolls back`}
                    </span>
                  )}
                  {'\n'}
                </span>
              ))}
              {'\n'}
              <span className="text-sky-400">COMMIT;</span>
            </pre>
          )}
          {error && <ErrorBanner className="mt-3" error={error} />}
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Keep editing
          </Button>
          <Button onClick={() => void commit()} disabled={!statements || committing}>
            {committing ? <Spinner className="text-primary-foreground" /> : <GitCommitHorizontal />} Commit {statements?.length ?? ''} statement(s)
          </Button>
        </div>
      </SheetContent>
    </Dialog>
  )
}
