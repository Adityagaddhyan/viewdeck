/**
 * Monaco SQL editor. Cmd/Ctrl+Enter runs the selection, or the statement under
 * the cursor if nothing is selected (statementAtCursor.ts), and briefly
 * highlights what ran.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { SQL_LANGUAGE, setupMonaco } from './monacoSetup'
import { actions, useAppState } from '@renderer/lib/store'
import { useMonacoTheme } from '@renderer/lib/theme'
import { statementAtCursor } from './statementAtCursor'

setupMonaco()

/** Imperative API for panels (recent / starred queries) that load SQL into the editor. */
export interface SqlEditorHandle {
  /** Replaces the whole text (undoable). */
  setValue: (sql: string) => void
  /** Inserts at the cursor / over the selection. */
  insert: (text: string) => void
  getValue: () => string
  focus: () => void
  /** Underlines the word at `offset` (0-based, whole document) as a SQL error. Cleared on the next edit. */
  markError: (offset: number, message: string) => void
  clearErrors: () => void
  /** Same as Cmd+Enter (menu: Query → Run Statement). */
  runStatement: () => void
  /** Same as Cmd+E / Cmd+Shift+E: EXPLAIN the selection or statement at the cursor. */
  explainStatement: (analyze: boolean) => void
}

export const SqlEditor = forwardRef<
  SqlEditorHandle,
  {
    defaultValue: string
    onChange: (sql: string) => void
    /** `offset` = where the executed text starts in the document (for error underlining). */
    onRun: (sql: string, offset: number) => void
    onExplain?: (sql: string, analyze: boolean) => void
    focused: boolean
  }
>(function SqlEditor({ defaultValue, onChange, onRun, onExplain, focused }, ref) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoTheme = useMonacoTheme()
  const fontSize = useAppState((s) => s.settings.editorFontSize)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const runStatementRef = useRef<(() => void) | null>(null)
  const explainRef = useRef<((analyze: boolean) => void) | null>(null)
  useImperativeHandle(
    ref,
    () => ({
      setValue: (sql) => {
        const ed = editorRef.current
        const model = ed?.getModel()
        if (!ed || !model) return
        ed.executeEdits('viewdeck', [{ range: model.getFullModelRange(), text: sql }])
        ed.pushUndoStop()
        ed.focus()
      },
      insert: (text) => {
        const ed = editorRef.current
        const sel = ed?.getSelection()
        if (!ed || !sel) return
        ed.executeEdits('viewdeck', [{ range: sel, text, forceMoveMarkers: true }])
        ed.focus()
      },
      getValue: () => editorRef.current?.getValue() ?? '',
      focus: () => editorRef.current?.focus(),
      markError: (offset, message) => {
        const ed = editorRef.current
        const model = ed?.getModel()
        const monaco = monacoRef.current
        if (!ed || !model || !monaco) return
        const pos = model.getPositionAt(Math.max(0, offset))
        const word = model.getWordAtPosition(pos)
        monaco.editor.setModelMarkers(model, 'viewdeck', [
          {
            severity: monaco.MarkerSeverity.Error,
            message,
            startLineNumber: pos.lineNumber,
            endLineNumber: pos.lineNumber,
            startColumn: word?.startColumn ?? pos.column,
            endColumn: word?.endColumn ?? pos.column + 1
          }
        ])
        ed.revealPositionInCenterIfOutsideViewport(pos)
      },
      runStatement: () => runStatementRef.current?.(),
      explainStatement: (analyze) => explainRef.current?.(analyze),
      clearErrors: () => {
        const model = editorRef.current?.getModel()
        if (model) monacoRef.current?.editor.setModelMarkers(model, 'viewdeck', [])
      }
    }),
    []
  )
  const runRef = useRef(onRun)
  runRef.current = onRun
  const explainCbRef = useRef(onExplain)
  explainCbRef.current = onExplain

  useEffect(() => {
    if (focused) editorRef.current?.focus()
  }, [focused])

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco as unknown as typeof Monaco
    editor.onDidChangeModelContent(() => {
      const model = editor.getModel()
      if (model) monaco.editor.setModelMarkers(model, 'viewdeck', [])
    })
    editor.focus()
    let decorations: Monaco.editor.IEditorDecorationsCollection | null = null

    // IMPORTANT: use addAction, not addCommand. addCommand keybindings are global
    // across all Monaco instances (the last editor to register wins), so with
    // several query tabs Cmd+Enter would run a hidden tab's SQL. Actions are
    // scoped to the focused editor instance.

    // Monaco treats Cmd/Ctrl+K as a chord prefix and swallows it. Claim it for the palette.
    editor.addAction({
      id: 'viewdeck.palette',
      label: 'Command palette',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      run: () => actions.setPalette(true)
    })

    /** The selection, else the statement at the cursor, with its range and document offset. */
    const pickStatement = (): { sql: string; offset: number; range: Monaco.IRange } | null => {
      const model = editor.getModel()
      if (!model) return null
      const sel = editor.getSelection()
      let range: Monaco.IRange | null = null
      let sql = ''
      let offset = 0
      if (sel && !sel.isEmpty()) {
        range = sel
        sql = model.getValueInRange(sel)
        offset = model.getOffsetAt(sel.getStartPosition())
      } else {
        const pos = editor.getPosition()
        const stmt = pos ? statementAtCursor(model.getValue(), model.getOffsetAt(pos)) : null
        if (stmt) {
          const s = model.getPositionAt(stmt.start)
          const e = model.getPositionAt(stmt.end)
          range = new monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column)
          sql = stmt.text
          offset = stmt.start
        }
      }
      return sql.trim() && range ? { sql, offset, range } : null
    }
    const runStatement = (): void => {
      const picked = pickStatement()
      if (!picked) return
      const { sql, offset, range } = picked
      editor.trigger('viewdeck', 'hideSuggestWidget', {}) // don't leave the popup over the editor
      decorations?.clear()
      decorations = editor.createDecorationsCollection([{ range, options: { className: 'vd-ran-statement', isWholeLine: false } }])
      setTimeout(() => decorations?.clear(), 600)
      runRef.current(sql, offset)
    }
    runStatementRef.current = runStatement
    const explain = (analyze: boolean): void => {
      const picked = pickStatement()
      if (picked) explainCbRef.current?.(picked.sql, analyze)
    }
    explainRef.current = explain
    editor.addAction({
      id: 'viewdeck.explain',
      label: 'Explain statement',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE],
      contextMenuGroupId: 'navigation',
      run: () => explain(false)
    })
    editor.addAction({
      id: 'viewdeck.explainAnalyze',
      label: 'Explain analyze statement (rolled back)',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE],
      contextMenuGroupId: 'navigation',
      run: () => explain(true)
    })
    editor.addAction({
      id: 'viewdeck.run',
      label: 'Run statement at cursor / selection',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      contextMenuGroupId: 'navigation',
      run: runStatement
    })
  }

  return (
    <Editor
      defaultLanguage={SQL_LANGUAGE}
      defaultValue={defaultValue}
      theme={monacoTheme}
      onMount={onMount}
      onChange={(v) => onChange(v ?? '')}
      options={{
        fontSize,
        fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, monospace",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: 'on',
        renderLineHighlight: 'line',
        padding: { top: 8 },
        suggest: { showStatusBar: false, preview: true },
        quickSuggestions: { other: true, strings: false, comments: false }
      }}
    />
  )
})
