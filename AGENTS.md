# AGENTS.md: ViewDeck

> Read this first. It is the operating manual for any AI agent (Claude Code, Cursor,
> Codex, Windsurf) or human working on this repo. `CLAUDE.md` and `.cursorrules` are
> symlinks to this file, so edit **only** `AGENTS.md`.

ViewDeck is a keyboard-first, AWS-native desktop database GUI: Electron, React 19 and
TypeScript. Its core features are AWS SSO / IAM profile auth, RDS discovery, RDS IAM
token auth, and private-VPC access over SSM port-forwarding tunnels. PostgreSQL is the
first engine. Others plug in through the `DatabaseDriver` contract.

Deeper docs:

- [`README.md`](README.md): what the app does and how to run it.
- [`ARCHITECTURE.md`](ARCHITECTURE.md): diagrams, IPC flow, token and tunnel lifecycles.
- [`docs/ROADMAP.md`](docs/ROADMAP.md): **prioritised backlog with acceptance criteria. Start here for new work.**
- [`docs/ADDING_A_DATABASE.md`](docs/ADDING_A_DATABASE.md): how to add an engine.
- [`docs/PACKAGING.md`](docs/PACKAGING.md): building the `.dmg`, signing, runtime-vs-dev dependencies.
- [`docs/adr/`](docs/adr/): why the big decisions were made.

---

## Commands

| Task | Command |
| --- | --- |
| Install (also downloads the Electron binary via `postinstall`) | `npm install` |
| **Everything an agent must pass before committing**: typecheck + unit tests + docs check | `npm run verify` |
| Fail if docs drift from code (IPC channels, modules, scripts) | `npm run check:docs` |
| Dev with HMR | `npm run dev` |
| Typecheck main + preload + shared, and renderer + shared | `npm run typecheck` |
| Unit tests (Vitest, plain Node; DB integration tests auto-skip) | `npm test` |
| Postgres integration tests (starts a local TLS Postgres in `.pgtest/`, needs `brew install postgresql@18`) | `npm run test:integration` |
| End-to-end smoke test (builds, starts test Postgres, drives the real Electron app with Playwright, screenshots in `e2e/.artifacts/`) | `npm run test:e2e` |
| Record the README demo GIF `docs/images/demo.gif` (drives the built app against the test Postgres; needs ffmpeg) | `npm run demo:gif` |
| Regenerate the lean Monaco entry (after upgrading monaco-editor) | `npm run gen:monaco` |
| Re-render `resources/icon.png` from `icon.svg` (black and white app icon) | `npm run gen:icon` |
| Rename the dev `Electron.app` to ViewDeck so the macOS menu bar shows ViewDeck (runs on `postinstall`) | `npm run brand:electron` |
| Production bundle to `out/` | `npm run build` |
| Package `.dmg` + `.zip` into `release/` (see `docs/PACKAGING.md`) | `npm run dist` |
| Package only the `.app` (fast packaged smoke test) | `npm run dist:dir` |
| Run the built bundle | `npm run preview` |

Requires Node ≥ 22.13 (`node:sqlite`). Live AWS features need the AWS CLI v2 and the
`session-manager-plugin` on `PATH`.

**Definition of done for any change:** `npm run verify` passes (typecheck, unit tests,
`check:docs`). Run `npm run test:integration` and `npm run test:e2e` if you touched
drivers, IPC or UI. Make a local commit.

---

## Repo layout

