/**
 * "Compare rows" dialog: two row snapshots side by side, aligned by column
 * name (compareRows.ts), with differing values highlighted and an option to
 * show only the differences. Opened from the grid context menu (two selected
 * rows, or a row compared with the pinned row).
 */
import { useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import type { CellValue } from '@shared/types/driver'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogContent } from '@renderer/components/ui/dialog'
import { actions, useAppState } from '@renderer/lib/store'
import { cn } from '@renderer/lib/utils'
import { cellText } from './copyFormats'
import { compareRows } from './compareRows'

function Value({ v }: { v: CellValue | undefined }) {
  if (v === undefined) return <span className="italic text-muted-foreground/60">no column</span>
  if (v === null) return <span className="italic text-muted-foreground">NULL</span>
  return <span className="whitespace-pre-wrap break-all">{cellText(v)}</span>
}

export function CompareRowsDialog() {
  const compare = useAppState((s) => s.compare)
  const [onlyDiff, setOnlyDiff] = useState(false)
  if (!compare) return null
  const { a, b } = compare
  const lines = compareRows(a, b)
  const diffs = lines.filter((l) => !l.same).length
  const shown = onlyDiff ? lines.filter((l) => !l.same) : lines

  return (
    <Dialog open onOpenChange={(o) => !o && actions.closeCompare()}>
      <DialogContent title="Compare rows" description={`${diffs} of ${lines.length} columns differ`} className="max-w-4xl">
        <div className="mb-2 flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} aria-label="Only differences" />
            Only differences
          </label>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => actions.compareRows(b, a)} title="Swap sides">
            <ArrowLeftRight /> Swap
          </Button>
        </div>
        <div className="max-h-[60vh] overflow-auto rounded border">
          <table className="w-full table-fixed border-collapse font-mono text-[11px]" aria-label="Row comparison">
            <thead className="sticky top-0 bg-card text-left text-muted-foreground">
              <tr>
                <th className="w-44 border-b px-2 py-1 font-medium">column</th>
                <th className="border-b border-l px-2 py-1 font-medium">A · {a.label}</th>
                <th className="border-b border-l px-2 py-1 font-medium">B · {b.label}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.column} data-diff={!l.same} className={cn(!l.same && 'bg-amber-500/10')}>
                  <td className={cn('truncate border-b px-2 py-0.5 align-top', !l.same && 'font-semibold text-amber-400')} title={l.column}>
                    {l.column}
                  </td>
                  <td className="border-b border-l px-2 py-0.5 align-top">
                    <Value v={l.a} />
                  </td>
                  <td className="border-b border-l px-2 py-0.5 align-top">
                    <Value v={l.b} />
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-2 py-3 text-center text-muted-foreground">
                    The rows are identical.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}
