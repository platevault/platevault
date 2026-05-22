# Data Model: Router And URL State

## RouteContract

Every page that participates in the router MUST implement `RouteContract`.
The contract is the typed shape that links a route definition to the page
that consumes it, and is the boundary `url.resolve` parses on the backend.

```ts
interface RouteContract<TPath extends string, TParams, TSearch> {
  /** Canonical path including any `$param` segments. */
  path: TPath;
  /** Path-param shape (`{}` for parameterless routes). */
  params: TParams;
  /** Search-param shape (`{}` for routes that ignore search). */
  search: TSearch;
  /** Search-param validator. Must drop unknown keys and invalid values. */
  validateSearch(input: Record<string, unknown>): TSearch;
  /** True when this route allows the URL to carry a selected entity id. */
  carriesSelection: boolean;
  /** Entity kinds referenced by params/search; consumed by url.resolve. */
  resolvableEntities: ResolvableEntityRef[];
}

interface ResolvableEntityRef {
  /** Where to read the id from. */
  source: "path" | "search";
  /** Key within params or search. */
  key: string;
  /** Backend entity kind. */
  kind: "plan" | "project" | "inventory_item" | "inbox_item" | "settings_section";
  /** Whether resolution failure should clear (search) or render empty (path). */
  on_missing: "clear" | "render_empty";
}
```

## RouteShape Catalog

The v1 route table. Each row is one `RouteContract` instance.

### `/`

| Aspect              | Value                                                                |
|---------------------|----------------------------------------------------------------------|
| Path                | `/`                                                                  |
| Params              | `{}`                                                                 |
| Search              | `{}`                                                                 |
| Carries Selection   | no                                                                   |
| Resolvable Entities | none                                                                 |
| Notes               | Index resolver. Redirects to `/welcome` or `/inventory` based on `alm.first-run.completed`. |

### `/welcome`

| Aspect              | Value         |
|---------------------|---------------|
| Path                | `/welcome`    |
| Params              | `{}`          |
| Search              | `{}`          |
| Carries Selection   | no            |
| Resolvable Entities | none          |

### `/inventory`

| Aspect              | Value                                                                |
|---------------------|----------------------------------------------------------------------|
| Path                | `/inventory`                                                         |
| Params              | `{}`                                                                 |
| Search              | `{ lib?: string; id?: string; source?: string; frame?: string; reviewFilter?: string }` |
| Carries Selection   | yes (`id`)                                                           |
| Resolvable Entities | `{source:"search", key:"id", kind:"inventory_item", on_missing:"clear"}` |

| Search Key      | Type    | Purpose                               | On Invalid       | Enum Allow-List |
|-----------------|---------|---------------------------------------|------------------|-----------------|
| `lib`           | string? | Library id for cross-library refusal  | drop             | runtime-known   |
| `id`            | string? | Selected item id                      | drop             | –               |
| `source`        | string? | Filter by data source id              | drop             | –               |
| `frame`         | string? | Filter by frame type                  | error banner+drop | `FrameType` from spec 005: `Light \| Dark \| Flat \| Bias \| DarkFlat` |
| `reviewFilter`  | string? | Filter by review state (canonical key; old key `review` auto-migrated via DeprecatedParamMap) | error banner+drop | `SessionState` from spec 006: 6 canonical values + `all` |

### `/inbox`

| Aspect              | Value                                                  |
|---------------------|--------------------------------------------------------|
| Path                | `/inbox`                                               |
| Params              | `{}`                                                   |
| Search              | `{ lib?: string; id?: string; type?: string; source?: string }` |
| Carries Selection   | yes (`id`)                                             |
| Resolvable Entities | `{source:"search", key:"id", kind:"inbox_item", on_missing:"clear"}` |

| Search Key | Type    | Purpose                  | On Invalid        | Enum Allow-List |
|------------|---------|--------------------------|-------------------|-----------------|
| `lib`      | string? | Library id               | drop              | runtime-known   |
| `id`       | string? | Selected inbox item id   | drop              | –               |
| `type`     | string? | Filter by item type      | error banner+drop | `calibration_type` from spec 007: `dark \| flat \| bias` |
| `source`   | string? | Filter by source id      | drop              | –               |

### `/projects`

| Aspect              | Value                                                          |
|---------------------|----------------------------------------------------------------|
| Path                | `/projects`                                                    |
| Params              | `{}`                                                           |
| Search              | `{ lib?: string; id?: string; lifecycle?: string; tool?: string }` |
| Carries Selection   | yes (`id`)                                                     |
| Resolvable Entities | `{source:"search", key:"id", kind:"project", on_missing:"clear"}` |

| Search Key  | Type    | Purpose                                          | On Invalid        | Enum Allow-List |
|-------------|---------|--------------------------------------------------|-------------------|-----------------|
| `lib`       | string? | Library id                                       | drop              | runtime-known   |
| `id`        | string? | Selected project id                              | drop              | –               |
| `lifecycle` | string? | Lifecycle filter (CSV multiselect, enum-allowed) | error banner+drop | `ProjectLifecycle` from spec 002: `setup_incomplete \| active \| blocked \| processing \| ready \| completed \| archived \| discarded` |
| `tool`      | string? | Tool filter (`tool_id` slug)                     | drop              | runtime-known set from spec 011 |

