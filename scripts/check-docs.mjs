#!/usr/bin/env node
// Agent-handoff guard: fails if the docs drift from the code.
//   - every IPC channel and push event is documented in ARCHITECTURE.md
//   - every non-test source module is named in AGENTS.md or ARCHITECTURE.md
//   - every npm script is documented in AGENTS.md
//   - no stale "(planned)" / "⬜" markers remain
// Run: npm run check:docs  (also part of `npm run verify`)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

const root = join(import.meta.dirname, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const agents = read('AGENTS.md')
const arch = read('ARCHITECTURE.md')
const docs = agents + '\n' + arch
const problems = []

// 1. IPC channels and events
const ipc = read('src/shared/ipc.ts')
const listOf = (name) => {
  const m = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`).exec(ipc)
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : []
}
for (const ch of [...listOf('IPC_CHANNELS'), ...listOf('IPC_EVENTS')]) {
  if (!arch.includes(`\`${ch}\``)) problems.push(`IPC channel/event \`${ch}\` is not documented in ARCHITECTURE.md`)
}

// 2. Source modules
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
const IGNORE = /(\.test\.ts|\.d\.ts|\/index\.tsx?|\/main\.tsx)$/
for (const file of walk(join(root, 'src'))) {
  if (!/\.(ts|tsx)$/.test(file) || IGNORE.test(file)) continue
  const name = basename(file).replace(/\.(ts|tsx)$/, '')
  if (!docs.includes(name)) problems.push(`${relative(root, file)} is not mentioned in AGENTS.md or ARCHITECTURE.md`)
}

// 3. npm scripts
const pkg = JSON.parse(read('package.json'))
for (const script of Object.keys(pkg.scripts ?? {})) {
  if (['postinstall', 'typecheck:node', 'typecheck:web', 'test:watch', 'preview'].includes(script)) continue
  if (!agents.includes(`npm run ${script}`) && !(script === 'test' && agents.includes('npm test'))) {
    problems.push(`npm script "${script}" is not documented in AGENTS.md § Commands`)
  }
}

// 4. Stale markers
for (const [file, text] of [['AGENTS.md', agents], ['ARCHITECTURE.md', arch]]) {
  if (/_\(planned\)_|⬜|\(M[2-5]\)/.test(text)) problems.push(`${file} still contains planned/⬜/(Mn) markers`)
}

if (problems.length) {
  console.error(`check:docs found ${problems.length} problem(s):\n` + problems.map((p) => `  - ${p}`).join('\n'))
  process.exit(1)
}
console.log('check:docs OK: docs match the code.')
