# ADR-001: Tech stack and typed IPC boundary

- Status: Accepted
- Date: 2026-11-23

## Context

ViewDeck needs native capabilities that a browser lacks: reading `~/.aws`, spawning
`aws sso login` and SSM tunnels, raw TCP to Postgres, and OS keychain encryption. It
also needs a fast, dense UI with a code editor and a 100k-row grid. It will handle
production credentials, so the UI must not hold privileged access.

## Decision

- **Electron 45 + electron-vite 6 + Vite 8 + TypeScript 7 (strict) + React 19.** One
  language end to end. electron-vite gives us three correctly-targeted bundles (main,
  preload, renderer) and HMR with almost no config.
- **Tailwind CSS v4 + shadcn/ui + Lucide.** shadcn components are copied into the repo
  (`src/renderer/src/components/ui`), so we own and can densify them. No runtime
  component-library lock-in.
- **Monaco** (`@monaco-editor/react`) for SQL. **TanStack Table v8 + TanStack Virtual**
  for the grid. Both are headless or embeddable, and the virtualiser handles 100k+ rows.
- **`node:sqlite`** for local persistence. It is built into Node, so there is no native
  module and no `electron-rebuild` across Electron upgrades.
- **Security model:** `contextIsolation`, `sandbox`, and no `nodeIntegration`. All
  privileged work lives in main.
- **Typed IPC:** one contract (`src/shared/ipc.ts`) maps channel → request/response.
  The preload exposes a single allow-listed `invoke`. Main registers handlers through
  `registerHandler`. That wrapper converts results and throws into an `IpcResult<T>`
  envelope with a stable `AppErrorCode`.

## Consequences

- Adding a channel touches exactly three places (contract, handler, caller), and the
  compiler checks both ends.
- Errors keep their meaning across the boundary, so the UI can show targeted fixes
  instead of "Error invoking remote method".
- The sandboxed preload must be CJS with `@shared` inlined (electron-vite does both).
  Do not add `"type": "module"` to `package.json` without revisiting this.
- Electron ships its own Node. `node:sqlite` requires Electron's bundled Node ≥ 22.13,
  which Electron 45 satisfies.

## Alternatives considered

- **Tauri:** smaller binaries, but `pg`, the AWS SDK v3 and `@aws-sdk/rds-signer` are
  first-class only in Node. Rust ports would add a large surface area.
- **better-sqlite3:** a mature API, but a native module that must be rebuilt for every
  Electron ABI bump.
- **Untyped `ipcRenderer` exposure:** simpler, but it removes the security boundary and
  any compile-time checking.