### `/plans`

| Aspect              | Value                                  |
|---------------------|----------------------------------------|
| Path                | `/plans`                               |
| Params              | `{}`                                   |
| Search              | `{ lib?: string; state?: string; origin?: string }` |
| Carries Selection   | no (selection is path-based via `/plans/$planId`) |
| Resolvable Entities | none                                   |

| Search Key | Type    | Purpose             | On Invalid        | Enum Allow-List |
|------------|---------|---------------------|-------------------|-----------------|
| `lib`      | string? | Library id          | drop              | runtime-known   |
| `state`    | string? | Plan state filter   | error banner+drop | `PlanState` from spec 017+025: `draft \| ready \| approved \| applying \| applied \| partially_applied \| failed \| cancelled \| discarded \| paused` |
| `origin`   | string? | Plan origin filter  | error banner+drop | `PlanOrigin` from spec 017: `cleanup \| split \| retry \| archive \| user` |

### `/plans/$planId`

| Aspect              | Value                                                                 |
|---------------------|-----------------------------------------------------------------------|
| Path                | `/plans/$planId`                                                      |
| Params              | `{ planId: string }`                                                  |
| Search              | `{ lib?: string }`                                                    |
| Carries Selection   | yes (via path param)                                                  |
| Resolvable Entities | `{source:"path", key:"planId", kind:"plan", on_missing:"render_empty"}` |

### `/settings` (redirect)

| Aspect              | Value                                                                |
|---------------------|----------------------------------------------------------------------|
| Path                | `/settings`                                                          |
| Params              | `{}`                                                                 |
| Search              | `{}`                                                                 |
| Carries Selection   | no                                                                   |
| Resolvable Entities | none                                                                 |
| Notes               | Redirects to `/settings/$section` with `section="data-sources"`.     |

### `/settings/$section`

| Aspect              | Value                                                                          |
|---------------------|--------------------------------------------------------------------------------|
| Path                | `/settings/$section`                                                           |
| Params              | `{ section: string }`                                                          |
| Search              | `{ lib?: string }`                                                             |
| Carries Selection   | no                                                                             |
| Resolvable Entities | `{source:"path", key:"section", kind:"settings_section", on_missing:"render_empty"}` |

## NavigationEvent

| Field            | Type     | Notes                                                              |
|------------------|----------|--------------------------------------------------------------------|
| `from_path`      | string   | Previous canonical path.                                           |
| `to_path`        | string   | New canonical path.                                                |
| `params_diff`    | object   | Keys whose values changed in path params.                          |
| `search_diff`    | object   | Keys whose values changed in search params (added, removed, modified). |
| `kind`           | enum     | `"link"`, `"programmatic"`, `"redirect"`, `"replace-cleanup"`. Settled vocabulary (C-020-3). |
| `source`         | enum     | `"user"`, `"restore"`, `"system"`. Matches spec 002 R-Source-1. Emitted on the event bus so subscribers can distinguish user-initiated navigations from restore/system-driven transitions. |
| `at`             | string   | ISO-8601 timestamp.                                                |

## DeprecatedParamMap

The `DeprecatedParamMap` registry maps old URL param keys to their canonical
replacements. The router's URL read phase applies the map before calling
`validateSearch`; the UI always emits the canonical key. Deprecated entries
are removed after 2 app releases.

| Deprecated key | Canonical key   | Route        | Rationale                                    |
|----------------|-----------------|--------------|----------------------------------------------|
| `review`       | `reviewFilter`  | `/inventory` | Aligns with spec 006 FR-010 canonical naming. |

**Implementation rule**: The migration rewrite is applied during search-param
parsing. A `debug`-level migration log entry is emitted per rewrite so the
team can track adoption before removal.

## Stale-Id Re-Fire Guard

Pages that issue a stale-id `navigate({ replace: true })` to clear a missing
`id` from the URL MUST guard against re-firing on every render. Use a `useRef`
flag or effect-cleanup pattern:

```ts
const staleClearedRef = useRef(false);
useEffect(() => {
  if (!staleClearedRef.current && entityMissing) {
    staleClearedRef.current = true;
    navigate({ search: prev => ({ ...prev, id: undefined }), replace: true });
  }
}, [entityMissing]);
```

Tests MUST assert that `navigate` fires at most once per stale-id encounter
(Phase 7 task, D-020-H1).

## RouteLoader (reserved)

Reserved for future use. When loaders are introduced they MUST:

- Be pure functions of `params` and `search`.
- Not call backend writes.
- Treat missing entities as a non-throwing "absent" result that the page
  renders as an empty state (path-param) or clears (`id` search).

No loaders are wired in v1.
