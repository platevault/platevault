# Research: Router And URL State

## R1: Hash History vs Browser History (Desktop)

**Decision**: Use `createHashHistory()` for the Tauri desktop shell.

**Context**: Tauri 2.x loads the SPA bundle from a non-HTTP origin (`file://`
or a custom `tauri://` scheme depending on platform). HTML5 History API
navigations rely on the host honoring path-based URLs for refresh, deep link,
and external-open flows.

**Options Considered**:

- `createBrowserHistory` (HTML5): cleaner URLs, but Tauri's `file://` origin
  rejects same-origin pushState targets on some platforms; refresh requires a
  custom protocol handler that rewrites all sub-paths to `index.html`.
- `createHashHistory` (chosen): every URL is `index.html#/route?search=…`;
  refresh always reloads `index.html`; the hash is parsed in JS; works
  identically across Windows, macOS, and Linux Tauri builds.
- `createMemoryHistory`: discards URLs on reload; breaks the spec's
  refresh-safety requirement and shareable-link affordance.

**Tradeoffs**: Hash URLs are slightly uglier and not search-engine indexable
(irrelevant for a local app). A future browser/web adapter will need a build
flag to swap to `createBrowserHistory`; the route tree itself is unchanged.

## R2: URL State vs Component State for Filters and Selection

**Decision**: URL search params own filter and selection state; component
state is only for transient UI affordances (open menus, draft text).

**Context**: Filters and the selected entity are workflow context the user
expects to survive refresh, copy/paste, and cross-page navigation. Component
state would lose all three.

**Options Considered**:

- Per-page `useState` (rejected): loses on refresh, can't deep-link, can't
  share, drifts between tab and tab.
- Global store (rejected): same restore problem unless mirrored to a durable
  layer; doubles the source of truth for filter state.
- URL search params (chosen): single source of truth, free serialization,
  testable via URL string, restorable for free.

**Tradeoffs**: Every filter change writes to the URL; high-frequency
interactions (e.g. text typing) should debounce writes. Search params are
strings; richer shapes (multiselect, ranges) need a small encoding convention
(see R4).

## R3: Validating Search Params

**Decision**: Each route owns a `validateSearch(search) => Shape` function
that narrows an opaque `Record<string, unknown>` to its typed shape and drops
unknown keys.

**Context**: TanStack Router calls `validateSearch` before passing search to
the component; the return type is the page-visible search shape. Without a
validator, components must defend against `unknown` everywhere.

**Behavior** (two-tier, R-Validator-Tiered):

- Strings: `typeof v === "string" && v.length > 0 ? v : undefined`.
- Enums: parse against an allow-list; a value that is a string but outside the
  allow-list is **invalid** (see below).
- Comma-list multiselect (e.g. `lifecycle=a,b,c`): split on `,`, drop empties,
  drop values outside the allow-list.
- **Unknown keys**: dropped silently (forward-compat for older app versions and
  shared links). No banner, no error.
- **Invalid values of known keys** (e.g. a non-enum string for `frame`): display
  an error banner ("Unrecognised filter value removed") and drop the param from
  the URL on the next merged write. The component sees `undefined`.

**Rejected Alternatives**: Zod-based runtime schemas (too heavy for a v1
prototype layer); throwing on invalid input (breaks shareable-link goodwill).

## R4: Multiselect and Special-Character Encoding

**Decision**: Multiselect search keys use comma-separated values
(`?lifecycle=processing,archived`); special characters in single-value keys
are URL-encoded by TanStack Router's default serializer, which is already
RFC 3986 compliant.

**Context**: The spec's edge cases call out special characters and lifecycle
multiselect. Comma is reserved enough for human-readable links and avoids the
ambiguity of repeated keys (`?lifecycle=a&lifecycle=b`), which not all link
parsers normalize the same way.

**Tradeoffs**: A comma inside a value is impossible to encode without
escaping; v1 filters use enum-only values so this is a non-issue. If freeform
text filters arrive later, switch that key to URL-encoded JSON.

## R5: Stale-Id Behavior

**Decision**: Path-param routes render a "not found" empty state and keep
the URL; search-param `id` clears via `navigate({ replace: true })` while
preserving filter keys. Cross-library mismatches are refused with a banner,
not silently cleared.

**Context**: The spec requires graceful handling of deleted/archived entities
without stranding the user. Path-param routes carry the id as part of the
route identity, so the URL has nowhere else to land; clearing it would lose
the link. Search-param `id` is a soft selection on top of a still-meaningful
ledger view, so clearing it is the safer default. Cross-library links are a
distinct case: the library is still open and valid, the link simply targets
the wrong context — a banner is the correct response.

**Behavior**:

- `/plans/$planId` with unknown id: render "plan not found" with a link back
  to `/plans`. URL stays put. Optional "go to plans list" replaces.
