# Open-Point Grill Decisions

**Date:** 2026-05-21
**Scope:** Companion to `SPECKIT_PASS_2026-05-20.md`. Captures the user's decisions on every open point surfaced by the adversarial-review pass. The next SpecKit revision should adopt these as ratified defaults and update the corresponding `spec.md` / `plan.md` / `research.md` artifacts.

## Cross-cutting decisions

These apply to multiple specs and should be threaded through:

1. **Event bus is the canonical state-propagation design** for all specs (originally surfaced under spec 002 stale propagation). Decouples producers and consumers across the workspace.
2. **Greenfield project** — no migration burden for v1. Settings stay `v1` forever (until a real v2 ships). Spec 010 has no existing-installs case.
3. **UI vocabulary aligns to backend** — drop presentational state projections; both layers use the 6 canonical inventory-session states.
4. **No auto-discovery without explicit user confirmation** — settings prefill, never auto-active.

---

## Per-spec decisions

### Spec 002 — Data Lifecycle State Model

| Open point | Decision |
|---|---|
| `state.unchanged` response shape | Third response status `status: "noop"` (no `audit_id`, no error) |
| Action-bound review block UX | Route to detail drawer with offending field highlighted |
| Projection-staleness propagation | **Event bus** (covers this spec + all others) |
| Provenance history retention | Keep most recent N per origin tag inline; archive older to a separate table |

### Spec 003 — First-Run Source Setup

| Open point | Decision |
|---|---|
| Restart wizard from Settings | Prefill existing sources; user adds/removes |
| Finish atomicity on partial register failure | Per-source calls + 'partial success' Finish screen with retry per row |
| Gate authority drift (localStorage vs DB) | **Research item:** can the localStorage flag be eliminated entirely in favor of DB-only? |

### Spec 004 — Native Filesystem Controls

| Open point | Decision |
|---|---|
| Audit log path PII | Drop path from audit; correlate via `entity_id` only |
| Reveal-in-OS through symlinks | Preserve the user-visible path |
| Tauri capability scope | Separate per operation: `reveal`, `launch-url`, `launch-app` |

### Spec 005 — Inbox Mixed-Folder Split

| Open point | Decision |
|---|---|
| Mixed-folder threshold | Strict: any rogue file (`≥1`) triggers split-plan |
| LRGB folder (lights with multiple filters) | Single-type; pattern routes by `{filter}` token |
| `unclassified` items recovery | Inline per-file 'Reclassify…' picker; 'Confirm' enabled once every file has manual kind |
| Classify/confirm TOCTOU | Re-classify in the same transaction as confirm; if drift, return `classification.stale` and force re-preview |

### Spec 006 — Inventory Library Lifecycle

| Open point | Decision |
|---|---|
| Presentational vs canonical states | UI uses the SAME 6 canonical states as backend; drop the 3-state projection |
| `ignored` filter UX | Cmd+K action 'Show ignored items' toggles the filter |
| Per-frame kind storage | Lives in spec 005 (Inbox) only; Inventory sessions collapse to single kind on confirm |

### Spec 007 — Calibration Matching Rules

| Open point | Decision |
|---|---|
| Flat gain hard vs soft | Configurable in Settings → Calibration |
| Dark temp tolerance | Fixed ±2°C default; user-overridable in Settings |
| Auto-assign on high-confidence single match | Pre-fill suggestion; user must confirm (no silent auto-assign) |
| Observing-night fallback when sessions record missing | Refuse to match; surface 'needs review' to user |

### Spec 008 — Project Create / Onboard / Edit

| Open point | Decision |
|---|---|
| Empty-sources project create | Allowed; lifecycle stays `setup_incomplete` until first source added |
| Tool unlock after `prepared` | No unlock; duplicate-as-new-project is the recovery path |
| Manual channel sticky on new source | Manual channels stick UNTIL user re-infers; new sources trigger a warn banner |
| Create UX | Single-form dialog (name, tool, optional initial sources, optional notes) |

### Spec 009 — Project Lifecycle Model

| Open point | Decision |
|---|---|
| System detector block rate suppression | No suppression at lifecycle layer — detector layer debounces (explicitly documented) |
| `actor=system` allowed edges | Restricted to `* → blocked` and `blocked → *` (recovery) only |
| `blocked → archived` / `blocked → completed` | Add `blocked → archived` only (escape hatch); `blocked → completed` stays forbidden |

### Spec 010 — Guided First-Project Flow

| Open point | Decision |
|---|---|
| Restart-after-Completed semantics | Reset progress, replay from step 1 |
| Dismissed coach scope | Persist across restarts; explicit Settings restart to re-enable |
| Existing-installs migration | N/A — greenfield project |
| Anchor-orphan protection | CI test that every registered anchor exists in the built bundle |

### Spec 011 — Processing Tool Launch

| Open point | Decision |
|---|---|
| macOS launch mechanism | `open -b com.pixinsight.PixInsight` (bundle id) |
| Tool-path auto-discovery trust | Pre-fill Settings only; user saves before activation. Also run during first-run wizard step |
| 'PI may already be running' policy | Warn dialog: 'Open another instance? [yes][cancel]' |
| Multi-version PixInsight | Defer to v2; v1 has one executable per tool |

### Spec 012 — Processing Artifact Observation

| Open point | Decision |
|---|---|
| PI rerun overwrites same path | Update in place (single row, content hash updated). Audit history lost but model simpler |
| Manual override clear-path | `kind: null` clears the override and re-applies rules |
| `final` artifact → manifest auto-link | Never auto-link; user manually attaches |
| Late-arriving launch attribution | Re-attribute within 6-hour window on `tool.launch` event |

### Spec 013 — Target Lookup From FITS Object

| Open point | Decision |
|---|---|
| v1 catalog scope | Ship all 5 (Messier + NGC + IC + Sharpless + LBN + LDN + common names) |
| Cross-catalog identity (M101 ≡ NGC5457) | **Revised:** auto-merge via cross-catalog equivalence table (reversal of original 'no auto-merge'). Spec 023's merge contract drops out |
| Ambiguity gap rule | Resolved if top is HIGH OR (top is MEDIUM AND second-best ≥15 points lower AND top score ≥90) |

### Spec 014 — Catalog Index Licensing

| Open point | Decision |
|---|---|
| OpenNGC CC BY-SA distribution | Bundle as a separate downloadable artifact at first run; app stays Apache-2.0. **Requires network for first run.** |
| Catalog updates | App-release-bound for v1; signed manifest fetch in v1.x |
| User-added catalogs | Not supported in v1 |

### Spec 015 — Token Pattern Builder

| Open point | Decision |
|---|---|
| Unicode normalization | NFC + strip C0/C1/format/bidi + confusables check |
| Reserved segments (`.`, `..`, Windows device names) | Reject on Windows; allow on macOS/Linux |
| Path length cap | Per-segment 200 bytes UTF-8; total relative path 200 chars |
| Vocabulary churn (token removed in future) | Hard-fail with `token.unknown`; UI banner blocks Inbox confirm |

### Spec 016 — Source Protection Defaults

| Open point | Decision |
|---|---|
| Override vs category precedence | Per-source override wins (even `unprotected` over a protected category) |
| `block_permanent_delete` scope | Per-source override + global default (mirrors `level`) |
| In-code default fallback if global row missing | `level: protected`, `block_permanent_delete: true`, `protected_categories: [lights, masters, finals]` |
| `protected_categories` storage shape | `array<string>` in storage; UI parses/renders comma-separated |

### Spec 017 — Cleanup Archive Review Plans

| Open point | Decision |
|---|---|
| Approval-token mechanism | HMAC over `(plan_id, content_hash, approved_at, server_secret)`; single-use. **No TTL** — superseded by per-apply FS revalidation (2026-05-21): apply revalidates each item's source content-hash and destination emptiness against current FS state; any drift surfaces a "Plan is stale" dialog and the user re-approves with a fresh plan baked against current state. HMAC still guards plan-body integrity end-to-end. |
| Discard with active retry chain | Soft-delete (`discarded_at` flag); chain stays intact |
| Plan counter shape | Add `itemsSkipped`; invariant `total == applied + failed + skipped + cancelled + pending` |
| Terminal plan retention | Keep all indefinitely; UI filter hides older than N days by default |

### Spec 018 — Settings Configuration Model

| Open point | Decision |
|---|---|
| No-op guard equality | Deep structural for object/array keys; strict for primitives |
| `autoApplyPattern` overridable scope | Drop `autoApplyPattern` from overridable set (symmetry with `pattern` non-override) |
| Restore-defaults semantics | Write the literal current default value; row is explicit; future default changes don't silently propagate |
| Schema migration | N/A — greenfield; v1 forever |

### Spec 019 — Bottom Log Viewer

| Open point | Decision |
|---|---|
| Id namespacing | Namespaced: `aud:<n>` for audit, `dia:<n>` for diagnostic |
| Export source default | `source: audit` (excluding diagnostics); toggle 'Include diagnostics' |
| Diagnostic events default visibility | Hidden by default if `logLevel != debug`; **plus** a per-session level toggle in the log header |
| Cursor-vacuum truncation signal | Inline marker at top of log: 'History gap — N entries older than this point are no longer retained' |

### Spec 020 — Router URL State

| Open point | Decision |
|---|---|
| Cross-library link policy | Refuse with inline message: 'This link is from a different library' (use `?lib=<library_id>` param) |
| Validator strictness | Strict allow-list per route; unknown values raise an error banner |
| Deprecated key alias | Maintain alias map; auto-migrate on URL read; remove after 2 releases |

### Spec 021 — Developer Contract Diagnostics

| Open point | Decision |
|---|---|
| devMode gating | Compile-time feature flag; release builds omit the surface entirely |
| Path redaction in exports | Redact ALL paths by default; per-export opt-in to include verbatim |
| Toggle-off behavior | Require app restart to actually uninstall the proxy. **FR-008 acceptance needs amendment** (current text says immediate effect) |
| `replay_safe` default | `false`; opt-in only |

### Spec 022 — Desktop Prototype Design System

| Open point | Decision |
|---|---|
| DESIGN.md location | Root-level `/DESIGN.md` |
| Density levels | Two (dense + comfortable); ship compact later if requested |
| New primitive threshold | 3+ uses OR unique a11y semantics |
| Token additions process | DESIGN.md update + adversarial review before merge |

### Spec 023 — Target Identity History Notes

| Open point | Decision |
|---|---|
| v1 merge contract | **Skipped** — reversed; spec 013 ships cross-catalog equivalence table instead |
| `captured_on` rule | Observing-night = local solar noon → next local solar noon; `captured_on` is the start-of-night date. Requires observer-location setting |
| Notes length cap | 16 KB UTF-8; debounce 5s for coalescing |

### Spec 024 — Project Manifests And Notes

| Open point | Decision |
|---|---|
| File immutability vs `version` | File is canonical and immutable; `version` only governs new writes |
| Notes embedding in manifest | Full text snapshot at write time |
| Trigger taxonomy | Expand enum: `created | source_change | lifecycle_transition | cleanup_applied | workflow_run` |
| Retention | Keep all v1; paginate list contract; auto-prune deferred to v1.x |

### Spec 025 — Filesystem Plan Application

| Open point | Decision |
|---|---|
| Cancel mid-copy-then-delete | Always finish in-flight item; cancellation between items only |
| Disk-full during apply | **Pre-flight space calculation** at plan generation; halt entire plan if can't fit |
| Symlink destination policy | Canonicalize at apply; verify canonical destination is inside a registered library root |
| Rollback affordance | No — rollback is a separate plan from a new origin |

### Spec 026 — Generated Project Source View Removal

| Open point | Decision |
|---|---|
| Hardlink removal | Always archive a backup copy (treat like a copy view) |
| Mixed-kind view (symlink declared, fallback to copy) | Refuse mixed-kind at create time; force fallback (declare `kind: copy` if any item fell back) |
| Stale detection content drift | Include content drift for copy-kind views (hash check); link kinds skip |
| Removed-view regenerable lifetime | Indefinite — view record stays in `removed` state; regeneration produces fresh files |

---

## Action items for the next SpecKit revision pass

### Cross-spec ripple effects

1. **Event bus design doc** — produce a foundational spec or research note that defines the event topics, payload shapes, delivery semantics (at-least-once vs exactly-once), and subscriber lifecycle. Most specs reference it but none owns it. Probably belongs in spec 002 or a new spec for the audit bus.
2. **Observer location setting** — needed by spec 007 (calibration night fallback) and spec 023 (`captured_on`). Settings gains a new key `observer_location: { tz, lat?, lon? }`. Belongs in spec 018. ~~SUPERSEDED — see Amendment 2026-05-22 below.~~
3. **Spec 013 retroactive expansion** — reverse the original 'no auto-merge' decision; build cross-catalog equivalence table. Spec 023 simplifies (no merge contract).
4. **Spec 021 FR-008 amendment** — toggle-off no longer immediate (now requires restart); update FR text and acceptance scenarios.
5. **Spec 014 first-run flow** — OpenNGC download at first run requires the wizard (spec 003) to surface a 'Download catalogs' step or run it asynchronously after Finish. Update spec 003 + spec 014 to align.
6. **Spec 003 wizard step for tool discovery** — spec 011's auto-discovery should run during first-run, not just on demand. Add a 'Detect tools' wizard step.
7. **Plan apply pre-flight space check** — spec 017's plan generator gains a `total_bytes_required` field; spec 025's apply pre-flight refuses if available < required. Plan review surface shows the budget.
8. **Plan revalidation at apply (2026-05-21)** — spec 025 gains a per-item FS revalidation step that runs before any mutation. Checks source content-hash unchanged and destination still empty. Any drift surfaces a "Plan is stale" dialog and forces re-approval against fresh state. Replaces the 15-min TTL on approval tokens (token now has no expiry; HMAC still guards plan-body integrity). Affects spec 017 (token issuance), spec 025 (apply contract), and the UI plan-review surfaces (Inbox / Projects / Activity drawers).

### Spec-internal mechanical fixes (no policy decisions needed)

For each BLOCKED spec, apply the user's decisions above + the adversarial review's structural fixes (B1/B2/etc. that have clean right answers). Then re-run adversarial pass.

### Recommended ordering

1. Spec 002 (decisions ripple everywhere; event bus needs to land first)
2. Spec 018 + 003 (settings shape + observer location + tool discovery wizard step)
3. Spec 014 + 003 (catalog download at first run)
4. Spec 013 + 023 (cross-catalog equivalence + merge removal)
5. Specs 017 + 025 (paired, with approval token + pre-flight space check)
6. Spec 005 + 015 paired (Inbox + token resolver Unicode/path fixes)
7. Remaining specs in dependency order

---

## Amendment 2026-05-22 — `observer_location` moved to `AcquisitionSession`

**Supersedes**: Cross-spec ripple item 2 above ("Observer location setting — Settings gains a new key `observer_location`").

**Ratification date**: 2026-05-22

**Decision**: `observer_location` is NOT a global settings key in spec 018. It is instead a field on `AcquisitionSession` (spec 002), typed as `ProvenancedValue<ObserverLocation>` with subfields `{ tz: IANA-timezone-string, lat?: number, lon?: number }`.

**Rationale**: Observer location is per-import data, not a global preference. It is auto-extracted from FITS keywords (`OBSGEO-B`/`OBSGEO-L`, `SITELAT`/`SITELONG`) during metadata parsing at session-formation time. The value may differ across sessions (different observing sites, different instruments). Placing it in global settings would require the user to keep it in sync manually, would not reflect per-session reality, and would conflict with the Research-Led Domain Modeling principle.

**Affected artifacts**:
- `specs/002-data-lifecycle-state-model/data-model.md` — `AcquisitionSession` gains `observer_location: ProvenancedValue<ObserverLocation>` field and a new `ObserverLocation` type definition.
- `specs/003-first-run-source-setup/plan.md` — documents that `observer_location` is NOT collected at first-run.
- `specs/018-settings-configuration-model/` — `observer_location` key is NOT added anywhere in this spec.
- `specs/GRILL_DECISIONS_2026-05-21.md` — this amendment (inline marker on the original item and this block).

