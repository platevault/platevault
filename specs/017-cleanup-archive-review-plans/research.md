# Research: Cleanup And Archive Review Plans

**Feature**: 017-cleanup-archive-review-plans  
**Date**: 2026-05-20  
**Status**: Decisions recorded against the existing mockup implementation.

## 1. Plan review UX

**Question**: What review surface gives users enough context to safely approve
destructive filesystem work without overwhelming them?

**Options considered**:

- **A. Single list with inline action buttons.** Familiar, but obscures
  per-item context and makes "review before approve" feel optional.
- **B. List + dedicated detail page with two-pane review (items + per-item
  detail).** Forces the user through a context-rich page before any approval.
  Higher click cost but matches the safety story.
- **C. Modal review on top of the list.** Good for short plans, poor for
  thousand-item restructure plans because modals constrain viewport.

**Decision**: **B.** The mockup already ships option B with a left items table
and a right detail pane showing source, destination, action, reason,
protection, linked records, and provenance.

**Rationale**: The constitution requires reviewable mutation; a dedicated
detail page is the only option that scales to large item counts and gives the
detail pane room to show provenance and protection state.

## 2. Retry semantics for failed plans

**Question**: When a plan ends in `failed` or `partially_applied`, should
retry mutate the parent or create a new plan?

**Options considered**:

- **A. In-place reset.** Cheaper UI, but obliterates the audit story: the
  parent plan's history is overwritten or lost.
- **B. New plan referencing the parent by id.** Each attempt has its own
  audit trail; the parent stays terminal and immutable.
- **C. Sub-plan nested under the parent.** Mirrors retry attempts as children,
  but doubles the data model (plans + sub-plans) for marginal value.

**Decision**: **B — retry is a new plan with `parentPlanId`.**

**Rationale**: Spec 002 §2.2 already commits to "retry plan is a NEW plan"
and the mockup mirrors this with the "Generate retry plan for failures" CTA.
This keeps each apply attempt audit-immutable and lets the list show retry
chains by following parent links.

**Retry default** (R-Retry-1): Default retry filter is `failed`. For
`cancelled` plans, the UI provides two separate explicit CTAs: "Retry failed"
and "Retry cancelled" (each filters server-side). No auto-bundling of failed
+ cancelled items.

