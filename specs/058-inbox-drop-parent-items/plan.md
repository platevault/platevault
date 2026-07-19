# Implementation Plan: Inbox — Drop Parent Items

**Branch**: `spec/058-plan-gate` | **Date**: 2026-07-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/058-inbox-drop-parent-items/spec.md`

## Summary

An inbox folder currently produces a placeholder "parent" row alongside its real
items. `classify()` sets that row's `state` to `classified` while leaving its
`group_key` empty and `frame_type` null, so the list badge renders a false
statement that the database itself contains. Two read-side patches (#1038,
#1081) hid the symptom and traded one regression for another.

This feature removes the cause. A folder yields exactly one item when
homogeneous and N sibling items when mixed, linked as a set by
`source_group_id`, with no distinguished member. Scan creates the source group;
classification creates the items.

The change surface is narrower than "redesign". `confirm.rs` already operates on
a single `inbox_item_id` and never resolves a folder, and `inbox_plan_links`
already keys on `inbox_item_id`. Both are sibling-safe today. What changes is
*which id the UI hands them*, plus the deletion of the suppression predicates
that exist only to hide the aggregate row.

## Technical Context

**Language/Version**: Rust 1.75+ (workspace, 2021 edition); TypeScript 5.x /
React 19 for the desktop shell

**Primary Dependencies**: Tauri v2, sqlx (SQLite), tauri-specta (generated
bindings), TanStack Query + Router, Paraglide (i18n), thirtyfour +
tauri-driver (Layer-2 Real-UI E2E)

**Storage**: SQLite — canonical for metadata, relationships, lifecycle and
audit. Migrations under `crates/persistence/db/migrations/`.

**Testing**: `cargo nextest` (workspace + Layer-1 integration against real
SQLite and real migrations), `vitest` (desktop UI), `cargo nextest -p e2e_tests`
under `tauri-driver` + `xvfb` (Layer-2 Real-UI journeys)

**Target Platform**: Windows, macOS, Linux desktop (Tauri). macOS Real-UI E2E is
skipped in CI on a known upstream issue (#489).

**Project Type**: Local-first desktop application, Rust core + React shell,
language-neutral contracts between them

**Performance Goals**: No regression in Inbox list render or classify latency.
Removing the placeholder reduces row count; it must not introduce an N+1 query
per sibling in `inbox.list`.

**Constraints**: Greenfield per D-004 — no migration of existing parent+child
rows, and the accepted risk that v0.5.0 databases strand open inbox plans is
already recorded. No file content is read or written by this feature beyond the
signatures already computed at scan and reclassify.

**Scale/Scope**: 31 functional requirements, 12 success criteria, 4 user
stories. Change surface spans `crates/app/inbox`, `crates/persistence/db`,
`crates/contracts/core`, the desktop Inbox feature, and 5 Layer-2 journeys.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Verdict |
|---|---|---|
| **I. Local-First File Custody** | No image file is copied, moved or read by this feature. It changes how rows are derived from a scan, not where files live. Root and relative path remain modelled separately on the source group. | **PASS** |
| **II. Reviewable Filesystem Mutation** | Confirm still produces a reviewable plan before any mutation, and confirm's own logic is untouched. The feature *strengthens* this: a plan can no longer be built from a row that misreports its own classification. D-005 (invalidate a superseded sibling's plan) is a recorded decision here; its mechanism is descoped to the follow-on micro-spec, and the interim behaviour — the folder-wide interlock — is a refusal, not a silent mutation. | **PASS with recorded exception** — see Complexity Tracking |
| **III. PixInsight Boundary** | Nothing in this feature calibrates, registers, integrates or edits. It organises queue rows. | **PASS** |
| **IV. Research-Led Domain Modeling** | `research.md` documents the root cause with a call-site inventory read against `main`. Nine review questions were resolved and recorded with rationale and rejected alternatives before this gate. Two conclusions were corrected after Layer-2 verification rather than argued. | **PASS** |
| **V. Portable Contracts and Durable Records** | The contract change is additive on `InboxListItem` and the needs-review field (FR-028). SQLite remains the durable record; the source group remains the folder-level identity. No UI-only state is made canonical. | **PASS** |

**Product constraints check**: no eager hashing is introduced (Q-5's real
per-group signature landed separately in #1105 and reuses scan-time file
hashes); no symlink/junction traversal changes; protected categories and
cleanup exclusions are untouched.

### Post-Phase-1 re-check

To be completed after `data-model.md` and `contracts/` land. The specific thing
to re-check: whether FR-028's needs-review field is modelled as durable record
state (constitution V) or leaks into a presentation concern.

## Plan-gate decisions

The spec explicitly deferred three decisions to this gate. They are made here.

### PG-1 — FR-031: `mixed` is retired, not re-scoped

FR-031 requires the `mixed` affordance be retained "for as long as placeholder
rows exist", and notes that this feature is itself what makes it unreachable.

**Decision: retire it.** `mixed` is produced at `classify.rs:404` for a folder
whose files span two or more frame types, and it attaches to that folder's
**pre-materialization placeholder**. This feature deletes the placeholder, and
FR-017 replaces the source-group row with item rows the moment classification
completes. There is no surviving row for a `mixed` result to describe. The
Layer-2 route recorded originally — a needs-review item carrying conflicting
manual overrides — was refuted empirically: `seed_sub_item_cache` clears
`manual_override` from the evidence rows, so the distinct set is empty.

Retirement is therefore removal of dead code, not removal of an affordance a
user can reach. It carries one non-obvious cost, tracked as a task rather than
discovered later:

> `inbox_ui_mixed_folder_splits_into_single_type_items` waits on
> `inbox-mixed-alert` as its **proof-of-classify synchronisation signal** —
> not as an assertion about mixedness. Retiring the affordance without
> replacing that signal makes the journey hang rather than fail. The
> replacement signal must be the appearance of the split item rows
> themselves, which is what the journey actually cares about.

### PG-2 — The D-006 / E2E harness tension is resolved in the harness

FR-015/FR-016 say scan creates the source group and no inbox item, and that the
unclassified folder is visible as a source-group row. `spec.md:349-351` says
that row must not be confirmable. Two harness helpers contradict this:
`rescan_and_wait_for_item` waits for an `inbox-item-*` testid immediately after
scan, and `select_only_item` clicks the first such row **and then waits for
`inbox-confirm-btn` to mount**.

**Decision: the helpers change, the product requirement stands.** A
source-group row must not be confirmable — making it confirmable to satisfy a
test helper would reintroduce exactly the "act on the folder as a whole"
semantics this feature removes. The helpers split into two:

- select the source-group row after scan, asserting Confirm is **absent**
- select an item row after classification, asserting Confirm is present

Five journeys call these, including all three SC-005 journeys. This is
mechanical but not trivial, and it must land in the same change as FR-015/016
or CI goes red for the wrong reason.

### PG-3 — Both plan interlocks are in scope for *documentation*, neither for removal

`reclassify.rs:347-360` refuses when any sibling has an open plan.
`classify.rs:433` additionally filters `source_group_id` on
`state != 'plan_open'`, so the scan/classify path *also* refuses re-derivation
for plan-open items. The second was undocumented until this gate.

**Decision: neither is removed here.** Removing them requires D-005's
invalidation path, which is descoped to the follow-on micro-spec. This plan
records both, and the follow-on's requirement 3 is now known to cover two sites
rather than one. Removing only the first would leave the requirement unmet
while appearing done — the failure mode this gate exists to prevent.

## Project Structure

### Documentation (this feature)

```text
specs/058-inbox-drop-parent-items/
├── plan.md                      # This file
├── spec.md                      # Feature specification (merged)
├── research.md                  # Root cause + call-site inventory (merged; extended by this gate)
├── PENDING_REVIEW_QUESTIONS.md  # Nine questions, all resolved (merged)
├── data-model.md                # Phase 1 output
├── quickstart.md                # Phase 1 output
├── contracts/                   # Phase 1 output
└── tasks.md                     # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
crates/
├── app/inbox/src/
│   ├── classify.rs          # materialization gate (:433 interlock, :404 mixed,
│   │                        #   :467 the false state write), seed_sub_item_cache
│   ├── reclassify.rs        # v1 per-item, v2 group-scoped; sentinel clearing
│   ├── confirm.rs           # already single-item; staleness guard (unchanged)
│   ├── metadata.rs          # compute_missing_mandatory
│   ├── plan_listener.rs     # event-driven pattern the follow-on will extend
│   └── target_recommendations.rs  # resolve_item_id — ambiguous under this model (#1102)
├── persistence/db/src/repositories/
│   └── inbox.rs             # exclude_split_placeholder!, grouping_keys_for_items,
│                            #   list_unacknowledged_*, count_unacknowledged_*
├── persistence/db/migrations/   # FR-028 needs-review field
└── contracts/core/src/inbox.rs  # InboxListItem, reclassify/confirm requests