```
src/
  shared/                 Pure TS shared by main, preload AND renderer. No Node/DOM/Electron imports.
    ipc.ts                THE IPC contract: every channel, request and response type.
    environment.ts        prod/staging/dev classification + default read-only policy.
    settings.ts           AppSettings + normalizeSettings (pure). Per-tier read-only/timeout defaults live here.
    update.ts             UpdateStatus + pure helpers (version compare, release asset names, SHA256SUMS parsing).
    types/result.ts       IpcResult<T> / AppError envelope (handlers never throw over IPC).
    types/driver.ts       DatabaseDriver contract + all DB DTOs (QueryResult, StagedChangeset...).
    types/aws.ts          AWS DTOs: AwsProfile, SsoStatus, RdsDatabase, TunnelTarget, TunnelInfo.
    types/connection.ts   SavedConnection (route + auth, no secrets), SessionInfo, QueryHistoryEntry.
    types/diagram.ts      SchemaGraph DTOs for the ER diagram (tables, keys, FKs both directions).
  main/                   Electron main process (Node). All privileged work lives here.
    index.ts              App lifecycle, BrowserWindow, security flags, quit hooks.
    menu.ts               Native menu + app identity. Mirrored shortcuts use registerAccelerator:false
                          and send `menu:command` (the renderer acts), so Monaco keeps its keys.
    ipc/registry.ts       registerHandler(): typed ipcMain.handle wrapper → IpcResult.
    ipc/toAppError.ts     AppErrorException + error normalisation.
    services.ts           Composition root: builds every service singleton (getServices()).
    ipc/handlers/         One file per domain (`<domain>Handlers.ts`), wired in handlers/index.ts.
    ipc/events.ts         broadcast(): typed main → renderer push events (IpcEvents).
    ipc/validate.ts       Runtime validation of renderer input (requireString / requirePort).
    ipc/validateDb.ts     Validation of connection settings, SQL params and staged changesets.
    nativeTheme.ts        nativeTheme.themeSource + window background follow the theme setting.
    update/UpdateService.ts   GitHub Releases check, update lifecycle (UpdateStatus), 12 h schedule.
    update/UpdateInstaller.ts Download + SHA-256 + ditto + codesign verify; post-exit bundle swap script.
    ipc/handlers/updateHandlers.ts  update:getStatus / check / download / restart.
    resources.ts          Bundled resource paths (dev vs packaged) + cached RDS CA bundle.
    process/ChildProcessRegistry.ts  Spawns + tracks every child; kills whole process groups.
    aws/AwsProfileService.ts   ~/.aws profile discovery + `aws sso login` orchestration.
    aws/ssoTokenCache.ts       Reads ~/.aws/sso/cache token state (no network).
    aws/iniParser.ts           INI parser for ~/.aws files.
    aws/credentials.ts         AwsClientFactory: memoised per-profile credentials + SDK client cache.
    aws/awsErrors.ts           SDK / credential errors → AppError codes (SSO expired, access denied...).
    aws/RdsDiscoveryService.ts Postgres RDS instances + Aurora/Multi-AZ clusters.
    aws/TunnelTargetService.ts SSM-online EC2 instances in a VPC.
    aws/SsmTunnelManager.ts    SSM port-forward tunnels: port alloc, readiness, retry, cleanup.
    aws/RdsIamSignerService.ts Per-connection RDS IAM token provider for pg.Pool.
    aws/cliPath.ts             Finds `aws` / `session-manager-plugin` beyond Finder's minimal PATH.
    aws/freePort.ts            Ephemeral 127.0.0.1 port allocation.
    testing/fakeChild.ts  Test-only fake ChildProcess. Never import from app code.
    aws/remediation.ts         AppErrors for missing AWS CLI / session-manager-plugin (install commands).
    drivers/DriverFactory.ts   Engine → driver registry (exhaustive over DatabaseEngine).
    drivers/types.ts           DriverDeps injected into drivers (password, IAM provider, CA).
    drivers/postgres/PostgresDriver.ts  Pool + pinned console client, read-only sync, commit.
    drivers/postgres/pgConfig.ts        DriverConnectionConfig → pg.PoolConfig (IAM fn, TLS SNI).
    drivers/postgres/changesetSql.ts    StagedChangeset → parameterised SQL (preview == commit).
    drivers/postgres/introspection.ts   pg_catalog queries for schemas/tables/columns/PKs.
    drivers/postgres/typeParsers.ts     Keep PG text values exact and IPC-safe.
    drivers/postgres/pgErrors.ts        SQLSTATE / socket / TLS errors → AppError codes.
    drivers/postgres/readOnly.ts        ReadOnlyTracker (per-client sync) + READ_WRITE_ESCAPE guard.
    drivers/postgres/commit.ts          runInTransaction: BEGIN/COMMIT with expected-row checks.
    drivers/postgres/browseSql.ts       Table-browser SELECT with contained filter-bar WHERE / ORDER BY.
    drivers/postgres/tableDetails.ts    Catalog + pg_stat queries for the table info panel.
    drivers/postgres/tableDdl.ts        Pure DDL reconstruction (no pg_get_tabledef) + size formatting.
    drivers/postgres/schemaSnapshot.ts  Whole-catalog snapshot (schemas, search_path, tables+columns).
    drivers/postgres/catalog.ts         Catalog reads (schemas/tables/columns/PKs) + result shaping.
    drivers/postgres/statementTimeout.ts StatementTimeoutTracker (statement_timeout synced at checkout).
    drivers/postgres/schemaObjects.ts   Functions / sequences / types + their CREATE definitions.
    drivers/postgres/explain.ts         EXPLAIN (FORMAT JSON) as a named statement; ANALYZE in BEGIN … ROLLBACK.
    drivers/postgres/schemaGraph.ts     One schema's tables/columns/keys/FKs (4 catalog queries) for the ER diagram.
    db/SessionManager.ts       Live sessions: driver + tunnel paired lifecycle.
    db/resolveConnection.ts    SavedConnection → DriverConnectionConfig (+ opens tunnel).
    store/LocalStore.ts        node:sqlite at <userData>/viewdeck.sqlite + migrations.
    store/SecretStore.ts       safeStorage-encrypted passwords (refuses without OS keyring).
    store/ConnectionRepository.ts, QueryHistoryRepository.ts, PreferencesRepository.ts,
    store/SavedQueryRepository.ts (starred queries; migration v2)
  preload/
    index.ts              contextBridge: exposes allow-listed `window.viewdeck.invoke`. Nothing else.
    index.d.ts            `Window.viewdeck` typing for the renderer.
  renderer/               React 19 UI (browser context, untrusted).
    index.html            CSP lives here.
    src/main.tsx          React root.
    src/App.tsx           Screen router (home → AWS wizard → workspace) + session:lost handling.
    src/lib/ipc.ts        call() (unwraps IpcResult, throws IpcError), onEvent(), asAppError().
    src/lib/store.ts      Tiny external store: screen, session, tabs (useAppState selector hook).
    src/lib/useAsync.ts   Data-fetching hook with stale-response protection.
    src/lib/hotkeys.ts    useHotkey('mod+s', …): Cmd on macOS, Ctrl elsewhere.
    src/lib/theme.ts      useApplyTheme (html.dark ⇄ settings/system, live OS changes), useMonacoTheme, setTheme.
    src/features/settings/ SettingsDialog (⌘,), ThemeMenu (header Light / Dark / System picker).
    src/features/update/  UpdateBanner (bottom-right card: Update now → progress → Restart now / Later).
    src/lib/updates.ts    checkForUpdatesNow() for the menu item and ⌘K ("You're on the latest version").
    src/components/ui/    shadcn/ui primitives (button, primitives, dialog/sheet). Owned by us; edit freely.
    src/components/       ErrorBanner (renders AppError steps/command/docs + inline SSO sign-in & retry),
                          ErrorBoundary (render-crash fallback), EnvironmentBar, Toaster.
    src/components/ui/context-menu.tsx  Radix ContextMenu wrappers (all in-app right-click menus).
    src/lib/clipboard.ts  copyText(): clipboard via main (app:writeClipboard) + toast.
    src/lib/workspacePersistence.ts  Per-connection tabs / editor text / filters in prefs
                          (debounced, max 3 s, flushed before leave/switch/unload).
    src/lib/splitView.ts  Split view rules (two tabs side by side), applied by the store.
    src/lib/reconnect.ts  session:lost → reconnect with backoff (1/3/10/30 s), keeping tabs.
    src/lib/sessions.ts   enterSession / connectTo / leaveSession / hasStagedEdits: every connect
                          entry point goes through these, so a previous session is always closed.
    src/components/ConfirmDialog.tsx, components/ui/dropdown-menu.tsx
    src/features/connect/ ConnectionsHome, ManualConnectionDialog, EditConnectionDialog, editDraft.ts (pure),
                          connectionDraft.ts (pure),
                          awsWizard/{AwsWizard,StepProfile,StepDatabase,StepConnect}.tsx
    src/features/workspace/ Workspace (layout, tabs), ConnectionSwitcher (top-left), SchemaExplorer,
                          SchemaObjectsGroup (functions/sequences/types), ReadOnlyToggle, StatusBar.
    src/features/editor/  SqlEditor (Monaco), QueryTab, statementAtCursor.ts, completionContext.ts,
                          schemaCache.ts (snapshot cache, persisted per connection), schemaIndex.ts
                          (sync lookups), suggestions.ts (pure suggestion builder), MiniSqlInput
                          (one-line Monaco with autocomplete), QueriesPanel (Recent / Starred),
                          StarQueryDialog, TimeoutPicker, dangerGuard.ts (pure) + DangerConfirmDialog,
                          planTree.ts (pure EXPLAIN model) + PlanView (plan tree),
                          QueryResults (result tabs, Export, status), ResultToolbar + useResultFilter
                          (live client-side WHERE filter and ⌘F find over the loaded rows), ScriptOutputView (All tab
                          of a multi-statement run + Copy all), scriptOutput.ts (pure: psql-style
                          tables, Copy all as Markdown / text / JSON),
                          monacoSetup.ts, monacoLean.ts (GENERATED).
    src/features/grid/    DataGrid (TanStack Table + Virtual), CellEditor, TableTab,
                          SqlDiffDrawer (Cmd+S), stagedChanges.ts (pure staged-edit model),
                          FilterBar (raw WHERE / ORDER BY, Cmd+F), TableInfoDrawer (ⓘ: stats, indexes, DDL),
                          GridContextMenu (right-click), useGridSelection (cursor/rows/keyboard),
                          ValueViewer + JsonTree (cell inspector, collapsible JSON;
                          ⌘F find via ValueFindBar + valueSearch.ts, pure), copyFormats.ts /
                          jsonPath.ts (pure clipboard + path builders), sortOrder.ts (header sort ⇄ ORDER BY),
                          gridColumns.tsx (columns + cell display/tooltips), valueFormat.ts (timestamps,
                          epoch → date), fkLinks.ts (FK navigation targets), useTableExtras.ts
                          (column meta, formats, totals, FKs for TableTab), compareRows.ts (pure) +
                          CompareRowsDialog (two rows side by side, differences highlighted),
                          resultFilter.ts (pure: SQL WHERE parser/evaluator for loaded rows; invalid → no filter).
    src/features/palette/ CommandPalette (Cmd+K), paletteItems.ts (sources), fuzzy.ts (pure matcher).
    src/features/diagram/ ER diagram tab. Pure model: graphModel.ts (nodes, typed edges, clusters, hubs),
                          inferRelations.ts (FK-less relationships from naming), joinPath.ts (shortest
                          join path + SQL), clusterMerge.ts. View: DiagramTab (React Flow), TableNode /
                          ClusterNode (semantic zoom), RelationEdge (crow's-foot markers), DiagramLegend (ⓘ),
                          DiagramHover, DiagramSidebar (search, relate, clusters, hubs), useSchemaDiagram
                          (cache → fetch → model → layout), diagramLayout.ts + layout.worker.ts (ELK in a
                          Web Worker), diagramCache.ts (graph + layout + dragged positions per connection).
    src/lib/utils.ts      cn() helper.
    src/styles/globals.css Tailwind v4 + theme tokens (CSS variables, dark default).
resources/                Bundled static assets: rds-global-bundle.pem (AWS RDS CA, all regions),
                          icon.svg (source) / icon.png (app + dock icon, `npm run gen:icon`).
scripts/                  Dev scripts (start-test-postgres.sh for integration and e2e tests).
e2e/                      Playwright-driven Electron smoke test (smoke.e2e.mjs).
docs/                     Guides + ADRs.
```

