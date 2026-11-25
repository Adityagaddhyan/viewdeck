// End-to-end smoke test: drives the BUILT Electron app (out/) with Playwright.
//
//   npm run test:e2e     (builds, starts the local TLS test Postgres, runs this)
//
// Isolation: VIEWDECK_USER_DATA points userData at a temp dir (real saved
// connections are never touched), and VIEWDECK_E2E=1 uses Chromium's mock
// keychain (no macOS Keychain prompts). Screenshots go to e2e/.artifacts/.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import pg from 'pg'
import { _electron as electron } from 'playwright-core'

const PORT = Number(process.env.VIEWDECK_PG_TEST_PORT ?? 0)
const PASSWORD = process.env.VIEWDECK_PG_TEST_PASSWORD ?? ''
if (!PORT || !PASSWORD) throw new Error('Run via `npm run test:e2e` (needs VIEWDECK_PG_TEST_* env).')

const ART = join(import.meta.dirname, '.artifacts')
mkdirSync(ART, { recursive: true })
const userData = mkdtempSync(join(tmpdir(), 'viewdeck-e2e-'))
// Fake AWS config: profile discovery is real, but every AWS API call goes to a
// closed local port (AWS_ENDPOINT_URL), so the test never reaches real AWS.
const awsDir = mkdtempSync(join(tmpdir(), 'viewdeck-e2e-aws-'))
writeFileSync(join(awsDir, 'config'), '[profile e2e-staging]\nregion = eu-west-1\n')
writeFileSync(join(awsDir, 'credentials'), '[e2e-staging]\naws_access_key_id = AKIAE2EFAKE\naws_secret_access_key = fake\n')
const exportDir = join(userData, 'exports')
mkdirSync(exportDir, { recursive: true })
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const db = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: PASSWORD, database: 'postgres', ssl: { rejectUnauthorized: false } })

const step = (msg) => console.log(`  ✓ ${msg}`)
const shot = (page, name) => page.screenshot({ path: join(ART, `${name}.png`) })

await db.connect()
await db.query(`
  DROP TABLE IF EXISTS e2e_lines, e2e_orders, e2e_nopk;
  DROP TYPE IF EXISTS e2e_mood;
  CREATE TYPE e2e_mood AS ENUM ('sad', 'ok', 'happy');
  CREATE TABLE e2e_orders (id int PRIMARY KEY, status text NOT NULL, amount numeric(10,2), meta jsonb, created_ms int8, mood e2e_mood);
  INSERT INTO e2e_orders VALUES
    (1, 'new', 10.00, '{"customer": {"tier": "pro", "tags": ["a", "b"]}, "items": [{"sku": "SKU-1", "qty": 2}]}', 1771907103556, 'ok'),
    (2, 'new', 20.50, NULL, 1771907103556, 'sad'), (3, 'shipped', NULL, '{"k": 1}', NULL, NULL);
  CREATE TABLE e2e_lines (id int PRIMARY KEY, order_id int REFERENCES e2e_orders(id), qty int);
  INSERT INTO e2e_lines VALUES (10, 1, 2), (11, 1, 5), (12, 3, 1);
  CREATE OR REPLACE FUNCTION e2e_add(x int) RETURNS int LANGUAGE sql AS 'SELECT x + 1';
  ANALYZE e2e_orders;
  CREATE TABLE e2e_nopk (note text);`)

