/** Vite worker import of Monaco's base editor worker via the @monaco-esm alias. */
declare module '@monaco-esm/editor/editor.worker.js?worker' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

/** Monaco's pgsql Monarch grammar (reused for the inline SQL inputs). */
declare module '@monaco-esm/languages/definitions/pgsql/pgsql.js' {
  export const conf: unknown
  export const language: unknown
}