Path aliases: `@shared/*` → `src/shared/*` (all bundles), `@renderer/*` →
`src/renderer/src/*` (renderer only). Defined in `electron.vite.config.ts`,
`tsconfig.*.json` and `vitest.config.mts`. Keep all three in sync. `@monaco-esm/*` →
`node_modules/monaco-editor/esm/vs/*` exists only in the renderer Vite config (see § Monaco).

---

## Invariants: never break these

1. **Process boundary.** The renderer never imports Node, Electron, `pg`, or the AWS SDK.
   It talks to main **only** through `window.viewdeck.invoke(...)`.
2. **BrowserWindow security flags** stay `contextIsolation: true`, `sandbox: true`,
   `nodeIntegration: false`. The preload never exposes raw `ipcRenderer`.
3. **One IPC contract.** Every channel is declared in `src/shared/ipc.ts` (`IpcContract`
   **and** `IPC_CHANNELS`, which a compile-time assertion keeps aligned). No string
   channel names anywhere else.
4. **Handlers never throw across IPC.** Use `registerHandler`. It wraps results in
   `IpcResult<T>`. For a user-actionable failure, throw `AppErrorException` with a
   specific `AppErrorCode` and a `hint`.
5. **IPC payloads are structured-clone safe.** No class instances, functions, `Buffer`,
   or `BigInt`. Drivers normalise values to `CellValue`.