- `/inventory?id=missing&frame=light`: detail layer reports missing, page
  issues `navigate({ search: prev => ({ ...prev, id: undefined }), replace: true })`.
  URL becomes `/inventory?frame=light`.
- Library mismatch (`lib` param differs from currently-open library): refuse
  with inline banner "This link is from a different library." Do NOT apply
  filters or clear selection silently. The `url.resolve` contract returns a
  `library.mismatch` error and the caller shows the refusal banner.

## R6: Link Shape For Sharing and Exporting

**Decision**: Shared links are exactly the in-app URL, no extra wrapper. A
future "copy link" affordance reads `window.location.href` after a `navigate`
settle; an importer pastes it into the address bar (or a future "open link"
dialog). Library identity IS encoded in v1 via `?lib=<library_id>` (R-Lib-V1).

**Context**: Every internal link carries `?lib=<current_library_id>` as a
required search param (injected by all `<Link>` components and `useNavigate`
call sites). This allows importers to detect a mismatch at resolution time and
refuse with a banner rather than silently clearing selection. The param is
validated by `url.resolve`, which returns `library.mismatch` when the open
library differs.

**Settled design (C-020-1)**: `library_id` is required (not deferred/ignored)
in v1.

**Tradeoffs**: Every link now carries the library id; stale-library links
surface a clear refusal banner rather than silently applying partial state.

**Rejected Alternatives**: Encode a JSON payload (heavier, less debuggable);
mint a custom `alm://` scheme (requires OS-level handler registration; out of
scope for v1).

## R7: Code-Based vs File-Based Routing

**Decision**: Code-based route definitions.

**Context**: The route surface is small and bounded (~9 routes) and is
deliberately audited against the spec. File-based routing optimizes for
discoverability in large apps; code-based optimizes for a single source of
truth that can be diffed against the spec table.

**Tradeoffs**: Adding a route requires editing `router.tsx`; this is desired
friction at v1 scale.

## R8: Index Route Resolution (unchanged)

**Decision**: `/` is a component-only route that reads
`alm.first-run.completed` from localStorage and issues a `Navigate replace`
to `/welcome` or `/inventory`.

**Context**: The decision must run before any backend hydration. Using a
loader would block the first paint on backend readiness; using localStorage
is synchronous and decoupled from backend.

**Tradeoffs**: A misconfigured/cleared localStorage sends a returning user
back through Welcome, which is acceptable; Welcome offers a fast-path to
Inventory.

## R9: Deprecated Param Migration (DeprecatedParamMap)

**Decision**: Maintain a `DeprecatedParamMap` registry that maps old
(deprecated) URL param keys to their canonical replacements. At URL read
time the router applies the map before passing search params to
`validateSearch`, transparently upgrading old links. The UI always emits
the canonical key; deprecated entries are removed after 2 releases.

**Initial mapping**:

| Deprecated key | Canonical key | Route     | Notes                        |
|----------------|---------------|-----------|------------------------------|
| `review`       | `reviewFilter`| `/inventory` | Renamed to align with spec 006 FR-010. |

**Behavior**:
- Incoming URL has `?review=foo`: read phase rewrites to `?reviewFilter=foo`
  before `validateSearch` runs; a migration log entry is emitted at `debug`
  level.
- The UI never writes `review`; all `useNavigate` call sites use `reviewFilter`.
- Deprecated entries are removed after 2 app releases; the migration log helps
  track adoption before removal.

**Rejected Alternatives**: Silently forwarding without logging (hard to remove
later); keeping both keys in parallel (doubles the surface).

## R10: `?lib=` Required in All Internal Links (R-Lib-V1)

**Decision**: All internally generated links carry `?lib=<current_library_id>`
as a required search param. The `url.resolve` contract compares this value to
the currently-open library and returns `library.mismatch` on conflict.

**Rationale**: Ships cross-library refusal in v1. Prevents silent filter
application across library contexts. Requires `current_library_id` to be
available in the UI context at link-generation time (see spec 018 ripple flag).

## Settled Design Decisions (Silent Questions Resolved)

These questions were resolved without requiring new options analysis:

- **C-020-1 (`library_id` required)**: `library_id` is required in
  `url.resolve` Request; not ignored. Covered by R-Lib-V1 above.
- **C-020-2 (`overall_status: "partial"`)**: The `ok | partial | stale`
  taxonomy is kept as defined. `partial` means at least one path entity
  exists but at least one search `id` is missing.
- **C-020-3 (`NavigationEvent.kind` enum)**: The four-value enum
  `link | programmatic | redirect | replace-cleanup` is kept and is the
  canonical vocabulary for the event bus.
- **C-020-4 (`settings_section` resolves to `render_empty`)**: An unknown
  `settings_section` path param renders a section-not-found empty state
  inside the settings shell (no hard redirect). Consistent with
  `on_missing: "render_empty"` in the route contract.
