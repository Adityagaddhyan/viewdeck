/**
 * One-line SQL input with Postgres highlighting and autocomplete (Monaco), for
 * the table filter bar and any other short SQL fields.
 *
 * - Uses its own language id (`vd-sql-inline`, sharing the pgsql grammar), so
 *   its completion provider never leaks into the main editor and vice versa.
 * - Each instance supplies its suggestions via `suggest()`. A single global
 *   provider looks them up by model URI.
 * - Enter / Esc are bound with `precondition: '!suggestWidgetVisible'`: with the
 *   popup open they accept or close a suggestion, otherwise they submit / clear.
 *   Pasted newlines collapse to spaces.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type * as MonacoApi from 'monaco-editor'
import { conf, language } from '@monaco-esm/languages/definitions/pgsql/pgsql.js'
import { setupMonaco, toMonacoItem } from './monacoSetup'
import type { Suggestion } from './suggestions'
import { useMonacoTheme } from '@renderer/lib/theme'
import * as lean from './monacoLean'

setupMonaco()
const monaco = lean as unknown as typeof MonacoApi
export const INLINE_LANGUAGE = 'vd-sql-inline'
const sources = new Map<string, () => Suggestion[]>()
let registered = false

function registerInlineLanguage(): void {
  if (registered) return
  registered = true
  monaco.languages.register({ id: INLINE_LANGUAGE })
  monaco.languages.setMonarchTokensProvider(INLINE_LANGUAGE, language as MonacoApi.languages.IMonarchLanguage)
  monaco.languages.setLanguageConfiguration(INLINE_LANGUAGE, conf as MonacoApi.languages.LanguageConfiguration)
  monaco.languages.registerCompletionItemProvider(INLINE_LANGUAGE, {
    triggerCharacters: [' ', '.', '('],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position)
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
      const items = (sources.get(model.uri.toString())?.() ?? []).map((s) => toMonacoItem(s, range))
      return { suggestions: items }
    }
  })
}

export interface MiniSqlInputHandle {
  focus: () => void
}

export const MiniSqlInput = forwardRef<
  MiniSqlInputHandle,
  {
    value: string
    onChange: (v: string) => void
    onSubmit: () => void
    onEscape?: () => void
    /** Cmd/Ctrl+F inside the input (overrides Monaco's Find widget, which makes no sense on one line). */
    onFind?: () => void
    suggest: () => Suggestion[]
    placeholder?: string
    ariaLabel: string
  }
>(function MiniSqlInput({ value, onChange, onSubmit, onEscape, onFind, suggest, placeholder, ariaLabel }, ref) {
  registerInlineLanguage()
  const monacoTheme = useMonacoTheme()
  const editorRef = useRef<MonacoApi.editor.IStandaloneCodeEditor | null>(null)
  const cb = useRef({ onSubmit, onEscape, onFind, suggest, onChange })
  cb.current = { onSubmit, onEscape, onFind, suggest, onChange }

  useImperativeHandle(ref, () => ({ focus: () => editorRef.current?.focus() }), [])

  // Values this editor emitted since the parent last caught up. With fast typing
  // and a slow parent re-render, renders arrive several keystrokes behind the
  // editor; writing such a stale value back would reset the cursor and scramble
  // the text. So only values that did NOT come from typing here (Clear, "Filter by
  // this value") are written into the editor.
  const emitted = useRef(new Set<string>())
  useEffect(() => {
    const ed = editorRef.current
    if (!ed) return
    if (ed.getValue() === value) emitted.current.clear() // caught up
    else if (!emitted.current.has(value)) {
      emitted.current.clear()
      ed.setValue(value)
    }
  }, [value])

  useEffect(
    () => () => {
      const uri = editorRef.current?.getModel()?.uri.toString()
      if (uri) sources.delete(uri)
    },
    []
  )

  const onMount: OnMount = (editor) => {
    editorRef.current = editor
    const uri = editor.getModel()?.uri.toString()
    if (uri) sources.set(uri, () => cb.current.suggest())
    editor.addAction({ id: 'vd.inline.submit', label: 'Apply', keybindings: [monaco.KeyCode.Enter], precondition: '!suggestWidgetVisible', run: () => cb.current.onSubmit() })
    editor.addAction({ id: 'vd.inline.escape', label: 'Clear', keybindings: [monaco.KeyCode.Escape], precondition: '!suggestWidgetVisible', run: () => cb.current.onEscape?.() })
    editor.addAction({
      id: 'vd.inline.find',
      label: 'Focus filter',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF],
      run: () => (cb.current.onFind ? cb.current.onFind() : editor.setSelection(editor.getModel()?.getFullModelRange() ?? editor.getSelection()!))
    })
    editor.onDidChangeModelContent(() => {
      const v = editor.getValue()
      if (/[\r\n]/.test(v)) editor.setValue(v.replace(/\r?\n/g, ' '))
      else {
        emitted.current.add(v)
        cb.current.onChange(v)
      }
    })
  }

  return (
    <div className="h-7 min-w-0 flex-1 overflow-hidden rounded-md border border-input bg-background px-1 focus-within:ring-2 focus-within:ring-ring" aria-label={ariaLabel}>
      <Editor
        height={26}
        defaultLanguage={INLINE_LANGUAGE}
        defaultValue={value}
        theme={monacoTheme}
        onMount={onMount}
        options={{
          placeholder,
          fontSize: 12,
          fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, monospace",
          lineNumbers: 'off',
          glyphMargin: false,
          folding: false,
          lineDecorationsWidth: 4,
          lineNumbersMinChars: 0,
          minimap: { enabled: false },
          scrollbar: { vertical: 'hidden', horizontal: 'hidden', handleMouseWheel: false },
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          renderLineHighlight: 'none',
          scrollBeyondLastLine: false,
          wordWrap: 'off',
          contextmenu: false,
          fixedOverflowWidgets: true,
          automaticLayout: true,
          padding: { top: 4, bottom: 0 },
          quickSuggestions: { other: true, strings: false, comments: false },
          suggest: { showStatusBar: false, preview: true }
        }}
      />
    </div>
  )
})