6. **No plaintext secrets on disk.** Passwords are encrypted with Electron `safeStorage`
   before they reach LocalStore. AWS credentials are never persisted by ViewDeck. They
   are resolved from `~/.aws` at use time.
7. **RDS IAM tokens are never cached as a static pool password.** `pg.Pool` gets
   `password: async () => signer.getAuthToken()`, so each new physical connection signs
   a fresh token (tokens expire after 15 minutes). See ADR-002.
8. **TLS over tunnels verifies the real RDS hostname.** When the socket host is
   `127.0.0.1` (SSM tunnel), set `ssl.servername` to the RDS endpoint and `ssl.ca` to
   the bundled RDS CA. Never "fix" a TLS error with `rejectUnauthorized: false`.
9. **Every spawned child process is tracked** (SSM tunnels, `aws sso login`) and killed
   on disconnect, crash, and `before-quit` / `will-quit`. No orphans. The single exception is
   the update swap script (`ChildProcessRegistry.spawnDetachedAfterExit`), which must run
   after the app exits. Never use that method for anything else.
10. **Writes are staged, previewed, and transactional.** The grid never writes on cell
    edit. `Cmd/Ctrl+S` shows the exact parameterised SQL in `BEGIN … COMMIT`, and
    commit is all-or-nothing. User values are **always** bound parameters, and
    identifiers are always quoted by the driver. See ADR-003.