**Downstream consumers unchanged**: spec 007 (calibration night fallback) and spec 023 (`captured_on`) still read observer location, but they read it from `AcquisitionSession.observer_location`, not from settings.

---

## Amendment 2026-05-22 — Spec 014 Catalog Index Licensing: ratified decisions folded

**Ratification date**: 2026-05-22

**Scope**: Supersedes the spec 014 row in the per-spec decisions table above
and folds three grill-session rounds (A, R-1.x, R-2.x, R-3.x) into the
spec 014 artifact set.

### (a) HEASARC NGC/IC dropped — OpenNGC is the canonical NGC+IC source

The original spec 014 recommendation to source NGC/IC from HEASARC's public
release is **replaced** by OpenNGC (https://github.com/mattiaverga/OpenNGC,
CC BY-SA 4.0). OpenNGC provides modern positions and active maintenance.
The project app stays Apache-2.0; the `astro-plan-catalogs` repo acts as
redistributor and attaches the OpenNGC LICENSE and NOTICE alongside every
artifact. The `LicenseAttribution` for OpenNGC populates `author`, `title`,
and `license_uri` (required for CC-BY-SA, R-2.2).

### (b) Pattern X (all-download) replaces the earlier bundle-or-download discussion

The earlier "bundle-only for v1, signed manifest in v1.x" recommendation
(research R3 original) is **replaced** by **Pattern X**: all thirteen v1
catalogs are downloaded at first run from a project-hosted manifest. There
are no bundled/built-in catalog files in v1. The `origin = "built_in"` enum
value is reserved for future emergency-fallback use only (zero catalogs ship
as `built_in` in v1, R-3.3).

The v1 catalog set is: Messier, Caldwell, Sharpless 2, Abell PN, Abell
galaxy clusters, Arp, vdB, Barnard, LBN, LDN, Melotte, common-names
(app-authored, Apache-2.0), and OpenNGC (CC BY-SA 4.0). Thirteen total.

### (c) Project-hosted manifests repo + minisign signing

A separate repository (`astro-plan-catalogs`, name TBD) holds TOML
manifest files per catalog. Each GitHub Release publishes a signed catalog
bundle + `.minisig` signature file. The app:

- Embeds the minisign public key at build time (`minisign.pub.key`).
- Fetches the manifest via ETag-conditional HTTP with one retry + 2 s
  backoff on transient failure (mirrors astro-up `catalog/fetch.rs`).
- Verifies the minisign signature in memory before writing to disk
  (mirrors astro-up `catalog/verify.rs`).
- Installs verified catalogs into SQLite.

This pattern is identical to the one used by
[astro-up](https://github.com/sjors/astro-up) `crates/astro-up-core/src/catalog/`.

### Additional ratified decisions (rounds R-1 through R-3)

| Decision | Summary | Ref |
|---|---|---|
| R-1.3 | `origin` enum: `built_in` (reserved) \| `downloaded` (v1) \| `user` (v1.x) | data-model.md, contracts |
| R-1.4 | Two new contracts: `catalog.manifest.fetch` + `catalog.download` | new contract files |
| R-2.1 | `LicenseShortCode` closed enum (8 values); CI hard-fails on unknown | research R5, contracts |
| R-2.2 | `LicenseAttribution` structured CC-BY fields (`author`, `title`, `license_uri`, `modifications_notice`) | data-model.md, contracts |
| R-2.3 | NOTICE artifacts: `NOTICE.json` + `NOTICE.txt` generated by CI per release | research R6, spec.md US4 |
| R-2.4 | SC-003 replaced: 10 MB compressed threshold per catalog; process constraint | research R7, spec.md SC-003 |
| R-3.1 | Catalog event-bus topics (5 topics) registered on spec 002 event bus | research R8, spec 002 §6.2 |
| R-3.2 | `ProvenancedValue` carve-out: catalog entries are app-owned reference data; no per-field provenance | data-model.md, spec 002 §4 |
| R-3.3 | `built_in` ships zero catalogs in v1; enum reserved for graceful-degradation future | data-model.md, plan.md |
| A2 | User-added catalogs (`origin = "user"`) deferred to v1.x; `origin.not_implemented` in v1 | spec.md, tasks.md |
| A3 | Catalog update UI deferred to v1.x; `catalog.download` doubles as update in v1 | spec.md US5, tasks.md |

### Affected artifacts (2026-05-22)

- `specs/014-catalog-index-licensing/spec.md`
- `specs/014-catalog-index-licensing/plan.md`
- `specs/014-catalog-index-licensing/research.md`
- `specs/014-catalog-index-licensing/data-model.md`
- `specs/014-catalog-index-licensing/contracts/catalog.list.json`
- `specs/014-catalog-index-licensing/contracts/catalog.attribution.get.json`
- `specs/014-catalog-index-licensing/contracts/catalog.manifest.fetch.json` (new)
- `specs/014-catalog-index-licensing/contracts/catalog.download.json` (new)
- `specs/014-catalog-index-licensing/tasks.md`
- `specs/002-data-lifecycle-state-model/research.md` (§4 carve-out note, §6.2 catalog topics)
- `specs/003-first-run-source-setup/plan.md` (Download Catalogs step contract wiring)
- `specs/003-first-run-source-setup/research.md` (§9 updated with contract references)

---

## Amendment 2026-05-22 — Spec 013 + 023: ratified decisions folded

**Ratification date**: 2026-05-22

**Scope**: Folds mechanical items (A1–A8) plus three grill-session rounds
(R-1.x, R-2.x, R-3.x) into the spec 013 and spec 023 artifact sets.
Supersedes the spec 013 and spec 023 rows in the per-spec decisions table
above.

### Spec 013 — Target Lookup From FITS OBJECT

| Decision ID | Summary | Artifacts |
|---|---|---|
| A1 | 13-catalog set replaces 4-catalog references everywhere in spec 013 | spec.md FR-004+Key Entities; research.md R1; plan.md Summary; data-model.md CatalogRef; tasks.md T002+T005 |
| A2 | Pattern X (downloaded, not bundled) — `crates/targeting/` reads from SQLite installed by spec 014; no `crates/targeting/data/` folder; index rebuilds on `catalog.download.completed` event | plan.md Architecture; research.md R4; tasks.md T002+T005 |
| A3 | Cross-catalog equivalence table (`CatalogEquivalence`) added to data-model.md; seeded at first catalog install from manifest sidecar; `is_primary` set by precedence table; tasks T010-eq + T011-eq | data-model.md new entity; research.md R5; tasks.md Phase 2b |
| A4 | FR-005 revised: "offline after first-run download; returns `catalog.not_installed` before download completes" | spec.md FR-005; research.md R4 |
| R-1.1 | `Target.id` via UUIDv5: `namespace=UUIDv5(dns,"astro-plan.targets")`, `name="<catalog_id>:<designation>"` from precedence-highest row | data-model.md Target.id; research.md R6 |
| R-1.2 | Target rows SQLite-persisted at first catalog install; `acquisition_sessions.target_id` is a real FK | data-model.md Lifecycle; plan.md Architecture |
| R-1.3 | Field rename: `canonical_name` → `primary_designation` everywhere | data-model.md; contracts; spec 002 data-model.md ripple |
| R-1.4 | Two-field `CatalogRef`: `catalog_id` (slug, closed enum) + `catalog_display` (human) + `designation` | data-model.md CatalogRef; all contracts using CatalogRef |
| R-2.1 | `target.resolve` response includes `primary_designation`, `catalog_display`, `candidates[]` in status-discriminated envelope | contracts/target.resolve.json |
| R-2.2 | `catalog_filter` removed from `target.lookup` Request; backend derives active set from spec 018 `target_lookup.active_catalogs` setting | contracts/target.lookup.json; research.md R8 |
| R-2.3 | Ambiguity gap rule: two-tier (90/15 → high, 60/10 → medium); truth table added | research.md R3; contracts/target.resolve.json |
| R-2.4 | Contract envelope: status-discriminated camelCase (`contractVersion`, `requestId`, `errors[]`); removes oneOf Request/Response/Error envelope | contracts/target.lookup.json; contracts/target.resolve.json |

### Spec 023 — Target Identity History Notes

| Decision ID | Summary | Artifacts |
|---|---|---|
| A5 | `captured_on` formula: `date_of(exposure_start_utc − 12h)` in `AcquisitionSession.observer_location.tz` | research.md R3; data-model.md TargetSession; tasks.md T011b |
| A6 | Notes 16 KB cap: `target.note.update.json` `content.maxLength` → 16384 (UTF-8 bytes) | contracts/target.note.update.json; data-model.md; spec.md FR-004 |
| A7 | Debounce 5 s explicit in plan.md UI section and tasks.md T022 | plan.md; tasks.md T022 |
| A8 | Merge domain question resolved: spec 013 `CatalogEquivalence` table handles catalog unification; manual merge/split deferred; v1 remediation = `alias.remove` + `primary.rename` | spec.md Domain Questions; plan.md Architecture cross-spec note |
| R-1.3 | `Target.primary` → `primary_designation`; `CatalogRef.catalog` → two-field shape | data-model.md; contracts/target.get.json |
| R-3.1 | `captured_on` null when `observer_location` null/unreviewed; session excluded from history; `provenance.unreviewed` error per spec 002 | research.md R3 null rule; data-model.md TargetSession; contracts/target.get.json TargetSession.captured_on |
| R-3.2 | `"target"` added to `AssetType` enum in spec 002 `provenance.read.json` | specs/002-data-lifecycle-state-model/contracts/provenance.read.json |
| R-3.3 | `TargetProject.tool` optional; null for `setup_incomplete` projects; UI renders as `—` | data-model.md TargetProject; contracts/target.get.json TargetProject |
| R-3.4 | `target.alias.remove` + `target.primary.rename` shipped in v1; new contract files created; US5 + FR-008 + FR-009 added to spec.md; tasks T027–T030 added | contracts/target.alias.remove.json (new); contracts/target.primary.rename.json (new); spec.md; plan.md; tasks.md |
| E6 | `ProjectLifecycle` in `target.get.json` documented as a $ref dependency on spec 002/009 canonical enum; X-2 snapshot test task updated | contracts/target.get.json; tasks.md X-2 |

### Spec 018 follow-up (not edited here)

Decision R-2.2 requires a `target_lookup.active_catalogs: catalog_id[]` settings
key to be added to spec 018. This spec 018 ripple was NOT applied in this
session. It must be addressed when spec 018 is next revised.

### Spec 006 follow-up (not edited here)

`specs/006-inventory-library-lifecycle/data-model.md` lines 70 and 138
still reference `Target.canonical_name`. These must be updated to
`Target.primary_designation` when spec 006 is next revised.

### Affected artifacts (2026-05-22)

- `specs/013-target-lookup-from-fits-object/spec.md`
- `specs/013-target-lookup-from-fits-object/plan.md`
- `specs/013-target-lookup-from-fits-object/research.md`
- `specs/013-target-lookup-from-fits-object/data-model.md`
- `specs/013-target-lookup-from-fits-object/contracts/target.lookup.json`
- `specs/013-target-lookup-from-fits-object/contracts/target.resolve.json`
- `specs/013-target-lookup-from-fits-object/tasks.md`
- `specs/023-target-identity-history-notes/spec.md`
- `specs/023-target-identity-history-notes/plan.md`
- `specs/023-target-identity-history-notes/research.md`
- `specs/023-target-identity-history-notes/data-model.md`
- `specs/023-target-identity-history-notes/contracts/target.get.json`
- `specs/023-target-identity-history-notes/contracts/target.note.update.json`
- `specs/023-target-identity-history-notes/contracts/target.alias.remove.json` (new)
- `specs/023-target-identity-history-notes/contracts/target.primary.rename.json` (new)
- `specs/023-target-identity-history-notes/tasks.md`
- `specs/002-data-lifecycle-state-model/data-model.md` (Target: `canonical_name` → `primary_designation`)
- `specs/002-data-lifecycle-state-model/contracts/provenance.read.json` (`"target"` added to AssetType enum)

---

## Amendment 2026-05-22 — Spec 017 + 025: ratified decisions folded

**Ratification date**: 2026-05-22

**Scope**: Folds mechanical items (A1–A7), cross-spec contradictions (E1–E6),
and three grill-session rounds (R-Env-1, R-Run-1, R-Fail-1, R-FS-1,
R-Concur-1, R-Pause-1, R-CAS-1, R-Ret-1, R-Archive-1, R-Trash-1,
R-Archive-2, R-Retry-1, R-Chain-1) into the spec 017 and spec 025 artifact
sets. Supersedes the spec 017 and spec 025 rows in the per-spec decisions
table above.

### EXPLICIT OVERRIDE: OS Trash available in v1

**Prior position** (SPECKIT_PASS_2026-05-20 + original spec 017 §4):
"OS trash deferred to future; v1 uses archive-only."

**New position** (R-Trash-1): **OS trash IS available in v1.** At
plan-review time, the user picks the destructive destination per cleanup
plan: `archive` (default, app-managed, reversible from app UI) or `os_trash`
(uses OS-native recycle bin: Windows Recycle Bin, macOS Trash, Linux XDG
trash via freedesktop spec). The choice is per-plan, not per-item. The
selection is recorded as `destructiveDestination` on the Plan entity.

Recommended Rust crate: `trash` (cross-platform abstraction).

This is an explicit, intentional override of the prior "OS trash deferred"
position.

### Summary table

| Decision ID | Summary | Artifacts |
|---|---|---|
| A1 | `approvalToken` HMAC in `plan.approve` response; no TTL | `017/contracts/plan.approve.json` |
| A2 | Drop 15-min TTL; per-item FS revalidation is freshness mechanism | `025/research.md §R8`; `025/spec.md FR-011`; `025/plan.md` |
| A3 | `itemsSkipped` + `itemsCancelled` counters; invariant `total == applied + failed + skipped + cancelled + pending` | `017/data-model.md`; `017/contracts/plan.get.json`; `017/contracts/plan.list.json`; `025/data-model.md` |
| A4 | `totalBytesRequired` pre-flight field; plan generation fails if space insufficient; mid-apply `disk.full` pauses (R-Pause-1) | `017/data-model.md`; `017/contracts/plan.get.json + plan.list.json`; `025/spec.md FR-012`; `025/research.md §R3 addendum`; `025/tasks.md` |
| A5 | `discarded` state: soft-delete terminal; `discardedAt` set; row retained; excluded from default list filter | `017/spec.md FR-005`; `017/data-model.md PlanState table`; `017/contracts/plan.list.json + plan.get.json + plan.discard.json` |
| A6 | Canonical path verification at apply; fail with `path.invalid` for out-of-root paths (Phase 3 blocker in spec 025) | `025/spec.md FR-014`; `025/tasks.md T046` |
| A7 | Event bus topics registered on spec 002 §6.3 (plan lifecycle topics — see below) | `017/tasks.md T056`; `025/tasks.md T054+T059` |
| R-Env-1 | Universal camelCase + `contractVersion` + `requestId` + status-discriminated envelope on ALL spec 017 + 025 contracts | All 7 existing contracts rewritten; 3 new contracts follow same pattern |
| R-Run-1 | `PlanApplyRun` mandatory SQLite table in v1 | `025/data-model.md`; `025/tasks.md T005` |
| R-Fail-1 | `copy.succeeded.delete.failed` + rollback policy; `copy.succeeded.delete.failed.rollback.failed` hybrid state | `025/research.md §R1 addendum`; `025/contracts/plan.apply.json` failure codes |
| R-FS-1 | Per-item FS revalidation: `approvedMtime`/`approvedSizeBytes` on `PlanItem`; populated at approve time; mismatch → `item.stale` → paused | `017/data-model.md PlanItem`; `017/contracts/plan.approve.json`; `025/spec.md FR-013`; `025/research.md §R-FS-1` |
| R-Concur-1 | Strictly sequential within a plan; cross-plan overlap check via subtree-prefix path-set comparison | `025/research.md §R7`; `025/spec.md FR-017`; `025/tasks.md T056+T058` |
| R-Pause-1 | `applying → paused` on `volume.unavailable`/`disk.full`/`item.stale`; `paused → applying` via `plan.resume`; `paused → cancelled` via `plan.cancel` | `025/spec.md FR-015`; `025/plan.md`; `025/research.md §R-Pause-1`; `025/contracts/plan.resume.json` (new); `017/data-model.md PlanState`; `002/data-model.md FilesystemPlan` |
| R-CAS-1 | Atomic CAS `approved → applying` at apply start; `plan.invalid_state` on race | `025/spec.md FR-016`; `025/research.md §R-CAS-1`; `025/contracts/plan.apply.json`; `025/tasks.md T055+T057` |
| R-Ret-1 | Plan list age cutoff 90 days (configurable); optional `createdAfter` filter in `plan.list` | `017/research.md §9`; `017/contracts/plan.list.json` |
| R-Archive-1 | Archive location: `<library_root>/.astro-plan-archive/<planId>/`; conflict naming appends `.<n>` before extension | `017/research.md §4`; `017/data-model.md Storage Notes` |
| R-Trash-1 | **OVERRIDE**: OS trash available in v1; `destructiveDestination: archive | os_trash` per-plan field | `017/spec.md FR-016`; `017/data-model.md Plan entity`; `017/research.md §4`; `025/research.md §R2 addendum` |
| R-Archive-2 | `archive.send_to_trash` + `archive.permanently_delete` per-plan contracts; `confirmText: "DELETE"` required for permanent delete | `017/spec.md FR-017`; `017/contracts/archive.send_to_trash.json` (new); `017/contracts/archive.permanently_delete.json` (new); `017/tasks.md Phase 8` |
| R-Retry-1 | Default retry filter `failed`; cancelled plans get separate "Retry cancelled" CTA; added `"cancelled"` to `itemsFilter` enum | `017/research.md §2`; `017/contracts/plan.retry.json`; `017/plan.md` |
| R-Chain-1 | Retry chain UI: flat `parentPlanId` link in detail header; no tree widget in v1 | `017/research.md §2`; `017/plan.md` |
| E1 | `discarded` state resolved by A5 | All spec 017 state enums |
| E2 | Counter invariant resolved by A3 | `017/data-model.md`; `025/data-model.md` |
| E3 | Envelope convention resolved by R-Env-1 (deferred sweep for older specs noted below) | All contracts in 017 + 025 |
| E4 | `itemsPendingSkipped` renamed to `itemsCancelled` in `025/contracts/plan.cancel.json` | `025/contracts/plan.cancel.json` |
| E5 | `cancelled` added to `PlanItem.state` enum | `017/contracts/plan.get.json PlanItem.state` |
| E6 | `PlanApplyRun` made mandatory by R-Run-1 | `025/data-model.md` |

### Event bus topics registered on spec 002 §6.3 (A7)

**Plan lifecycle topics (spec 017)**:
- `plan.lifecycle.transitioned` — re-uses spec 002 topic `lifecycle.transition.applied`
- `plan.approved` (carries `approvedAt`, `approvalToken` hash)
- `plan.discarded` (carries `discardedAt`)
- `plan.cancelled`

**Plan apply topics (spec 025)**:
- `plan.applying.started` (carries `runId`, `planId`)
- `plan.item.progress` (carries `runId`, `planId`, `itemId`, `priorState`, `newState`)
- `plan.applying.paused` (carries `runId`, `planId`, `pauseReason`)
- `plan.applying.resumed` (carries `runId`, `planId`, `resumedAt`)
- `plan.applying.completed` (carries `runId`, `planId`, `terminalState`, `counts`)

These topics must be registered in `specs/002-data-lifecycle-state-model/research.md §6`
under a new §6.3 "Plan lifecycle topics" (or extend §6.2). This spec 002 ripple is NOT
applied in this session; it must be addressed when spec 002 is next revised.

### Spec 018 follow-ups (not edited here)

1. New settings key `plans.list.default_age_cutoff_days: number` (default 90,
   0 = show all) for R-Ret-1.
2. `target_lookup.active_catalogs: catalog_id[]` (carried forward from
   spec 013 amendment 2026-05-22).

### Deferred envelope sweep (R-Env-1 note)

The universal camelCase + envelope convention sweep on **older specs** (002,
003, 014, 018 and any remaining specs) is **deferred to a final pass** after
all specs are reviewed. Only spec 017 + 025 contracts have been updated in
this session.

### Affected artifacts (2026-05-22)

- `specs/017-cleanup-archive-review-plans/spec.md`
- `specs/017-cleanup-archive-review-plans/plan.md`
- `specs/017-cleanup-archive-review-plans/research.md`
- `specs/017-cleanup-archive-review-plans/data-model.md`
- `specs/017-cleanup-archive-review-plans/contracts/plan.list.json`
- `specs/017-cleanup-archive-review-plans/contracts/plan.get.json`
- `specs/017-cleanup-archive-review-plans/contracts/plan.approve.json`
- `specs/017-cleanup-archive-review-plans/contracts/plan.discard.json`
- `specs/017-cleanup-archive-review-plans/contracts/plan.retry.json`
- `specs/017-cleanup-archive-review-plans/contracts/archive.send_to_trash.json` (new)
- `specs/017-cleanup-archive-review-plans/contracts/archive.permanently_delete.json` (new)
- `specs/017-cleanup-archive-review-plans/tasks.md`
- `specs/025-filesystem-plan-application/spec.md`
- `specs/025-filesystem-plan-application/plan.md`
- `specs/025-filesystem-plan-application/research.md`
- `specs/025-filesystem-plan-application/data-model.md`
- `specs/025-filesystem-plan-application/contracts/plan.apply.json`
- `specs/025-filesystem-plan-application/contracts/plan.cancel.json`
- `specs/025-filesystem-plan-application/contracts/plan.item.retry.json`
- `specs/025-filesystem-plan-application/contracts/plan.item.skip.json`
- `specs/025-filesystem-plan-application/contracts/plan.resume.json` (new)
- `specs/025-filesystem-plan-application/tasks.md`
- `specs/002-data-lifecycle-state-model/data-model.md` (`paused` state added to `FilesystemPlan`)

---

## Amendment 2026-05-22 — Spec 005 + 015: ratified decisions folded

**Ratification date**: 2026-05-22

**Scope**: Folds mechanical items (A1–A9) and three grill-session rounds
(R-Split-1, R-Unclass-1, R-Unclass-2, R-IMAGETYP, R-IMAGETYP-Norm,
R-FrameEnum, R-FileMarker, R-Date-1, R-Sig-1, R-Preview, R-CratePatterns,
R-Video-1, R-Granularity-1, R-PlanOpen, R-DestChoice) into the spec 005 and
spec 015 artifact sets.

### EXPLICIT OVERRIDE: IMAGETYP-only classification model

**Prior position** (SPECKIT_PASS_2026-05-20 + original spec 005 research.md):
Classification used confidence scores (per-file 0.0–1.0), filename heuristics
as fallback evidence (NINA, SGP, ASIAIR patterns), and count-based thresholds
(≥95% for single_type, <2 rogues, ≥0.6 confidence, etc.).

**New position** (R-IMAGETYP, A5): **Classification is fully deterministic.**
The sole authoritative signal is the FITS `IMAGETYP` keyword, normalized via
the `ImageTypNormalizationTable`. There are no confidence scores, no filename
heuristics, and no percentage thresholds. Unknown IMAGETYP values produce
per-file unclassified markers (not folder-level unclassified). This is an
explicit, intentional override of the prior confidence-threshold model.

### Summary table — Spec 015 (Token Pattern Builder)

| Decision ID | Summary | Artifacts |
|---|---|---|
| A1 | Unicode hardening: NFC normalization + strip C0/C1/format/bidi + confusables detection via UTS#39/`unicode-security` crate; error code `pattern.invalid.unicode` | `015/research.md R4`; `015/data-model.md` errors table; `015/contracts/pattern.resolve.json`; `015/contracts/pattern.validate.json` |
| A2 | Reject `.` and `..` in resolved token values and assembled paths; error code `path.traversal` | `015/research.md R4`; `015/data-model.md` errors table; `015/contracts/pattern.resolve.json` |
| A3 | Reject Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9), case-insensitive, all platforms; error code `path.reserved_name` | `015/research.md R4`; `015/data-model.md` errors table; both contracts |
| A4 | Path length caps: ≤200 UTF-8 bytes per segment; ≤200 chars total; `pattern.invalid` payload includes `segmentLengthBytes` + `resolvedLength` | `015/research.md R4`; `015/data-model.md`; `015/contracts/pattern.resolve.json` |
| R-FrameEnum | `MetadataBundle.frame_type` enum: `[light, dark, flat, bias, dark_flat]` (lowercase). `mixed` removed — it is a folder-level result, not a per-file field | `015/contracts/pattern.resolve.json`; `015/data-model.md` |
| R-Date-1 | `{date}` token uses `AcquisitionSession.observer_location.tz` local date at `exposure_start`, solar-noon boundary (spec 023 `captured_on` rule); UTC fallback when observer_location unset | `015/research.md R6`; `015/data-model.md` TokenRegistry; `015/contracts/pattern.resolve.json` |
| R-Preview | New `pattern.preview` contract: `{ contractVersion, requestId, pattern: PatternPart[], sampleMetadata: MetadataBundle }` → status-discriminated response; errors include all validation codes | `015/contracts/pattern.preview.json` (new) |
| R-CratePatterns | Pattern parser + resolver split into `crates/patterns/` (separate from `crates/project/structure/`); consumed by `crates/app/core` (spec 005), `crates/fs/planner` (spec 017), `crates/project/structure/` (spec 008/024) | `015/plan.md` Architecture; `015/tasks.md T3.1`; CLAUDE.md crate path update deferred |

