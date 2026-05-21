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
| Search              | `{ id?: string; source?: string; frame?: string; review?: string }`  |
| Carries Selection   | yes (`id`)                                                           |
| Resolvable Entities | `{source:"search", key:"id", kind:"inventory_item", on_missing:"clear"}` |

| Search Key | Type    | Purpose                       | On Invalid |
|------------|---------|-------------------------------|------------|
| `id`       | string? | Selected item id              | drop       |
| `source`   | string? | Filter by data source id      | drop       |
| `frame`    | string? | Filter by frame type          | drop       |
| `review`   | string? | Filter by review state        | drop       |

### `/inbox`

| Aspect              | Value                                                  |
|---------------------|--------------------------------------------------------|
| Path                | `/inbox`                                               |
| Params              | `{}`                                                   |
| Search              | `{ id?: string; type?: string; source?: string }`      |
| Carries Selection   | yes (`id`)                                             |
| Resolvable Entities | `{source:"search", key:"id", kind:"inbox_item", on_missing:"clear"}` |

| Search Key | Type    | Purpose                  | On Invalid |
|------------|---------|--------------------------|------------|
| `id`       | string? | Selected inbox item id   | drop       |
| `type`     | string? | Filter by item type      | drop       |
| `source`   | string? | Filter by source id      | drop       |

### `/projects`

| Aspect              | Value                                                          |
|---------------------|----------------------------------------------------------------|
| Path                | `/projects`                                                    |
| Params              | `{}`                                                           |
| Search              | `{ id?: string; lifecycle?: string; tool?: string }`           |
| Carries Selection   | yes (`id`)                                                     |
| Resolvable Entities | `{source:"search", key:"id", kind:"project", on_missing:"clear"}` |

| Search Key  | Type    | Purpose                                          | On Invalid |
|-------------|---------|--------------------------------------------------|------------|
| `id`        | string? | Selected project id                              | drop       |
| `lifecycle` | string? | Lifecycle filter (CSV multiselect, enum-allowed) | drop       |
| `tool`      | string? | Tool filter                                      | drop       |

### `/plans`

| Aspect              | Value                                  |
|---------------------|----------------------------------------|
| Path                | `/plans`                               |
| Params              | `{}`                                   |
| Search              | `{ state?: string; origin?: string }`  |
| Carries Selection   | no (selection is path-based via `/plans/$planId`) |
| Resolvable Entities | none                                   |

| Search Key | Type    | Purpose             | On Invalid |
|------------|---------|---------------------|------------|
| `state`    | string? | Plan state filter   | drop       |
| `origin`   | string? | Plan origin filter  | drop       |

### `/plans/$planId`

| Aspect              | Value                                                                 |
|---------------------|-----------------------------------------------------------------------|
| Path                | `/plans/$planId`                                                      |
| Params              | `{ planId: string }`                                                  |
| Search              | `{}`                                                                  |
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
| Search              | `{}`                                                                           |
| Carries Selection   | no                                                                             |
| Resolvable Entities | `{source:"path", key:"section", kind:"settings_section", on_missing:"render_empty"}` |

## NavigationEvent

| Field            | Type     | Notes                                                              |
|------------------|----------|--------------------------------------------------------------------|
| `from_path`      | string   | Previous canonical path.                                           |
| `to_path`        | string   | New canonical path.                                                |
| `params_diff`    | object   | Keys whose values changed in path params.                          |
| `search_diff`    | object   | Keys whose values changed in search params (added, removed, modified). |
| `kind`           | enum     | `"link"`, `"programmatic"`, `"redirect"`, `"replace-cleanup"`.     |
| `at`             | string   | ISO-8601 timestamp.                                                |

## RouteLoader (reserved)

Reserved for future use. When loaders are introduced they MUST:

- Be pure functions of `params` and `search`.
- Not call backend writes.
- Treat missing entities as a non-throwing "absent" result that the page
  renders as an empty state (path-param) or clears (`id` search).

No loaders are wired in v1.