11. **Filter-bar SQL is contained, never trusted.** `selectRows` `where` / `orderBy` are raw
    user SQL (same power as the editor). `browseSql.ts` must keep them parenthesised and
    on their own lines, the query must use bound parameters (which blocks a second
    statement), and the read-only escape guard applies.
12. **Connection safety defaults come from `AppSettings`** (`settings.readOnlyDefaults` /
    `timeoutDefaults`, normalised by `normalizeSettings`). Defaults: everything but dev
    starts read-only. `resolveConnection` is the only place they are applied.
13. **Destructive SQL asks first even when unlocked.** `QueryTab.requestRun` runs
    `findDangers` (UPDATE/DELETE without WHERE, TRUNCATE, DROP, ALTER … DROP). Prod
    requires typing the database name. Never add an editor run path that skips `requestRun`.
14. **Read-only is synced at every client checkout.** PostgresDriver re-asserts
    `default_transaction_read_only` on each checkout while locked, and rejects SQL that
    would undo it (`READ_WRITE_ESCAPE`, `drivers/postgres/readOnly.ts`). Never add a query
    path that bypasses `withClient()` / `getConsoleClient()`.
15. **Unknown environments are treated like prod** (read-only by default).
    `defaultReadOnly()` in `src/shared/environment.ts` is the single policy point.