### Summary table — Spec 005 (Inbox Mixed-Folder Split)

| Decision ID | Summary | Artifacts |
|---|---|---|
| A5 | Drop confidence scoring + filename heuristics (OVERRIDE of prior model). IMAGETYP-only deterministic classification. Remove all confidence, score, threshold, filename-heuristic references from all artifacts | `005/spec.md`; `005/research.md` (full rewrite); `005/plan.md`; `005/data-model.md`; `005/tasks.md` |
| A6 | LRGB/multi-filter folders with uniform IMAGETYP=Light → `single_type Light`; `{filter}` token routes per-filter at plan time. Remove `[NEEDS DECISION]` for filter mismatches | `005/spec.md` edge cases; `005/research.md §Anti-Signal` |
| A7 | Per-file manual reclassify + multiselect bulk-assign UI. New `inbox.reclassify.json` contract. `[NEEDS DECISION]` markers replaced | `005/spec.md`; `005/research.md §Ambiguity Surfacing`; `005/contracts/inbox.reclassify.json` (new) |
| A8 | `contentSignature` TOCTOU guard: `inbox.classify` response adds required `content_signature`; `inbox.confirm` request adds required `content_signature`; mismatch → `classification.stale` error with `staleSince` | `005/contracts/inbox.classify.json`; `005/contracts/inbox.confirm.json`; `005/data-model.md §Content Signature` |
| A9 | `InboxConfirmUseCase` enumerates plan item paths from `InboxClassificationEvidence.relativeFilePath` rows, NOT from `fileCount`; plan items carry actual source/destination paths | `005/data-model.md InboxClassificationEvidence`; `005/tasks.md T027a` |
| R-IMAGETYP | FITS IMAGETYP is the SOLE classification source. Deterministic: `single_type T` if all classified files agree; `mixed` if multiple types; `unclassified` if no files have readable IMAGETYP. Per-file unclassified markers for files without IMAGETYP | `005/research.md` (rewritten); `005/spec.md FR-001,FR-005`; `005/data-model.md InboxClassification` |
| R-IMAGETYP-Norm | Normalization table per FrameType (Light/Dark/Bias/Flat/DarkFlat) covering NINA, SGP, APT, Voyager, Ekos/KStars, MaximDL, ASIAIR, SharpCap, ZWO, FireCapture. Ships as data in `crates/metadata/core`. Settings UI for user-extended mappings deferred to v1.x (spec 018 follow-up) | `005/research.md §IMAGETYP Normalization`; `005/data-model.md ImageTypNormalizationTable`; `005/tasks.md T0-IMAGETYP-Research, T-NormTable` |
| R-FileMarker | Per-file `unclassified: boolean` + `manual_override: FrameType?` fields on `InboxClassificationEvidence`. Folder classification ignores files with `unclassified=true AND manual_override IS NULL`. Folder is `unclassified` only if ALL files unclassified | `005/data-model.md InboxClassificationEvidence`; `005/research.md §Per-File Unclassified Markers` |
| R-Split-1 | Split plans produce Inventory destination paths directly via spec 015 resolver. No sibling Inbox staging. One plan per confirm action. Plan items carry final Inventory destinations | `005/spec.md`; `005/research.md §Split Destination Model`; `005/plan.md §Plan Generator`; `005/contracts/inbox.confirm.json` |
| R-Unclass-1 | Manual reclassification: user reclassifies file(s) via inline picker → `inbox.reclassify` writes `manualOverride` → classifier re-aggregates → item transitions to single_type or mixed | `005/research.md §Ambiguity Surfacing`; `005/spec.md`; `005/contracts/inbox.reclassify.json` (new) |
| R-Unclass-2 | Multiselect bulk-assign UX: Shift+Click, Ctrl+Click, Select All; "Set type for selected" bulk action; `inbox.reclassify` accepts list of `{ filePath, frameType }` | `005/spec.md US2`; `005/plan.md`; `005/contracts/inbox.reclassify.json` |
| R-Sig-1 | Content signature formula: per-file = `sha256(filename || size_bytes || mtime_unix_ns || sha256(first 65536 bytes))`; folder = `sha256(sorted(per_file_signatures))` | `005/research.md §Content Signature`; `005/data-model.md §Content Signature` |
| R-Video-1 | Video files (`.ser`, `.avi`, `.mp4`, `.mov`) routed to separate `inbox.video.*` lane; do NOT enter FITS classifier; `lane: enum("fits", "video")` on InboxItem | `005/spec.md`; `005/research.md §Video Lane`; `005/data-model.md InboxItem` |
| R-Granularity-1 | Recursive scan; one Inbox item per FITS-bearing leaf folder. Intermediate folders (containing only subfolders) are not Inbox items | `005/research.md §Recursive Scan`; `005/spec.md FR-013`; `005/data-model.md InboxItem` |
| R-PlanOpen | `plan_open` stored as persistent state. Background repair query every 5 minutes: scan `plan_open` items where linked plan is terminal; transition to post-plan state. Event bus is primary; repair is safety net. Topics: `plan.applying.completed`, `plan.applying.paused`, `plan.discarded` | `005/research.md §plan_open State`; `005/data-model.md InboxItem`; `005/tasks.md T-PlanRepair` |
| R-DestChoice | `inbox.confirm` request gains `destructive_destination: enum("archive", "os_trash")` (required when plan has destructive items). Confirm screen shows toggle. Plan carries chosen value | `005/contracts/inbox.confirm.json`; `005/plan.md §Plan Generator` |
| E1 | `paused` added to `existing_plan_state` enum in `inbox.confirm.json` `inbox.has.open.plan` error; `paused` added to open-plan states in `InboxPlanLink` constraint | `005/contracts/inbox.confirm.json`; `005/data-model.md InboxPlanLink` |
| E2 | Universal camelCase envelope sweep: **DEFERRED** to final pass. Exception: the NEW contracts (`pattern.preview.json`, `inbox.reclassify.json`) use camelCase convention. Existing spec 005+015 contracts stay snake_case | All new contracts use camelCase; existing contracts unchanged |
| E4 | `005/tasks.md` event-bus subscription task (T030) references specific topics: `plan.applying.completed`, `plan.applying.paused`, `plan.discarded` | `005/tasks.md T030` |
| E5 | Covered by R-DestChoice | `005/contracts/inbox.confirm.json` |

### Spec 018 follow-ups (not edited here)

- User-extended IMAGETYP normalization mappings (for niche capture software)
  deferred to v1.x; Settings UI to expose extension mechanism. Must be added
  to spec 018 when next revised.

### CLAUDE.md crate path update (deferred)

`crates/patterns/` (R-CratePatterns) must be added to the Monorepo Structure
section of `CLAUDE.md`. This edit is deferred — do NOT edit CLAUDE.md in this
session. Flag for next CLAUDE.md revision pass.

