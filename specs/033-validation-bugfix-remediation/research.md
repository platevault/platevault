# Research & Decisions: Validation Bugfix & Remediation (Spec 033)

Phase 0 output. Every cross-cutting reconciliation and dependency choice the dependent stories rely on is
decided here before implementation (Constitution §IV). Format: **Decision / Rationale / Alternatives**.

---

## D1 — Destructive-destination vocabulary (FR-038; resolves the 0014↔0019 drift)

**Context**: Migration 0014 used `archive` / `os_trash`; migration 0019 used `trash` / `archive` / `none`.
Two vocabularies for "where does a destructive removal go" exist in the schema and contracts.

**Decision**: Canonical destructive-destination enum is **`archive` | `trash`**.
- `os_trash` → renamed `trash` (the OS recycle bin / XDG trash, via the `trash` crate — D4).
- `archive` = move into the app's archive root (unchanged).
- `none` is **removed** as a destination. A plan item is either *not destructive* (no destination field
  applies) or *destructive* (destination ∈ {archive, trash}).
- **Permanent deletion is NOT a destination.** It remains a distinct, separately-gated action type
  (destructive-confirm + the existing permanent-delete gate from spec 017), never the default.

**Rationale**: Constitution §II says destructive operations MUST prefer archive/trash over permanent
deletion — so the two safe destinations are the vocabulary, and permanent delete is the exceptional gated
path, not a peer value. Collapsing `none` removes an ambiguous state. Renaming `os_trash`→`trash` matches
the `trash` crate and the newer 0019 spelling.

**Alternatives**: (a) keep `os_trash` — rejected, verbose and inconsistent with 0019; (b) keep `none` as
"keep in place" — rejected, that's the absence of a destructive action, better modeled by the action type;
(c) add `permanent` as a destination value — rejected, it would make permanent deletion a selectable peer
of the safe options, weakening §II.

**Migration**: a sequential migration normalizes existing rows (`os_trash`→`trash`; any `none` rows on
destructive items are re-derived). Contracts in `packages/contracts` and `crates/contracts/core` updated to
the single enum; a conformance test asserts only `{archive, trash}` are accepted.

---

## D2 — Project lifecycle: one canonical table (FR-019; resolves the two-table divergence)

**Context**: Auto-transitions/health write spec-008 `projects.lifecycle` (`project_health.rs`);
user-triggered IPC transitions write the legacy spec-002 `project.state` (`transition_use_case.rs`). Both
are live → a project's lifecycle can silently diverge between the two surfaces.

**Decision**: **`projects.lifecycle` (spec-008) is canonical.** User-triggered IPC transitions are
re-pointed to read/write `projects.lifecycle`. The legacy `project.state` column is migrated (its values
mapped into `projects.lifecycle`) and then **deprecated and dropped** so only one authoritative state
exists.

**Rationale**: `projects.lifecycle` already carries the richer model (auto-transitions + health +
blocked-state machinery the typed blocked reason hangs off of). Converging onto it means the typed blocked
reason (D-data-model) and audit of auto-transitions live in one place. Keeping the legacy column would
perpetuate the divergence the validation flagged.

**Alternatives**: (a) make `project.state` canonical — rejected, it lacks the health/auto-transition model;
(b) keep both and sync — rejected, two-writer sync is exactly the divergence bug; (c) introduce a third
unified table — rejected, unnecessary churn over an existing good table.

**Migration**: sequential migration backfills `projects.lifecycle` from any `project.state` rows that lead,
maps states, then removes `project.state`. The user-IPC transition use-case and any DTO that read
`project.state` are updated. A test asserts both the user path and the auto path read the same row.

---

## D3 — Catalog slug canonicalization (FR-029; resolves the 013↔014 mismatch)

**Context**: Spec 013 lookup uses a **closed enum** `common` / `openngc` / `abell_pn`; spec 014 licensing
uses **strings** including `opengc` (missing the second `n`). Mismatched slugs parse to `Unknown` and are
silently skipped.

**Decision**: The **013 closed enum (`common`, `openngc`, `abell_pn`) is the single source of truth.**
Spec 014's string slugs are corrected to match (`opengc`→`openngc`, etc.) and 014 parses incoming slugs
**against the closed enum, hard-failing unknown slugs** (no silent `Unknown` fallback; ties to FR-027's
"reject unknown" posture).

**Rationale**: A closed enum is the safer contract; the 014 strings contain an actual typo. Making the enum
canonical and hard-failing unknown slugs converts a silent data-loss bug into a loud, testable error.

**Alternatives**: (a) make 014's strings canonical — rejected, they contain the typo and are open-ended;
(b) keep silent `Unknown` skip — rejected, that's the data-loss bug; (c) accept both spellings via an alias
map — rejected, hides the defect and invites future drift.

---

## D4 — OS trash: adopt the `trash` crate (FR-006; replaces the stub)

**Context**: `crates/fs/executor/src/ops/trash_op.rs` returns `TrashUnavailable` on all platforms; the
existing test `trash_returns_unavailable_in_v1` asserts the stub. Constitution §II prefers trash over
permanent delete, so the "prefer trash" guarantee is unmet at runtime.

