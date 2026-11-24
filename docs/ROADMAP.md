# ViewDeck Roadmap & Requirements

Living backlog of product requirements after Milestones 1–5. These come from real use
against a production RDS replica (Direct route, IAM auth, read-only) and from a sandbox
UX review with a local Postgres: 50k-row tables, JSON, arrays, enums, uuid, inet, bytea,
NULLs and long text.

**How to use this file (agents and humans):** pick the highest-priority unchecked item.
Read its *Where* pointers, implement it, and meet its *Done when* criteria. Run
`npm run verify` (plus `test:integration` / `test:e2e` when drivers, IPC or UI change).
Tick the box, and commit locally. Follow AGENTS.md invariants, especially read-only
safety, contained user SQL, and no plaintext secrets.

Legend: **P0** = devs hit this daily, **P1** = high-value polish, **P2** = nice to have.

---

## P0: daily-driver essentials

- [x] **1. Autocomplete in every query box (filter bar included).**
  - *What:* the table filter bar's `WHERE` and `ORDER BY` boxes suggest column names
    (with type), SQL keywords and operators (`=`, `IN`, `IS NULL`, `ILIKE`, `BETWEEN`),
    and common functions (`now()`, `lower()`, `coalesce()`, `date_trunc()`) while typing.
    Typing `crea` offers `created_at`. Tab or Enter accepts. Enter with no popup open
    applies the filter, and Esc closes the popup first, then clears.
  - *Why:* the filter bar is the most-used box after the editor, and today it's plain text.
  - *Where:* replace the `<input>`s in `src/renderer/src/features/grid/FilterBar.tsx` with
    one-line Monaco editors (no line numbers, no minimap, `pgsql`), or a lightweight
    completion popover. Feed it the table's columns (`schemaCache.getColumns` /
    `page.data.fields`) plus `SQL_KEYWORDS` from `features/editor/completionContext.ts`.
    Reuse `editor.addAction` for Enter/Esc (never `addCommand`, see AGENTS.md).
  - *Done when:* typing a column prefix shows suggestions with types, accepting inserts a
    correctly quoted identifier (`quoteIfNeeded`), the Enter/Esc semantics above hold, and
    e2e covers `crea` → `created_at`.

- [x] **2. Connection switcher in the top-left.**
  - *What:* the connection name in the workspace header becomes a dropdown. It lists saved
    connections grouped by environment (prod/staging/dev colour dots), the current one is
    marked, and it ends with "+ New AWS connection", "+ Manual connection" and "Manage
    connections…". Switching asks before discarding staged edits.
  - *Where:* `features/workspace/Workspace.tsx` header; reuse the `switchTo` logic in
    `features/palette/paletteItems.ts`. Later, keep tabs per connection (`lib/store.ts`).
  - *Done when:* you can switch or add a connection without going back to Home, staged
    changes are never silently lost, and e2e covers switching.

- [x] **3. Copy cell / row / selection.**
  - *What:* Cmd+C copies the selected cell (or range). A right-click menu on cell, row and
    header offers: Copy value, Copy row as TSV / CSV / JSON / `INSERT` / Markdown, Copy
    column name, Copy column values, Copy as `WHERE col = …` (pastes straight into the
    filter bar). NULL copies as an empty string in TSV and `null` in JSON.
  - *Where:* `features/grid/DataGrid.tsx` (selection state + context menu), with a pure
    formatter module `features/grid/copyFormats.ts` (unit-tested). `INSERT` uses quoted
    identifiers and escaped literals.
  - *Done when:* every format is unit-tested (quoting, NULL, newlines, unicode), and works
    in both the table grid and query results.

- [x] **4. Grid cell selection & keyboard navigation.**
  - *What:* click selects a cell. Arrow keys / Tab move. Shift+arrows or Shift+click
    selects a range. Enter starts editing, Esc cancels, Delete stages a row delete (when
    unlocked), and Cmd+A selects all. The selected cell is always visible (auto-scroll).
  - *Where:* `DataGrid.tsx`. The virtualizer's `scrollToIndex` handles rows; horizontal
    scroll for columns.
  - *Done when:* the grid is fully usable without a mouse. Prerequisite for item 3 ranges.

- [x] **5. Value viewer / editor panel.**
  - *What:* Space or double-click on a read-only cell opens a side panel. It shows full
    text wrapped, JSON/JSONB pretty-printed and collapsible, arrays as lists, bytea as hex
    plus size, and timestamps in local and UTC. It has a copy button, and is editable when
    unlocked (staged like any edit).
  - *Why:* `jsonb`, `notes` and arrays are truncated (`{"items": …`, `Long note…`).
  - *Where:* new `features/grid/ValueViewer.tsx`, opened from `DataGrid` / `TableTab` /
    `QueryTab`.
  - *Done when:* a 10 KB JSON value is readable and copyable, and edits go through staging.