### Deferred envelope sweep (R-Env-1 / E2 note)

The universal camelCase + `contractVersion` + `requestId` + status-discriminated
envelope convention sweep on spec 005 and spec 015 existing contracts (and all
older specs) is **deferred to a final pass** after all specs are reviewed. Only
the newly created contracts (`pattern.preview.json`, `inbox.reclassify.json`)
use the new camelCase convention in this session.

### Affected artifacts (2026-05-22)

- `specs/005-inbox-mixed-folder-split/spec.md`
- `specs/005-inbox-mixed-folder-split/plan.md`
- `specs/005-inbox-mixed-folder-split/research.md` (full rewrite — prior confidence model superseded)
- `specs/005-inbox-mixed-folder-split/data-model.md`
- `specs/005-inbox-mixed-folder-split/contracts/inbox.classify.json`
- `specs/005-inbox-mixed-folder-split/contracts/inbox.confirm.json`
- `specs/005-inbox-mixed-folder-split/contracts/inbox.reclassify.json` (new)
- `specs/005-inbox-mixed-folder-split/tasks.md`
- `specs/015-token-pattern-builder/spec.md` (no changes required — already clean)
- `specs/015-token-pattern-builder/plan.md`
- `specs/015-token-pattern-builder/research.md`
- `specs/015-token-pattern-builder/data-model.md`
- `specs/015-token-pattern-builder/contracts/pattern.resolve.json`
- `specs/015-token-pattern-builder/contracts/pattern.validate.json`
- `specs/015-token-pattern-builder/contracts/pattern.preview.json` (new)
- `specs/015-token-pattern-builder/tasks.md`
- `specs/GRILL_DECISIONS_2026-05-21.md` (this amendment)

---

## Amendment 2026-05-22 — Spec 008 + 009: ratified decisions folded

**Ratification date**: 2026-05-22

**Scope**: Folds mechanical items (A1–A7), cross-spec contradiction resolutions
(E1–E7), and three grill-session rounds (R-Tool-Req, R-NoDup, R-Ready-Trigger,
R-Remove, R-Tool-Lock, R-Archived-Plan, R-ChannelDrift, R-Pagination,
R-PlanGated-Schema, R-Inventory-Confirmed, R-Manifest-Reason) into the spec 008
and spec 009 artifact sets.

### EXPLICIT OVERRIDE: spec 023 R-3.3 — TargetProject.tool optional → REQUIRED

**Prior position** (spec 023 R-3.3, GRILL 2026-05-21): `TargetProject.tool`
was optional; null for `setup_incomplete` projects; UI renders null as `—`.

**New position** (spec 008 R-Tool-Req, GRILL 2026-05-22): `TargetProject.tool`
is **REQUIRED**. v1 projects always have a tool because spec 008 ratified
R-Tool-Req, making `tool` mandatory at project creation. The `setup_incomplete`
state is only for missing/unconfirmed sources, never for a missing tool. No v1
project can exist without a tool. The `optional` treatment from spec 023 R-3.3
is explicitly and intentionally overridden.

**Affected artifacts**:
- `specs/023-target-identity-history-notes/data-model.md` — `TargetProject.tool`
  changed from optional to required; override note added.
- `specs/023-target-identity-history-notes/contracts/target.get.json` —
  `TargetProject.required` array now includes `"tool"`; description updated.

### Mechanical items (A1–A7)

| ID | Summary | Artifacts |
|---|---|---|
| A1 | Single-form create dialog replaces 5-step wizard. `CreateProjectWizard.tsx` → `CreateProjectDialog.tsx`. Wizard step tasks (US1-2 through US1-7) collapsed into single dialog task. | `008/spec.md`, `008/plan.md`, `008/research.md R1` (wizard reversed), `008/tasks.md US1-2..US1-9` |
| A2 | Drop `state.unchanged` ErrorCode; use `status: "noop"` (no `audit_id`, no error). Aligns with spec 002 noop pattern. | `009/contracts/project.lifecycle.transition.json ErrorCode` enum; `009/research.md R1 noop section` |
| A3 | Add `blocked → archived` edge (escape hatch). `blocked → completed` stays forbidden. Always requires plan (same as `completed → archived`). Allowed actors: user (with explicit confirmation) or system. | `009/spec.md` edge table; `009/data-model.md` transition table; `009/research.md R1`; `002/data-model.md` Project lifecycle table (already present) |
| A4 | `actor=system` per-edge authorization. System allowed only on `* → blocked`, `blocked → *`, and the deterministic `setup_incomplete → ready` invariant-driven auto-transition. Server rejects all other system-actor edges with `transition.refused`. Documented in actor field description. | `009/contracts/project.lifecycle.transition.json Actor` description; `009/research.md R1 A4` |
| A6 | `requires_plan` server-derivation documented. Caller MUST NOT supply it. Server consults spec 002 canonical `(entity_type, from, to) → requires_plan` edge table. | `009/research.md R1 A6`; `009/data-model.md` transition table notes |
| A7 | Deferred envelope sweep. Spec 008/009 existing contracts stay snake_case. New contracts (`project.source.remove`, `project.channels.reinfer`, `project.channels.dismiss_drift`) use camelCase. | All three new contracts |

### Newly ratified decisions

#### Round 1

| ID | Summary | Artifacts |
|---|---|---|
| R-Tool-Req | Tool REQUIRED at project creation. `setup_incomplete` is ONLY for missing/unconfirmed sources, never missing tool. Invariant: `tool` is non-null on all v1 projects. | `008/spec.md FR-003`; `008/contracts/project.create.json` (tool already in required — confirmed); `008/data-model.md` invariants; `023/data-model.md` + `023/contracts/target.get.json` (OVERRIDE of R-3.3) |
| R-NoDup | No `project.duplicate` contract in v1. Recovery path for tool-locked projects is manual re-creation via `project.create`. UI surfaces this in tool-lock messaging. **Follow-up deferred to v1.x.** | `008/spec.md US1 note`; `008/plan.md Summary`; `008/data-model.md` invariants |
| R-Ready-Trigger | Auto `setup_incomplete → ready` when invariants pass (`tool != null AND ≥1 confirmed source mapped`). Server-side check fires after every `project.update` or `project.source.add`. Actor=system (classified as "automatic invariant transition" — allowed alongside `* → blocked` / `blocked → *`). Emits `project.lifecycle.ready` event on bus. | `009/data-model.md` transition table + invariants; `009/research.md R1`; `009/tasks.md Phase 8`; `008/plan.md Phase 2` |
| R-Remove | `project.source.remove` contract in v1. Permitted in `{setup_incomplete, ready, blocked}`. Refused in `{prepared, processing, completed, archived}`. `lifecycle.last_confirmed_source` error when removing last confirmed source without `confirmLastSource=true`. camelCase convention. | `008/contracts/project.source.remove.json` (new); `008/spec.md FR-011`; `008/tasks.md US1b` |

#### Round 2

| ID | Summary | Artifacts |
|---|---|---|
| R-Tool-Lock | Tool lock scope: `{prepared, processing, completed, blocked}`. `blocked` explicitly added to prior `{prepared, processing, completed}` set. | `008/data-model.md` invariants; `008/contracts/project.update.json` details description; `008/research.md R7` |
| R-Archived-Plan | Plan required on ALL `completed → archived` transitions, even when no files move. No-move plan has at least manifest-write structural item. Same requirement applies to `blocked → archived`. | `009/data-model.md` transition table + R-Archived-Plan note; `009/research.md R1`; `002/data-model.md` Plan-Requirement Edge Table (updated — see contradiction note below) |
| R-ChannelDrift | `channelDrift: { hasNewSources: boolean, suggestedAction: "re_infer" \| "dismiss" }` on `project.get` response. Two new contracts: `project.channels.reinfer` and `project.channels.dismiss_drift`. Both use camelCase. | `008/data-model.md` ChannelDrift derived view; `008/spec.md FR-010`; `008/plan.md` Contracts section; `008/contracts/project.channels.reinfer.json` (new); `008/contracts/project.channels.dismiss_drift.json` (new); `008/tasks.md US1c` |
| R-Pagination | Cursor-based pagination on `project.list`. Optional `cursor`, `limit` (default 50, max 200). Response adds `nextCursor`. Cursor format: opaque base64-encoded `(createdAt, id)` tuple. | `009/contracts/project.list.json`; `008/research.md R8`; `008/tasks.md F-6` |

#### Round 3

| ID | Summary | Artifacts |
|---|---|---|
| R-PlanGated-Schema | JSON Schema `if/then` for `plan_id` requirement on `next_state in ["prepared", "archived"]`. Belt-and-suspenders alongside spec 002 edge table. Server remains authoritative. | `009/contracts/project.lifecycle.transition.json` Request allOf; `009/research.md R5a` |
| R-Inventory-Confirmed | `project.source.add` use case checks `inventory_session.state == "confirmed"`. Rejects with `source.not_confirmed` (with `details.actual_state`). Contract schema unchanged (enforcement is use-case-side only). | `008/contracts/project.source.add.json` ErrorCode enum + details; `008/research.md R10`; `008/spec.md FR-012` |
| R-Manifest-Reason | `ProjectManifest.reason` is now `ManifestReason` typed enum (not free String). Closed enum: `created \| source_change \| lifecycle_transition \| cleanup_applied \| workflow_run`. Spec 024 is canonical owner; spec 009 references. | `009/data-model.md ProjectManifest` + ManifestReason enum + invariants |

### Cross-spec contradiction resolutions (E1–E7)

| ID | Summary | Resolution |
|---|---|---|
| E1 | `state.unchanged` / noop alignment | Resolved by A2: `status: "noop"`, `state.unchanged` error code removed |
| E2 | `$ref` envelope sweep | Deferred per A7 |
| E3 | `ManifestReason` free string vs closed enum | Resolved by R-Manifest-Reason |
| E4 | `TargetProject.tool` optional vs required | Resolved by R-Tool-Req + spec 023 ripple override |
| E5 | `blocked → archived` missing edge | Resolved by A3 |
| E6 | `PlanState` in `ProjectPlanRef` missing `paused`/`discarded` | Resolved: `data-model.md` references spec 002 canonical `PlanState` (includes `paused`, `discarded` per spec 017+025 amendment) |
| E7 | `$ref` deferred | Deferred per A7 |

### Spec 002 Plan-Requirement Edge Table — contradiction note

The spec 002 Plan-Requirement Edge Table row `project | * | archived | true (when archiving moves files)` contradicted R-Archived-Plan (which requires plan unconditionally). This contradiction was **resolved in spec 002 data-model.md**: the row was split into two rows — `project | completed | archived | true (always)` and `project | blocked | archived | true (always)` — and the "when archiving moves files" condition was removed. The `archived → processing` row was also updated with the C7 criterion text.

### Spec 018 follow-ups (not edited here — carried forward)

- `target_lookup.active_catalogs: catalog_id[]` (from spec 013 R-2.2).
- `plans.list.default_age_cutoff_days` (from spec 017 R-Ret-1).
- User-extended IMAGETYP normalization mappings (from spec 005 R-IMAGETYP-Norm).

### Deferred envelope sweep (A7)

The universal camelCase + `contractVersion` + `requestId` + status-discriminated
envelope convention sweep on spec 008 and spec 009 **existing** contracts is
**deferred to the final pass** after all specs are reviewed. Only the three new
contracts (`project.source.remove`, `project.channels.reinfer`,
`project.channels.dismiss_drift`) use the new camelCase convention in this
session.

### Affected artifacts (2026-05-22)

**Spec 008**:
- `specs/008-project-create-onboard-edit/spec.md`
- `specs/008-project-create-onboard-edit/plan.md`
- `specs/008-project-create-onboard-edit/research.md`
- `specs/008-project-create-onboard-edit/data-model.md`
- `specs/008-project-create-onboard-edit/contracts/project.update.json`
- `specs/008-project-create-onboard-edit/contracts/project.source.add.json`
- `specs/008-project-create-onboard-edit/contracts/project.source.remove.json` (new)
- `specs/008-project-create-onboard-edit/contracts/project.channels.reinfer.json` (new)
- `specs/008-project-create-onboard-edit/contracts/project.channels.dismiss_drift.json` (new)
- `specs/008-project-create-onboard-edit/tasks.md`

**Spec 009**:
- `specs/009-project-lifecycle-model/spec.md`
- `specs/009-project-lifecycle-model/plan.md`
- `specs/009-project-lifecycle-model/research.md`
- `specs/009-project-lifecycle-model/data-model.md`
- `specs/009-project-lifecycle-model/contracts/project.lifecycle.transition.json`
- `specs/009-project-lifecycle-model/contracts/project.list.json`
- `specs/009-project-lifecycle-model/tasks.md`

**Spec 023 ripple (OVERRIDE of R-3.3)**:
- `specs/023-target-identity-history-notes/data-model.md` — `TargetProject.tool` optional → REQUIRED
- `specs/023-target-identity-history-notes/contracts/target.get.json` — `tool` added to `TargetProject.required` array

**Spec 002 ripple**:
- `specs/002-data-lifecycle-state-model/data-model.md` — Plan-Requirement Edge Table updated: `completed → archived` and `blocked → archived` now unconditionally `true`; `archived → processing` updated with C7 criterion

---

## Amendment 2026-05-22 — Spec 010 + 024: ratified decisions folded

**Ratification date**: 2026-05-22

**Scope**: Folds mechanical items A1–A8 (from the original GRILL 2026-05-21
per-spec tables), plus newly ratified decisions R-Source-1, R-Workflow-1,
R-NotesEdit, R-Corrupt, and trigger-taxonomy convention C into the spec 010
and spec 024 artifact sets. Also applies R-Source-1 as a ripple to spec 002.

### Spec 010 — Guided First-Project Flow

| ID | Summary | Artifacts |
|---|---|---|
| A1 | Restart-after-Completed = reset + replay from step 1 (not resume). `Completed → Idle` transition added to state machine. | `010/data-model.md` transitions table; `010/plan.md` state machine; `010/spec.md` FR-005 clarified; `010/tasks.md` T041 |
| A2 | Anchor-orphan CI gate task added. Build fails when any registered `data-guide-anchor` constant is absent from the built desktop bundle. | `010/tasks.md` T026 (new Phase 2 addendum); `010/plan.md` anchor drift mitigation note; `010/research.md` §R6 |
| R-Corrupt | `STATE_CORRUPTED` handling: reset to Idle silently + diagnostic audit. First `guided.state.get` after corruption returns `STATE_CORRUPTED` (informational); subsequent reads return fresh Idle. FR-010 added to spec.md. Recovery rules section added to data-model.md. T027 added. | `010/spec.md` FR-010 (new); `010/data-model.md` §Recovery Rules (new); `010/research.md` §R4 updated; `010/contracts/guided.state.get.json` STATE_CORRUPTED description updated; `010/tasks.md` T027 (new) |
| R-Source-1 | Spec 010 subscriber filters `source != "restore"`. Guided-flow ignores replay events. `GuidedSubscription` rule added to data-model.md §Event Subscription Rules. `plan.md` event bus updated with filter note. `research.md` §R3 open variable resolved. All three subscription tasks (T012, T022, T032) updated. | `010/data-model.md` §Event Subscription Rules (new section); `010/plan.md` §Event Bus; `010/research.md` §R3; `010/tasks.md` T012, T022, T032 |
| C | Trigger taxonomy: dot-notation lowercase for all event-bus topic names. Registry `trigger` and `completion_event` columns updated to dot-notation. `plan.md` bus subscription list converted from PascalCase to dot-notation. Task references updated. | `010/data-model.md` GuidedFlowStep registry; `010/plan.md` §Event Bus topic list; `010/tasks.md` T011, T012, T021, T022, T031, T032 |

### Spec 024 — Project Manifests And Notes