apps/desktop/
├── src-tauri/src/commands/inbox.rs   # command surface wiring
└── src/features/inbox/
    ├── InboxList.tsx        # classificationLabel, isNeedsReview, badge
    ├── InboxPage.tsx        # selection handoff (FR-023), mixed guards
    ├── InboxDetail.tsx      # needs-review section, property editor
    └── store.ts             # query keys + invalidation

crates/e2e-tests/tests/
├── common/mod.rs            # rescan_and_wait_for_item, select_only_item (PG-2)
└── inbox_ui_journeys.rs     # 5 affected journeys, incl. all 3 SC-005
```

**Structure Decision**: No new crate. This feature changes behaviour inside the
existing `app/inbox` and `persistence/db` boundaries and deletes read-side
predicates; it does not introduce a new responsibility that warrants its own
crate. The one structural addition is a migration for FR-028.

## Implementation phasing

Ordered by what unblocks what, not by layer.

1. **Needs-review gets its own field (FR-028/029/030).** Migration plus the
   write path. Independent of the placeholder work and cheapest now under
   D-004's greenfield licence — after a release it costs a real migration.
   `clear_needs_review_sentinel` writes `group_key`, `frame_type` and
   `state='classified'` as one transition; any replacement must preserve all
   three or it recreates FR-007's violation in a new location.
2. **Scan/classify boundary (FR-015/016/017)** together with the harness split
   from PG-2. These must land together.
3. **Stop creating the placeholder (FR-001–006)**, then delete the suppression
   predicates (FR-026, SC-007). Deleting the predicates before the placeholder
   stops being created would re-run the #1038 regression.
4. **Truthfulness and continuity (FR-007/008/009, FR-023)** — the badge, the
   counts, and the selection handoff across the source-group→items swap.
5. **Retire `mixed` (PG-1)** including the replacement E2E sync signal.
6. **Verification** — SC-001 through SC-012, with the three SC-005 journeys as
   the gate.

## Known costs and risks

| Risk | Detail | Mitigation |
|---|---|---|
| Harness assumes one selectable item per folder | 5 journeys, incl. all 3 SC-005 | PG-2; land with FR-015/016 |
| Deleting suppression too early | Reproduces #1038, which blocked ~9 PRs | Sequence per phase 3 |
| `mixed` sync signal | Journey hangs rather than fails | PG-1 names the replacement |
| `target_recommendations.resolve_item_id` | `ids.next()` has no defensible meaning with no parent | **#1102 is `phase:design` and unresolved — this feature makes it live.** Must be decided before phase 3 |
| Two interlocks, not one | Follow-on scope larger than recorded | PG-3 |
| `classify.rs:457` signature overwrite | Overwrites `content_signature` with the *folder* signature on every classify, so a per-group signature is transient | Recorded in `research.md`; must be reconciled if the per-group signature becomes the sole confirm anchor |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Constitution II — a folder-wide refusal survives this feature (both interlocks, PG-3) | Removing them without D-005's invalidation path leaves an item with an open plan describing files that no longer exist — a silently retained stale row, which is a worse Constitution II outcome than an explicit refusal | Building invalidation inside this feature was assessed and descoped: it needs a plan-cancellation path that `crates/app/inbox` cannot reach without either a new dependency edge on `crates/app/core` or an event-driven inversion. Recorded as the follow-on's owner-approved target rather than improvised here |

## Dependencies

- **#1105 (merged)** — Q-5's real per-group signatures. Plan around this as
  done; `reclassify_v2` already takes `rootAbsolutePath`.
- **#1102 (open, `phase:design`)** — must be decided before phase 3.
- **`specs/tiny/reclassify-split-per-item-and-rederivation.md` (merged)** —
  owns FR-020/021/022 and both interlocks. Gated on this feature's model.
- **#968/#994/#995/#997** — inbox file splits held by another lane. #968 is
  unblocked; #994 should sequence after #1126.