16. **Drivers are engine-isolated.** The UI branches on `DriverCapabilities`, never on
    `engine === 'postgres'`.

---

## Coding conventions

- TypeScript `strict` + `noUncheckedIndexedAccess` + `noUnusedLocals`. No `any`. Use `unknown` and narrow it.
- Aim for **< 300 lines per file**. Split by responsibility and use descriptive names
  (`SsmTunnelManager.ts`, not `utils2.ts`).
- **TSDoc on every export**: interfaces, IPC channels, services, non-trivial functions.
  Explain *why*, especially for edge cases (SNI over tunnels, token expiry, quoting).
- Services in main are classes with injected dependencies (AWS clients, `spawn`,
  clock), so they can be unit-tested without AWS or Electron. They are wired once in
  `src/main/services.ts`. Handlers call `getServices()`.
- Spawn child processes **only** through `ChildProcessRegistry`, never `child_process`
  directly, so quit cleanup sees them. Pass `cliEnv()` as the env for AWS CLI children.
- AWS SDK calls go through `AwsClientFactory` and are wrapped in `withAwsErrors(profile, …)`.
- Tests are co-located as `*.test.ts` and run with Vitest in plain Node. Mock AWS and
  child processes. Tests must not need network or credentials.
- Renderer: function components, Tailwind utility classes, shadcn primitives in
  `components/ui`. Keep it dense: 13px base text, `h-7` controls.
- Formatting: 2-space indent, single quotes, no semicolons.
- Write files with an editor tool, not giant shell heredocs. Heredocs containing SQL
  can trip command-safety checks.
- Integration tests are named `*.integration.test.ts` and must `describe.skipIf` when
  their env is missing, so `npm test` stays hermetic.

## Keyboard shortcuts

| Shortcut | Action | Where it is bound |
| --- | --- | --- |
| `Cmd/Ctrl+K` | Command palette: tables, schemas, recent queries, connections, actions | `App.tsx` (`useHotkey`) + `SqlEditor` (`addAction`, Monaco swallows Cmd+K) |
| `Cmd/Ctrl+Enter` | Run the selection, or the statement at the cursor | `SqlEditor` (`addAction`) |
| `Cmd/Ctrl+E` / `Cmd/Ctrl+Shift+E` | EXPLAIN / EXPLAIN ANALYZE (rolled back) the selection or statement at the cursor | `SqlEditor` (`addAction`) |
| `Cmd/Ctrl+S` | Review staged grid changes (SQL diff drawer) | `TableTab` (`useHotkey`, active tab only) |
| `Cmd/Ctrl+T` | New query tab | `App.tsx` |
| `Cmd/Ctrl+F` | Table tab: focus the filter bar (`Enter` applies, `Esc` clears). Query tab: find in results (`Enter` / `Shift+Enter` next / previous, `Esc` clears); inside the SQL editor it is Monaco's VS Code-style Find (the arrow opens Replace; `Cmd/Ctrl+Alt+F` opens Find + Replace). Cell inspector: find in the value | `TableTab` / `QueryTab` (`useHotkey`, active tab only) |
| `Cmd/Ctrl+,` | Settings | `App.tsx` + menu |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous workspace tab (literal Ctrl on every OS) | `App.tsx` (`useHotkey('ctrl+tab')`) |
| Arrows, `Tab`, `Home`/`End`, `Cmd+↑/↓` | Move the grid cell cursor; `Shift` extends row selection; `Cmd+A` selects all rows | `useGridSelection` |
| `Cmd/Ctrl+C` (grid) | Copy cell, or selected rows as TSV | `DataGrid` |
| `Space` / double-click | Open the value viewer (JSON tree for json/jsonb); double-click edits plain editable cells | `DataGrid` → `ValueViewer` |
| `Enter` / `Esc` | Edit cell / commit; cancel a cell edit | `DataGrid`, `CellEditor` |
| `Delete` (grid) | Stage deletes for selected rows (unlocked, PK tables) | `DataGrid` |