| ID | Summary | Artifacts |
|---|---|---|
| A4 | `workflow_run` added to `ManifestReason` enum. Subscribes to `workflow.run_completed` event from spec 012 (R-Workflow-1). | `024/data-model.md` ManifestReason table + Generation Triggers table; `024/contracts/project.manifest.list.json` reason enum; `024/contracts/project.manifest.get.json` reason enum; `024/research.md` §M-1; `024/plan.md` Architecture §1; `024/tasks.md` T2.4 |
| A5 | 16 KB notes cap + 5-second debounce. `content.maxLength: 16384` in contract. `ProjectNote` length invariant added. `plan.md` UI section documents 5s debounce. `note.content_too_large` error added. | `024/contracts/project.note.update.json` content.maxLength + errors enum; `024/data-model.md` §Invariants; `024/plan.md` Architecture §4; `024/tasks.md` T4.2 + T4.7 + TX.9 |
| A6 | Pagination on `manifest.list`. Optional `cursor`, `limit` (default 50 / max 200) in Request. `next_cursor` in Response. Deferred auto-prune. | `024/contracts/project.manifest.list.json` request + response; `024/research.md` §M-4 pagination note; `024/tasks.md` T1.6 + TX.7 |
| A7 | Drop file regeneration clause. File is canonical and immutable. `version` governs format for NEW writes only; existing files are never re-rendered from DB. | `024/plan.md` Architecture §2 |
| A8 | Notes embedding = full text snapshot at write time (not hash or excerpt). Invariant updated. | `024/data-model.md` §Invariants; `024/research.md` §M-3; `024/tasks.md` T2.5 |
| R-Workflow-1 | Spec 024 subscribes to spec 012's `workflow.run_completed` event. On receipt, writes a `workflow_run` manifest for the named project. **FLAGGED — spec 012 ripple**: spec 012 MUST emit `workflow.run_completed` with payload `{ projectId, toolId, completedAt, outputArtifacts: [...] }`. This edit must be applied when spec 012 is next revised. Do NOT edit spec 012 in this session. | `024/data-model.md` Generation Triggers; `024/plan.md` Architecture §1; `024/research.md` §M-1; `024/tasks.md` T2.4 + TX.8 |
| R-NotesEdit | Notes editable on all lifecycle states except `archived`. `project.read_only` error fires only when `lifecycle == "archived"`. | `024/spec.md` FR-003; `024/plan.md` Architecture §4; `024/contracts/project.note.update.json` error description note; `024/tasks.md` T4.7 + TX.10 |

### Spec 002 ripple — R-Source-1 (event-bus envelope `source` field)

`specs/002-data-lifecycle-state-model/research.md` §6 event-bus subsection
updated: every bus event carries a top-level `source: enum("user", "restore",
"system")` field. Semantics documented; subscribers instructed to branch on
`source`. Audit log captures `source`. Spec 010 is the first documented
consumer of this field.

### FLAGGED — Spec 012 ripple (do not edit spec 012 now)

Spec 012 MUST emit `workflow.run_completed` on the in-process event bus with
payload shape:

```jsonc
{
  "projectId": "<uuid>",
  "toolId": "<string>",
  "completedAt": "<rfc3339>",
  "outputArtifacts": [ /* array of artifact refs */ ],
  "source": "system"
}
```

This is a **required spec 012 change** that must be applied in the next spec
012 revision pass. Until it is done, spec 024's `workflow_run` trigger cannot
be tested end-to-end.

### Deferred: envelope sweep (older specs)

The universal camelCase + `contractVersion` + `requestId` + status-discriminated
envelope convention sweep on spec 010 and spec 024 **existing** contracts is
**deferred to the final pass** after all specs are reviewed. Spec 010 contracts
remain snake_case; spec 024 contracts remain snake_case. Only newly created
contracts in prior sessions use camelCase.

### D — Spec 015 R-CratePatterns note for spec 024

Verified: the manifest writer in `crates/project/structure/manifest.rs` does
not use pattern resolution. No dependency on `crates/patterns/` is required.
Note added to `024/plan.md` Architecture §1.

### Affected artifacts (2026-05-22)

**Spec 010**:
- `specs/010-guided-first-project-flow/spec.md` — FR-005 clarified; FR-010 added (R-Corrupt)
- `specs/010-guided-first-project-flow/plan.md` — state machine Completed→Idle; event bus dot-notation + source filter
- `specs/010-guided-first-project-flow/research.md` — §R3 resolved (R-Source-1); §R4 resolved (R-Corrupt)
- `specs/010-guided-first-project-flow/data-model.md` — transitions table Completed→Idle; registry dot-notation; §Event Subscription Rules (new); §Recovery Rules (new)
- `specs/010-guided-first-project-flow/contracts/guided.state.get.json` — STATE_CORRUPTED description
- `specs/010-guided-first-project-flow/tasks.md` — T011, T012, T021, T022, T031, T032 (dot-notation + source filter); T026 + T027 (new); T041 (Completed→Idle restart)

**Spec 024**:
- `specs/024-project-manifests-and-notes/spec.md` — FR-003 (R-NotesEdit)
- `specs/024-project-manifests-and-notes/plan.md` — Architecture §1 (workflow_run + spec 012 flag + crates/patterns note); §2 (A7 immutability); §4 (A5 debounce + R-NotesEdit)
- `specs/024-project-manifests-and-notes/research.md` — §M-1 (workflow_run); §M-3 (A8 full text); §M-4 (pagination); Summary table updated
- `specs/024-project-manifests-and-notes/data-model.md` — ManifestReason (workflow_run); Generation Triggers (workflow_run row); §Invariants (A8 full text + A5 cap)
- `specs/024-project-manifests-and-notes/contracts/project.manifest.list.json` — reason enum (workflow_run); pagination (cursor, limit, next_cursor)
- `specs/024-project-manifests-and-notes/contracts/project.manifest.get.json` — reason enum (workflow_run)
- `specs/024-project-manifests-and-notes/contracts/project.note.update.json` — content.maxLength 16384; errors (note.content_too_large); R-NotesEdit note
- `specs/024-project-manifests-and-notes/tasks.md` — T1.6 (pagination); T2.4 (workflow_run + spec 012 flag); T2.5 (A8); T4.2 (A5 debounce + cap); T4.7 (R-NotesEdit + A5); TX.7–TX.10 (new)

**Spec 002 ripple**:
- `specs/002-data-lifecycle-state-model/research.md` — §6 event-bus envelope: `source` field added (R-Source-1)

---

## Amendment 2026-05-22 — Spec 011 + 012: ratified decisions folded

**Ratification date**: 2026-05-22

**Scope**: Folds mechanical items A1–A8, newly ratified decisions
R-BundleId, R-Event-Light, R-Hash-Exec, R-CwdContain, R-ExtAllow,
R-DropExecCheck, R-MacQuarantine, R-AppClock, cross-spec resolutions
E1–E5, and silent decisions C1–C5 into the spec 011 and spec 012
artifact sets.

### Mechanical items (A1–A8)

| ID | Summary | Artifacts |
|---|---|---|
| A1 | macOS launch via `open -b <bundle_id>`. `DetachStrategy.open_minus_a` → `open_bundle_id`. `tool.launch` pid description updated. | `011/data-model.md` DetachStrategy + macOS launch rule; `011/plan.md` Per-Platform Invocation; `011/tasks.md` T008; `011/contracts/tool.launch.json` pid description |
| A2 | Tool-path auto-discovery dual invocation: Settings page AND spec 003 first-run wizard "Detect tools" step. | `011/plan.md` Settings Layer (dual invocation note); `011/research.md` R2 (dual entry points documented) |
| A3 | PI-already-running dialog: exactly two buttons "Open another instance" / "Cancel". | `011/spec.md` US1 scenario 3; `011/tasks.md` T012 (button text) |
| A4 | Multi-version PixInsight (O1) deferred to v2. | `011/spec.md` Domain Questions — moved O1 to "Deferred to v2" subsection |
| A5 | Spec 012 emits `workflow.run_completed`. | See R-Event-Light below |
| A6 | `kind: null` in `artifact.classify` clears override and re-applies rules. | `012/contracts/artifact.classify.json` kind type → `enum | null`; `012/data-model.md` ClassificationOverride clear-path; `012/plan.md` Architecture §3; `012/research.md` M-1 resolved |
| A7 | Re-attribution within 6h window on every `tool.launch` event. Back-fills `tool_launch_id` for null or earlier-launch rows. | `012/data-model.md` Tool Launch Attribution (re-attribution rule); `012/plan.md` Architecture §4; `012/tasks.md` T022b |
| A8 | PI rerun overwrites in place; `content_hash` updated; `artifact.updated` event emitted; prior hash history NOT preserved. | `012/data-model.md` ProcessingArtifact (`content_hash` field); Tool Launch Attribution (PI rerun rule); Audit Events (`artifact.updated`); Storage Sketch; `012/plan.md` Architecture §8; `012/tasks.md` T007 |

### Newly ratified decisions

| ID | Summary | Artifacts |
|---|---|---|
| R-BundleId | `bundle_id: String?` on `ToolProfile` (macOS only). Seed: PixInsight `com.pixinsight.PixInsight`, Siril `org.free-astro.siril`, StarTools `com.startools.startools`, AstroPixelProcessor `com.astropixelprocessor.app`. macOS launch: prefer `open -b <bundle_id>` when set; null → setsid fallback. Settings UI exposes bundle_id editing per tool. | `011/data-model.md` ToolProfile (bundle_id, macOS launch rule, seed values); `011/plan.md` Settings Layer; `011/tasks.md` T002, T008 |
| R-Event-Light | New `workflow.run_completed` event contract (spec 012 owner). Payload: `{ contractVersion, topic, source, payload: { projectId, toolId, toolLaunchId, completedAt, artifactIds } }`. Spec 024 subscribes; calls `artifact.list` for full details. | `012/contracts/workflow.run_completed.json` (NEW); `012/data-model.md` Audit Events; `012/spec.md` FR-010; `012/plan.md` Architecture §7; `012/tasks.md` T022c |
| R-Hash-Exec | `args_hash = BLAKE3(canonicalized_executable_path || rendered_argv)`. Algorithm and scope documented. | `011/data-model.md` ToolLaunch `args_hash` field comment |
| R-CwdContain | Library-root containment check on cwd. Canonicalize + verify inside a registered library root. `cwd.outside_library_root` error code added. | `011/spec.md` FR-010; `011/contracts/tool.launch.json` ErrorCode enum; `011/plan.md` use-case step 4; `011/tasks.md` T012b |
| R-ExtAllow | `WorkflowProfile.watch_extensions: string[]` (default list of 9 extensions). Coarse pre-filter before classifier. Settings UI per profile. | `012/data-model.md` WorkflowProfile extension; `012/research.md` R-7; `012/tasks.md` T003, T007b |
| R-DropExecCheck | Pre-spawn executable-existence check removed. OS errors propagate as `launch.failed`. | `011/spec.md` FR-011; `011/plan.md` use-case step 4 (no existence check); `011/tasks.md` (no separate existence-check task) |
| R-MacQuarantine | macOS quarantine/translocation is user responsibility. On `open -b` quarantine error, surface notification with `xattr` command. `macos.quarantine.detected` advisory error code added. | `011/research.md` R5 (new); `011/plan.md` Per-Platform Invocation; `011/contracts/tool.launch.json` ErrorCode enum |
| R-AppClock | App-clock (`Instant::now()`) for `detected_at` and attribution window calculations. `file_mtime` stored but NOT used for attribution (NAS skew protection). | `012/data-model.md` Tool Launch Attribution (clock source note) + ProcessingArtifact `file_mtime` description; `012/research.md` R-8 (new); `012/plan.md` Architecture §4 |

### Cross-spec resolutions (E1–E5)

| ID | Summary | Resolution |
|---|---|---|
| E1 | `workflow.run_completed` event contract ownership | Resolved by R-Event-Light: spec 012 owns the contract; spec 024 subscribes |
| E2 | `ToolLaunch.completed_at` write ownership | Resolved by A7 + R-Event-Light: spec 012's attribution pass writes `completed_at` and emits the event. Spec 011 `ToolLaunch` table carries the nullable column; spec 012 owns the update. `011/tasks.md` X-5 documents the cross-spec dependency |
| E3 + E4 | Contract envelope convention sweep for 011 + 012 | Deferred per prior sessions' R-Env-1 note. NEW `workflow.run_completed.json` uses camelCase; existing 011 + 012 contracts stay in their current form |
| E5 | Mockup `setProjectLifecycle('processing')` must be removed | Resolved: `011/spec.md` Implementation Status explicitly states the call MUST be removed; tool launch does NOT mutate project lifecycle |

### Silent decisions resolved (C1–C5)

| ID | Summary | Resolution |
|---|---|---|
| C1 | `args_hash` algorithm and scope | Resolved by R-Hash-Exec: `BLAKE3(canonicalized_executable_path || rendered_argv)` |
| C2 | `tool_id` derivation rule | `tool_id` MUST match `[a-z0-9_]+`. Derivation: lowercase + remove spaces. Reject other characters. Documented in `011/data-model.md` ToolProfile invariants + `011/tasks.md` X-6 |
| C3 | 6h attribution window: per-profile configurable (default 6h) | Documented in `012/plan.md` Architecture §4 and `012/data-model.md` Tool Launch Attribution |
| C4 | `ProcessingArtifact.id`: ULID → UUID for consistency | `012/data-model.md` ProcessingArtifact `id` field changed to UUID; Storage Sketch updated |
| C5 | Watcher lifetime (drawer-bound): kept; trade-off documented | `012/research.md` R-9 (new) |

### Spec 018 ripples (flagged — do NOT edit spec 018 now)

- Per-tool `bundle_id` override (R-BundleId): settings table supports per-tool `bundle_id` editing
- `workflow_profile.<id>.watch_extensions` (R-ExtAllow): per-profile watch extension list
- Per-profile 6h attribution window override (`launch_attribution_window`) (C3)
- Carried forward from prior sessions: `target_lookup.active_catalogs`, `plans.list.default_age_cutoff_days`, user-extended IMAGETYP mappings, `calibration.*` keys

### Deferred envelope sweep note

The universal camelCase + `contractVersion` + `requestId` + status-discriminated
envelope convention sweep on spec 011 and spec 012 **existing** contracts is
**deferred to the final pass** after all specs are reviewed. The newly created
`workflow.run_completed.json` uses camelCase convention (consistent with
R-Event-Light, which specified camelCase for this contract). Existing contracts
(`tool.launch.json`, `tool.profile.list.json`, `artifact.list.json`,
`artifact.classify.json`) retain their current form.

### Affected artifacts (2026-05-22)

**Spec 011**:
- `specs/011-processing-tool-launch/spec.md` — FR-010 (R-CwdContain), FR-011 (R-DropExecCheck), US1 scenario 3 (A3 dialog), O1 moved to deferred, E5 note, Last Amended
- `specs/011-processing-tool-launch/plan.md` — Settings Layer (bundle_id, dual invocation A2); use-case pipeline (steps reordered: no existence check, containment check added, open -b, quarantine); Per-Platform Invocation (open -b + R-MacQuarantine); Date
- `specs/011-processing-tool-launch/research.md` — R2 (dual invocation); R5 (new — R-MacQuarantine)
- `specs/011-processing-tool-launch/data-model.md` — ToolProfile (bundle_id field, seed values, macOS launch rule, DetachStrategy rename, tool_id invariant C2); ToolLaunch (args_hash formula R-Hash-Exec); Date
- `specs/011-processing-tool-launch/contracts/tool.launch.json` — ErrorCode enum (cwd.outside_library_root, macos.quarantine.detected); pid description (open -b)
- `specs/011-processing-tool-launch/tasks.md` — T002 (bundle_id seed); T008 (open -b + quarantine); T012 (dialog button text A3); T012b (new — containment); X-5 (new — completed_at cross-ref); X-6 (new — tool_id C2)