- [x] **6. Edit, duplicate & safely delete saved connections.**
  - *What:* edit any field of a saved connection (name, user, database, route
    Direct/SSM, tunnel host, auth, TLS, environment). Duplicate. Delete needs a
    confirmation that names the connection. Show last-used time.
  - *Why:* today a wrong user (e.g. the master user `db_admin` instead of
    `app_readonly`) means deleting and re-running the wizard. Delete is a hover icon with
    no confirmation.
  - *Where:* `features/connect/ConnectionsHome.tsx`, plus an edit dialog reusing
    `connectionDraft.ts`. `connections:save` already upserts by id.
  - *Done when:* round-trip edit keeps the secret (when the password is unchanged), and
    delete requires confirmation.

- [x] **7. Cancel running queries + statement timeout.**
  - *What:* a Stop button and an elapsed-time counter while a query runs. Cancel sends
    `pg_cancel_backend(pid)` from a separate pool connection. A per-environment default
    `statement_timeout` (e.g. 30s prod, off dev), overridable per tab.
  - *Why:* a mistaken full scan on prod currently can't be stopped from the app.
  - *Where:* new IPC `db:cancelQuery`. `PostgresDriver` tracks the console client's
    backend pid (`SELECT pg_backend_pid()` at checkout). Apply `SET statement_timeout`
    alongside the read-only sync.
  - *Done when:* integration test: `pg_sleep(30)` is cancelled in under 1s, and the timeout
    fires and surfaces as a clear `DB_QUERY_FAILED` ("canceled due to statement timeout").

---

## P1: high-value polish

- [x] **8. Sort by clicking column headers.** Clicking a header toggles asc → desc → none,
  writing `ORDER BY` into the filter bar so it's visible and editable. A header arrow shows
  the state. *Where:* `DataGrid` header + `TableTab` filter state.
- [x] **9. Total row count.** Show an estimated total (`pg_class.reltuples`, already in
  `getTableDetails`) next to the pager, e.g. `1–1000 of ~3.2M`. "Count exactly" runs
  `COUNT(*)` with the current filter, cancellable (item 7).
- [x] **10. Human-readable timestamps.** `timestamptz` cells are truncated. Hover shows
  local time, UTC and relative ("3 days ago"). Epoch-millisecond `int8` columns (e.g.
  `created_at` 1771907103556) get an opt-in "Format as date" per column, remembered per
  table in preferences.
- [x] **11. Foreign-key navigation.** FK cells show a subtle link icon. Cmd+click opens the
  referenced table filtered to that row (`WHERE id = …`). Data is already in
  `TableDetails.constraints` / `referencedBy`. Add "Show referencing rows".
- [x] **12. Type-aware editors.** Enum columns get a dropdown (values from `pg_enum`),
  bool a toggle, date/timestamp a picker, and json a mini editor (item 5).
- [x] **13. Better query results.**
  - Export results to CSV / JSON / clipboard.
  - Multi-statement runs show one result tab per statement.
  - SQL errors underline the failing position in Monaco (Postgres returns `position`;
    pass it through `AppError.context`).
- [x] **14. Dangerous-statement guard.** Even when unlocked, `UPDATE` / `DELETE` without
  `WHERE`, `TRUNCATE` and `DROP` need confirmation. On prod, require typing the database
  name. Pure detection module with tests (reuse `statementAtCursor` lexing).
- [x] **15. Persist workspace across restarts.** Open tabs, editor text, filters, split
  sizes and the active tab, per connection, in `preferences`.
- [x] **16. Saved queries / snippets + history panel.** Name and save queries per
  connection or globally. Searchable history side panel (`history:list`) with re-run and
  copy. Surface both in Cmd+K.
- [x] **17. Richer sidebar.**
  - Views, materialized views, functions, sequences and enums as sections.
  - Estimated row count per table.
  - Right-click: Open, `SELECT … LIMIT 100` in a new tab, Copy name, Copy qualified
    name, Show DDL (info drawer), Refresh. Truncate/Drop guarded by item 14.
- [x] **18. Smarter wizard defaults.** Remember the last DB user, database and route
  (Direct/SSM) per RDS identifier/profile. Don't prefill the master user for IAM auth when
  a previous choice exists. Remember the last region per profile.
- [x] **19. Close the autocomplete popup when a query runs.** After Cmd+Enter the Monaco
  suggest widget stays open over the editor. Trigger `hideSuggestWidget` in the run action
  (`SqlEditor.tsx`).

