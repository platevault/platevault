# Contracts: Gen-3 Target Management

Language-neutral command contracts for the rebuilt Targets surface. All operate on the
spec-035 `canonical_target` / `target_alias` model. DTOs are camelCase on the wire
(tauri-specta). Each `*Request` carries the standard `contractVersion` + `requestId`;
each `*Response`/error follows the existing project result-wrapper convention.

## `target.get` — target detail

- **Request**: `{ targetId: string }`
- **Response**: `TargetDetail`
  ```
  TargetDetail {
    id: string
    primaryDesignation: string        // canonical (read-only)
    displayAlias: string | null       // user-set; null = none
    effectiveLabel: string            // displayAlias ?? primaryDesignation
    objectType: string                // closed ObjectType enum
    raDeg: number
    decDeg: number
    simbadOid: number | null
    source: "seed" | "resolved" | "user-override"
    aliases: TargetAliasDto[]
  }
  TargetAliasDto { id: string, alias: string, kind: "designation" | "common_name" | "user" }
  ```
- **Errors**: `target.not_found`.

## `target.list` — list targets (list pane)

- **Request**: `{ }` (optionally a limit; default all, ordered by primaryDesignation)
- **Response**: `{ targets: TargetListItem[] }`
  ```
  TargetListItem { id: string, effectiveLabel: string, primaryDesignation: string,
                   objectType: string }
  ```

## `target.alias.add` — add a user alias

- **Request**: `{ targetId: string, alias: string }`
- **Response**: `{ alias: TargetAliasDto }` (the created `kind='user'` row)
- **Errors**: `alias.duplicate` (normalized form already exists for any target),
  `alias.invalid` (empty/blank), `target.not_found`.

## `target.alias.remove` — remove a user alias

- **Request**: `{ targetId: string, aliasId: string }`
- **Response**: `{ removed: true }`
- **Errors**: `alias.not_found`, `alias.not_user` (refuses to remove a
  designation/common_name — those are canonical identity).

## `target.display_alias.set` — set the display label

- **Request**: `{ targetId: string, displayAlias: string }`
- **Response**: `TargetDetail` (refreshed)
- **Behaviour**: trims input; an empty/blank value is treated as a clear (NULL).
- **Errors**: `target.not_found`.

## `target.display_alias.clear` — revert to canonical

- **Request**: `{ targetId: string }`
- **Response**: `TargetDetail` (refreshed; `displayAlias = null`)
- **Errors**: `target.not_found`. Clearing when already null is a successful no-op.

## Removed commands (no longer registered)

- `target.note.update` (D1 — per-target notes dropped)
- `target.primary.rename` (D2 — no free rename)
- `target.lookup`, `target.resolve.fits` (spec-013 — superseded by spec-035
  `target.search` / `target.resolve`)