**Spec 012**:
- `specs/012-processing-artifact-observation/spec.md` — FR-010 (workflow.run_completed), Last Updated
- `specs/012-processing-artifact-observation/plan.md` — Architecture §3 (A6 kind null), §4 (A7 re-attribution + R-AppClock), §7 (R-Event-Light, new), §8 (A8 in-place update, new); Date
- `specs/012-processing-artifact-observation/research.md` — R-7 (R-ExtAllow, new); R-8 (R-AppClock, new); R-9 (C5 watcher lifetime, new); M-1 resolved; Last Amended
- `specs/012-processing-artifact-observation/data-model.md` — ProcessingArtifact (id→UUID C4, content_hash A8, file_mtime clock note); ClassificationOverride (A6 clear-path); WorkflowProfile extension (R-ExtAllow, new section); Tool Launch Attribution (A7 re-attribution, A8 in-place, R-AppClock); Invariants (A6, A8, C4 bullets); Audit Events (artifact.updated A8, artifact.classify.override.cleared A6, workflow.run_completed R-Event-Light); Storage Sketch (content_hash column, UUID comment); Date
- `specs/012-processing-artifact-observation/contracts/artifact.classify.json` — kind type → enum | null (A6)
- `specs/012-processing-artifact-observation/contracts/workflow.run_completed.json` — **NEW** (R-Event-Light)
- `specs/012-processing-artifact-observation/tasks.md` — T003 (watch_extensions); T007 (artifact.updated); T007b (new — watch_extensions); T014 (kind null clear); T022 (app-clock note); T022b (new — re-attribution); T022c (new — event emission); dependency graph updated; Date

---

## Amendment 2026-05-22 — Spec 006 + 007: ratified decisions folded

**Ratification date**: 2026-05-22

**Scope**: Folds mechanical items A1–A8, newly ratified decisions
R-Projection-Wide, R-Night-TS-1, R-OverridePenalty, R-DarkFlat-Reserved,
R-Ignored-Filter, R-Prefill, R-Batch, R-OpticTrain, cross-spec contradiction
resolutions E1–E5, and SPECKIT structural fixes D1–D6 into the spec 006 and
spec 007 artifact sets.

### Mechanical items (A1–A8)

| ID | Summary | Artifacts |
|---|---|---|
| A1 | `Target.canonical_name` → `Target.primary_designation`. Carried from spec 013 amendment. | `006/data-model.md` lines (target field description, cross-reference map) |
| A2 | Drop `state.unchanged` ErrorCode; use `status: "noop"` (no `audit_id`, no error). `inventory.session.review` response enum gains `"noop"` status; `state.unchanged` removed from ErrorCode. | `006/contracts/inventory.session.review.json`; `006/plan.md §Constitution Check`; `006/research.md §3`; `006/tasks.md T303` |
| A3 | Per-frame kind storage constraint: lives in spec 005 only; Inventory sessions collapse to single kind on confirm; `mixed` is post-promotion regression marker, not stored frame-level data. | `006/research.md §2` |
| A5 | Settings keys for calibration tolerances: `calibration.dark_temp_tolerance` (default 2.0°C), `calibration.flat.gain.tolerance_hard` (default false), `calibration.<frame_type>.override_penalty` (default 0.3). All spec 018 ripples — flagged. | `007/research.md R4`; `007/data-model.md §Settings Keys` |
| A6 | Drop ±12h fallback; refuse-to-match when `observer_location` or `exposure_start_utc` null. Returns `match.observer_location_missing`. Session must be reviewed via spec 002 `provenance.unreviewed`. | `007/research.md R3`; `007/contracts/calibration.match.suggest.json errors`; `007/tasks.md T042` |
| A7 | `suggestCalibration` is pre-fill only. Settings toggle controls UI pre-fill, not auto-assign. UI NEVER calls `calibration.match.assign` without explicit user confirmation. Loop-closing rule documented. | `007/research.md R5`; `007/data-model.md MatchingRuleConfig` |
| A8 | Observer_location source for night calc: matcher reads `AcquisitionSession.observer_location.tz` (per spec 002 + spec 023 amendments). Not from settings. Not from global default. | `007/research.md R3` |

### Newly ratified decisions

| ID | Summary | Artifacts |
|---|---|---|
| R-Projection-Wide | Drop `state` (presentational) field entirely from `InventorySession`; drop `PresentationalReviewState` schema; rename `CanonicalSessionState` → `SessionState`; `review_filter` accepts 6 canonical values + `all`. UI maps display labels locally: `discovered`+`candidate` → "Needs review". | `006/data-model.md`; `006/contracts/inventory.list.json`; `006/contracts/inventory.session.review.json`; `006/research.md §3`; `006/plan.md Summary`; `006/tasks.md T302` |
| R-Night-TS-1 | Observing-night timestamp source = `AcquisitionSession.exposure_start_utc`. Spec 005 IMAGETYP classifier feeds the session; session aggregates `exposure_start_utc` from earliest frame's `DATE-OBS`. Chain documented. | `007/research.md R3`; `007/data-model.md` |
| R-OverridePenalty | Default `override_penalty = 0.3`; per-frame-type configurable. Confidence formula gains mandatory `clamp(…, 0.0, 1.0)` to prevent negative values (Flat soft cap sum = 1.1). | `007/research.md R4`; `007/data-model.md §Flat table note + §Invariants` |
| R-DarkFlat-Reserved | `dark_flat` kept OUT of `calibration_types` enum in all v1 contracts. Files with dark_flat IMAGETYP land as `unclassified` (spec 005 ripple — see below). No v1 Settings UI exposure. `CalibrationType` Rust enum reserves slot for forward-compat. | `007/spec.md FR-001`; `007/research.md R1`; `007/data-model.md CalibrationType`; `007/contracts/calibration.match.suggest.json`; `007/contracts/calibration.match.suggest.batch.json` |
| R-Ignored-Filter | `ignored` added to 6-value `review_filter` enum. Cmd+K "Show ignored items" navigates to `/inventory?reviewFilter=ignored`. New FR-010 in spec.md. New task T309+T310. | `006/contracts/inventory.list.json`; `006/spec.md FR-010`; `006/plan.md`; `006/tasks.md T309, T310` |
| R-Prefill | Rename `suggest_auto_assign` → `prefill_suggestion` (snake_case in data model). Description: pre-fill assign dialog with top candidate; user must confirm. UI never bypasses confirmation. Settings key `calibration.prefill_suggestion: boolean` (default true) — spec 018 ripple flagged. | `007/data-model.md MatchingRuleConfig`; `007/research.md R5` |
| R-Batch | Ship `calibration.match.suggest.batch` in v1. camelCase convention. Request: `{ contractVersion, requestId, sessionIds: uuid[], calibrationTypes?: enum[] }`. Response status-discriminated with per-item partial success. Per-item statuses: `match \| ambiguous \| no_match \| observer_location_missing \| session.mixed_state`. | `007/contracts/calibration.match.suggest.batch.json` (new); `007/spec.md US5`; `007/plan.md contracts`; `007/tasks.md T035–T039` |
| R-OpticTrain | `optic_train` confirmed Hard dimension for flats. Rationale: telescope+camera+filter wheel+focuser+rotator owns vignetting pattern; cross-train flats are unsafe. | `007/spec.md FR-004`; `007/data-model.md §Flat table`; `007/research.md R1` |

### Cross-spec contradiction resolutions (E1–E5)

| ID | Summary | Resolution |
|---|---|---|
| E1 | `state.unchanged` error code in `inventory.session.review` | Resolved by A2: replaced with `status: "noop"` |
| E2 | `captured_on` semantics: Inventory §006 vs spec 023 solar-noon boundary | Documented intentional divergence: `InventorySession.captured_on` = earliest frame date (UX label); `TargetSession.captured_on` = solar-noon boundary (spec 023 canonical night identity). Added note to `006/data-model.md`. |
| E3 | `observer_location` source for night calculation | Resolved by A6 + A8 + R-Night-TS-1: reads from `AcquisitionSession.observer_location.tz` |
| E4 | `suggest_auto_assign` + spec 008 UI dependency | Resolved by R-Prefill: renamed `prefill_suggestion`; spec 008 UI must respect the setting when opening assign dialog. Spec 008 dependency documented in `007/plan.md`. |
| E5 | Assigning calibration to a `mixed`-state session | Resolved: `calibration.match.suggest` and `calibration.match.assign` reject with `session.mixed_state` error. User must split via spec 005 reclassify first. Documented in `007/data-model.md §Invariants` and `006/data-model.md §Mutations`. |

### SPECKIT structural fixes (D1–D6)

| ID | Summary | Resolution |
|---|---|---|
| D1 | `setSessionReviewState` hook signature: accepts canonical 6-value states | Resolved by R-Projection-Wide: T302 updated in `006/tasks.md` |
| D2 | `mixed` projection: server-side detection; integration test (not JSON Schema fixture) | Documented in `006/data-model.md §Invariants`; integration test task T311 added to `006/tasks.md` |
| D3 | Flat soft cap clamp: prevents negative confidence | Resolved by R-OverridePenalty: clamp documented in `007/research.md R4` and `007/data-model.md §Flat table note` |
| D4 | `override_penalty` value = 0.3 default | Resolved by R-OverridePenalty: documented in `007/research.md R4` and `007/data-model.md §Settings Keys` |
| D5 | Observing-night timestamp source | Resolved by R-Night-TS-1: `exposure_start_utc` documented in `007/research.md R3` |
| D6 | Enum drift CI tests | CI snapshot test tasks added: T506 in `006/tasks.md` (SessionState enum); T040 in `007/tasks.md` (calibration_types enum). Both fail build on drift vs spec 002 canonical definition. |

### Spec 018 ripples (flagged — do NOT edit spec 018 now)

- `calibration.dark_temp_tolerance: number` (default 2.0°C)
- `calibration.<frame_type>.override_penalty: number` (default 0.3 per type)
- `calibration.prefill_suggestion: boolean` (default true)

These three keys must be added to spec 018 when next revised.

### Spec 005 ripple (flagged — do NOT edit spec 005 now)

`dark_flat` keywords (DARKFLAT, Dark Flat, FLATDARK, etc.) MUST NOT be added
to the spec 005 IMAGETYP normalization table for v1. Files with these IMAGETYP
values land as `unclassified`. The `dark_flat` slot in `FrameType` is reserved
for forward-compatibility only. This narrowing must be confirmed when spec 005
is next revised (the IMAGETYP normalization table was added in the spec 005+015
apply pass).

### Deferred envelope sweep note

The universal camelCase + `contractVersion` + `requestId` + status-discriminated
envelope convention sweep on spec 006 and spec 007 **existing** contracts
(`inventory.list.json`, `inventory.session.review.json`,
`calibration.match.suggest.json`, `calibration.match.assign.json`) is
**deferred to the final pass** after all specs are reviewed. The newly created
`calibration.match.suggest.batch.json` uses the camelCase convention (per
"NEW contracts use camelCase" rule). Existing contracts retain their current
snake_case + non-discriminated shape.

### Affected artifacts (2026-05-22)

**Spec 006**:
- `specs/006-inventory-library-lifecycle/spec.md` — FR-002 (no dark_flat v1), FR-010 (Cmd+K ignored), Key Entities (canonical states), Implementation Status (6-state review filter, local label mapping)
- `specs/006-inventory-library-lifecycle/plan.md` — Summary (R-Projection-Wide, single canonical state + local label mapping); Constitution Check (noop pattern)
- `specs/006-inventory-library-lifecycle/research.md` — §2 (per-frame kind constraint, dark_flat reserved); §3 (full rewrite: R-Projection-Wide ratified, noop pattern); §4 (state.unchanged → noop)
- `specs/006-inventory-library-lifecycle/data-model.md` — InventorySession fields (A1 primary_designation, R-Projection-Wide drop dual state, dark_flat excluded); Invariants (6-value state, mixed detection, dark_flat never returned); Required Reviewed Fields (state condition updated); captured_on note (E2); Cross-Reference Map (A1, drop canonical_state row); Mutations (noop pattern A2, E5 mixed_state guard)
- `specs/006-inventory-library-lifecycle/contracts/inventory.list.json` — Full rewrite: drop PresentationalReviewState; rename CanonicalSessionState → SessionState; add ReviewFilter def; update review_filter to use ReviewFilter; update InventorySession.state; update FrameType (drop dark_flat, add description); add captured_on E2 note
- `specs/006-inventory-library-lifecycle/contracts/inventory.session.review.json` — Full rewrite: drop PresentationalReviewState; drop projected_state field; rename CanonicalSessionState → SessionState; add "noop" to response status enum; drop state.unchanged from ErrorCode; add session.mixed_state to ErrorCode; simplify next_state to SessionState
- `specs/006-inventory-library-lifecycle/tasks.md` — T302 (canonical states + local label mapping); T303 (noop pattern); T308 (mixed_state test); T309 (Cmd+K action); T310 (Playwright Cmd+K); T311 (mixed detection integration test); T506 (D6 CI snapshot test)

**Spec 007**:
- `specs/007-calibration-matching-rules/spec.md` — FR-001 (dark_flat reserved, not v1); FR-004 (optic_train added); US5 (batch suggest)
- `specs/007-calibration-matching-rules/plan.md` — contracts list (batch contract added); spec 008 dependency note
- `specs/007-calibration-matching-rules/research.md` — R1 (optic_train rationale, dark_flat reserved note); R3 (full rewrite: refuse-to-match when null, no ±12h fallback, observer_location.tz source, exposure_start_utc chain); R4 (confidence clamp formula, override_penalty default, A5 settings keys); R5 (pre-fill semantics, loop-closing rule, spec 008 dependency); resolved/deferred questions updated
- `specs/007-calibration-matching-rules/data-model.md` — CalibrationType (dark_flat reserved note); MatchingRuleConfig (prefill_suggestion rename + description); Flat table (optic_train rationale, gain note, soft cap sum note); Invariants (3 new: dark_flat not in contracts, E5 mixed guard, A6 observer_location guard); Settings Keys section (new, A5)
- `specs/007-calibration-matching-rules/contracts/calibration.match.suggest.json` — calibration_types description (no dark_flat); response gains `status` field with observer_location_missing; errors gain session.mixed_state + match.observer_location_missing
- `specs/007-calibration-matching-rules/contracts/calibration.match.assign.json` — errors gain session.mixed_state + match.observer_location_missing
- `specs/007-calibration-matching-rules/contracts/calibration.match.suggest.batch.json` (new) — R-Batch: camelCase; sessionIds; calibrationTypes; per-item SessionResult with status enum; partial success supported
- `specs/007-calibration-matching-rules/tasks.md` — Phase 6b (T035–T039 batch tasks); T031 (prefill_suggestion rename); T034 (prefill_suggestion note); T040 (D6 CI snapshot test); T041 (session.mixed_state test); T042 (observer_location_missing test); dependency graph updated

---

## Amendment 2026-05-22 — Spec 020 + 021: ratified decisions folded

**Ratification date**: 2026-05-22

**Scope**: Folds all mechanical decisions (A-020-1 through A-021-4), newly
ratified decisions (R-Key-ReviewFilter, R-Lib-V1, R-DevFeature,
R-Validator-Tiered), cross-spec contradiction resolutions (E-020-2, E-020-3,
E-021-1, E-021-2, E-021-3), adversarial fixes (D-020-H1, D-020-H2,
D-021-B1, D-021-B2, D-021-H3), and silent-decision settlements
(C-020-1 through C-021-4) into the spec 020 and spec 021 artifact sets.

---

### Mechanical decisions applied