---

## P2: nice to have

- [x] **20. EXPLAIN / EXPLAIN ANALYZE visualiser.** Tree or flame view with costs, rows
  and timings. Driver capability `supportsExplain` already exists. ANALYZE is blocked
  while read-only unless wrapped in a rolled-back transaction.
  *Done:* `Cmd+E` / `Cmd+Shift+E` (or the Explain menu) show an indented plan tree with
  cost, estimated → actual rows (misestimates ≥ 10× flagged), self time and a heat bar.
  ANALYZE always runs inside `BEGIN … ROLLBACK` (read-only sessions stay read-only), and
  destructive statements still go through the danger confirmation.
- [x] **21. Status bar.** Latency (periodic `SELECT 1`), tunnel health, session age,
  server version. Auto-reconnect when the VPN/tunnel drops, with a banner instead of
  ending the session.
- [x] **22. Multiple sessions side by side.** Split view of two connections or tabs; a
  "compare rows" view.
  *Done:* split view of two tabs (tab-strip button or tab right-click → "Open beside
  current tab"); clicking a pane focuses it, and switching tabs replaces the focused
  pane. Compare rows: right-click with 2 rows selected, or "Pin row for comparison" and
  compare any other row (any tab, table or query result) with it.
  *Not done:* two different **connections** side by side. The renderer holds one live
  session; it needs a per-pane session context (separate follow-up).
- [x] **23. App identity & menus.** The app name shows "Electron" in the macOS menu bar.
  Set the name, an About panel and an icon. Add File / Query / View menus mirroring the
  shortcuts (New Query Tab, Run, Review Changes, Command Palette).
- [x] **24. Settings screen.** Page size, font size, theme (light mode), date display, the
  default read-only policy per environment, and statement-timeout defaults (item 7).
- [x] **25. Packaging & updates.** Signed, notarised `.app` / `.dmg` (electron-builder),
  shipping `resources/` as extraResources (RDS CA bundle), with auto-update.
  *Done:* `npm run dist` builds `.dmg` and `.zip` with `resources/` as extraResources and a
  19 MB asar (only `pg` and the AWS SDK are runtime deps). See `docs/PACKAGING.md`.
  *Needs the owner:* a Developer ID certificate for signing and notarisation (currently
  ad-hoc signed), and a hosted feed URL before auto-update can be switched on.

---

## Known bugs / rough edges

- [x] **B1. Manual "Save & connect" without Test may silently do nothing.** Seen once in the
  sandbox: the dialog closed, no connection was saved, no error. It didn't reproduce on
  retry. Investigate the `ManualConnectionDialog` `run('connect')` flow (dialog close vs.
  error state) and add an e2e for Save without Test.
  *Fixed:* dismissing the dialog while save/connect was in flight hid the later connect
  error, and Home never reloaded, so the saved connection looked missing. The dialog now
  can't close while busy, Home reloads right after the save, the error reads "Saved …, but
  connecting failed", and a retry reuses the saved id (no duplicates). Covered by e2e.
- [x] **B2. Suggest widget stays open after running** (see item 19).

---

## Done (recent, for context)

- [x] Direct route for private RDS over VPN/peering (ADR-004).
- [x] Table filter bar: raw `WHERE` / `ORDER BY`, Cmd+F, contained SQL (`browseSql.ts`).
- [x] Table info panel (ⓘ): stats, indexes (size, scans, unused), constraints, referencing
  FKs, triggers, reconstructed DDL.
- [x] Cmd+K palette, actionable error banners with inline SSO sign-in, docs drift check.
- [x] Right-click menus everywhere (grid, headers, sidebar, tabs, connections, native text menu).
- [x] Fast suggestions: schema snapshot cached per connection (instant on next launch),
  synchronous in-memory index, no IPC per keystroke.
- [x] Query results: live SQL WHERE filter over the loaded rows (client-side, invalid → no
  filter, survives re-runs) and ⌘F find with match highlighting and Enter / ⇧Enter cycling.
- [x] Theme picker in the header (Light / Dark / System, follows macOS live), also in ⌘K;
  native menus match; light-mode colours fixed for banners, JSON tree, diff and grid.
- [x] Run all: statements run one by one (a failure doesn't drop the other results), an All
  tab stacks every query with its output like a terminal, and Copy all copies them in one
  click (Markdown / plain text / JSON). Timestamps there show local and UTC on hover.
- [x] Drag a table from the sidebar into the editor. Ctrl+Tab / Ctrl+Shift+Tab cycle tabs.
  Always-visible "New query" button in the header.