const app = await electron.launch({
  args: ['.'],
  cwd: join(import.meta.dirname, '..'),
  env: {
    ...process.env,
    VIEWDECK_USER_DATA: userData,
    VIEWDECK_E2E: '1',
    ELECTRON_RENDERER_URL: '',
    AWS_CONFIG_FILE: join(awsDir, 'config'),
    AWS_SHARED_CREDENTIALS_FILE: join(awsDir, 'credentials'),
    AWS_ENDPOINT_URL: 'http://127.0.0.1:9',
    AWS_MAX_ATTEMPTS: '1',
    VIEWDECK_E2E_SAVE_DIR: exportDir
  }
})
const errors = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 1400, height: 860 })

  // 0. AWS wizard renders discovered profiles and surfaces API failures as a banner.
  await page.getByText('No saved connections').waitFor()
  await shot(page, '01-home')
  await page.getByRole('button', { name: 'New AWS connection' }).click()
  await page.locator('select option', { hasText: 'e2e-staging (static)' }).waitFor({ state: 'attached' })
  await page.getByRole('alert').getByText("Can't reach AWS.").waitFor()
  await page.getByRole('alert').getByText(/Check your internet connection or VPN/).waitFor()
  step('AWS wizard lists ~/.aws profiles; network failure shows an actionable checklist')
  await shot(page, '00-wizard')
  const regionInput = page.locator('input[list="aws-regions"]')
  await regionInput.fill('us-west-2')
  await page.getByTitle('Back to connections').click()
  await page.getByRole('button', { name: 'New AWS connection' }).click()
  await page.locator('select option', { hasText: 'e2e-staging (static)' }).waitFor({ state: 'attached' })
  await page.waitForFunction(() => (document.querySelector('input[list="aws-regions"]'))?.value === 'us-west-2')
  step('wizard remembers the region per profile')
  await page.getByTitle('Back to connections').click()

  // 1. Home → manual connection to the local test server.
  await page.getByText('No saved connections').waitFor()
  await page.getByRole('button', { name: 'Manual' }).click()
  const dialog = page.getByRole('dialog')
  const inputs = dialog.locator('input')
  await inputs.nth(0).fill('e2e local')
  await inputs.nth(1).fill('127.0.0.1')
  await inputs.nth(2).fill(String(PORT))
  await inputs.nth(5).fill('wrong-password')
  await dialog.locator('select').nth(0).selectOption('require')
  await dialog.locator('select').nth(1).selectOption('dev')
  // B1: Save & connect WITHOUT Test, failing: the dialog stays open with the error, and the
  // saved connection already shows on Home behind it.
  await dialog.getByRole('button', { name: 'Save & connect' }).click()
  await dialog.getByText(/Saved "e2e local", but connecting failed/).waitFor()
  await page.getByText('No saved connections').waitFor({ state: 'detached' })
  step('Save & connect without Test: failure keeps the dialog open with the error; connection is saved')
  await inputs.nth(5).fill(PASSWORD)
  await dialog.getByRole('button', { name: 'Test' }).click()
  await dialog.getByText(/Connected · PostgreSQL 18/).waitFor()
  step('test connection')
  await dialog.getByRole('button', { name: 'Save & connect' }).click()
  await page.getByText('Disconnect').waitFor()
  await page.getByText('Read-write').waitFor() // dev → unlocked by default
  const saved = await page.evaluate(() => window.viewdeck.invoke('connections:list'))
  assert.equal(saved.data.filter((c) => c.name === 'e2e local').length, 1, 'retry after a failed connect reuses the saved connection')
  step('connected; dev session starts read-write')

  // 2. SQL editor: Cmd/Ctrl+Enter runs the statement under the cursor.
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.type('select 1 as one;\nselect id, status from e2e_orders order by id')
  await page.keyboard.press(`${mod}+Enter`)
  await page.getByText('3 rows').waitFor()
  step('Cmd+Enter ran the statement under the cursor (3 rows)')

  // 2b. Status bar + resilience: killing the server-side connections doesn't strand the session.
  const status = page.getByLabel('Status bar')
  await status.getByText('postgres@127.0.0.1/postgres').waitFor()
  await status.getByText(/\d+ ms/).waitFor()
  await db.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'ViewDeck'")
  await page.waitForTimeout(300)
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${mod}+Enter`) // may hit the dead connection once
  await page.waitForTimeout(500)
  await page.keyboard.press(`${mod}+Enter`)
  await page.getByText('3 rows').waitFor()
  step('status bar shows user@host/db and latency; session recovers after its backends are killed')
  await shot(page, '02-query')

  // 3. Autocomplete: tables + columns from the live schema.
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.type('select  from e2e_orders o')
  for (let i = 0; i < 'from e2e_orders o'.length + 1; i++) await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('o.')
  await page.locator('.suggest-widget').getByText('status', { exact: true }).waitFor()
  step('autocomplete suggests columns for alias o.')
  await shot(page, '03-autocomplete')
  await page.keyboard.press('Escape')

  // 4. Open table → stage an edit → Cmd+S diff → commit.
  await page.locator('aside').getByText('e2e_orders').click()
  await page.getByText('public.').waitFor()
  const activeTab = page.locator('[data-active="true"]')
  const cell = activeTab.getByText('new', { exact: true }).first()
  await cell.dblclick()
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.type('paid')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: /Review \(1\)/ }).waitFor()
  step('cell edit staged (amber, Review (1))')
  await shot(page, '04-staged')
  await page.keyboard.press(`${mod}+s`)
  const drawer = page.getByRole('dialog')
  await drawer.getByText('UPDATE "public"."e2e_orders" SET "status" = $1 WHERE "id" = $2;').waitFor()
  await drawer.getByText("$1 = 'paid', $2 = 1").waitFor()
  step('Cmd+S drawer shows exact parameterised SQL in BEGIN/COMMIT')
  await shot(page, '05-diff-drawer')
  await drawer.getByRole('button', { name: /Commit 1 statement/ }).click()
  await page.getByText(/Committed\. 1 row/).waitFor()
  const { rows } = await db.query('SELECT status FROM e2e_orders WHERE id = 1')
  assert.equal(rows[0].status, 'paid')
  step('commit wrote to Postgres')

  // 4a. Filter bar (Cmd/Ctrl+F) and table info drawer.
  await page.keyboard.press(`${mod}+f`)
  await page.keyboard.type('id >= 2')
  await page.keyboard.press('Enter')
  await activeTab.getByText('1–2').waitFor()
  await activeTab.getByText('shipped').waitFor()
  await shot(page, '04a-filter')
  await page.keyboard.press('Escape')
  await activeTab.getByText('1–3').waitFor()
  step('filter bar WHERE narrows rows; Esc clears')
  await page.keyboard.press(`${mod}+f`)
  await page.keyboard.type('sta')
  await page.locator('.suggest-widget').getByText('status', { exact: true }).waitFor()
  await page.keyboard.press('Tab')
  await page.keyboard.type(" = 'shipped'")
  await page.keyboard.press('Enter')
  await activeTab.getByText('1–1').waitFor()
  await shot(page, '04a2-filter-autocomplete')
  await page.keyboard.press('Escape')
  await activeTab.getByText('1–3').waitFor()
  step('filter bar autocompletes columns (sta → status), Enter applies, Esc clears')
  const header = (name) => activeTab.locator('.sticky button').filter({ hasText: new RegExp(`^${name}`) })
  await header('amount').click()
  await header('amount').click()
  await activeTab.locator('[data-cell="0:2"]').getByText('NULL').waitFor() // DESC puts NULLs first
  await header('amount').click() // back to default order
  await activeTab.locator('[data-cell="0:0"]').getByText('1', { exact: true }).waitFor()
  await activeTab.getByRole('button', { name: /Count/ }).click()
  await activeTab.getByText(/of 3$/).waitFor()
  step('header click sorts asc → desc → off; Count shows the exact total')
  await activeTab.getByTitle(/Table info/).click()
  const info = page.getByRole('dialog')
  await info.getByText('Total size').waitFor()
  await info.getByRole('button', { name: /Indexes/ }).click()
  await info.getByText('e2e_orders_pkey', { exact: true }).waitFor()
  await info.getByRole('button', { name: /^DDL$/ }).click()
  await info.getByText(/CREATE TABLE "public"."e2e_orders"/).waitFor()
  await page.waitForTimeout(300)
  await shot(page, '04b-table-info')
  await page.keyboard.press('Escape')
  step('table info shows stats, indexes and reconstructed DDL')

  // 4c. Copy cell / row via keyboard and context menu (real OS clipboard).
  const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText())
  await activeTab.getByText('shipped', { exact: true }).click()
  await page.keyboard.press(`${mod}+c`)
  await page.getByText('Copied cell').waitFor()
  assert.equal(await clipboard(), 'shipped')
  await activeTab.getByText('shipped', { exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Copy row as/ }).hover()
  await page.getByRole('menuitem', { name: 'JSON' }).click()
  await page.getByText('Copied row as JSON').waitFor()
  assert.deepEqual(JSON.parse(await clipboard()), { id: 3, status: 'shipped', amount: null, meta: { k: 1 }, created_ms: null, mood: null })
  step('Cmd+C copies a cell; right-click copies a row as JSON (json columns embedded)')

  // 4d. JSON viewer: double-click a jsonb cell → collapsible tree.
  await activeTab.locator('[data-cell="0:3"]').dblclick()
  const viewer = page.getByRole('dialog')
  await viewer.getByText('customer', { exact: true }).waitFor()
  await viewer.getByText('tier', { exact: true }).waitFor()
  await viewer.getByRole('button', { name: /Collapse/ }).click()
  await viewer.getByText('tier', { exact: true }).waitFor({ state: 'detached' })
  // Find in value: ⌘F focuses the find bar; a match inside a collapsed node opens its parents.
  await page.keyboard.press('Meta+f')
  await page.keyboard.type('sku')
  await viewer.getByTestId('find-count').filter({ hasText: '1 / 1' }).waitFor()
  assert.match(await viewer.locator('[data-current-match]').innerText(), /SKU-1/)
  await viewer.getByLabel('Find in value').fill('i')
  // jsonb stores keys shortest first, so "items" renders before "customer" → "tier".
  await viewer.getByTestId('find-count').filter({ hasText: '1 / 2' }).waitFor()
  assert.match(await viewer.locator('[data-current-match]').innerText(), /items/)
  await page.keyboard.press('Enter')
  await viewer.getByTestId('find-count').filter({ hasText: '2 / 2' }).waitFor()
  assert.match(await viewer.locator('[data-current-match]').innerText(), /tier/)
  await shot(page, '04c2-json-find')
  await page.keyboard.press('Escape') // first Esc clears the find, the panel stays
  await viewer.getByTestId('find-count').waitFor({ state: 'detached' })
  await viewer.getByRole('button', { name: /Expand all/ }).click()
  await viewer.getByText('SKU-1', { exact: false }).waitFor()
  await page.waitForTimeout(300)
  await shot(page, '04c-json-viewer')
  await page.keyboard.press('Escape')
  step('double-click on jsonb opens a collapsible JSON tree (expand / collapse all, ⌘F find)')

  // 4d2. Epoch → date formatting (header menu, persisted) and the enum dropdown editor.
  await activeTab.locator('.sticky button').filter({ hasText: /^created_ms/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Format as date \(epoch milliseconds\)/ }).click()
  await activeTab.getByText('· as date').waitFor()
  await activeTab.locator('[data-cell="0:4"]').getByText(/^2026-02-2[34] /).waitFor()
  await activeTab.locator('[data-cell="1:5"]').dblclick()
  await activeTab.locator('[data-cell="1:5"] select').selectOption('happy')
  await activeTab.getByRole('button', { name: /Review \(1\)/ }).waitFor()
  await shot(page, '04d2-epoch-enum')
  await activeTab.getByRole('button', { name: /Discard/ }).click()
  step('epoch int8 column formats as a date; enum column edits via dropdown (staged)')

  // 4e. Sidebar context menu → SELECT … LIMIT 100 in a new tab.
  await page.locator('aside').getByText('e2e_orders').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /SELECT … LIMIT 100/ }).click()
  await page.locator('[data-active="true"] .monaco-editor').getByText('LIMIT').waitFor()
  step('sidebar right-click opens SELECT … LIMIT 100 in a new tab')

  // 4f. Ctrl+Tab cycles tabs; persistent New query button opens a tab.
  const activeTitle = () => page.locator('main .bg-background.text-foreground').first().innerText()
  const before = await activeTitle()
  await page.keyboard.press('Control+Tab')
  assert.notEqual(await activeTitle(), before)
  await page.keyboard.press('Control+Shift+Tab')
  assert.equal(await activeTitle(), before)
  await page.getByRole('button', { name: 'New query', exact: true }).click()
  await page.getByText(/Query \d/).last().waitFor()
  step('Ctrl+Tab / Ctrl+Shift+Tab cycle tabs; New query button opens a tab')

  // 4f2. Native menu: File → New Query Tab, Query → Run Statement, File → Close Tab.
  const clickMenu = (id) => app.evaluate(({ Menu }, menuId) => Menu.getApplicationMenu()?.getMenuItemById(menuId)?.click(), id)
  const tabCount = () => page.getByRole('tab').count()
  const before2 = await tabCount()
  await clickMenu('newQueryTab')
  await page.waitForFunction((n) => document.querySelectorAll('[role="tab"]').length === n + 1, before2)
  await page.locator('[data-active="true"] .monaco-editor').click()
  await page.keyboard.type('select 42 as answer')
  await clickMenu('runStatement')
  await page.locator('[data-active="true"] [data-cell="0:0"]').getByText('42').waitFor()
  await clickMenu('closeTab')
  await page.waitForFunction((n) => document.querySelectorAll('[role="tab"]').length === n, before2)
  step('native menu: New Query Tab, Run Statement and Close Tab drive the app')

  // 4f3. Settings (menu → Settings…): light theme applies app-wide, then back to dark.
  await clickMenu('settings')
  await page.getByLabel('Theme', { exact: true }).selectOption('light')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark'))
  await page.waitForTimeout(300)
  await shot(page, '04f3-light-theme')
  await clickMenu('settings')
  await page.getByLabel('Theme', { exact: true }).selectOption('dark')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  step('Settings: theme switches light / dark app-wide')

  // 4f4. Header theme picker: Light / Dark / System, saved instantly; System follows the OS.
  const isDark = () => page.evaluate(() => document.documentElement.classList.contains('dark'))
  await page.getByRole('button', { name: 'Theme: Dark' }).click()
  await page.getByRole('menuitem', { name: /Light/ }).click()
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark'))
  assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'light')
  await page.getByRole('button', { name: 'Theme: Light' }).click()
  await page.getByRole('menuitem', { name: /System/ }).click()
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark'))
  await shot(page, '04f4-system-light')
  assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'system')
  await page.getByRole('button', { name: 'Theme: System' }).click()
  await page.getByRole('menuitem', { name: /Dark/ }).click()
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  await page.emulateMedia({ colorScheme: null })
  assert.equal(await isDark(), true)
  step('header theme picker: Light / Dark / System (follows OS changes live)')

  // 4g. Drag a table from the sidebar into the editor.
  await page.locator('aside').getByText('e2e_orders').dragTo(page.locator('[data-active="true"] .monaco-editor .view-lines'))
  await page.locator('[data-active="true"] .monaco-editor').getByText('e2e_orders').waitFor()
  step('drag table from sidebar drops its name into the editor')

  // 4b. Cmd/Ctrl+K palette: works from inside Monaco, fuzzy-jumps to tables and recent queries.
  await page.locator('main div').filter({ hasText: /^Query 1$/ }).first().click()
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${mod}+k`)
  const palette = page.getByPlaceholder(/Jump to a table/)
  await palette.waitFor()
  await page.getByText('Recent queries').waitFor()
  await palette.fill('e2eord')
  await page.keyboard.press('Enter')
  await page.locator('[data-active="true"]').getByText('public.').waitFor()
  step('Cmd+K from the editor fuzzy-jumps to a table')
  await page.keyboard.press(`${mod}+k`)
  await palette.fill('select id status')
  await page.getByRole('button', { name: /select id, status from e2e_orders/ }).first().waitFor()
  await page.waitForTimeout(400) // let the open animation finish
  await shot(page, '07-palette')
  await page.keyboard.press('Enter')
  await page.getByText('Query 2').waitFor()
  step('Cmd+K reopens a recent query in a new tab')

  // 4h. Star a query; Recent & starred panel; clicking loads the query into the editor.
  const q = page.locator('[data-active="true"]')
  await q.getByRole('button', { name: 'Star', exact: true }).click()
  const starDlg = page.getByRole('dialog')
  await starDlg.locator('input').first().fill('my orders query')
  await starDlg.getByRole('button', { name: 'Star' }).click()
  await page.getByText('Starred', { exact: true }).first().waitFor()
  await q.getByRole('button', { name: /Recent & starred/ }).click()
  await q.getByText(/select id, status from e2e_orders/).first().waitFor()
  await q.getByRole('button', { name: /^Starred/ }).click()
  await q.getByText('my orders query').waitFor()
  await page.waitForTimeout(200)
  await shot(page, '04h-queries-panel')
  step('Star saves a named query; panel lists Recent and Starred')

  // 4i. Cancel a running query; statement timeout from the toolbar.
  await q.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.type('select pg_sleep(20)')
  const t0 = Date.now()
  await page.keyboard.press(`${mod}+Enter`)
  await q.getByRole('button', { name: /Cancel/ }).click()
  await q.getByText('Query cancelled.').waitFor()
  assert.ok(Date.now() - t0 < 8000, 'cancel should stop pg_sleep(20) quickly')
  await q.getByLabel('Statement timeout').selectOption({ label: 'Timeout: 5s' })
  await page.getByText('Statement timeout: 5s').waitFor()
  await q.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.type('select pg_sleep(10)')
  await page.keyboard.press(`${mod}+Enter`)
  await q.getByText(/exceeded the statement timeout/).waitFor({ timeout: 15000 })
  await q.getByLabel('Statement timeout').selectOption({ label: 'Timeout: Off' })
  step('Cancel stops a running query; toolbar statement timeout cuts off long queries')

  // 4i2. Dangerous-statement guard (unlocked session): DELETE without WHERE asks first.
  await q.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.type('delete from e2e_nopk')
  await page.keyboard.press(`${mod}+Enter`)
  await page.getByText('DELETE without WHERE removes every row').waitFor()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByText('DELETE without WHERE removes every row').waitFor({ state: 'detached' })
  await page.keyboard.press(`${mod}+Enter`)
  await page.getByRole('button', { name: 'Run anyway' }).click()
  await q.getByText('DELETE', { exact: true }).waitFor()
  step('DELETE without WHERE asks for confirmation before running (unlocked session)')

  // 4i3. Multi-statement results, export to CSV, and error position underline.
  await q.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.type('select 1 as a; select 2 as b, 3 as c')
  await q.getByRole('button', { name: /^Run/ }).click()
  await q.getByTestId('script-output').getByText('select 2 as b, 3 as c').waitFor()
  await q.getByRole('button', { name: /^1 SELECT/ }).click()
  await q.locator('.sticky').getByText('a', { exact: true }).waitFor()
  await q.getByRole('button', { name: /^2 SELECT/ }).click()
  await q.locator('.sticky').getByText('c', { exact: true }).waitFor()
  await q.getByRole('button', { name: /Export/ }).click()
  await page.getByRole('menuitem', { name: 'Save as CSV…' }).click()
  await page.getByRole('status').getByText(/Saved query-.*\.csv/).waitFor()
  const { readdirSync } = await import('node:fs')
  const csv = readFileSync(join(exportDir, readdirSync(exportDir).find((f) => f.endsWith('.csv'))), 'utf8')
  assert.equal(csv, 'b,c\n2,3')
  await q.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.type('select * from e2e_ordrs')
  await page.keyboard.press(`${mod}+Enter`)
  await q.getByText(/relation "e2e_ordrs" does not exist/).first().waitFor()
  await q.locator('.squiggly-error').first().waitFor()
  await shot(page, '04i3-results-export-error')
  step('multi-statement result tabs; export saves CSV; SQL error position underlined')

  // 4i3b. Run all keeps going past a failing statement; Copy all copies every query + result.
  await q.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.type("select 'first' as one; select * from no_such_table; select 'third' as three")
  await q.getByRole('button', { name: /^Run/ }).click()
  const out = q.getByTestId('script-output')
  await out.getByText('third', { exact: true }).waitFor()
  await out.getByText(/ERROR: relation "no_such_table" does not exist/).waitFor()
  await out.getByText('first', { exact: true }).waitFor()
  await q.getByRole('button', { name: /^2 ERROR/ }).waitFor()
  await shot(page, '04i3b-run-all')
  await q.getByRole('button', { name: 'Copy all', exact: true }).click()
  await page.getByRole('status').getByText('Copied 3 results').waitFor()
  const copied = await clipboard()
  for (const part of ["select 'first' as one", '| one |', '| first |', 'ERROR: relation "no_such_table" does not exist', '| third |']) assert.ok(copied.includes(part), `Copy all missing ${part}:\n${copied}`)
  await q.getByRole('button', { name: 'Copy all options' }).click()
  await page.getByRole('menuitem', { name: 'Plain text (terminal style)' }).click()
  await page.getByRole('status').getByText('Copied 3 results').last().waitFor()
  assert.ok((await clipboard()).includes(' one\n-------\n first\n(1 row)'), await clipboard())
  step('Run all runs every statement past a failure; Copy all copies queries + results (Markdown / text)')

  // 4i3c. Result filter (live client-side WHERE; invalid = no filter) and Cmd+F find in results.
  await q.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.type("select * from (values (1, 'shipped', 10), (2, 'pending', 250), (3, 'shipped', 40)) t(id, status, amount)")
  await page.keyboard.press(`${mod}+Enter`)
  const bar = q.getByTestId('result-toolbar')
  await bar.waitFor()
  const filterInput = bar.getByLabel('Filter results').locator('.monaco-editor')
  await filterInput.click()
  await page.keyboard.type("status = 'shipped' and amount > 20") // full speed: must not scramble
  await bar.getByTestId('filter-status').getByText('1 of 3 rows').waitFor()
  await q.locator('[data-cell]').getByText('40', { exact: true }).waitFor()
  assert.equal(await q.locator('[data-cell]').getByText('250', { exact: true }).count(), 0)
  await page.keyboard.type(' and')
  await bar.getByTestId('filter-status').getByText('not applied').waitFor() // incomplete → every row, no error
  await q.locator('[data-cell]').getByText('250', { exact: true }).waitFor()
  assert.equal(await q.getByText(/syntax error/i).count(), 0)
  await page.keyboard.type(" status <> 'x'")
  await bar.getByTestId('filter-status').getByText('1 of 3 rows').waitFor()
  await shot(page, '04i3c-result-filter')
  await bar.getByRole('button', { name: 'Clear filter' }).click()
  await q.locator('[data-cell]').getByText('250', { exact: true }).waitFor()
  await q.locator('[data-cell]').getByText('pending', { exact: true }).click() // focus the grid, then Cmd+F
  await page.keyboard.press(`${mod}+f`)
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Find in results')
  await page.keyboard.type('shipp')
  await bar.getByTestId('find-status').getByText('1/2').waitFor()
  await page.keyboard.press('Enter')
  await bar.getByTestId('find-status').getByText('2/2').waitFor()
  assert.equal(await q.locator('[data-cell][class*="bg-yellow"]').count(), 2)
  await shot(page, '04i3c-find')
  await page.keyboard.press('Escape')
  step('result filter: live SQL WHERE on loaded rows, invalid input shows all rows; Cmd+F finds and cycles matches')

  // 4i4. EXPLAIN plan tree; EXPLAIN ANALYZE of a DELETE asks first and is rolled back.
  await q.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.type('select * from e2e_orders o join e2e_lines l on l.order_id = o.id')
  await page.keyboard.press(`${mod}+e`)
  await q.getByLabel('Query plan').getByText('EXPLAIN', { exact: true }).waitFor()
  assert.ok((await q.getByTestId('plan-node').count()) >= 3, 'join plan has several nodes')
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.type('delete from e2e_lines')
  await page.keyboard.press(`${mod}+Shift+e`)
  await page.getByRole('button', { name: 'Run anyway' }).click()
  await q.getByLabel('Query plan').getByText('EXPLAIN ANALYZE').waitFor()
  await q.getByText('rolled back').waitFor()
  await shot(page, '04i4-explain-analyze')
  await q.getByLabel('Close plan').click()
  await q.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.type('select count(*) as n from e2e_lines')
  await page.keyboard.press(`${mod}+Enter`)
  await q.locator('[data-cell="0:0"]').filter({ hasNotText: /^0$/ }).waitFor()
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.type('select * from e2e_ordrs') // later steps expect this tab's text
  step('EXPLAIN shows a plan tree; EXPLAIN ANALYZE of DELETE confirms first and is rolled back')

  // 4i5. Split view: table grid on the left, a query on the right; compare rows.
  const queryTabLabel = await page.locator('[role="tab"][aria-selected="true"]').getAttribute('aria-label')
  await page.locator('aside').getByText('e2e_orders').click()
  await page.getByRole('button', { name: 'Split view', exact: true }).click()
  const leftPane = page.locator('[data-pane="left"]')
  const rightPane = page.locator('[data-pane="right"]')
  await rightPane.locator('.monaco-editor').click()
  await page.keyboard.type('select 7 as seven')
  await page.keyboard.press(`${mod}+Enter`)
  await rightPane.locator('[data-cell="0:0"]').getByText('7').waitFor()
  await leftPane.locator('[data-cell="0:1"]').waitFor() // grid still visible beside it
  await leftPane.locator('[data-cell="0:1"]').click()
  assert.equal(await leftPane.getAttribute('data-active'), 'true', 'clicking a pane focuses it')
  await leftPane.locator('[data-cell="1:1"]').click({ modifiers: ['Shift'] })
  await leftPane.locator('[data-cell="1:1"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Compare the 2 selected rows' }).click()
  const cmp = page.getByRole('dialog')
  await cmp.getByText(/columns differ/).waitFor()
  assert.ok((await cmp.locator('tr[data-diff="true"]').count()) >= 1)
  await cmp.getByLabel('Only differences').check()
  await shot(page, '04i5-split-compare')
  await page.keyboard.press('Escape')
  await leftPane.locator('[data-cell="0:1"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Pin row for comparison' }).click()
  await leftPane.locator('[data-cell="2:1"]').click()
  await leftPane.locator('[data-cell="2:1"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Compare with pinned row/ }).click()
  await page.getByRole('dialog').getByText(/columns differ/).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Close split view' }).click()
  await leftPane.waitFor({ state: 'detached' })
  await page.getByRole('tab', { name: queryTabLabel, exact: true }).click()
  step('split view shows a table and a query side by side; compare 2 rows and pinned row')

  // 4j. Foreign-key navigation: ↗ opens the referenced row; right-click shows referencing rows.
  await page.locator('aside').getByText('e2e_lines').click()
  const fkCell = page.locator('[data-active="true"] [data-cell="0:1"]')
  await fkCell.hover()
  await fkCell.getByTitle('Open referenced row').click()
  await page.locator('[data-active="true"]').getByText('public.').waitFor()
  await page.locator('[data-active="true"]').getByText(/^1–1/).waitFor()
  await page.locator('[data-active="true"] [data-cell="0:0"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Rows in public.e2e_lines/ }).click()
  await page.locator('[data-active="true"]').getByText(/^1–2/).waitFor()
  await shot(page, '04j-fk-navigation')
  step('FK navigation: ↗ opens the referenced row; right-click lists referencing rows')

  // 4k. Richer sidebar: row estimates, Types / Functions groups open definitions, Generate DROP.
  const aside = page.locator('aside')
  await aside.getByRole('button', { name: /^Types/ }).click()
  await aside.getByText('e2e_mood', { exact: true }).click()
  await page.locator('[data-active="true"] .monaco-editor').getByText('ENUM').waitFor()
  await aside.getByRole('button', { name: /^Functions/ }).click()
  await aside.getByText(/^e2e_add\(/).click()
  await page.locator('[data-active="true"] .monaco-editor').getByText('FUNCTION').first().waitFor()
  await aside.getByText('e2e_orders').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Generate DROP/ }).click()
  await page.locator('[data-active="true"] .monaco-editor').getByText('DROP').first().waitFor()
  await shot(page, '04k-sidebar')
  step('sidebar shows Types / Functions with definitions; Generate DROP writes (not runs) the statement')

  // 4l. ER diagram: open from the schema row, FK edge with crow's-foot markers, focus, hover, legend.
  await page.locator('aside').getByText('public', { exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open diagram' }).click()
  const diagram = page.locator('[data-active="true"] [data-testid="diagram-canvas"]')
  await diagram.locator('[data-table="public.e2e_orders"]').waitFor({ timeout: 30000 })
  await diagram.locator('[data-table="public.e2e_lines"]').waitFor()
  assert.ok((await diagram.locator('.react-flow__edge').count()) >= 1, 'the e2e_lines → e2e_orders FK is drawn')
  assert.ok(await diagram.locator('.react-flow__edge path[marker-end*="vd-many"]').count(), "crow's-foot marker on the child end")
  await diagram.locator('[data-table="public.e2e_orders"]').click()
  await page.locator('[data-active="true"]').getByText(/Relationships of e2e_orders/i).waitFor()
  await page.locator('[data-active="true"]').getByText(/Focus: e2e_orders/).waitFor()
  await diagram.locator('[data-table="public.e2e_lines"]').hover()
  await diagram.getByText(/Each e2e_orders can have many e2e_lines rows|e2e_lines/).first().waitFor()
  await page.getByRole('button', { name: 'Legend' }).click()
  await page.getByRole('dialog', { name: 'Diagram legend' }).getByText('Many-to-one, required').waitFor()
  await shot(page, '04l-diagram')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Diagram legend' }).waitFor({ state: 'detached' })
  await clickMenu('closeTab')
  await diagram.waitFor({ state: 'detached' })
  step('ER diagram opens from the sidebar: FK edges with crow\'s-foot ends, focus, hover details, legend')

  // 5. Read-only lock is server-enforced, including for hand-written SQL.
  await page.getByRole('button', { name: 'Read-write' }).click()
  await page.getByRole('button', { name: 'Read-only' }).waitFor()
  await page.locator('header').getByText('Code', { exact: false }).count() // no-op; header stays
  await page.locator('main div').filter({ hasText: /^Query 1$/ }).first().click()
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.type("update e2e_orders set status = 'x'")
  await page.keyboard.press(`${mod}+Enter`)
  await page.getByText('This session is read-only.').waitFor()
  const after = await db.query("SELECT count(*)::int AS n FROM e2e_orders WHERE status = 'x'")
  assert.equal(after.rows[0].n, 0)
  step('locked session rejects UPDATE from the editor (server-side)')
  await shot(page, '06-read-only')

  // 6. Connection switcher + edit / duplicate / confirmed delete of saved connections.
  const switcher = page.getByTitle('Switch connection')
  await switcher.click()
  await page.getByRole('menuitem', { name: /Manage connections/ }).click()
  await page.getByText('Connections', { exact: true }).waitFor()
  const row = (name) => page.locator('div.group').filter({ has: page.getByText(name, { exact: true }) })
  await row('e2e local').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await page.getByText('e2e local (copy)', { exact: true }).waitFor()
  await row('e2e local (copy)').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Edit/ }).click()
  const edit = page.getByRole('dialog')
  await edit.locator('input').first().fill('e2e local B')
  await edit.getByRole('button', { name: 'Save' }).click()
  await page.getByText('e2e local B', { exact: true }).waitFor()
  step('saved connections: duplicate (secret re-encrypted) and edit')

  await page.getByText('e2e local', { exact: true }).click()
  await page.getByTitle('Switch connection').waitFor()
  // Workspace restore: tabs, editor text and table filters come back on reconnect.
  await page.getByRole('tab', { name: 'Query 4', exact: true }).click()
  await page.locator('[data-active="true"] .monaco-editor').getByText('e2e_ordrs').waitFor()
  await page.getByRole('tab', { name: 'e2e_orders', exact: true }).click()
  await page.locator('[data-active="true"]').getByText(/^1–1/).waitFor() // FK filter "id" = 1 restored
  await page.locator('[data-active="true"]').getByTitle('Clear filter (Esc)').click()
  step('reconnect restores tabs, editor text and table filters')
  await page.locator('aside').getByText('e2e_orders').click()
  await page.locator('[data-active="true"]').getByText('new', { exact: true }).first().dblclick()
  await page.keyboard.type('x')
  await page.keyboard.press('Enter')
  await page.getByTitle('Switch connection').click()
  await page.getByRole('menuitem', { name: 'e2e local B' }).click()
  await page.getByText('Discard staged changes?').first().waitFor()
  await page.getByRole('button', { name: 'Cancel' }).click()
  assert.equal(await page.getByTitle('Switch connection').innerText(), 'e2e local')
  await page.getByTitle('Switch connection').click()
  await page.getByRole('menuitem', { name: 'e2e local B' }).click()
  await page.getByRole('button', { name: 'Discard and continue' }).click()
  await page.getByText('Connected to e2e local B').waitFor()
  assert.equal(await page.getByTitle('Switch connection').innerText(), 'e2e local B')
  await shot(page, '06-switcher')
  step('header switcher changes connection; guards staged edits (cancel / discard)')

  await page.getByTitle('Switch connection').click()
  await page.getByRole('menuitem', { name: /Manage connections/ }).click()
  await row('e2e local B').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Delete/ }).click()
  await page.getByText('Delete “e2e local B”?').first().waitFor()
  await page.getByRole('button', { name: 'Delete connection' }).click()
  await page.getByText('e2e local B', { exact: true }).waitFor({ state: 'detached' })
  step('delete asks for confirmation, then removes the connection')

  assert.deepEqual(errors, [], `renderer errors: ${errors.join('\n')}`)
  console.log(`\nE2E PASSED. Screenshots in ${ART}`)
} catch (err) {
  const page = app.windows()[0]
  if (page) await shot(page, 'FAILURE').catch(() => {})
  console.error(`\nE2E FAILED. See ${join(ART, 'FAILURE.png')}${errors.length ? `\nRenderer errors:\n${errors.join('\n')}` : ''}`)
  throw err
} finally {
  await app.close().catch(() => {})
  await db.query('DROP TABLE IF EXISTS e2e_lines, e2e_orders, e2e_nopk; DROP TYPE IF EXISTS e2e_mood; DROP FUNCTION IF EXISTS e2e_add(int)').catch(() => {})
  await db.end()
  rmSync(userData, { recursive: true, force: true })
  rmSync(awsDir, { recursive: true, force: true })
}
