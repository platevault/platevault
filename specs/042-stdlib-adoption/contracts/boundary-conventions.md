# Boundary & Convention Contracts — 042

This feature changes type-GENERATION and wrapper mechanics, not command semantics. The
"contracts" here are the conventions the migrations must uphold so the boundary stays
single-sourced.

## C1. Generated bindings are the single source of truth

- `apps/desktop/src/bindings/index.ts` (specta-generated) is authoritative for IPC
  types and command argument names. The frontend consumes these generated types
  directly.
- The hand-written `bindings/types.ts` snake_case struct universe is **deleted**; any
  still-needed alias becomes a re-export of the generated `_Serialize` type from a single
  generated alias module.
- `commands.ts` wrappers MUST mirror the generated `camelCase` argument names exactly.
  The existing `apps/desktop/src/api/commands.bindings-guard.test.ts` MUST stay green and
  is extended to also reject pass-through raw `invoke` once the 3 `plans_*` wrappers are
  migrated (closes its current inline-literal-only blind spot).

## C2. `ErrorCode` is generated, not duplicated

- One Rust `enum ErrorCode` in `crates/contracts/core` → specta generates the TS union.
- Existing dotted wire strings (`"internal.database"`, `"plan.required"`, …) are
  preserved exactly via serde rename; **no IPC payload string changes**.
- TS branches compare against `ErrorCode` members, never string literals.
- `ContractError.code: ErrorCode`; command results return `Result<T, ContractError>`.

## C3. Two generators must agree (Principle V)

- `packages/contracts` JSON-Schema is produced from the **same** `contracts_core`
  reflection that feeds specta (derived, not parallel).
- An automated test asserts the generated TypeScript bindings and the language-neutral
  schema agree; CI fails on disagreement. This replaces today's orphaned, never-imported
  schema surface with a guaranteed-consistent one.

## C4. Query-key + invalidation contract (frontend)

- All server reads go through the `queryKeys` factory (see `data-model.md` §1).
- Every mutation invalidates exactly the keys the homegrown store invalidated (the §1
  invalidation map is the conformance reference). No view may show stale data after a
  mutation.

## C5. Runtime validation at the seam (zod)

- A zod schema validates IPC payloads at the boundary for the surfaces where the backend
  shape is dynamic or historically drift-prone; a malformed payload yields a typed,
  caught error (not a silent `as`-cast success). zod schemas are aligned to / derived
  from the generated contract types, not hand-maintained in parallel.

## C6. Non-negotiable invariants

- Command names and payload **field names** unchanged.
- DB schema, migrations, and on-disk/serialized representation unchanged (the
  persistence→domain type move keeps serde + SQL mapping identical).
- Rust domain invariants unchanged; only the enumerated defects are fixed.