| ID | Decision | Artifacts |
|---|---|---|
| A-020-1 | Rename URL param `review` → `reviewFilter` in route table, spec.md search-param table, data-model.md, all `validateSearch` examples and deep-link examples. | `020/spec.md`; `020/data-model.md` |
| A-020-2 | Add `DeprecatedParamMap` registry (old→new param names). URL read applies the map; UI emits canonical name. Remove deprecated entries after 2 releases. Initial entry: `review → reviewFilter` on `/inventory`. | `020/research.md R9`; `020/data-model.md` (new DeprecatedParamMap section); `020/tasks.md T060, T061` |
| A-020-3 | Cross-library refusal with banner. `url.resolve` `library_id` → `libraryId` is required in Request; `library.mismatch` error emitted on conflict (not informational). Removed "ignored in v1" / "not emitted in v1" notes. | `020/research.md R5, R6`; `020/data-model.md` (lib param on every route); `020/contracts/url.resolve.json` (libraryId required; errorCodes updated); `020/spec.md FR-011`; `020/tasks.md T064, T065` |
| A-020-4 | Strict two-tier validator. Unknown keys: drop silently. Invalid values of known keys: error banner + drop. | `020/research.md R3`; `020/spec.md FR-008`; `020/tasks.md T062` |
| A-021-1 | FR-008 acceptance amendment. Scenario 4 rewritten: toggle-off + restart = fully uninstalled. Scenario 5 added: toggle-off without restart = recording continues (informational). | `021/spec.md US4 acceptance scenarios 4–5`; `021/spec.md FR-008` |
| A-021-2 | Compile-time + runtime hybrid gating (R-DevFeature). Release builds omit route + proxy + Tauri commands entirely via `dev-tools` Cargo feature. Runtime toggle controls proxy installation in dev-tools builds. T032 gated. | `021/spec.md` (Compile-Time Gating section); `021/plan.md` (Build Configuration section); `021/data-model.md` (Developer Mode Flag note); `021/research.md R2`; `021/tasks.md T036` |
| A-021-3 | Redact ALL paths by default (`${LIBRARY_ROOT}/...` placeholder). Per-export opt-in: `includeVerbatimPaths: boolean` (default false) on `dev.export` request. | `021/research.md R4`; `021/data-model.md ContractCall.request note`; `021/contracts/dev.calls.list.json`; `021/contracts/dev.export.json (new)`; `021/tasks.md T034` |
| A-021-4 | `replaySafe` default `false`; opt-in only. Write-contracts must not set true without allow-list entry. CI lint snapshot test T037 enforces. | `021/research.md R6`; `021/data-model.md ContractMeta.replay_safe`; `021/contracts/dev.contracts.list.json`; `021/tasks.md T037` |

---

### Newly ratified decisions applied

| ID | Decision | Artifacts |
|---|---|---|
| R-Key-ReviewFilter | Canonical key is `reviewFilter` (aligns with spec 006 FR-010). Covered by A-020-1. | See A-020-1 above |
| R-Lib-V1 | `?lib=<library_id>` ships in v1. Every route's search shape includes `lib?: string`. `url.resolve` requires `libraryId`. `current_library_id` setting may be needed in UI context (spec 018 ripple — flagged, not edited). | `020/spec.md FR-010`; `020/data-model.md` (lib on all routes); `020/contracts/url.resolve.json`; `020/tasks.md T063, T065` |
| R-DevFeature | Cargo feature `dev-tools` + runtime toggle. Route registered only when feature compiled in. Release builds omit route + proxy + Tauri commands. `Cargo.toml` and `tauri.conf.json` edits deferred to Rust implementation phase (flagged, not edited). | `021/spec.md`; `021/plan.md`; `021/research.md R2`; `021/tasks.md T036` |
| R-Validator-Tiered | Unknown keys drop silently; invalid values of known keys error (banner + drop). Per-type handling documented separately. | `020/research.md R3`; `020/spec.md FR-008` |

---

### Cross-spec contradiction resolutions applied

| ID | Resolution | Artifacts |
|---|---|---|
| E-020-2 | `url.resolve.json` rewritten with camelCase envelope: `contractVersion`, `requestId`, status-discriminated `Response`, `errors: [{ code, message, details }]`, camelCase field names throughout (`libraryId`, `overallStatus`, `onMissing`, `redirectTo`, `suggestedNavigation`). | `020/contracts/url.resolve.json` |
| E-020-3 | `NavigationEvent` gains `source: enum("user", "restore", "system")` field. Documents: navigation events emitted to the bus carry source, matches spec 002 R-Source-1. | `020/data-model.md NavigationEvent` |
| E-021-1 | `dev.contracts.list.json` and `dev.calls.list.json` rewritten with camelCase envelope: `contractVersion`, `requestId`, status-discriminated Response/Error, camelCase field names (`schemaPath`, `replaySafe`, `sensitiveFields`, `tsHash`, `rustHash`, `startedAt`, `durationMs`, `payloadTruncated`, `contractVersion` on call items). New `dev.export.json` uses camelCase from the start. | `021/contracts/dev.contracts.list.json`; `021/contracts/dev.calls.list.json`; `021/contracts/dev.export.json (new)` |
| E-021-2 | `devMode` settings key not previously registered as spec 018 ripple. Added to spec 018 ripple flags in this amendment (see below). | GRILL_DECISIONS (this block) |
| E-021-3 | Spec 021 Domain Questions marked RESOLVED inline with GRILL decisions. All three questions answered: build flag + runtime toggle; paths redacted by default; `replaySafe` default false. | `021/spec.md Domain Questions → RESOLVED` |

---

### Adversarial fixes applied

| ID | Fix | Artifacts |
|---|---|---|
| D-020-H1 | Stale-id re-fire race guard. Added use-case rule to `data-model.md`: pages MUST use a `useRef` flag or effect-cleanup pattern so `navigate({ replace:true })` fires at most once per stale-id encounter. Phase 7 test task T066 added. | `020/data-model.md` (Stale-Id Re-Fire Guard section); `020/tasks.md T066` |
| D-020-H2 | Allow-list enum definitions. Canonical allow-lists for all URL enum params defined in `data-model.md` search-param tables: `FrameType` (spec 005), `SessionState` (spec 006, 6 values + `all`), `ProjectLifecycle` (spec 002, 8 values), `PlanState` (spec 017+025, 10 values), `PlanOrigin` (spec 017), `tool_id` (spec 011, runtime-known), `calibration_type` (spec 007). T067 task adds enum allow-list constants to `route-contract.ts`. | `020/data-model.md` route search-param tables; `020/tasks.md T067` |
| D-021-B1 | Covered by A-021-2 (R-DevFeature). | See A-021-2 above |
| D-021-B2 | Covered by A-021-3 (path redaction default). | See A-021-3 above |
| D-021-H3 | CI lint snapshot test. T037 added: every new contract must declare `replaySafe` explicitly; build fails if missing or if write-contract sets `replaySafe: true` without allow-list entry. | `021/tasks.md T037` |

---

### Silent decisions settled

| ID | Settlement | Artifacts |
|---|---|---|
| C-020-1 | `library_id` required (not ignored). Covered by R-Lib-V1. | `020/contracts/url.resolve.json`; `020/research.md R6` |
| C-020-2 | `overall_status: "partial"` semantics kept: `ok \| partial \| stale`. Documented as settled. | `020/contracts/url.resolve.json` (`overallStatus` description); `020/research.md` settled decisions |
| C-020-3 | `NavigationEvent.kind` enum `link \| programmatic \| redirect \| replace-cleanup` kept as settled vocabulary. | `020/data-model.md NavigationEvent.kind` note |
| C-020-4 | `settings_section` resolves to `render_empty` for unknown sections. Kept; documented in research settled decisions. | `020/research.md` settled decisions |
| C-021-1 | Ring buffer worst-case 13 MB accepted for developer-only surface. Documented. | `021/research.md R8` |
| C-021-2 | `devMode` in settings store. Cross-spec ripple noted in spec 018 flags (see below). Spec 021 references key with `dev-tools` feature compile-time gate. | `021/data-model.md Developer Mode Flag` |
| C-021-3 | `ts_hash` / `rust_hash` algorithm: SHA-256, canonical JSON serialization with deterministic key ordering. Consistent with spec 014 catalog checksums. | `021/data-model.md ContractMeta`; `021/research.md R4, R9`; `021/contracts/dev.contracts.list.json` (tsHash/rustHash descriptions) |
| C-021-4 | Diagnostic export: `dev.export.json` new contract created. `includeVerbatimPaths: boolean` (default false) in request. camelCase envelope. | `021/contracts/dev.export.json (new)`; `021/tasks.md T034` |

---

### Spec 018 ripples flagged (do NOT edit spec 018 in this session)

The following spec 018 changes are required but deferred:

1. **`current_library_id`** (from R-Lib-V1): A setting or library-context
   value providing the currently-open library's id is needed to drive `?lib=`
   injection in all `<Link>` components. May live in a library-context React
   context rather than the Settings store, but requires a cross-spec decision.
2. **`devMode`** (from R-DevFeature / C-021-2): The `devMode` boolean key
   must be registered in the spec 018 settings store schema (default `false`,
   developer-only, persisted per device). Key is only meaningful in `dev-tools`
   builds but should be present in the schema for portability.
3. **`plans.list.default_age_cutoff_days`**: Carried forward from the
   2026-05-22 Spec 017+025 amendment.
4. **`target_lookup.active_catalogs: catalog_id[]`**: Carried forward from
   the 2026-05-22 Spec 013+023 amendment.

---

### Cargo.toml + tauri.conf.json ripple flagged (Rust implementation phase)

The `dev-tools` Cargo feature requires the following edits at Rust
implementation time (NOT in the spec session):

- `Cargo.toml` (workspace root): add `dev-tools` feature declaration.
- `crates/app/core/Cargo.toml`: add `dev-tools` feature entry.
- `tauri.conf.json`: reference `dev-tools` build profile for developer builds.

These are flagged for the implementing agent and MUST NOT be applied during
spec editing passes.

---

### Deferred envelope sweep flagged

The universal camelCase + `contractVersion` + `requestId` + status-discriminated
envelope convention has been applied to specs 013, 014, 015, 017, 020, 021,
023, 024, and 025 contracts in their respective amendment sessions.

Older specs (002, 003, 006, 007, 008, 009, 010, 011, 012, 016, 018, 019,
026) still use the pre-camelCase envelope. A final envelope sweep pass is
required before implementation begins on those specs. This sweep is deferred
and must be tracked as a cross-cutting task.

---

### Affected artifacts (2026-05-22)

**Spec 020**:
- `specs/020-router-url-state/spec.md` — FR-008 (two-tier validator); FR-010, FR-011 (lib param + refusal); search-param table (`reviewFilter`); deep-link examples; Out of Scope (library identity prefix encoding removed); Assumptions updated; US4 scenario 4 added
- `specs/020-router-url-state/research.md` — R3 (two-tier validator); R5 (cross-library refusal-with-banner); R6 (lib in v1, C-020-1); R9 (DeprecatedParamMap, new); R10 (lib required, R-Lib-V1, new); R8 label fix; settled decisions section (C-020-1–4)
- `specs/020-router-url-state/data-model.md` — All route search tables: `lib` param added; `review` → `reviewFilter` with enum allow-list; enum allow-lists for all typed params; NavigationEvent: `source` field added (E-020-3), `kind` settled note; new DeprecatedParamMap section; new Stale-Id Re-Fire Guard section
- `specs/020-router-url-state/contracts/url.resolve.json` — Full rewrite: camelCase envelope (E-020-2); `libraryId` required in Request (R-Lib-V1, A-020-3); `library.mismatch` emitted (not informational); camelCase field names throughout; `overallStatus`, `onMissing`, `redirectTo`, `suggestedNavigation`
- `specs/020-router-url-state/tasks.md` — Phase 8 added: T060–T067 (DeprecatedParamMap, error banner, lib injection, refusal banner, stale-id guard, enum allow-lists); dependency graph extended

**Spec 021**:
- `specs/021-developer-contract-diagnostics/spec.md` — US4 acceptance scenarios 4–5 (A-021-1); FR-008 restart requirement; Independent Test (production build clarified); Compile-Time Gating section (R-DevFeature); Domain Questions → RESOLVED (E-021-3); Assumptions updated
- `specs/021-developer-contract-diagnostics/plan.md` — Build Configuration section added (R-DevFeature); Route Gating updated for compile-time gate
- `specs/021-developer-contract-diagnostics/research.md` — R2 replaced: compile-time + runtime hybrid (A-021-2); R4 updated: paths redacted by default (A-021-3); R6 updated: `replaySafe` default false (A-021-4); R8 (C-021-1 ring buffer); R9 (C-021-3 hash algorithm); R10 (C-021-4 export contract)
- `specs/021-developer-contract-diagnostics/data-model.md` — ContractMeta: `replay_safe` default-false note; `ts_hash`/`rust_hash` SHA-256 description; ContractCall.request: path redaction note; Developer Mode Flag: compile-time constraint note, spec 018 ripple note
- `specs/021-developer-contract-diagnostics/contracts/dev.contracts.list.json` — Full rewrite: camelCase envelope; camelCase fields (`schemaPath`, `replaySafe`, `sensitiveFields`, `tsHash`, `rustHash`); `replaySafe` default false; `errorCodes` (was `errors`)
- `specs/021-developer-contract-diagnostics/contracts/dev.calls.list.json` — Full rewrite: camelCase envelope; camelCase fields (`contractVersion`, `startedAt`, `durationMs`, `payloadTruncated`); path-redaction note in description; `errorCodes`
- `specs/021-developer-contract-diagnostics/contracts/dev.export.json` — NEW contract (C-021-4, A-021-3): camelCase; `outputPath`, `includeVerbatimPaths`, `includeContracts`, `includeCalls`; status-discriminated response; error codes
- `specs/021-developer-contract-diagnostics/tasks.md` — T032 (dev-tools gate note); T034 (updated for dev.export contract + path redaction); T036 (feature flag docs task, new); T037 (CI lint snapshot test, new); dependency graph extended

**GRILL_DECISIONS_2026-05-21.md**:
- This amendment appended (Amendment 2026-05-22 — Spec 020 + 021)

---

## Amendment 2026-05-22 — Spec 022 + 026 + Spec 009 Unarchive

**Ratification date**: 2026-05-22

**Scope**: Folds all decisions from the Spec 022 (Design System) grill,
Spec 026 (Generated Project Source View Removal) grill, and the
R-Unarchive ripple into the corresponding artifact sets.

---

### Spec 022 — Desktop Prototype Design System

| Decision ID | Summary | Artifacts |
|---|---|---|
| A1 | DESIGN.md lives at repo root `/DESIGN.md` (already exists from commit `314292a`). Spec references canonical file; do not create a new one. | `022/spec.md` Domain Questions resolved; `022/plan.md` Architecture; `022/tasks.md` T032 |
| A2 | Two density levels: `dense` + `comfortable` in v1. `compact` deferred to v1.x. | `022/spec.md` FR-017 (new); `022/plan.md` Architecture Token System |
| A3 | New primitive threshold: 3+ uses OR unique a11y semantics. | `022/spec.md` FR-018 (new) |
| A4 | Token additions process: DESIGN.md update + adversarial review before merge. | `022/spec.md` FR-019 (new); `022/plan.md` Architecture Token System |
| D-022-1 | Font-stack literals carve-out in FR-006. `font-family` MAY reference platform-native literal strings; token coverage for `font-size`, `font-weight`, `line-height` still applies. | `022/spec.md` FR-006 |
| D-022-2 | Helper exports added to vocabulary table: `FilterLabel`, `FactGroup`, `Facts`, `TokenPatternBuilder`. | `022/data-model.md` Component Vocabulary table |
| D-022-3 | FR-013 / T042 softened. `theme.get`/`theme.set` contracts are forward-compat only; v1 `ThemeProvider` is canonical; contracts do not block v1. T042 marked optional/deferred. | `022/spec.md` FR-013; `022/plan.md` Theme Contracts; `022/tasks.md` T042 |
| R-022-TSDefer | TypeScript token autocomplete module (`tokens.d.ts`) deferred to v1.x. Tokens enforced via review only in v1. | `022/spec.md` Out of Scope; `022/tasks.md` T013 (marked deferred) |
| R-022-PrefixConvention | `alm-` prefix is convention only in v1; reviewer enforces; no build-time check; lint deferred to v1.x. | `022/spec.md` Out of Scope; `022/plan.md` Architecture |
| E-022 (deferred) | Envelope sweep for `theme.get.json` + `theme.set.json` deferred to cross-spec final envelope sweep pass. | — |

---

### Spec 026 — Generated Project Source View Removal

