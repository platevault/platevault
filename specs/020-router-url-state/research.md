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

**Behavior**:

- Strings: `typeof v === "string" && v.length > 0 ? v : undefined`.
- Enums: parse against an allow-list, return `undefined` for unknown.
- Comma-list multiselect (e.g. `lifecycle=a,b,c`): split on `,`, drop empties,
  drop values outside the allow-list.
- Unknown keys: dropped silently (forward-compat for older shared links).
- Invalid values: dropped silently; component sees `undefined` and the bad
  fragment is removed from the URL on the next merged write.

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
preserving filter keys.

**Context**: The spec requires graceful handling of deleted/archived entities
without stranding the user. Path-param routes carry the id as part of the
route identity, so the URL has nowhere else to land; clearing it would lose
the link. Search-param `id` is a soft selection on top of a still-meaningful
ledger view, so clearing it is the safer default.

**Behavior**:

- `/plans/$planId` with unknown id: render "plan not found" with a link back
  to `/plans`. URL stays put. Optional "go to plans list" replaces.
- `/inventory?id=missing&frame=light`: detail layer reports missing, page
  issues `navigate({ search: prev => ({ ...prev, id: undefined }), replace: true })`.
  URL becomes `/inventory?frame=light`.
- Library mismatch: same behavior as deleted; the importer of a foreign link
  sees the filter portion apply and the selection cleared with an info notice.

## R6: Link Shape For Sharing and Exporting

**Decision**: Shared links are exactly the in-app URL, no extra wrapper. A
future "copy link" affordance reads `window.location.href` after a `navigate`
settle; an importer pastes it into the address bar (or a future "open link"
dialog). Library identity is not encoded in v1.

**Context**: The spec wants shareable links without mandating a portable
library identity scheme today. Keeping the shape identical to the in-app URL
maximizes round-trip fidelity and avoids a parser fork.

**Tradeoffs**: A pasted link that targets a different library opens the
correct route + filters but typically clears selection. R5 covers the UX.
A future research item will decide whether to prefix `?lib=<id>` so importers
can refuse mismatched links instead of silently clearing selection.

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

## R8: Index Route Resolution

**Decision**: `/` is a component-only route that reads
`alm.first-run.completed` from localStorage and issues a `Navigate replace`
to `/welcome` or `/inventory`.

**Context**: The decision must run before any backend hydration. Using a
loader would block the first paint on backend readiness; using localStorage
is synchronous and decoupled from backend.

**Tradeoffs**: A misconfigured/cleared localStorage sends a returning user
back through Welcome, which is acceptable; Welcome offers a fast-path to
Inventory.