**Retry chain UI** (R-Chain-1): Retry chain displays as a flat
`parentPlanId` link in the plan detail header (e.g. "Retry of Plan #42 —
partially_applied"). The parent plan shows "→ Retried as Plan #43 —
applying". Bidirectional via shared `parentPlanId`. No tree widget in v1.

## 3. Cancellation semantics with partial progress

**Question**: When the user cancels an `applying` plan that has already
applied some items, what state does the plan end in and what happens to the
applied items?

**Options considered**:

- **A. Cancel implies rollback.** Reverse every applied item. Maximises user
  surprise minimisation, but introduces a second mutation engine and risks
  cascading rollback failures.
- **B. Cancel halts forward progress; applied items stay applied; plan moves
  to `cancelled`.** The plan ends with a partial-progress record but no
  rollback. Retry path uses the same "new plan referencing parent" flow.
- **C. Cancel halts and forces the plan to `partially_applied`.** Conflates
  "user cancelled" with "executor reported partial failure".

**Decision**: **B.** Cancellation is a forward-progress halt. Applied items
remain applied; pending items remain pending; the plan transitions to
`cancelled`. Retry handles recovery.

**Rationale**: Rollback is its own destructive operation that needs its own
plan and approval gate. Conflating it with cancellation would smuggle
destructive work past the approval gate. Distinct `cancelled` and
`partially_applied` states preserve audit fidelity.

**Coordination with spec 025**: The apply executor is the only writer of
`cancelled`. The review surface only exposes the Cancel button while the plan
is `applying`.

## 4. Archive versus trash by platform

**Question**: For destructive plan items in v1, do we use platform trash, an
app-managed archive folder, or permanent delete?

**Decision** (R-Trash-1 — OVERRIDE of prior "OS trash deferred"):
**Both `archive` and `os_trash` are available in v1.** The user picks the
destructive destination per cleanup plan at plan-review time. The choice is
per-plan, recorded as `destructiveDestination` on the Plan entity. Default
is `archive`.

- **`archive`** (default): app-managed folder under
  `<library_root>/.astro-plan-archive/<planId>/<relative_source_path>`.
  Conflict naming: append `.<n>` before extension. The archive folder is
  filesystem-visible and appears in spec 016 protected categories by default.
  Per-plan subfolders enable bulk operations (R-Archive-2).
- **`os_trash`**: uses OS-native recycle bin per platform:
  - Windows: `IFileOperation::DeleteItem` with `FOFX_RECYCLEONDELETE`.
  - macOS: `NSFileManager.trashItem(at:resultingItemURL:error:)`.
  - Linux: freedesktop trash spec / `gio trash` (XDG `$XDG_DATA_HOME/Trash`).
  - Recommended Rust crate: `trash` (cross-platform abstraction).
- **Permanent delete** of original paths remains deferred past v1. The
  `archive.permanently_delete` contract covers only the app's own archive
  subfolder after archiving (R-Archive-2).

**Error codes added** (for `os_trash` path): `os_trash.unavailable`
(platform API not supported), `os_trash.full`, `os_trash.permission.denied`.

**Rationale**: Constitution principle II prefers archive workflows. An
app-managed archive is reviewable, predictable, and reversible. OS trash is
now also available as a convenience for users who prefer it, since the `trash`
Rust crate provides reliable cross-platform semantics including external
drive support on all three target platforms.

## 5. Dry-run preview

**Question**: Do plans need a separate "dry-run" mode beyond the existing
review state?

**Decision**: **No separate dry-run.** The review state already represents a
dry run — items show source, destination, action, and reason without
mutation. A second "dry-run apply" mode would duplicate the review surface
and confuse the state machine.

**Rationale**: The review state is the dry run. Adding a parallel mode
multiplies states without adding safety.

**Future note**: If users ask for execution simulation (timing, conflict
detection at apply time), that belongs in spec 025 as a `preflight` phase
inside `applying`, not as a new review-side state.

## 6. Multi-origin plan ordering

**Question**: When the list contains plans from multiple origins (inbox,
restructure, cleanup, archive, project source-map) in mixed states, what is
the default ordering?

**Options considered**:

- **A. Strict creation-order descending.** Familiar but buries failures.
- **B. Failed-first, then creation-order.** Surfaces the most attention-worthy
  plans at the top.
- **C. Grouped by origin.** Helpful for power users but adds visual
  complexity; users with mostly one origin lose the failure signal.

**Decision**: **B — failed-first ordering as the default**, with creation-time
descending as the secondary sort.

**Rationale**: A failed plan needs attention before any new draft; surfacing
failures by default makes the "Generate retry plan" CTA discoverable. Origin
grouping is available via the origin filter rather than as the default sort.

**Implementation evidence**: The mockup's `PlansListPage` already implements
failed-first ordering and exposes state and origin filters.

## 7. Concurrent reviewers

**Question**: What happens if two windows attempt to approve or discard the
same plan?

**Decision**: The plan state is the source of truth; the review use cases
perform a state-precondition check (`plan.invalid_state`) and reject the
second call. The audit log records both attempts.

## 8. Resolved + open summary

Resolved:

- Two-pane review surface (Q1).
- Retry = new plan with `parentPlanId` (Q2).
- Retry default = `failed`; cancelled plans get separate CTAs (R-Retry-1).
- Retry chain UI = flat `parentPlanId` link, no tree widget in v1 (R-Chain-1).
- Cancel = halt without rollback; distinct from partial-applied (Q3).
- Archive folder + OS trash both available in v1; per-plan choice
  `destructiveDestination` (R-Trash-1 — OVERRIDE of "OS trash deferred").
- Archive location: `<library_root>/.astro-plan-archive/<planId>/` (R-Archive-1).
- Archive management: `archive.send_to_trash` + `archive.permanently_delete`
  per plan; `permanently_delete` requires `confirmText: "DELETE"` (R-Archive-2).
- No separate dry-run state (Q5).
- Default ordering: failed-first, then creation-time descending (Q6).
- Concurrency: state-precondition rejects the loser (Q7).
- `discarded` state: soft-delete terminal; row retained; `parentPlanId`
  resolvable (A5).
- `itemsSkipped` + `itemsCancelled` counters; invariant updated (A3).
- `totalBytesRequired` pre-flight field; plan generation fails if insufficient
  space (A4).
- Per-item FS revalidation (`approvedMtime`/`approvedSizeBytes`) replaces TTL;
  stale mismatch → `item.stale` → run pauses (R-FS-1, A2).
- Approval token: HMAC over `(planId, contentHash, approvedAt, serverSecret)`;
  single-use; no time-based TTL (A1).
- Event bus topics: `plan.approved`, `plan.discarded`, `plan.cancelled` (A7).
- Universal camelCase + `contractVersion` + `requestId` envelope (R-Env-1).
- Plan list age cutoff: 90 days default from settings, configurable (R-Ret-1).

Open:

- None remaining for spec 017 after this revision pass.

## 9. Plan list age cutoff (R-Ret-1)

**Decision**: The UI default list view hides terminal plans older than
`settings.plans.list.default_age_cutoff_days` (default 90 days). User can
override via Settings or a filter chip. Value `0` means show all.

**Settings follow-up (NOT edited here)**: Spec 018 must add key
`plans.list.default_age_cutoff_days: number (default 90, 0 = show all)`.
This is flagged as a spec 018 follow-up.

**Contract impact**: `plan.list.json` `request` adds optional `createdAfter:
rfc3339`; server derives the default cutoff from the settings value when the
caller omits it.