## Error model

Every user-facing failure is an `AppError` (`src/shared/types/result.ts`): a stable
`code` plus optional `hint`, `steps` (troubleshooting checklist), `command`
(copyable fix), `docsUrl` and `context` (e.g. `profile`). Producers live next to the
code that fails: `aws/awsErrors.ts`, `aws/remediation.ts`, `SsmTunnelManager.classifyExit`
and `drivers/postgres/pgErrors.ts`. `<ErrorBanner>` renders all of it. For
`AWS_SSO_EXPIRED` with `context.profile` it offers inline "Sign in with AWS SSO" and then
calls `onRetry`, so pass `onRetry` wherever an AWS-backed call can fail. When you add a
failure mode, add a code (or reuse one), give it steps or a command, and unit-test the
mapping.

## Renderer conventions

- Right-click menus use `components/ui/context-menu.tsx` (Radix). Radix prevents the DOM
  event, so main's native Cut/Copy/Paste menu (`index.ts`, `context-menu` handler) only
  appears on text fields and selections nothing else handled.
- Open or close sessions only through `lib/sessions.ts` (never `actions.openSession` +
  `db:connect` by hand), and guard switches and disconnects with `hasStagedEdits()` +
  `ConfirmDialog`. Never use `window.confirm`: it blocks Electron's renderer.
- Copy through `copyText()` (`lib/clipboard.ts`), never `navigator.clipboard`. It goes via
  main and shows a toast.
- Talk to main only through `call()` / `onEvent()` from `lib/ipc.ts`. Show failures
  with `<ErrorBanner error={asAppError(err)} />`.
- `useAppState(selector)` selectors must return existing references (state fields), not
  new objects or arrays, or `useSyncExternalStore` re-renders forever.
- Keep logic that decides SQL or data shapes in pure `.ts` modules with tests
  (`stagedChanges.ts`, `connectionDraft.ts`, `statementAtCursor.ts`,
  `completionContext.ts`). Components stay thin.
- Inactive workspace tabs stay mounted (hidden) so editor text, results and staged edits
  survive tab switches. The visible tab panel has `data-active="true"`; e2e selectors
  rely on it.
- Global shortcuts use `useHotkey(combo, handler, enabled)`. Pass `enabled = isActiveTab`.
  Inside Monaco, use `editor.addAction({ keybindings })` (Monaco swallows key events).
  **Never `editor.addCommand`**: its keybindings are global across Monaco instances, so
  the last tab to mount would receive every tab's Cmd+Enter.
- Autocomplete must stay synchronous: build suggestions from `schemaCache.index`
  (`SchemaIndex`) with `suggestions.ts`. Never add an IPC call per keystroke. Short SQL
  fields use `MiniSqlInput` (own language id `vd-sql-inline`, per-instance suggestion
  source, Enter/Esc gated on `!suggestWidgetVisible`, Cmd+F overridden).

## Monaco

Monaco is bundled locally (`loader.config({ monaco })`). The CDN default would break
the CSP and offline use. `features/editor/monacoLean.ts` is **generated** from
`monaco-editor/esm/vs/editor/editor.main.js` with every `languages/*` import removed
(that drops about 15 MB of TS/CSS/HTML/JSON workers), plus the `pgsql` grammar. After
upgrading `monaco-editor`, run `npm run gen:monaco` (scripts/gen-monaco-lean.mjs) and then
`npm run test:e2e`.

## Adding an IPC channel (checklist)

