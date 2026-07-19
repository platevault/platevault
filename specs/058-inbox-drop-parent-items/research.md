# Research: Inbox — Drop Parent Items

**Feature**: 058-inbox-drop-parent-items

**Created**: 2026-07-19

**Base commit**: `22f94a9e`

All line references were re-verified against `22f94a9e` on 2026-07-19, after
three relevant merges:

- **`b4e72263` (#1081)** — landed, so `exclude_split_placeholder!` now exists on
  `main` and the predicate is no longer triplicated inline (§2).
- **`22f94a9e` (#1086)** — closed #711 **Instance B** by re-checking the
  mandatory-attribute gate before promoting a sentinel-carrying row. Narrows
  this feature's claim to Instance A, and sharpens §4.4 / Q-7.
- **`1eae04e9` (#1038)** — already accounted for.

## 1. Root cause of #711

### The unconditional split

`classify()` calls `materialize_sub_items` for every source-group-backed item:

- `crates/app/inbox/src/classify.rs:433` — the gate is
  `item.source_group_id.as_deref().filter(|_| item.state != "plan_open")`.
- `crates/app/inbox/src/classify.rs:435` — the call.

The gate tests only for *having a source group* and *not being plan-open*.
**There is no condition on the folder actually being mixed.** A homogeneous
folder therefore produces the parent row *and* one child, which is the premise
#1038 got wrong and #1081 had to narrow.

The `plan_open` exclusion is itself a legacy shim: migration 0049 stamps every
pre-existing row with a `sg-migrate-*` source group unconditionally, so without
the state check a legacy plan's 1:1 link to its item would be re-split out from
under it (documented in the comment at `classify.rs:423-433`). Under D-004 this
shim has no reason to exist.

### The false statement

- `crates/app/inbox/src/classify.rs:458` — `update_inbox_item_scan` writes the
  recomputed **folder** signature onto the parent.
- `crates/app/inbox/src/classify.rs:467` — `update_inbox_item_state(...,
  "classified")` sets the parent's state.

`update_inbox_item_state` updates state and nothing else. The parent is left
with `group_key = ''` and `frame_type = NULL` while its state now reads
`classified`. The list badge reads those fields and reports them faithfully.

This is #711 Instance A: the row is not mis-rendered, the row is false.

Instance B is the mirror — a `__needs_review__` sibling and the parent coexist
on the same physical file, distinguished only by group key, and the list picks
the wrong projection for the badge.

### Confirmation from the fix history

- PR #1038 (`1eae04e9`) hid the parent whenever **any** sibling existed. Because
  the split is unconditional, this fired for ordinary folders too. For a
  homogeneous folder the parent is the row the user selects, confirms, and that
  plans bind to, so hiding it broke selection cleanup and the open-plans surface
  simultaneously. Three Real-UI journeys failed; roughly nine PRs were blocked.
- PR #1081 narrowed the predicate to a genuine split (two or more distinct
  sibling group keys). Its own follow-up section states #711 stays open and that
  fixing it properly "means making sub-items authoritative in the confirm/plan
  path … not hiding the row the workflow still depends on."

## 2. Read-side machinery to be removed

The #1038 predicate — `group_key = '' AND source_group_id IS NOT NULL AND
EXISTS (sibling with non-empty group_key)`, narrowed by #1081 to a genuine
split — now lives in one macro with four call sites:

| Location | Query |
|---|---|
| `crates/persistence/db/src/repositories/inbox.rs:1494` | `exclude_split_placeholder!` definition (compile-time literal, because sqlx 0.9 rejects runtime-built SQL) |
| `crates/persistence/db/src/repositories/inbox.rs:1788` | `list_unacknowledged_across_roots` (the Inbox list) |
| `crates/persistence/db/src/repositories/inbox.rs:1565` | `inbox_stats` |
| `crates/persistence/db/src/repositories/inbox.rs:1603` | `count_distinct_inbox_folders` |
| `crates/persistence/db/src/repositories/q_desktop.rs:184` | `count_unacknowledged_inbox_items` — **the fourth site, in a different file**, reached via the import at `q_desktop.rs:13`. Added when #1092 merged, after this table was first written |

**Note the file split.** Three sites live in `repositories/inbox.rs`; the fourth
lives in `repositories/q_desktop.rs`. There is also an
`apps/desktop/src-tauri/src/commands/inbox.rs` — a *different file with the same
basename* that contains none of them. Grep the macro name tree-wide rather than
searching "inbox.rs".

Under this feature the macro and all four call sites are deleted outright
(plus the `q_desktop.rs:13` import). Deleting three of the four leaves SC-004
failing while every static check still passes.
rather than corrected: with no aggregate row there is nothing to suppress
(FR-026, SC-007).

**Pre-existing inconsistency, fixed for free**: `count_unacknowledged_inbox_items`
at `crates/persistence/db/src/repositories/q_desktop.rs:171-179` has **no**
dedup clause at all, so the status-bar badge already counts the parent *and* its
siblings. Removing the parent removes this divergence without a targeted fix.

Tests that become vacuous and should be deleted with the predicates:

- `crates/persistence/db/src/repositories/inbox.rs:2241-2360`
  (`list_unacknowledged_hides_superseded_placeholder_711`)
- `crates/persistence/db/src/repositories/inbox.rs:2366-2447`
  (`..._keeps_processed_folder_placeholder_hidden_711`)
- `crates/persistence/db/src/repositories/inbox.rs:2451-2586` (stats/list dedup)
- `crates/persistence/db/src/repositories/q_desktop.rs:282-345`
  (`inbox_folder_placeholder_round_trips`)

## 3. What already exists (verified)

- **`inbox_source_groups` already holds folder-level identity.** Confirmed:
  `root_id`, `relative_path`, `content_signature`, `format`, `lane`. The parent
  row duplicates all of it. Upsert conflict target is
  `(root_id, relative_path)` — `inbox.rs:281-306` — refreshing the signature on
  re-scan while preserving `discovered_at`.
- **Migration 0049's stated invariant.** `0049_inbox_single_type.sql:292` —
  "Each distinct (root_id, relative_path) in inbox_items → one source group."
  Item identity became `(root_id, relative_path, group_key)` (`:59`, `:113`).
- **Siblings already carry the linkage.** Materialized items already hold both
  `source_group_id` and `group_key`, so the mechanism this feature needs exists.
- **Sibling coexistence at one path is already supported.** The UNIQUE triple
  `(root_id, relative_path, group_key)` is exactly what lets the parent
  (`group_key = ''`) and a child coexist today — `crates/persistence/db/src/lib.rs:246-312`
  is a schema test asserting two sub-items in one folder are admissible.
- **Plans already bind per item, not per folder.** `inbox_plan_links` has
  `inbox_item_id` as its primary key (`migrations/0020_inbox.sql:105-117`).

The consequence is that the target model needs **no new structural concept** —
it is reachable by deleting the parent and moving the write path, not by adding
machinery.

`group_key TEXT NOT NULL DEFAULT ''` (`0049:89`) is a hazard worth flagging: any
row inserted without an explicit group key silently becomes a "placeholder"
under the current predicates. Master items do exactly this
(`q_desktop.rs:36`, `q_core.rs:829`, `lib.rs:181`).

## 4. Call sites that assume a parent exists

### 4.1 The parent write path — deleted wholesale

| Location | Assumption |
|---|---|
| `apps/desktop/src-tauri/src/commands/inbox.rs:392-454` | `persist_folder_placeholder` — the entire one-row-per-folder write path: invents an item id, inserts the parent, backfills the source-group link, re-reads it, returns exactly one item summary per folder |
| `apps/desktop/src-tauri/src/commands/inbox.rs:369` | its only call site (scan-folder) |
| `apps/desktop/src-tauri/src/commands/inbox.rs:44-48` | the imports of the placeholder helpers |
| `crates/persistence/db/src/repositories/q_desktop.rs:24` | `insert_inbox_folder_placeholder` |
| `crates/persistence/db/src/repositories/q_desktop.rs:57` | `InboxPlaceholderRow` |
| `crates/persistence/db/src/repositories/q_desktop.rs:72` | `get_inbox_placeholder_row` — selects by `group_key = ''`; the **only** way scan reads back "the" row for a folder |
| `crates/persistence/db/src/repositories/inbox.rs:321` | `link_placeholder_to_source_group` — `UPDATE … WHERE root_id=? AND relative_path=? AND group_key=''` |

`InboxScanFolderResponse.items` is one-row-per-folder **by construction**
(`commands/inbox.rs:441-453`). Under the new model scan must either return N
items or defer item creation to classification — a design question for the plan
gate (Q-4).

### 4.2 Confirm — already per-item, one coupling

`crates/app/inbox/src/confirm.rs` operates strictly on `req.inbox_item_id`. It
never resolves a folder. **It is already sibling-safe.**

| Location | Note |
|---|---|
| `confirm.rs:142` | loads the item by request id — whatever row the UI selected |
| `confirm.rs:162` | open-plan dedupe via `get_plan_link(inbox_item_id)` — per row |
| `confirm.rs:174` | the one `group_key` read, testing the `__needs_review__` sentinel — orthogonal to `''` |
| `confirm.rs:198` | **the parent-coupled part** — TOCTOU signature guard, see below |
| `confirm.rs:215` | requires `classification.result == "classified"`; already expects a single-type row |
| `confirm.rs:225` | evidence enumerated by item id |
| `confirm.rs:605` | `insert_plan_link(req.inbox_item_id, plan_id)` — per item |
| `confirm.rs:2353` | test helper whose item defaults to `group_key = ''`; encodes the parent assumption |

The important finding: **confirm and plan linkage do not need restructuring**.
They already key on whatever item id they are given. What changes is *which id
the UI hands them* — today the parent's, for a homogeneous folder. This narrows
the change surface considerably.

The signature guard at `confirm.rs:198` compares `item.content_signature` to the
request's. For a parent that is the folder signature written by scan/classify;
for a sibling it is the per-group signature from `materialize_sub_items`
(`classify.rs:935`, `:959`).

**Corrected (was wrong in the original draft, and the same error was stated in
two `reclassify.rs` comments).** Reclassify did not write an *empty* signature.
Passing no file paths produced `folder_signature(vec![])` — the SHA-256 of empty
input, the fixed 64-char constant `e3b0c442…b855`. Every item that had been
through `reclassify_v2` carried that identical value, in every folder and every
library, so the guard compared equal unconditionally and could never fire — it
would also have compared equal between two entirely unrelated items. That was a
live hole, not a latent one, and it did not depend on the parent row.

Because the value was never empty, an "empty means stale" rule was never
implementable as an emptiness check — which is why Q-5 was not resolved that
way.

Resolved ahead of this spec along Q-5's first option: `reclassify_v2` now takes
`rootAbsolutePath` (matching `inbox.classify`) and computes real per-group
signatures. With the parent gone the per-group signature becomes the sole
confirm anchor, which is now a genuine anchor. Q-5 is answered for the guard
itself; the D-005 re-scan invalidation signal it was coupled to remains open.

### 4.3 Source-group-to-item resolution

| Location | Assumption |
|---|---|
| `crates/app/inbox/src/target_recommendations.rs:227-231` | `resolve_item_id` takes `ids.into_iter().next()` — an arbitrary id-ordered row, today usually the parent. **Latent bug now, ambiguous by design after the change** |
| `crates/persistence/db/src/repositories/inbox.rs:1451-1466` | `list_item_ids_for_source_group` returns all rows including the parent |
| `crates/app/inbox/src/reclassify.rs:333-360` | resolves the source group from the request or from the item id |
| `crates/app/inbox/src/reclassify.rs:347-360` | blocks reclassify if **any** sibling has a plan link — a shared-lifecycle coupling that D-003 contradicts (Q-6) |
| `crates/app/inbox/src/reclassify.rs:389-400` | prefers `list_inbox_sub_items` over the full id set *only* to avoid double-counting the parent's duplicate evidence; falls back to the full set when nothing is materialized. This fallback exists solely for the parent and dies with it |
| `crates/app/inbox/src/reclassify.rs:448-450`, `:697-699` | same double-count avoidance |
| `crates/app/inbox/src/cone_search.rs:513-540` | per-file target overrides scoped to the source group — folder-scoped by intent, still correct, but re-check once parent evidence disappears |
| `crates/persistence/db/src/repositories/inbox.rs:639` | `list_inbox_sub_items` filters `group_key != ''` to exclude the parent — the filter becomes unnecessary |

### 4.4 The needs-review sentinel workaround

`crates/persistence/db/src/repositories/inbox.rs:585-598` — `clear_needs_review_sentinel`
rewrites the group key in place to a synthetic `type=<ft>·resolved=<item_id>`
value, explicitly to dodge the `(root_id, relative_path, group_key)` UNIQUE
against a sibling already materialized for the folder (comment at `:576-581`).

This exists because reclassify v1 mutates a row in place instead of re-splitting.
The synthetic key is a per-row uniqueness hack, not a classification identity —
worth revisiting under the new model rather than carrying forward (Q-7).

### 4.5 Re-scan and content signature

| Location | Note |
|---|---|
| `crates/app/inbox/src/scan.rs:315-353` | one scanned item per leaf folder with one folder-level signature (`signature.rs:86`) |
| `apps/desktop/src-tauri/src/commands/inbox.rs:331` | folder signature written to `inbox_source_groups.content_signature` — **survives the parent's removal; this is the natural new anchor** (FR-019) |
| `apps/desktop/src-tauri/src/commands/inbox.rs:415` | the same signature also written to the parent row — deleted |
| `apps/desktop/src-tauri/src/commands/inbox.rs:448` | the signature returned to the UI is read back **from the parent**, and the UI later echoes it into confirm — this path must be re-sourced |
| `crates/app/inbox/src/classify.rs:930-935`, `:959` | per-group signature from per-file hashes — the real per-row anchor |
| `crates/persistence/db/src/repositories/inbox.rs:501-546` | `upsert_inbox_sub_item` conflicts on `(root_id, relative_path, group_key)`; re-scan stability rests on the group key, **not on any parent row** |
| `crates/persistence/db/src/repositories/inbox.rs:610-619` | `delete_sub_item_if_unlinked` refuses to purge a plan-linked row; with no parent, a plan-linked stale group can no longer hide behind one (Q-2) |
| `crates/app/inbox/src/reclassify.rs:820-831` | **Fixed on `main` by #1105 (`038781e2`).** Formerly passed `&[]` for file paths, making the per-group signature `folder_signature([])` — the empty-set hash constant, **not** an empty string — which rendered the confirm guard vacuous. Now joins `req.root_absolute_path` per file (`:827`). Retained here because §4.2 and Q-5 describe the defect, not the fix |

### 4.6 Materialization

- Definition: `crates/app/inbox/src/classify.rs:870` (docs `:851-868`).
- Caller A: `classify.rs:433-445` — identity (`root_id`, `relative_path`,
  `lane`) is read **off the parent** at `:438-440`.
- Caller B: `crates/app/inbox/src/reclassify.rs:845-855` — identity comes from
  the source-group row instead (`:637-663`). **This is the pattern the
  parent-free model should generalize to** — reclassify already does it right.
- Stale-group purge: `classify.rs:994-1001` uses `list_inbox_sub_items`, which
  filters `group_key != ''`, so the parent is structurally exempt from purging.
- `classify.rs:1003` — `child_count = groups.len()`, excludes the parent.

### 4.7 Frontend

The frontend has **no** empty-group-key special-casing. It treats every returned
row as a real item, which means it is already largely compatible with the target
model. Findings are couplings and stale rationales, not filters.

| Location | Note |
|---|---|
| `apps/desktop/src/features/inbox/InboxList.tsx:65` | the only production `groupKey` read — `=== '__needs_review__'`. Untouched unless the sentinel moves to its own field |
| `apps/desktop/src/features/inbox/InboxPage.tsx:1159` | `key={selectedItem.sourceGroupId ?? selectedItem.inboxItemId}` remounts the detail panel per source group; its 16-line comment (`:1140-1158`) is premised on parent-purge and goes stale, though the key is still needed for re-split churn |
| `apps/desktop/src/features/inbox/InboxPage.tsx:319-326` | `useStaleSelectionCleanup` — clears the URL selection when the selected id leaves the list, with no path-based fallback. This is one of the two surfaces #1038 broke (FR-023) |
| `apps/desktop/src/lib/use-stale-selection.ts:14-31` | the generic hook; clears once per stale id |
| `apps/desktop/src/features/inbox/InboxPage.tsx:100-113` | `pickReclassifyTarget` picks one post-split target by largest file count; returns null when all siblings are needs-review |
| `apps/desktop/src/features/inbox/InboxPage.tsx:141-153` | `resolveReclassifyHandoff` gives up when the pending id is absent |
| `apps/desktop/src/features/inbox/InboxPage.tsx:832-841` | `canConfirm` requires `classification.type === 'single_type'`. The parent is exactly the row that classifies `mixed`. **Whether the `mixed` branch becomes dead code is a planning question** — with it, `handleConfirm`'s guard (`:607`), the root-pick guard (`:691`), `InboxDetail.tsx:1037-1048` (`inbox-mixed-alert`) and `mixedSummary` (`:842-843`) |
| `apps/desktop/src/features/inbox/InboxPage.tsx:1014-1015` | "Review plans" visibility driven by the plan surface, not list rows; per-plan keying at `:908-915`, `:939-941`. A folder yielding N items produces N plans and N summary lines instead of one |
| `apps/desktop/src/features/inbox/inboxStatsFromItems.ts:83-90` | counts one folder per non-master item; its docstring (`:7-14`) claims "each inbox folder is counted exactly once" — **already false** whenever a folder has siblings, and normal after this change (FR-009) |
| `apps/desktop/src/features/inbox/InboxPage.tsx:973-974` | same per-row counting feeding the top bar and status bar |
| `apps/desktop/src/features/inbox/InboxList.tsx:165-167` | `detectionLabel` falls back to the root basename when the relative path is empty, so N siblings of a root-level folder render N identical Path cells — a **new UX problem** the model makes routine |
| `apps/desktop/src/features/inbox/InboxList.tsx:185` | sorts by relative path with no secondary key, so sibling order is unstable |
| `apps/desktop/src/bindings/index.ts:4794`, `:4805` | generated `groupKey: string`, non-nullable |
| `apps/desktop/src/api/mocks.ts:1744-1793` | all mock rows emit `groupKey: ''` — parent-shaped fixtures |
| `apps/desktop/src-tauri/src/commands/inbox.rs:524-570` | `inbox_list` projection passes group key and source group straight through; hardcodes `missing_mandatory: Vec::new()` (`:562`), which is why the sentinel is the list's only working needs-review signal |

`grouping_keys_for_items` (`inbox.rs:1857`) is **not** row synthesis — it is a
per-item aggregate over file metadata and needs no change. The #711 report's
suspicion that it synthesizes rows was incorrect; `persist_folder_placeholder`
is the actual source of the extra row.

### 4.8 Tests and fixtures encoding the parent

- `crates/app/inbox/src/reclassify.rs:1605`, `:1737`, `:1872`, `:1979-2030` —
  fixtures named `placeholder_id`, including a test asserting reclassify
  identified by the **folder placeholder**
- `crates/e2e-tests/tests/inbox_ui_journeys.rs:227`, `:281`, `:393-395` — a
  journey asserting "the placeholder row is purged and replaced by the
  materialized needs-review sub-item"
- `crates/app/core/src/inbox_plan.rs` — #1081's regression test
  `list_open_keeps_confirmed_placeholder_with_materialized_sub_item` is
  parent-shaped by construction and must be rewritten, not deleted: its
  *intent* (a confirmed item's plan stays on the open-plans surface) is exactly
  SC-005 and must survive
- Frontend fixtures at `__tests__/InboxPage.metadataGate.test.tsx:69`,
  `InboxPage.classify.test.tsx:270,288,353`, `inbox.crossRoot.test.tsx:49,68,87`,
  `InboxPage.destRootReset.test.tsx:63`, `inbox.wave3.test.tsx:51`,
  `InboxList.windowsSplitPayload.test.tsx:41`, `inboxStatsFromItems.test.ts:26`

## 5. Summary of the change surface

**Deleted**: the parent write path (§4.1), the three dedup predicates and
#1081's macro (§2), the `plan_open` re-split shim (§1), the `group_key != ''`
filter (§4.3), and the parent-shaped tests (§2, §4.8).

**Moved, not restructured**: which item id the UI selects and hands to confirm.
Confirm and plan linkage are already per-item (§4.2) — this is the single most
load-bearing finding, because it means the lifecycle path needs re-pointing
rather than redesign.

**Re-anchored**: the folder content signature moves to the source group, which
already has the column (§4.5).

**Generalized**: materialization should take its identity from the source group,
as reclassify already does, rather than from a parent row (§4.6).

**New questions**: sibling row presentation and stable ordering in the list
(§4.7) — the model makes N identical-looking rows routine, which was rare
before.
