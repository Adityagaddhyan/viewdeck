# ADR-003: Staged writes and read-only safety

- Status: Accepted
- Date: 2026-11-23

## Context

ViewDeck connects to production databases with real credentials. The most expensive
mistakes in DB GUIs are an accidental cell edit written immediately, a wrong-tab
`DELETE`, and not noticing you are on prod. We want TablePlus-style fluid editing
without those failure modes.

## Decision

1. **Environment framing.** `classifyEnvironment()` (`src/shared/environment.ts`)
   classifies the AWS profile, account alias and DB identifier by name: `prod` →
   crimson `#EF4444`, `staging`/`stage` → amber `#F59E0B`, `dev`/`local` → emerald
   `#10B981`. A 3px bar across the header shows the tier at all times. With multiple
   hints, the **most cautious** tier wins. Unclassifiable names are `unknown`, shown in
   neutral grey.
2. **Read-only lock, server-enforced.** The toolbar has one lock toggle. Its default
   comes from `defaultReadOnly(tier)`: **locked for prod, staging and unknown**,
   unlocked for dev. In Postgres, locking runs
   `SET default_transaction_read_only = ON` on every pooled connection, including ones
   opened later (applied on the pool's `connect` event). The server then rejects
   writes even from hand-written SQL in the editor. The UI also disables grid editing
   while locked.
3. **Staged edits.** Double-clicking a cell edits it in client state only. Modified
   cells are highlighted amber. Inserts and deletes are staged the same way. Nothing
   touches the database until commit.
4. **Preview before commit.** `Cmd/Ctrl+S` opens a drawer showing the exact statements
   from `driver.previewChanges()`, which is the same function `commitChanges()` uses,
   wrapped in `BEGIN; … COMMIT;`, with bound parameters shown alongside.
5. **Atomic commit.** `commitChanges` runs every statement in one transaction and rolls
   back everything on the first error. UPDATE and DELETE are keyed by primary key, and
   tables without a PK are insert-only in the grid. Values are always bound
   parameters, and identifiers are always driver-quoted.

## Consequences

- An unrecognised account name starts read-only. That is mildly annoying, and
  deliberate.
- Unlocking requires an explicit toolbar click. For every non-dev tier (prod, staging,
  unknown) it also shows a confirmation dialog. The command palette can lock a session
  but never unlock one.
- Because read-only is server-enforced, it also covers the SQL editor, not just the grid.
- Future engines without server-side read-only (`supportsReadOnlySession: false`) must
  fall back to client-side blocking, and the UI must label the lock "client-side". That
  is not built yet, because Postgres enforces it on the server.

## Alternatives considered

- **Write-on-blur editing:** fastest, and the most dangerous. Rejected.
- **Read-only via a separate DB user:** stronger, but it needs per-environment IAM and
  DB-role setup we can't assume. It is compatible with this design and can be layered on.
