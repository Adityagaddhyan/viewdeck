/**
 * Query tab: toolbar (Run, Explain, Star, Recent & starred), SQL editor (top)
 * and results or the plan view (bottom) with a draggable splitter, plus the
 * optional QueriesPanel on the right.
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, GitBranch, History, Play, Square, Star } from 'lucide-react'
import type { ExplainResult, QueryResult } from '@shared/types/driver'
import type { AppError } from '@shared/types/result'
import { Button } from '@renderer/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@renderer/components/ui/dropdown-menu'
import { Spinner } from '@renderer/components/ui/primitives'
import { asAppError, call } from '@renderer/lib/ipc'
import { MOD_LABEL, useHotkey } from '@renderer/lib/hotkeys'
import { actions, useAppState } from '@renderer/lib/store'
import { cn } from '@renderer/lib/utils'
import { PlanView } from './PlanView'
import { QueriesPanel } from './QueriesPanel'
import { QueryResults, type QueryResultsHandle } from './QueryResults'
import { schemaCache } from './schemaCache'
import { SqlEditor, type SqlEditorHandle } from './SqlEditor'
import { StarQueryDialog } from './StarQueryDialog'
import { TimeoutPicker } from './TimeoutPicker'
import { DangerConfirmDialog } from './DangerConfirmDialog'
import { findDangers, type Danger } from './dangerGuard'
import type { ScriptStep } from './scriptOutput'
import { splitStatements } from './statementAtCursor'

const DDL = /^\s*(create|alter|drop|truncate|comment)\b/i

export function QueryTab({ tabId, initialSql, active }: { tabId: string; initialSql: string; active: boolean }) {
  const session = useAppState((s) => s.session)
  const sessionId = session?.id ?? ''
  const [result, setResult] = useState<QueryResult | null>(null)
  const [steps, setSteps] = useState<ScriptStep[] | null>(null)
  const [scriptTotal, setScriptTotal] = useState(0)
  const cancelledRef = useRef(false)
  const [error, setError] = useState<AppError | null>(null)
  const [running, setRunning] = useState(false)
  const [plan, setPlan] = useState<ExplainResult | null>(null)
  const [explaining, setExplaining] = useState(false)
  const [split, setSplit] = useState(0.45)
  const [panelOpen, setPanelOpen] = useState(false)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [starSql, setStarSql] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!startedAt) return
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 100)
    return () => clearInterval(t)
  }, [startedAt])
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<SqlEditorHandle>(null)
  const resultsRef = useRef<QueryResultsHandle>(null)
  // ⌘F: find in results, unless focus is in a Monaco editor (the SQL editor keeps its own Find;
  // the result filter input forwards ⌘F to find itself).
  useHotkey('mod+f', () => {
    if (!(document.activeElement as HTMLElement | null)?.closest('.monaco-editor')) resultsRef.current?.focusFind()
  }, active)
  const sqlRef = useRef(initialSql)
  const lastSqlRef = useRef('')
  const lastOffsetRef = useRef(0)
  // Native menu: Query → Run Statement / Cancel (only the active tab reacts).
  const tabCommand = useAppState((s) => s.tabCommand)
  const seenCommand = useRef(tabCommand?.n)
  useEffect(() => {
    if (!active || !tabCommand || tabCommand.n === seenCommand.current) return
    seenCommand.current = tabCommand.n
    if (tabCommand.id === 'runStatement') editorRef.current?.runStatement()
    if (tabCommand.id === 'cancelQuery' && running) cancel()
  }, [tabCommand, active]) // eslint-disable-line react-hooks/exhaustive-deps

  const [pendingDanger, setPendingDanger] = useState<{ sql: string; dangers: Danger[] } | null>(null)
  /** Whether the pending danger confirmation is for EXPLAIN ANALYZE (which executes the statement). */
  const pendingIsAnalyze = useRef(false)

  /**
   * EXPLAIN / EXPLAIN ANALYZE. ANALYZE executes the statement (rolled back by
   * the driver), so destructive SQL in an unlocked session still asks first.
   */
  function requestExplain(sql: string, analyze: boolean): void {
    const dangers = analyze && session && !session.readOnly ? findDangers(sql) : []
    if (dangers.length) {
      pendingIsAnalyze.current = true
      setPendingDanger({ sql, dangers })
    } else void explain(sql, analyze)
  }

  async function explain(sql: string, analyze: boolean): Promise<void> {
    setExplaining(true)
    setError(null)
    try {
      setPlan(await call('db:explain', { sessionId, sql, analyze }))
    } catch (err) {
      setPlan(null)
      setError(asAppError(err))
    } finally {
      setExplaining(false)
    }
  }

  function cancel(): void {
    cancelledRef.current = true // stops a script after the current statement
    void call('db:cancelQuery', { sessionId })
  }

  /** Entry point for Run / Cmd+Enter: destructive SQL in an unlocked session asks first. */
  function requestRun(sql: string, offset = 0): void {
    lastOffsetRef.current = offset
    pendingIsAnalyze.current = false
    const dangers = session && !session.readOnly ? findDangers(sql) : []
    if (dangers.length) setPendingDanger({ sql, dangers })
    else void execute(sql)
  }

  /** Several statements run one by one (like psql, so one failure keeps the others' results); one runs as-is. */
  function execute(sql: string): Promise<void> {
    return splitStatements(sql).length > 1 ? runScript(sql) : run(sql)
  }

  /**
   * Runs each statement as its own db:executeQuery on the pinned console
   * client, so a script's own BEGIN … COMMIT still spans statements and the
   * read-only guard checks every one. Errors are recorded and the run goes on.
   */
  async function runScript(sql: string): Promise<void> {
    const stmts = splitStatements(sql)
    const base = lastOffsetRef.current
    lastSqlRef.current = sql
    cancelledRef.current = false
    editorRef.current?.clearErrors()
    setRunning(true)
    setPlan(null)
    setResult(null)
    setError(null)
    setSteps([])
    setScriptTotal(stmts.length)
    setStartedAt(Date.now())
    setElapsed(0)
    const done: ScriptStep[] = []
    let ddl = false
    try {
      for (const stmt of stmts) {
        if (cancelledRef.current) break
        try {
          const res = await call('db:executeQuery', { sessionId, sql: stmt.text })
          done.push({ sql: stmt.text, result: res, error: null })
          if (DDL.test(stmt.text)) ddl = true
        } catch (err) {
          const appErr = asAppError(err)
          done.push({ sql: stmt.text, result: null, error: appErr })
          if (appErr.context?.position) editorRef.current?.markError(base + stmt.start + appErr.context.position - 1, appErr.message)
        }
        setSteps([...done])
      }
    } finally {
      if (ddl) {
        schemaCache.invalidate()
        actions.bumpSchemaVersion()
      }
      setRunning(false)
      setStartedAt(null)
      setHistoryVersion((v) => v + 1)
    }
  }

  async function run(sql: string): Promise<void> {
    lastSqlRef.current = sql
    setSteps(null)
    editorRef.current?.clearErrors()
    setRunning(true)
    setPlan(null)
    setStartedAt(Date.now())
    setElapsed(0)
    setError(null)
    try {
      const res = await call('db:executeQuery', { sessionId, sql })
      setResult(res)
      if (DDL.test(sql)) {
        // Keep autocomplete and the explorer honest after CREATE/ALTER/DROP.
        schemaCache.invalidate()
        actions.bumpSchemaVersion()
      }
    } catch (err) {
      setResult(null) // don't leave the previous result under the error
      const appErr = asAppError(err)
      setError(appErr)
      // Underline where Postgres says the error is (position is 1-based within the run text).
      if (appErr.context?.position) editorRef.current?.markError(lastOffsetRef.current + appErr.context.position - 1, appErr.message)
    } finally {
      setRunning(false)
      setStartedAt(null)
      setHistoryVersion((v) => v + 1)
    }
  }

  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const box = containerRef.current?.getBoundingClientRect()
    if (!box) return
    const onMove = (ev: MouseEvent): void => setSplit(Math.min(0.85, Math.max(0.15, (ev.clientY - box.top) / box.height)))
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b px-2">
        {running ? (
          <Button size="sm" variant="destructive" onClick={cancel} title="Cancel the running query (pg_cancel_backend)">
            <Square /> Cancel <span className="font-mono text-[10px] tabular-nums opacity-80">{(elapsed / 1000).toFixed(1)}s</span>
          </Button>
        ) : (
          <Button size="sm" onClick={() => sqlRef.current.trim() && requestRun(sqlRef.current, 0)} title={`Run every statement and show all results. ${MOD_LABEL}Enter runs the statement at the cursor.`}>
            <Play /> Run <kbd className="text-[10px] opacity-70">{MOD_LABEL}↵</kbd>
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" disabled={!sessionId || explaining} title="Show the query plan for the statement at the cursor">
              {explaining ? <Spinner /> : <GitBranch />} Explain <ChevronDown className="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => editorRef.current?.explainStatement(false)}>
              Explain <span className="ml-auto pl-4 text-[10px] text-muted-foreground">{MOD_LABEL}E</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => editorRef.current?.explainStatement(true)}>
              Explain analyze (rolled back) <span className="ml-auto pl-4 text-[10px] text-muted-foreground">{MOD_LABEL}⇧E</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" variant="ghost" onClick={() => sqlRef.current.trim() && setStarSql(sqlRef.current)} disabled={!sessionId} title="Star this query">
          <Star /> Star
        </Button>
        <div className="ml-auto" />
        <TimeoutPicker />
        <Button size="sm" variant={panelOpen ? 'secondary' : 'ghost'} onClick={() => setPanelOpen((o) => !o)} title="Recent & starred queries">
          <History /> Recent &amp; starred
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div ref={containerRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-0" style={{ height: `${split * 100}%` }}>
            <SqlEditor
              ref={editorRef}
              defaultValue={initialSql}
              focused={active}
              onChange={(v) => {
                sqlRef.current = v
                actions.setQuerySql(tabId, v)
              }}
              onRun={(sql, offset) => requestRun(sql, offset)}
              onExplain={(sql, analyze) => requestExplain(sql, analyze)}
            />
          </div>
          <div className="h-1 shrink-0 cursor-row-resize border-y bg-card hover:bg-sky-500/40" onMouseDown={startDrag} />
          {plan && !error ? (
            <PlanView result={plan} onClose={() => setPlan(null)} />
          ) : (
            <QueryResults ref={resultsRef} result={result} steps={steps} total={scriptTotal} running={running} elapsed={elapsed} error={error} onRetry={() => void execute(lastSqlRef.current)} />
          )}
        </div>
        <div className={cn(!panelOpen && 'hidden')}>
          {panelOpen && (
            <QueriesPanel
              connectionId={session?.connectionId ?? null}
              version={historyVersion}
              onOpen={(sql) => editorRef.current?.setValue(sql)}
              onStar={(sql) => setStarSql(sql)}
            />
          )}
        </div>
      </div>
      <DangerConfirmDialog
        pending={pendingDanger}
        database={session?.database ?? ''}
        environment={session?.environment ?? 'unknown'}
        onCancel={() => {
          setPendingDanger(null)
          requestAnimationFrame(() => editorRef.current?.focus()) // back to typing after the dialog
        }}
        onConfirm={(sql) => {
          setPendingDanger(null)
          requestAnimationFrame(() => editorRef.current?.focus())
          if (pendingIsAnalyze.current) void explain(sql, true)
          else void execute(sql)
        }}
      />
      <StarQueryDialog sql={starSql} connectionId={session?.connectionId ?? null} onClose={() => setStarSql(null)} onSaved={() => setHistoryVersion((v) => v + 1)} />
    </div>
  )
}
