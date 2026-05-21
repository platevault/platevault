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
2. **Observer location setting** — needed by spec 007 (calibration night fallback) and spec 023 (`captured_on`). Settings gains a new key `observer_location: { tz, lat?, lon? }`. Belongs in spec 018.
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