| Decision ID | Summary | Artifacts |
|---|---|---|
| A1 | Hardlink removal: archive backup ALWAYS required — BUT hardlink is DEFERRED to v1.x (R-026-Hardlink). Archive is hard-coded default for all removal (R-026-Dest-Archive). | `026/research.md` R3; `026/plan.md` Safety Properties |
| A2 | Mixed-kind: refuse at create time with `view.mixed_kind`. `PreparedSourceView.kind` MUST equal all item `materialization` values. `kind_diverged` view state added for pre-existing mismatches. | `026/data-model.md` invariants + state enum; `026/contracts/preparedview.remove.json`; `026/contracts/preparedview.regenerate.json`; `026/tasks.md` T003, T006a |
| A3 | Stale detection: copy-kind includes content hash check (`hash_diverged` value). Link-kind (symlink/junction) skips content hash. | `026/data-model.md` `last_observed_state` enum; `026/research.md` R1 |
| A4 | Removed-view regenerable lifetime: indefinite. View record never hard-deleted. | `026/data-model.md` invariants + Storage Notes; `026/spec.md` FR-010; `026/tasks.md` T008 |
| D-026-H1 | Hardlink regeneration verification: MOOT — hardlink deferred to v1.x. | `026/spec.md` Out of Scope |
| D-026-H2 | `materialization` vs `kind` divergence resolved at create time (A2). Pre-existing diverged records: `kind_diverged` state; UI surfaces for manual resolution. | `026/data-model.md` state enum + state transitions; `026/tasks.md` T006a |
| D-026-M2 | Content drift hash check: A3 resolves. | `026/data-model.md` `last_observed_state`; `026/research.md` R1 |
| R-026-Strategies | v1 ships symlink + junction + copy; hardlink deferred to v1.x. `hardlink` reserved in `kind` enum. | `026/data-model.md` `kind` enum + `materialization` enum; `026/spec.md` FR-007 + Out of Scope; `026/research.md` R2; `026/tasks.md` (hardlink tasks removed/deferred) |
| R-026-Dest-Archive | `destructiveDestination` always `archive` for view removal. No user-selectable field on remove request. Server hard-codes archive for the underlying FilesystemPlan. | `026/contracts/preparedview.remove.json` Request (no `destructiveDestination` field); `026/spec.md` FR-011; `026/plan.md` Architecture + Safety Properties |
| R-026-Lifecycle | View removal/regeneration allowed in `setup_incomplete \| ready \| prepared \| processing \| blocked \| completed`; refused on `archived` with `lifecycle.read_only`. Cross-references spec 009 R-Unarchive. | `026/contracts/preparedview.remove.json` errors; `026/contracts/preparedview.regenerate.json` errors; `026/spec.md` FR-012; `026/plan.md` Plan Flow |
| R-026-StaleAutoInclude | Stale views NEVER auto-mutate. Spec 017 cleanup plans MAY include stale views as passive candidates; user explicitly approves. | `026/research.md` D3; `026/spec.md` FR-013; `026/plan.md` |
| R-026-Pipeline | Full spec 017/025 compliance. View plans go through `plan.approve` (approvalToken) → `plan.apply` (per-item FS revalidation, paused state, `plan.resume`). Response includes `plan_id`. All spec 017/025 error codes can surface during apply. | `026/plan.md` Architecture + Plan Flow; `026/contracts/preparedview.remove.json` response; `026/contracts/preparedview.regenerate.json` response; `026/tasks.md` T003a, T010a |
| E-026-1 | Envelope sweep for `026/contracts/preparedview.remove.json` + `preparedview.regenerate.json` deferred. | `026/spec.md` Out of Scope |
| E-026-2 | Spec 017+025 compliance: R-026-Pipeline resolves. | — |
| E-026-3 | `destructiveDestination`: R-026-Dest-Archive resolves (hard-coded archive). | — |
| E-026-4 | `crates/project/structure/` placement: keep. Cross-spec interaction with spec 008/009 documented. R-026-Lifecycle aligns view ops with project lifecycle; R-Unarchive enables view ops after unarchiving. | `026/data-model.md` Storage Notes |

---

### Spec 009 — Unarchive Ripple (R-Unarchive)

User ratified: allow the user to unarchive a project with a direct `archived → ready` edge.

| Decision ID | Summary | Artifacts |
|---|---|---|
| R-Unarchive | Add `archived → ready` lifecycle transition. Actor: user only. Plan required when files need to move (C7 criterion), NOT required for metadata-only transitions (mirrors `archived → processing`). Audit event `project.unarchived` emitted. | `009/spec.md` transition table + unarchive note; `009/data-model.md` transition table row; `009/research.md` R1 unarchive two-paths + R2 label table + forbidden edges correction; `009/contracts/project.lifecycle.transition.json` R-PlanGated-Schema note; `009/tasks.md` US5 |
| (002 ripple) | Plan-Requirement Edge Table in spec 002 gains `archived → ready` row with C7 conditional `requires_plan`. | `002/data-model.md` Plan-Requirement Edge Table; `002/data-model.md` Project lifecycle table |

**Edge count update**: Spec 009 now has **eighteen** allowed edges (sixteen
original + `blocked → archived` A3 + `archived → ready` R-Unarchive).

**Deferred envelope sweep flagged**: `009/contracts/project.lifecycle.transition.json`
is in the pre-camelCase group. The universal envelope sweep for this contract is
deferred to the cross-spec final envelope sweep pass (same as 002, 003, 006–009,
etc. noted in the Spec 020+021 amendment above).

---

### Affected artifacts (2026-05-22)

**Spec 022**:
- `specs/022-mantine-prototype-design-system/spec.md`
- `specs/022-mantine-prototype-design-system/plan.md`
- `specs/022-mantine-prototype-design-system/data-model.md`
- `specs/022-mantine-prototype-design-system/tasks.md`

**Spec 026**:
- `specs/026-generated-project-source-view-removal/spec.md`
- `specs/026-generated-project-source-view-removal/plan.md`
- `specs/026-generated-project-source-view-removal/research.md`
- `specs/026-generated-project-source-view-removal/data-model.md`
- `specs/026-generated-project-source-view-removal/contracts/preparedview.remove.json`
- `specs/026-generated-project-source-view-removal/contracts/preparedview.regenerate.json`
- `specs/026-generated-project-source-view-removal/tasks.md`

**Spec 009 (R-Unarchive ripple)**:
- `specs/009-project-lifecycle-model/spec.md`
- `specs/009-project-lifecycle-model/data-model.md`
- `specs/009-project-lifecycle-model/research.md`
- `specs/009-project-lifecycle-model/contracts/project.lifecycle.transition.json`
- `specs/009-project-lifecycle-model/tasks.md`
- `specs/002-data-lifecycle-state-model/data-model.md`

**GRILL_DECISIONS_2026-05-21.md**:
- This amendment appended (Amendment 2026-05-22 — Spec 022 + 026 + Spec 009 Unarchive)

---

## Amendment 2026-05-22 — Spec 004 + 016 + 019

**Ratification date**: 2026-05-22

**Scope**: Folds all decisions from the 2026-05-22 grill session into specs
004 (Native Filesystem Controls), 016 (Source Protection Defaults), and
019 (Bottom Log Viewer).

---

### Spec 004 — Native Filesystem Controls

| Decision ID | Summary | Artifacts |
|---|---|---|
| A1 | Capability `opener:default` → `opener:allow-reveal-item-in-dir` in T002. `launch-app` and `launch-url` owned by spec 011. | `004/tasks.md` T002 |
| A2 | Drop `path_hash` from `native.reveal.failed` audit payload; correlate via `entity_id` only | `004/data-model.md` `native.reveal.failed` table; `004/plan.md` Audit Logging; `004/tasks.md` T005 |
| R-AllSupported | Combined `"All supported astro images"` preset as first filter row; extensions: `xisf, fits, fit, fts, tif, tiff, png, jpg` | `004/data-model.md` File Filter Ordering section; `004/contracts/native.file.pick.json` examples; `004/spec.md` FR-011 |
| R-LastPath | Per-kind `localStorage` under `alm.lastPath.<kind>` namespace; keys: `library_root`, `catalog_import`, `export`, `master_calibration` | `004/data-model.md` LastPathMemory section; `004/research.md` §5; `004/spec.md` FR-014 |
| R-EntityKind | `entity_kind` closed enum (6 values): `inbox_item \| inventory_row \| project_manifest \| master_calibration \| registered_source \| other` | `004/contracts/native.reveal.json` (already had 6 values); `004/data-model.md` RevealRequest table; `004/spec.md` FR-013 |
| D-004-1 | `*` only valid in a filter named exactly `"All files"`; server returns `filters.invalid` for `*` in any other row | `004/contracts/native.file.pick.json` extensions description + errors.filters.invalid; `004/spec.md` FR-012 |
| B-.fts | `.fts` added to FITS filter and All-supported filter (defer-no-more) | `004/data-model.md` File Filter Ordering; `004/contracts/native.file.pick.json` examples; `004/research.md` §2 |
| C-toast | Reveal failures emit BOTH toast (with "Copy path" action) AND audit event `native.reveal.failed` | `004/spec.md` Domain Questions Resolved + FR-010; `004/research.md` §6 |
| C-level-persistence | Session-only level filter; confirmed | `004/spec.md` Domain Questions Resolved |
| E-004-1 | Capability split aligned with spec 011 amendment | `004/tasks.md` T002 note |
| E-004-2 | Envelope sweep deferred; 3 spec 004 contracts stay snake_case | (deferred; tracked below) |

---

### Spec 016 — Source Protection Defaults

| Decision ID | Summary | Artifacts |
|---|---|---|
| A1 (H1 resolver) | Per-source override wins unconditionally; categories elevate level ONLY when no override row exists | `016/data-model.md` Resolver section |
| A2 (H3) | `block_permanent_delete: bool?` added to `SourceProtectionState`; null = inherit global; true/false = explicit per-source override | `016/data-model.md` SourceProtectionState table + resolve_block_permanent_delete pseudocode; `016/contracts/source.protection.get.json`; `016/contracts/source.protection.set.json` |
| A3 (H2) | Hard-coded fallback values when GlobalProtectionDefaults row absent: `level: protected`, `block_permanent_delete: true`, `protected_categories: ["lights","masters","finals"]` | `016/data-model.md` GlobalProtectionDefaults section |
| A4 | `protected_categories` stored as JSON-encoded `array<string>` in SQLite; UI parses/renders as comma-separated | `016/data-model.md` GlobalProtectionDefaults note; `016/tasks.md` T-030 |
| R-OSTrash-Allowed (E-016-1) | OS trash is reversible; `block_permanent_delete` applies ONLY to `permanent_delete` action; `os_trash` is always allowed | `016/research.md` §R3 (rewritten); `016/plan.md` Cross-Spec Notes; `016/spec.md` FR-007 |
| R-CheckScope | `plan.protection.check` response filtered to acknowledgement-required items only; `non_blocking_summary: { normal_count, unprotected_count }` added | `016/contracts/plan.protection.check.json`; `016/spec.md` FR-008 |
| E-016-2 | Protection re-resolution during spec 025 per-item FS revalidation | `016/plan.md` Cross-Spec Notes |
| E-016-3 | `protectedCategories` settings key MUST emit `protection.default.changed`; overrides spec 018 noisy-skip for this key | `016/plan.md` Cross-Spec Notes |
| Deferred | "Freeze project" toggle deferred to v1.x | `016/spec.md` Out of Scope; `016/research.md` Open Questions |

---

### Spec 019 — Bottom Log Viewer

| Decision ID | Summary | Artifacts |
|---|---|---|
| A1 (B1 cursor namespace) | `id` namespaced: `aud:<n>` for audit, `dia:<n>` for diagnostic; pattern `^(aud\|dia):[0-9]+$` | `019/data-model.md` LogEntry.id; `019/contracts/log.stream.json` LogEntry.id |
| A2 | Export source default: `source: audit`; `include_diagnostics: false`; toggle 'Include diagnostics' | `019/data-model.md` Level Filter section; `019/spec.md` Domain Questions Resolved; `019/tasks.md` T028 |
| A3 | Diagnostic visibility tied to `logLevel` setting: hidden + locked when `logLevel != debug`; visible with header toggle when `logLevel == debug` | `019/data-model.md` Level Filter section; `019/spec.md` FR-014; `019/tasks.md` T032 |
| A4 (H3 truncated) | `truncated: boolean` + `truncated_count: int?` on stream response; UI renders inline "History gap" marker | `019/data-model.md` Truncation Marker section; `019/contracts/log.stream.json` events.added; `019/spec.md` FR-015; `019/tasks.md` T033 |
| R-SourceEnum | `LogEntry.source` closed enum (11 values) aligned to spec 002 event-bus topic prefixes | `019/data-model.md` Source Enum section; `019/contracts/log.stream.json` LogEntry.source |
| R-SourceFilter | `source_filter: string[]` optional field added to `log.stream` request | `019/contracts/log.stream.json` request; `019/spec.md` FR-016; `019/tasks.md` T031 |
| R-Subscriptions | Log viewer subscribes to all spec 002 event-bus topic wildcards; source-tag mapping documented | `019/plan.md` Event-Bus Subscriptions section; `019/tasks.md` T030 |
| H1 contractVersion | `contract_version: "1"` added to `LogEntry` schema | `019/contracts/log.stream.json` LogEntry; `019/data-model.md` LogEntry table; `019/spec.md` FR-017; `019/tasks.md` T034 |
| B2 export divergence | US4 acceptance scenario 2 updated: exported file contains only audit-source entries by default | `019/spec.md` US4 Acceptance Scenario |
| B-level-persistence | Session-only level filter confirmed | `019/spec.md` Domain Questions Resolved |
| B-include_diagnostics-defaults | Stream default true (debug mode), export default false; asymmetry documented | `019/data-model.md` Level Filter section; `019/spec.md` Domain Questions Resolved |
| E-019-1 | `source` enum aligned with spec 002 categories; $ref deferred | `019/contracts/log.stream.json` source note |
| E-019-2 | `entity_type` values = spec 002 AssetType enum (includes `target`, `data_source`) | `019/contracts/log.stream.json` entity_type description |
| E-019-3 | `rememberFollowLogs` settings key added to spec 018 ripples list | See spec 018 ripples below |
| E-019-4 | `plans.list.default_age_cutoff_days`: spec 019 does not need this; no action | — |

---

### Spec 018 ripples (flag, do not edit spec 018 now)

Carried forward and newly added:

- `rememberFollowLogs` (spec 019 E-019-3) — follow-tail persistence key
- `current_library_id` (carried)
- `devMode` (carried)
- `plans.list.default_age_cutoff_days` (carried from spec 017 amendment)
- `target_lookup.active_catalogs` (carried from spec 013 amendment)
- `calibration.*` (carried)
- IMAGETYP user-extended mappings (carried)
- per-tool `bundle_id` (carried)
- `workflow_profile.*.watch_extensions` (carried)

---

### Deferred envelope sweep (all three specs)

Spec 004 contracts (`native.file.pick.json`, `native.reveal.json`,
`native.directory.pick.json`) and spec 016 contracts (`source.protection.get.json`,
`source.protection.set.json`, `plan.protection.check.json`) and spec 019
contracts (`log.stream.json`, `log.export.json`) remain in their current
form (snake_case, pre-camelCase envelope). The universal camelCase +
`contractVersion` + `requestId` envelope sweep is deferred to the final
cross-cutting pass after all specs are reviewed.

---

### Affected artifacts (2026-05-22)

**Spec 004**:
- `specs/004-native-filesystem-controls/spec.md`
- `specs/004-native-filesystem-controls/plan.md`
- `specs/004-native-filesystem-controls/research.md`
- `specs/004-native-filesystem-controls/data-model.md`
- `specs/004-native-filesystem-controls/contracts/native.file.pick.json`
- `specs/004-native-filesystem-controls/tasks.md`

**Spec 016**:
- `specs/016-source-protection-defaults/spec.md`
- `specs/016-source-protection-defaults/plan.md`
- `specs/016-source-protection-defaults/research.md`
- `specs/016-source-protection-defaults/data-model.md`
- `specs/016-source-protection-defaults/contracts/source.protection.get.json`
- `specs/016-source-protection-defaults/contracts/source.protection.set.json`
- `specs/016-source-protection-defaults/contracts/plan.protection.check.json`
- `specs/016-source-protection-defaults/tasks.md`

**Spec 019**:
- `specs/019-bottom-log-viewer/spec.md`
- `specs/019-bottom-log-viewer/plan.md`
- `specs/019-bottom-log-viewer/data-model.md`
- `specs/019-bottom-log-viewer/contracts/log.stream.json`
- `specs/019-bottom-log-viewer/tasks.md`

**GRILL_DECISIONS_2026-05-21.md**:
- This amendment appended (Amendment 2026-05-22 — Spec 004 + 016 + 019)