**Decision**: Adopt **`trash` 5.2.x (MIT)** for cross-platform recycle-bin/Trash/XDG support. `trash_op`
calls it; on platforms/paths where it genuinely fails, fall back to `archive` and **record which
destination was used** (FR-006). Update/replace the stub-asserting test.

**Rationale**: Purpose-built, widely used, MIT, light transitive footprint; it is the documented intended
replacement. Honoring §II requires a working trash path, not a permanent fallback.

**Alternatives**: (a) keep the stub + always archive — rejected, never honors the user's trash choice;
(b) hand-roll per-OS trash — rejected, large surface, exactly what a vetted crate solves.

---

## D5 — Catalog signature: adopt `minisign-verify` (FR-026; replaces the no-op)

**Context**: `crates/targeting/catalogs/src/download.rs` parses+stores the manifest `signature` but never
verifies it (explicit "deferred" comment); only the SHA-256 checksum is checked. The advertised
authenticity guarantee is absent.

**Decision**: Adopt **`minisign-verify` 0.2.x (MIT)** and verify the manifest signature against an embedded
trusted public key before accepting a catalog. A tampered/invalid signature hard-fails with
`ManifestSignatureInvalid`. Keep the SHA-256 checksum as a second, complementary check.

**Rationale**: 8M+ downloads, MIT, purpose-built for minisign, no heavy transitive deps. Wiring it closes
the highest-value safety gap. Real downloads remain externally blocked (catalog repo unpublished), so this
is verified against local/test fixtures now and is ready when the repo ships.

**Alternatives**: (a) `ed25519-dalek` directly — rejected, re-implements minisign framing the crate already
handles; (b) defer until the repo ships — rejected, the FR is about correctness of the verification path,
testable on fixtures today.

---

## D6 — Guided tour: adopt `react-joyride` ^3.1.0; the load-bearing work is the event bridge (FR-010/011)

**Context**: `react-joyride ^3.0.0` is declared but never imported; a hand-rolled `GuidedOverlay.tsx`
(MutationObserver portal, no viewport collision/flip) shipped. Critically, `completeGuidedStep` is called
**only in tests** — there is no domain-event subscriber, so the coach can show a hint but never advances.

**Decision**: Pin **`react-joyride` ^3.1.0** (MIT; peer `react 16.8 - 19`; the Mar-2026 v3 rewrite exists
specifically for React 19; uses `@floating-ui/react-dom` = same engine as Base UI → no z-index conflict).
Replace the hand-rolled **render layer** with a controlled `<Joyride>` driven by `stepIndex`/`run`; keep the
existing state machine, persistence, anchors, mock store, and Settings restart. **The real fix** is a new
Tauri event subscriber modeled on `apps/desktop/src/data/logSubscription.ts` that listens for
`inventory.confirmed` / `project.created` / `tool.opened`, filters `source != "restore"`, and calls
`completeGuidedStep`. `spotlightClicks: true` keeps the UI interactive (FR-011, non-modal). Drop the dead
inline `@media` at `GuidedOverlay.tsx:188`.

**Rationale**: Library choice is mostly orthogonal — no library provides the event→advance bridge; that's
domain wiring we must build either way. joyride removes ~250 lines and fixes off-screen positioning while we
build the bridge.

**Alternatives**: `@reactour/tour` 3.8 (now declares React 19 but ~2yr dormant) — viable fallback;
`driver.js` (5KB, imperative) — loses React JSX hint content; Shepherd/intro.js — **rejected (AGPL-or-
commercial; incompatible with a closed distributed binary)**. Hand-rolling — rejected, not required by any
FR.

---

## D7 — Approval-token model: CAS token bound to a content/staleness baseline, not HMAC (FR-003/FR-007)

**Context**: The handover asked us to decide HMAC approval token vs token-equality. Today approval is
CAS-gated (`approved → applying`) but the executor receives raw relative paths and lacks a staleness
baseline (`approve_plan` never records `approved_mtime`/`approved_size_bytes` — spec 017 R-FS-1).

**Decision**: Keep the **CAS-gated opaque approval token (equality check)**, but **bind it to a baseline
captured at approval time**: at `approve_plan`, snapshot each item's resolved path + `mtime` + `size` (and
the resolved-pattern, spec 005). At apply, an item is refused as **stale** if its on-disk `mtime`/`size`
differs from the approved baseline. No keyed HMAC.

**Rationale**: Threat model is **local, single-user, single-process** — there is no untrusted party forging
approvals, so HMAC adds key-management overhead for no adversary. The real risk is *applying a plan whose
files changed since approval*; a content/staleness baseline addresses that directly and is what spec 025's
CAS check needs to stat the right path. This also fills the spec-017 `approved_mtime`/`approved_size_bytes`
gap.

**Alternatives**: (a) HMAC over the plan with a per-install secret — rejected, no adversary; secret storage
is new attack surface; (b) plain token equality with no baseline — rejected, that's today's bug (stale plans
apply); (c) re-hash full file contents at apply — rejected, violates "lazy/optional hashing" for large files.

---

## D8 — Path resolution & symlink policy (FR-001/FR-002; the US1 core)

