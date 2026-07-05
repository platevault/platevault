# Research: Tauri Shell Integration & Platform Polish

**Feature**: `051-tauri-shell-integration` | **Date**: 2026-07-05

Per Constitution Principle IV, this file records the research decisions this
feature depends on before implementation begins. Four questions were posed;
each is answered below with the decision, rationale, and alternatives
considered.

---

## (a) Auto-update: signing model, endpoint shape, and CI

### Decision

Adopt the **minisign** signing model exactly as modeled by the reference
implementation `~/dev/astro-up` (a sibling project by the same author, same
Tauri major version), but with a **new, PlateVault-specific keypair** — keys
are never shared across products. Endpoint shape: a GitHub Releases artifact
set plus a generated `latest.json` update manifest, published by a release
workflow using `tauri-apps/tauri-action`'s `includeUpdaterJson: true`.

**What already exists in `astro-up` (the reference model)**:

- `crates/astro-up-gui/tauri.conf.json` embeds the **public** key
  (`plugins.updater.pubkey`, base64-encoded minisign public key block) and
  points `plugins.updater.endpoints` at
  `https://github.com/<org>/<repo>/releases/latest/download/latest.json`.
- The private signing key and its password are **GitHub Actions secrets**
  (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`), consumed
  only inside `.github/workflows/release.yml`'s `tauri-apps/tauri-action`
  step — never committed to the repo. The public `minisign.pub` /
  `minisign.pub.key` files ARE committed (that is the point of a public key).
- `crates/astro-up-gui/capabilities/default.json` grants `updater:default` and
  `process:default` (the latter for the app-restart-to-apply-update step).
- `crates/astro-up-gui/src/lib.rs` registers
  `tauri_plugin_updater::Builder::new().build()` at setup, and a
  `check_for_app_update` helper calls `app.updater()?.check().await`, emitting
  an `update-available` frontend event on `Ok(Some(update))` and treating
  `Err` as "updater not available" (logged at `debug`, not fatal).
- The release workflow structure: `release-please` (GitHub App-authenticated)
  creates the tag/release notes → a build job runs `tauri-apps/tauri-action`
  with `includeUpdaterJson: true` and `updaterJsonPreferNsis: true` (Windows
  NSIS installer preferred for the updater artifact) → a publish job flips the
  draft release live only if the build succeeded.

**What does NOT exist yet in `astro-plan`/PlateVault** (verified during this
research — `.github/workflows/` currently contains only `ci.yml` and
`e2e.yml`; no `release-please` config, no release workflow, no committed
minisign keys):

- No signing keypair.
- No release-please configuration or manifest.
- No release workflow / "Release Gate" CI job.

**Consequence for this spec**: US10's *application-side* integration (plugin
registration, `tauri.conf.json` `plugins.updater` block shape, capability
grant, check/verify/install flow, frontend "update available" affordance) is
fully specified and ready to implement here. The *infrastructure* side (key
generation, `release-please` adoption, the `release.yml` workflow, and
publishing the first signed release) is **out of scope for this spec's
commits** — partly by explicit instruction (pushes touching
`.github/workflows/**` are rejected for this branch's token; see plan.md), and
partly because it is genuinely a separate, sequenced piece of infrastructure
work that a repo owner with release-please authority should stand up as its
own change, modeled directly on `astro-up`'s `release.yml`. `tasks.md` records
this as an explicit, non-code follow-up task with the exact reference file
paths to copy from.

### Endpoint / manifest shape (for the `tauri.conf.json` placeholder)

```jsonc
"plugins": {
  "updater": {
    "pubkey": "<PlateVault's own minisign public key, base64, generated fresh>",
    "endpoints": [
      "https://github.com/<org>/astro-plan/releases/latest/download/latest.json"
    ]
  }
}
```

The `pubkey` value is a placeholder until the real keypair exists (see
Follow-up below); committing a placeholder that is obviously non-functional
(and documented as such) is preferable to blocking this spec on infrastructure
it does not own.

### Follow-up (tracked, not built here)

1. Generate a **new** minisign keypair for PlateVault (`cargo tauri signer
   generate`, or the `minisign` CLI) — never reuse `astro-up`'s keys.
2. Store the private key + password as repo secrets
   (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`); commit
   only the public key/pubkey block.
3. Stand up `release-please` (manifest + config) and a `.github/workflows/release.yml`
   modeled on `astro-up`'s, adapted for this repo's multi-crate/pnpm-workspace
   layout and its "Release Gate" quality bar (however that gate is ultimately
   defined for this repo).
4. Replace the placeholder `pubkey` in `tauri.conf.json` with the real one.

### Alternatives considered

- **Reuse `astro-up`'s keypair** — rejected: a compromised or rotated key for
  one product must not affect the other; per-product keys are the standard
  minisign/Tauri recommendation and cost nothing extra.
- **A self-hosted update server instead of GitHub Releases** — rejected as
  unnecessary complexity; GitHub Releases + `latest.json` is exactly what
  `tauri-plugin-updater` expects out of the box and what the reference
  implementation already does successfully.
- **`updater:allow-download-and-install` broad permission vs. `updater:default`** —
  `updater:default` (used by the reference impl) is suffient for a
  check-then-user-confirms flow and is the narrower grant; adopted.

---

## (b) Cleanup per-type action overrides: `localStorage` vs. database

### Decision

Move the override values into the database, but via the **existing generic
`settings` mechanism** (migration 0013, `crates/app/settings`), not a new
bespoke table. Concretely: add one new stable settings key,
`cleanupTypeOverrides`, whose value is a JSON object mapping a cleanup data
type's stable numeric id (as a string) to its overridden action
(`"Keep" | "Archive" | "Delete"`), registered in
`crates/app/settings/src/descriptors.rs` alongside the existing
`defaultProtection` / `protectedCategories` / per-frame-type-pattern keys.

### Rationale

- The generic `settings` table (`key TEXT PRIMARY KEY, value TEXT JSON,
  updated_at`) already stores exactly this shape of data — a small, whole-object,
  infrequently-changed configuration value — for structurally identical cases:
  `defaultDestinationPatterns` (spec 041 FR-026b) is already "a JSON object
  mapping [a closed enum] to [a value]", the same shape this needs
  (data-type-id → action).
  Reusing it means **zero new migration and zero new table** for this piece.
- `update_setting` in `crates/app/settings/src/lib.rs` already emits a
  `SettingsChanged` audit event (topic `TOPIC_SETTINGS_CHANGED`) on every
  non-no-op write, for free satisfying FR-008 ("each change... recorded in the
  existing audit trail") with **no new audit plumbing**.
- The frontend component (`Cleanup.tsx`) already calls `save('cleanup', {
  ...values })` for this exact settings scope (today only for
  `blockPermanentDelete`/`defaultProtection`) — adding `cleanupTypeOverrides`
  to that same call is a small, in-place change, not a new IPC surface.
- The fixed **taxonomy** (which 20 data types exist, their labels, stage
  grouping, and built-in default action — `CLEANUP_TYPES` in
  `apps/desktop/src/data/fixtures/settings.ts`) stays exactly where it is: it
  is app-defined reference data, not user data, and per FR-009 this feature
  does not change it. Only the user's *override* of the action moves to the
  database.

### Alternatives considered

- **A dedicated `cleanup_type_override` table** (one row per data-type id,
  its own migration, its own repository, its own audit call) — rejected as
  unnecessary duplication of infrastructure the generic settings mechanism
  already provides for an identically-shaped problem. This would also require
  a new IPC contract pair (`cleanup.overrides.list`/`.set`) where the existing
  `settings.get`/`settings.update` already do the job.
- **Store the full taxonomy (labels + defaults) in the database too**, driven
  by a backend catalog endpoint — rejected as scope creep: nothing in this
  spec's decided scope asks for a dynamic, backend-defined cleanup taxonomy,
  and the existing `TODO(cleanup-plan-spec)` in `Cleanup.tsx` already marks
  full backend wiring (including plan generation) as a distinct, not-yet-specified
  future feature (FR-010 makes this explicit).
- **Leave overrides in `localStorage`** — rejected per Constitution Principle V
  and the task's explicit instruction; overrides drive (future) cleanup-plan
  generation and must be canonical/auditable/portable.

---

## (c) Per-plugin version / maturity

`mcp-package-version` has no crates.io checker, so exact Rust crate versions
below were confirmed live against the crates.io API (`GET
/api/v1/crates/<name>`) on 2026-07-05; JS wrapper versions were confirmed via
`mcp-package-version`'s npm checker the same day. Tauri core itself is already
pinned at `2.11` (`Cargo.toml`) with `tauri = "2.11.2"` resolved in
`Cargo.lock`; all first-party plugins below are from the same
`tauri-apps/plugins-workspace` release train and are compatible with that
core version.

| Plugin | Rust crate (crates.io, confirmed 2026-07-05) | JS package (npm, confirmed 2026-07-05) | Publisher | Notes |
|---|---|---|---|---|
| Single-instance guard | `tauri-plugin-single-instance` **2.4.2** | *(none — Rust-only, no frontend API)* | `tauri-apps` (official) | Callback-based; receives the second launch's argv + cwd. |
| Window-state | `tauri-plugin-window-state` **2.4.1** | `@tauri-apps/plugin-window-state` **2.4.1** | `tauri-apps` (official) | JS package only needed if the frontend wants to trigger an explicit save; the Rust plugin alone auto-saves/restores. |
| Diagnostics log | `tauri-plugin-log` **2.8.0** | `@tauri-apps/plugin-log` **2.8.0** | `tauri-apps` (official) | Supports multiple targets (stdout + rotating file) simultaneously; rotation via `RotationStrategy`/`Target::Folder` with a max-file-size trigger. |
| OS notifications | `tauri-plugin-notification` **2.3.3** | `@tauri-apps/plugin-notification` **2.3.3** | `tauri-apps` (official) | Permission model varies per OS (see plan.md platform differences). |
| Auto-update | `tauri-plugin-updater` **2.10.1** | `@tauri-apps/plugin-updater` **2.10.1** | `tauri-apps` (official) | Also needs `@tauri-apps/plugin-process`/`process:default` capability for the relaunch-to-apply step (confirmed `@tauri-apps/plugin-process` **2.3.1**). |
| Prevent-default (F5/reload/native context menu) | `tauri-plugin-prevent-default` **5.0.2** | *(none — Rust-only, `Builder`-time config)* | **community** (`ferreira-tb`, not the `tauri-apps` org) | Third-party but widely used and actively maintained (repo: `github.com/ferreira-tb/tauri-plugin-prevent-default`); scope it to release builds only via the existing `#[cfg(not(debug_assertions))]` pattern already used elsewhere in `lib.rs`. Re-verify latest version at implementation time since it is not from the core org and has a faster release cadence. |
| Native application menu | *(no plugin)* — part of the `tauri` core crate (`tauri::menu` module, already available at `2.11.2`) | *(no package)* — `@tauri-apps/api/menu` (bundled with the already-pinned `@tauri-apps/api` **2.9.0**) | `tauri-apps` (official, core) | No new dependency at all. |
| Native theme sync | *(no plugin)* — `WebviewWindow::set_theme` / `@tauri-apps/api/window`'s `Window.setTheme()`, both part of core `tauri`/`@tauri-apps/api` (already pinned) | same | `tauri-apps` (official, core) | No new dependency. Desktop-only; see plan.md for the per-platform behavior. |
| `core.isTauri()` cleanup | *(no plugin)* — `@tauri-apps/api/core` (already pinned at `2.9.0`) | same | `tauri-apps` (official, core) | Already available today; this is a call-site swap, not a new dependency. |

None of the plugins above are currently present in `Cargo.lock`/`package.json`
(only `dialog`, `opener`, `mcp-bridge`, and the `e2e`-gated `webdriver` plugin
are). All eight new Rust crates/JS packages above must be added at
implementation time; re-confirm the exact patch version against crates.io/npm
at that point since time will have passed since this research pass.

---

## (d) Shared app-layer caching crate (moka) — shape and the resolver-decoupling rule

### Decision

Introduce a new, thin crate: **`crates/app/cache`** (workspace member name
`app_core_cache`, following the existing `app_core_*` naming convention
alongside `app_core_core`, `app_core_projects`, `app_core_targets`, etc.). It
wraps `moka` (already an in-tree workspace dependency, `moka = { version =
"0.12", features = ["sync"] }`, currently consumed directly and only by
`crates/app/projects/src/project_health.rs` for a debounce cache) behind a
small, typed API surface (e.g. a generic `TtlCache<K, V>` / `DebounceCache<K>`
wrapper struct) so other `app_core_*` crates get the same in-memory caching
primitive without each hand-rolling a `moka::sync::Cache` construction, and
without pulling `moka` in as a direct dependency of crates that do not
otherwise need it.

- **Scope**: in-memory, in-process, non-durable caching for app-layer
  orchestration code only (e.g. debouncing repeated event emission, memoizing
  a cheap derived read within a request). It is explicitly **not** a durable
  cache, not a replacement for SQLite, and not a general key-value store —
  Constitution Principle V still requires the database to be the durable
  record.
- **Consumers**: any `crates/app/*` crate MAY depend on `app_core_cache`
  (e.g. `crates/app/projects` could migrate its existing
  `project_health.rs` debounce cache onto the shared wrapper as a
  non-blocking follow-up — not required by this spec, since the existing
  direct `moka` usage there already works and migrating it is a pure
  refactor with no user-facing effect).

### The resolver-decoupling rule (hard constraint)

`crates/targeting/resolver` (the redistributable SIMBAD resolution crate) MUST
NOT depend on `app_core_cache`, and MUST NOT be changed by this feature. It
already has its own **self-contained SQLite-backed** resolution cache
(`crates/targeting/resolver/src/cache.rs`, keyed by `simbad_oid`,
deduplicated, `user-override`-precedence-aware) which is deliberately durable
(not in-memory) because resolution results must survive restarts and because
the crate is designed to be redistributable/embeddable outside this
application (per its own module doc: "The local SQLite cache is the durable
record (constitution §V)"). Coupling it to an app-layer, workspace-internal
convenience crate would:

1. Force every consumer of the resolver crate to also pull in
   `app_core_cache` and, transitively, `moka` — a redistribution/dependency-surface
   regression for a crate explicitly designed to be self-contained.
2. Conflate two different caching concerns: the resolver's cache is a
   *durable, semantic, dedup-by-oid* store; `app_core_cache` is a
   *volatile, TTL/debounce* utility. Merging them would blur an intentional
   architectural boundary for no benefit.

This rule is enforced by convention (crate dependency review) rather than by a
new lint, consistent with how other crate-boundary rules in this repository
are enforced today (e.g. the `dev-tools`/`e2e` feature gates are reviewed, not
mechanically linted).

### Alternatives considered

- **Depend on `moka` directly in each new consumer, no wrapper crate** —
  rejected: the task explicitly calls for "a thin shared caching crate", and a
  thin wrapper gives one place to standardize construction (capacity/TTL
  defaults, naming) rather than N independent `Cache::builder()` call sites.
- **Put the wrapper in `crates/app/core` instead of a new crate** — rejected:
  `app_core` (`crates/app/core`) is the use-case orchestration boundary
  crate and already has its own dependents; a dependency-free leaf crate
  (mirroring `app_core_errors`) keeps the caching utility from forcing a
  rebuild of `app_core` for unrelated changes, matching this repo's stated
  preference for "small Rust crates with narrow responsibility."
- **Have the resolver crate consume the shared cache for its in-memory
  hot-path reads, keeping SQLite only as the durable fallback** — rejected for
  this spec: it is a legitimate future optimization but is exactly the kind of
  redistribution-coupling change this rule exists to gate; it would need its
  own research/decision if ever proposed, not an incidental add-on here.
