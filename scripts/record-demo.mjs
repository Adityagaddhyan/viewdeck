// Records the README demo GIF (docs/images/demo.gif) by driving the BUILT app with
// Playwright against the local test Postgres, seeded with neutral demo data.
//
//   npm run demo:gif      (builds, starts the test Postgres, runs this; needs ffmpeg)
//
// Frames are captured continuously while a short scripted story plays, then
// encoded with real-time frame durations and a shared palette (small, crisp GIF).
// Isolated userData + mock keychain, like the e2e test: real connections are untouched.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { _electron as electron } from 'playwright-core'

const PORT = Number(process.env.VIEWDECK_PG_TEST_PORT ?? 0)
const PASSWORD = process.env.VIEWDECK_PG_TEST_PASSWORD ?? ''
if (!PORT || !PASSWORD) throw new Error('Run via `npm run demo:gif` (needs VIEWDECK_PG_TEST_* env).')

const ROOT = join(import.meta.dirname, '..')
const OUT = join(ROOT, 'docs', 'images', 'demo.gif')
const frames = mkdtempSync(join(tmpdir(), 'viewdeck-demo-frames-'))
const userData = mkdtempSync(join(tmpdir(), 'viewdeck-demo-'))
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Demo data: deterministic, neutral names.
const db = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: PASSWORD, database: 'postgres', ssl: { rejectUnauthorized: false } })
await db.connect()
await db.query(`
  DROP TABLE IF EXISTS orders, customers;
  CREATE TABLE customers (id int PRIMARY KEY, name text NOT NULL, country text NOT NULL, plan text NOT NULL);
  INSERT INTO customers
    SELECT i,
      (ARRAY['Ada Lovelace','Alan Turing','Grace Hopper','Linus Torvalds','Margaret Hamilton','Ken Thompson','Barbara Liskov','Dennis Ritchie','Radia Perlman','Guido van Rossum'])[1 + (i - 1) % 10] || CASE WHEN i > 10 THEN ' ' || i ELSE '' END,
      (ARRAY['UK','US','DE','IN','FR','JP','BR','CA'])[1 + i % 8],
      (ARRAY['free','pro','team','enterprise'])[1 + i % 4]
    FROM generate_series(1, 60) i;
  CREATE TABLE orders (
    id int PRIMARY KEY, customer_id int NOT NULL REFERENCES customers(id), status text NOT NULL,
    amount numeric(10,2) NOT NULL, currency text NOT NULL, created_at timestamp NOT NULL, meta jsonb);
  INSERT INTO orders
    SELECT i, 1 + (i * 7) % 60,
      (ARRAY['shipped','paid','pending','shipped','refunded','shipped','paid'])[1 + i % 7],
      round(((i * 37) % 997) / 2.0 + 9.99, 2), 'USD',
      timestamp '2026-11-01 08:00:00' + i * interval '47 minutes',
      jsonb_build_object('channel', (ARRAY['web','ios','android'])[1 + i % 3], 'items', 1 + i % 5)
    FROM generate_series(1, 500) i;
  ANALYZE orders; ANALYZE customers;`)
await db.end()

const app = await electron.launch({
  args: ['.'],
  cwd: ROOT,
  env: { ...process.env, TZ: 'UTC', VIEWDECK_USER_DATA: userData, VIEWDECK_E2E: '1', ELECTRON_RENDERER_URL: '' }
})
const page = await app.firstWindow()
await page.setViewportSize({ width: 1280, height: 800 })
await page.getByText('No saved connections').waitFor()
await page.evaluate(
  ([port, password]) =>
    window.viewdeck.invoke('connections:save', {
      connection: { name: 'shop · demo', engine: 'postgres', database: 'postgres', route: { kind: 'direct', host: '127.0.0.1', port }, auth: { kind: 'password', user: 'postgres', secretRef: null }, tlsMode: 'require', aws: null, environment: 'dev' },
      password
    }),
  [PORT, PASSWORD]
)
await page.reload()
await page.getByText('shop · demo').waitFor()
await sleep(400)

// ---- recorder: screenshots back-to-back with timestamps ----
const shots = []
let recording = true
const recorder = (async () => {
  while (recording) {
    const t = Date.now()
    const path = join(frames, `f${String(shots.length).padStart(5, '0')}.png`)
    await page.screenshot({ path })
    shots.push({ path, t })
  }
})()

const active = () => page.locator('[data-active="true"]')
const typeSlow = (text, delay = 22) => page.keyboard.type(text, { delay })

try {
  // 1. Home → connect.
  await sleep(1200)
  await page.getByText('shop · demo').click()
  await page.getByText('Disconnect').waitFor()
  await sleep(700)

  // 2. Open a table, stage an edit, review the exact SQL.
  await page.locator('aside').getByText('orders', { exact: true }).click()
  await active().locator('[data-cell="0:2"]').waitFor()
  await sleep(1000)
  await active().locator('[data-cell="0:2"]').dblclick()
  await page.keyboard.press(`${mod}+a`)
  await typeSlow('refunded', 60)
  await page.keyboard.press('Enter')
  await sleep(700)
  await page.keyboard.press(`${mod}+s`)
  await page.getByRole('dialog').getByText(/UPDATE "public"."orders"/).waitFor()
  await sleep(2200)
  await page.keyboard.press('Escape')
  await sleep(400)

  // 3. New query tab: run two queries at once → All tab → Copy all.
  await page.keyboard.press(`${mod}+t`)
  await sleep(300)
  await active().locator('.monaco-editor').first().click()
  await typeSlow('select status, count(*), sum(amount) from orders group by status order by 2 desc;\n')
  await typeSlow('select o.id, c.name, o.status, o.amount, o.created_at from orders o join customers c on c.id = o.customer_id order by o.amount desc;')
  await page.keyboard.press('Escape')
  await sleep(300)
  await active().getByRole('button', { name: /^Run/ }).click()
  await active().getByTestId('script-output').getByText('refunded').first().waitFor()
  await sleep(1800)
  await active().getByRole('button', { name: 'Copy all', exact: true }).click()
  await sleep(1400)

  // 4. Live WHERE filter on the second result, then Cmd+F find.
  await active().getByRole('button', { name: /^2 SELECT/ }).click()
  await sleep(700)
  await active().getByLabel('Filter results').locator('.monaco-editor').click()
  await typeSlow("status = 'shipped' and amount > 400", 55)
  await sleep(500)
  await active().locator('[data-cell="0:1"]').click() // closes the suggestion popup (Esc would clear the filter)
  await sleep(1600)
  await page.keyboard.press(`${mod}+f`)
  await typeSlow('grace', 90)
  await sleep(900)
  await page.keyboard.press('Enter')
  await sleep(700)
  await page.keyboard.press('Enter')
  await sleep(1800)
} finally {
  recording = false
  await recorder
  await app.close()
}

// ---- encode: real-time durations, hold the last frame ----
const list = shots.map((s, i) => {
  const next = shots[i + 1]?.t ?? s.t + 2500
  return `file '${s.path}'\nduration ${((next - s.t) / 1000).toFixed(3)}`
})
list.push(`file '${shots[shots.length - 1].path}'`)
writeFileSync(join(frames, 'list.txt'), list.join('\n'))
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(frames, 'list.txt'),
  '-vf', 'fps=12,scale=1100:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
  '-loop', '0', OUT
], { stdio: 'inherit' })
console.log(`demo: ${shots.length} frames → ${OUT}`)
rmSync(frames, { recursive: true, force: true })
rmSync(userData, { recursive: true, force: true })
