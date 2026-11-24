/**
 * One-time Monaco configuration.
 *
 * - Bundles a lean Monaco locally (monacoLean.ts) (`loader.config({ monaco })`) instead of
 *   @monaco-editor/react's default CDN load. The CSP forbids remote scripts,
 *   and the app must work offline.
 * - Only the base editor worker is needed (SQL has no language worker).
 * - Registers the schema-aware SQL completion provider (completionContext.ts + schemaCache.ts).
 */
import { loader } from '@monaco-editor/react'
import type * as MonacoApi from 'monaco-editor'
import * as lean from './monacoLean'
import EditorWorker from '@monaco-esm/editor/editor.worker.js?worker'
import { statementAtCursor } from './statementAtCursor'
import { completionContext } from './completionContext'
import { sqlSuggestions, type Suggestion } from './suggestions'
import { schemaCache } from './schemaCache'

/** Runtime from the lean bundle, typed with monaco-editor's public API. */
const monaco = lean as unknown as typeof MonacoApi

/** Language id used by every editor. Monaco's pgsql grammar knows Postgres keywords and functions. */
export const SQL_LANGUAGE = 'pgsql'

let initialised = false

export function setupMonaco(): void {
  if (initialised) return
  initialised = true

  self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
  loader.config({ monaco })

  monaco.editor.defineTheme('viewdeck-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '7DD3FC' },
      { token: 'string', foreground: 'FCD34D' },
      { token: 'number', foreground: 'C4B5FD' },
      { token: 'comment', foreground: '6B7280', fontStyle: 'italic' }
    ],
    colors: {
      'editor.background': '#121214',
      'editor.lineHighlightBackground': '#1c1c20',
      'editorLineNumber.foreground': '#4b4b55',
      'editorGutter.background': '#121214'
    }
  })

  monaco.editor.defineTheme('viewdeck-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '0369A1' },
      { token: 'string', foreground: 'B45309' },
      { token: 'number', foreground: '7C3AED' },
      { token: 'comment', foreground: '6B7280', fontStyle: 'italic' }
    ],
    colors: { 'editor.background': '#FFFFFF' }
  })

  monaco.languages.registerCompletionItemProvider(SQL_LANGUAGE, {
    triggerCharacters: ['.', ' '],
    async provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position)
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
      const full = model.getValue()
      const offset = model.getOffsetAt(position)
      const stmt = statementAtCursor(full, offset)
      const before = full.slice(stmt?.start ?? 0, offset)
      const ctx = completionContext(before, stmt?.text ?? '')
      // Instant path: synchronous lookups in the cached SchemaIndex. Only the very
      // first request of a session (no cached snapshot yet) waits for one round trip.
      const idx = schemaCache.index ?? (await schemaCache.refresh().catch(() => null))
      const items: MonacoApi.languages.CompletionItem[] = sqlSuggestions(ctx, idx).map((s) => toMonacoItem(s, range))
      return { suggestions: items }
    }
  })
}

const KIND: Record<Suggestion['kind'], MonacoApi.languages.CompletionItemKind> = {
  keyword: monaco.languages.CompletionItemKind.Keyword,
  schema: monaco.languages.CompletionItemKind.Module,
  table: monaco.languages.CompletionItemKind.Struct,
  view: monaco.languages.CompletionItemKind.Interface,
  column: monaco.languages.CompletionItemKind.Field,
  function: monaco.languages.CompletionItemKind.Function,
  operator: monaco.languages.CompletionItemKind.Operator
}

/** Maps a pure Suggestion to a Monaco item. `$0` in function snippets becomes the cursor position. */
export function toMonacoItem(s: Suggestion, range: MonacoApi.IRange): MonacoApi.languages.CompletionItem {
  const snippet = s.insertText.includes('$0')
  return {
    label: s.label,
    kind: KIND[s.kind],
    detail: s.detail,
    insertText: s.insertText,
    insertTextRules: snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
    sortText: s.sortText,
    range
  }
}