1. Add the type to `IpcContract` and the name to `IPC_CHANNELS` in `src/shared/ipc.ts`.
2. Implement it in `src/main/ipc/handlers/<domain>Handlers.ts` with `registerHandler`.
   Register the domain in `handlers/index.ts`. Validate every request field with
   `ipc/validate.ts`, because renderer input is untrusted.
3. Call it from the renderer with `window.viewdeck.invoke('<domain>:<action>', req)`.
4. Add a row to the IPC table in `ARCHITECTURE.md`.

## Adding a push event

Declare it in `IpcEvents` **and** `IPC_EVENTS` (`src/shared/ipc.ts`), send it with
`broadcast()` (`src/main/ipc/events.ts`), and subscribe with
`window.viewdeck.on(event, cb)`, which returns an unsubscribe function.

## Adding a database engine

Follow [`docs/ADDING_A_DATABASE.md`](docs/ADDING_A_DATABASE.md). In short: extend
`DatabaseEngine`, implement `DatabaseDriver` in `src/main/drivers/<engine>/`, and
register it in `DriverFactory`. Nothing in `src/renderer` or `src/main/aws` should need
to change.

---

## Git workflow (public repo)

- The repo is **public** on GitHub. Remote `origin` uses the SSH host alias
  `github-personal` (a separate key in `~/.ssh/config`), so pushes go out as the
  project's account, not a work account. Push only `main`:
  `git push origin main`.
- **Never push `archive/private-history`.** It holds the pre-publication commits, which
  name private infrastructure. It stays on this machine only.
- **Nothing private in commits.** No real hostnames, database / schema / user names,
  AWS profiles or account IDs, and no screenshots of real data. Use neutral fixtures
  (`acme`, `billing`, `orders.abc.us-east-1.rds.amazonaws.com`, `111111111111`).
- Commit identity is set in this repo's local git config (the account's GitHub noreply
  address). Don't override it with a work email.
- Branch: `main`. Conventional Commit messages (`feat`, `fix`, `chore`, `docs`,
  `refactor`, `test`). Run `npm run verify` before each commit.
- Never commit `.env`, `*.sqlite`, `out/`, `dist/`, `release/`, `.claude/` or
  `node_modules/` (see `.gitignore`).

## CI and repo rules

GitHub Actions (`.github/workflows/`), with actions pinned to commit SHAs and a read-only token:

- `ci.yml`: on every push to `main` and every PR. `verify` (Linux), `integration`
  (Linux, Postgres 18 from PGDG, `PG_BIN` picks it) and `e2e` (macOS, Homebrew Postgres 18).
  These three are the required status checks on `main`.
- `codeql.yml`: CodeQL for TypeScript and the workflows (PRs, `main`, weekly).
- `dependabot.yml`: weekly grouped npm and Actions updates with a 14-day cooldown.
  When pinning a new action by hand, use a release that is at least two weeks old.

`main` is protected: PRs need passing checks and a code-owner review (`.github/CODEOWNERS`),
and force-push and deletion are blocked. The owner may bypass, for solo pushes.

## Keeping docs in sync

`npm run check:docs` enforces the mechanical part: IPC channels and events in
ARCHITECTURE.md, every source module named somewhere, every npm script documented. When
you add a module, an IPC channel, or a database feature:

- Update the **Repo layout** above and the module map in `ARCHITECTURE.md`.
- Add new IPC channels to the IPC table in `ARCHITECTURE.md`.
- If you change a decision recorded in an ADR, add a new ADR that supersedes it. Don't
  rewrite history.

## Milestone status

| # | Milestone | Status |
| --- | --- | --- |
| 1 | Git, scaffold, agent docs, typed IPC | ✅ done |
| 2 | AWS profiles, SSO, RDS discovery, SSM tunnels, IAM signer | ✅ done |
| 3 | Driver layer, PostgresDriver, LocalStore | ✅ done |
| 4 | Connection wizard, workspace, Monaco, virtual grid, staged edits | ✅ done |
| 5 | Error states, shortcuts, final doc audit | ✅ done |