**Decision**: Introduce a single resolution gate in front of every executor op:
1. Join the item's relative path onto its **registered library root**, then normalize **lexically**
   (no `std::fs::canonicalize`, which would resolve/permit symlinks and is forbidden for scans by the
   Product Constraints). Use a lexical clean (`..`/`.` collapse) — the repo already avoids canonicalize.
2. **Refuse** if the normalized path escapes the root prefix (root-escape).
3. **Refuse** if any path component is a symlink/junction (lstat each component) unless link-following is
   explicitly enabled for that root/op. This satisfies "never follow links unless explicitly enabled."
4. Then the staleness baseline check (D7), then the no-overwrite check (existing, keep).

**Rationale**: Lexical normalization + per-component lstat enforces the root boundary without resolving
links (which the constitution forbids by default). This is the §II promise the validation found missing at
`plan_apply.rs:173`.

**Alternatives**: (a) `std::fs::canonicalize` — rejected, follows symlinks and resolves junctions, violating
the no-follow constraint; (b) `dunce`/`path-clean` crates — the audit found the repo deliberately hand-rolls
sanitize with `unicode-security`; a small lexical-clean helper fits better than a new dep. Keep hand-rolled
sanitize; add only the root-join+escape+lstat gate.

---

## D9 — Destructive-confirm signal separate from protection (FR-003; fixes the :199 inversion)

**Decision**: Add an explicit `requires_destructive_confirm: bool` (or equivalent signal) to the plan item,
derived from the **action type** (delete/trash ⇒ true), **independent** of `is_protected`. The executor
refuses to apply a destructive item until its destructive-confirm is satisfied; protection status is a
*separate* gate (D2/US4). Replace the `confirm_required = is_protected` line (`plan_apply.rs:199`).

**Rationale**: The two concepts answer different questions ("is this destructive?" vs "is this source
protected?"). Conflating them mis-gates both (a non-protected delete is wrongly cleared; a protected item
wrongly proceeds). Separating them is the correctness fix.

---

## D10 — Dead dependency removal & artifact-watcher debounce

**Decision**: Remove `@tanstack/react-table` and `@uiw/react-md-editor` (declared, zero imports). For the
artifact watcher (FR-009), wrap `notify` with **`notify-debouncer-full` 0.7.x (MIT OR Apache-2.0)** to
coalesce Create/Modify bursts (editor/tool saves fire multiple events), keeping the event bus from storming.

**Rationale**: Removing unused deps reduces bundle and audit surface ("deliberate dependencies"). The
debouncer is a small, well-scoped addition that prevents a real burst problem; it is optional and may be
deferred if a simpler in-loop debounce suffices — recorded as a low-risk choice.

**Alternatives**: keep raw `notify` + hand-rolled debounce — acceptable fallback if the dep is unwelcome;
noted as the secondary option.

---

## D11 — Real-backend headless e2e harness (FR-034; US9)

**Decision**: Drive the real Tauri app via **`tauri-driver` + `WebKitWebDriver` (W3C WebDriver) under
`xvfb`**, with `VITE_USE_MOCKS=false` and a throwaway SQLite db path (deleted between runs for first-run
scenarios). Co-locate with the existing Playwright setup under `apps/desktop/e2e/`; mocks-UI e2e stays on
Playwright. The harness must run deterministically with no human steps (FR-034) and is scaffolded by the
in-flight test-catalog effort.

**Rationale**: This is the only layer that exercises real Rust IPC + SQLite end-to-end and proves the
background features actually fire (SC-003) — the gap green unit tests missed. xvfb + webkit2gtk are
confirmed working in this environment.

**Alternatives**: mocks-only e2e — rejected, can't prove real-data behavior; Windows-only manual — that's
the runbook (US9 part 2), not reproducible/automated.

---

## Decision summary (for tasks.md traceability)

| ID | Decision | Drives FR |
|----|----------|-----------|
| D1 | Destructive destination = `archive` \| `trash`; permanent delete is a gated action, not a destination | FR-038, FR-006 |
| D2 | `projects.lifecycle` canonical; migrate + drop `project.state` | FR-019, FR-021 |
| D3 | 013 closed slug enum canonical; 014 conforms + hard-fails unknown | FR-029, FR-027 |
| D4 | Adopt `trash` 5.2.x for OS trash; archive fallback recorded | FR-006 |
| D5 | Adopt `minisign-verify` 0.2.x; verify signature, hard-fail invalid | FR-026 |
| D6 | `react-joyride` ^3.1.0 render layer + new event→advance subscriber | FR-010, FR-011 |
| D7 | CAS token + approval-time staleness baseline (mtime/size); no HMAC | FR-003, FR-007 |
| D8 | Root-join + lexical-normalize + escape refusal + per-component lstat (no canonicalize) | FR-001, FR-002 |
| D9 | Explicit destructive-confirm signal independent of protection | FR-003 |
| D10 | Remove dead deps; debounce artifact watcher | FR-009, FR-033 |
| D11 | Real-backend e2e via tauri-driver/WebKitWebDriver under xvfb | FR-034 |

No NEEDS CLARIFICATION remain.
