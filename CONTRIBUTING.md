# Contributing to ViewDeck

Thanks for helping! ViewDeck is free and open source (MIT), and contributions of all
sizes are welcome: bug reports, docs, fixes, features and new database drivers.

## Getting started

```sh
npm install
npm run dev       # app with hot reload
npm run verify    # typecheck + unit tests + docs check (must pass before a PR)
```

Integration tests need a local Postgres (`brew install postgresql@18`):
`npm run test:integration`. The end-to-end test drives the real app:
`npm run test:e2e`.

Read [`AGENTS.md`](AGENTS.md) first. It is the operating manual for humans and AI agents:
repo map, the invariants that must never break (process boundary, read-only lock,
staged writes, TLS over tunnels…), and conventions.

## Pull requests

1. Fork, create a branch, keep the change focused.
2. Add or update tests next to the code (`*.test.ts`).
3. Run `npm run verify` (and integration / e2e tests if you touched drivers, IPC or UI).
4. Use a Conventional Commit style title (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
5. Never include real hostnames, credentials, database names or screenshots of real data.

CI runs the same checks on every PR, and a maintainer review is required to merge.

## Adding a database engine

See [`docs/ADDING_A_DATABASE.md`](docs/ADDING_A_DATABASE.md). A new engine is one
folder under `src/main/drivers/` plus one registration line.

## Reporting security issues

Please don't open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).
