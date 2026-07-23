# Tasks: Inbox — Drop Parent Items

**Spec**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Data model**: [data-model.md](data-model.md) · **Contracts**: [contracts/operations.md](contracts/operations.md)

## Format: `[ID] [P?] [Story] Description`

- **[P]** — parallelisable: different files, no dependency on an incomplete task
- **[US1]..[US4]** — maps to the user stories in spec.md. Setup, Foundational and Polish carry no story label.

## Path Conventions

Rust core under `crates/`, desktop shell under `apps/desktop/`, Layer-2 journeys
under `crates/e2e-tests/tests/`. Migrations in
`crates/persistence/db/migrations/`.

---

## Sequencing constraints — read before reordering anything

These are not stylistic. Each one has already cost this project a regression or
a wasted CI cycle.

1. **Suppression deletion comes AFTER the placeholder stops being created.**
   Deleting `exclude_split_placeholder!` while the placeholder still exists
   reproduces #1038, which blocked roughly nine PRs. T024 must not start before
   T020 is done.
2. **There are FOUR suppression call sites, not three.** `inbox.rs:1565`,
   `:1603`, `:1788` and `q_desktop.rs:184`. `research.md` says
   `count_unacknowledged_inbox_items` has no dedup clause and is "fixed for
   free" — that went stale when #1092 merged. Deleting three of four leaves the
   count inconsistent with the list and SC-004 failing.
3. **The harness split lands WITH the scan/classify boundary, not after.**
   T014–T016 and T012–T013 are one change. Splitting them turns CI red for a
   reason unrelated to the product change.
4. **Retiring `mixed` must replace the sync signal in the same task.**
   `inbox_ui_mixed_folder_splits_into_single_type_items` waits on
   `inbox-mixed-alert` as proof that classify ran server-side — not as an
   assertion about mixedness. Remove the affordance without replacing the
   signal and the journey **hangs for 20s and times out** rather than failing
   cleanly. That reads as a harness bug, not as your change.
5. **#1102 blocks Phase 5.** `resolve_item_id` picks an arbitrary sibling via
   `ids.next()`. With no parent row that has no defensible meaning. It is
   labelled `phase:design` and needs a product decision, not a code fix.

---

## Phase 1: Setup

- [X] T001 Create the feature branch from current `main` and confirm `specs/058-inbox-drop-parent-items/` carries spec, research, plan, data-model, contracts and quickstart — branch `spec/058-inbox-drop-parent-items` off `20bf710c`; all seven artifacts present
- [X] T002 Re-check the next free migration number in `crates/persistence/db/migrations/`. Highest on main is `0073`; open PR #1048 adds colliding `0072`/`0073` which must renumber upward. Do not assume `0074` is still free — **re-checked 2026-07-20 against `20bf710c`: main still tops out at `0073`, so `0074` is free. PR #1048 still claims `0072`/`0073` and must renumber to `0075`/`0076` regardless of merge order.**
- [X] T003 Resolve #1102 (`phase:design`) — decide what "the item for this folder" means for target recommendations once no parent exists. **Blocks Phase 5.** Record the decision on the issue before writing code — **DECIDED: per-sibling recommendations.** `SourceGroup` stops resolving to a representative item; a recommendation belongs to one `inbox_item_id`. `ids.next()` is deleted, not replaced with a better pick. Rationale on [#1102](https://github.com/platevault/platevault/issues/1102#issuecomment-5018415456). Phase 5 unblocked

### Requirements-quality gate (`/speckit.checklist`)

- [X] T003a Run the skipped requirements-quality gate → `checklists/requirements.md` (32 items). Editorial corrections applied to `spec.md`: feature-branch field `057`→`058`, FR-001 scoped to match FR-015's master carve-out, FR-031 updated to record PG-1's decision, SC-009 marked NOT-met in its own text so a completion sweep cannot tick it. Substantive gaps filed as [#1177](https://github.com/platevault/platevault/issues/1177) (D-004 precondition drift) and [#1178](https://github.com/platevault/platevault/issues/1178) (counts, selection, needs-review split, ordering). **#1178's CHK010 and CHK011 must be answered before T022 and T029 close**

---

## Phase 2: Foundational (blocking prerequisites)

Everything downstream depends on an item being able to state its own truth, so
the needs-review field and the scan/classify boundary land first.

### FR-028/029/030 — needs-review becomes its own field

- [X] T004 Add migration `0074_inbox_needs_review.sql` in `crates/persistence/db/migrations/`: `ALTER TABLE inbox_items ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1));`. Additive, metadata-only, **no backfill** — D-004 greenfield
- [X] T005 Extend `upsert_inbox_sub_item` in `crates/persistence/db/src/repositories/inbox.rs` to write `needs_review` alongside `group_key`, `frame_type` and `state` in the **same statement**, preserving FR-029's atomicity
- [X] T006 Route the sentinel-resolve path through materialisation rather than in-place rewrite, and **delete** `clear_needs_review_sentinel` (`crates/persistence/db/src/repositories/inbox.rs:~584-600`). Its uniqueness-discriminator role is removed, not replaced — two rows sharing a classification identity in one folder are the same item, and the existing `ON CONFLICT(root_id, relative_path, group_key)` already converges them
- [X] T007 [P] Narrow `group_key` to classification identity only in `crates/app/inbox/src/classify.rs` and `reclassify.rs`; stop writing `__needs_review__` and the synthetic `type=<ft>·resolved=<id>` key — **done**: `materialize_sub_items` now always runs `group_file` when a frame type is known, so a missing-mandatory file keeps its identity. ⚠️ **The original "the absent dimension renders as `SENTINEL_MISSING`, which is what keeps it distinct from a resolved sibling" justification was FALSE and caused a regression — corrected 2026-07-20.** `target` is mandatory for lights (`mandatory_set_for`) but `Dimension` (`grouping.rs:126-151`) has no Target variant, so OBJECT cannot influence the key at all: a light with OBJECT and one without share a `group_key`. The verdict was stored via `or_insert_with`, so the FIRST enumerated file won and a file missing a mandatory attribute became confirmable on filename order alone. Fixed by OR-folding (`entry.1 |= needs_review`) with a two-order regression test, `light_missing_target_keeps_needs_review_beside_a_resolved_sibling`. A file with **no determinable frame type** keys on the new `GROUP_KEY_TYPE_UNKNOWN` (`"type=unknown"`) — an identity value, not a flag; nothing branches on it and `FrameType::as_str` never yields `"unknown"`. **Side effect to note for T050**: a heterogeneous needs-review folder now materialises one sibling per frame type instead of one shared sentinel bucket, which is the CHK003 outcome arriving early. **Cardinality consequence pinned 2026-07-20 (verification round 2).** The OR-fold does not only change a verdict, it changes a COUNT: on `main` the sentinel made "one resolved light + one light missing OBJECT" TWO sub-items, so the resolved sibling stayed independently confirmable and only the offender was gated; it is now ONE, which gates the resolved frames too (a folder of 100 good lights + 1 OBJECT-less light yields a single `needs_review=1`, `frame_type=NULL` row). It also drops such a folder below `exclude_split_placeholder!`'s `COUNT(DISTINCT group_key) > 1` bound, so the placeholder stops being hidden for it — that is not a NEW defect class, because the tree in `InboxList` groups by dimension rather than by folder and every UNSPLIT folder already renders placeholder + sub-item (the deliberate pre-T020 state documented on the macro); it widens the blast radius of the known duplicate that T019/T020 remove. Accepted, not silently: separating the two rows again needs a grouping `Dimension` for the missing attribute, which is a spec decision (CHK003), not a local fix. `light_missing_target_keeps_needs_review_beside_a_resolved_sibling` now asserts `sub_items.len() == 1` so any future change to this number is deliberate — two-direction control: re-keying needs-review files onto `__needs_review__` fails it with `left: 2 / right: 1` and `got [("__needs_review__", 1), ("type=light·…", 0)]`, i.e. the exact pre-058 shape
- [X] T008 [P] Update `isNeedsReview` in `apps/desktop/src/features/inbox/InboxList.tsx` to read the new field rather than the `__needs_review__` sentinel
- [X] T009 Update the #1086 gate test `reclassify_type_agreement_without_mandatory_attrs_stays_needs_review` in `crates/app/inbox/src/reclassify.rs` to assert against the new field. **Edit its mechanism, never its invariant** — frame-type agreement alone must still not report an item classified, and the API response, item row and classification cache must still agree. Record in the commit that this is not a weakening of the gate
- [X] T010 Regenerate TypeScript bindings (`just check-generated` must report no drift afterwards). Do not hand-edit `apps/desktop/src/bindings/index.ts`
- [X] T011 Layer-1 test: an item resolving out of needs-review records frame type, classification identity, `classified` state and `needs_review = 0` in one statement (FR-029). **SC-003 is NOT met by this task — corrected 2026-07-20.** The original wording and the T011 commit claimed "no observable intermediate where it reports classified without a frame type"; that claim was false and the assertion carried a `AND needs_review = 0` qualifier that excluded exactly the violating rows. An UNRESOLVED needs-review row is `state = 'classified'` with a NULL `frame_type` for as long as it stays unresolved — observable, not transient (proved: unqualified sweep returns 1). The violation is now pinned by an explicit assertion in `needs_review_resolves_atomically_onto_its_natural_key_058`. **SC-003 closes at T018, not here** — a completion sweep must not tick it off these tests

### D-006 / FR-015-017 — the scan / classify boundary, with its harness

**T012–T016 are one landing.** See sequencing constraint 3.

> ⛔ **T012 and T014–T017 are blocked** (2026-07-20) — see T012 for the proof and
> the missing design decision. T014/T015's helper split was deliberately NOT
> written ahead of it: the source-group variants must assert against detail-pane
> testids that only exist once T012 renders a source-group row, so writing them
> now would ship assertions that cannot be failed on purpose in either
> direction. T013's backend half landed independently because it is additive
> and inert (`sourceGroups` is always empty while the placeholder still exists).

**Carried in from Phase 2a verification (2026-07-20) — stale `∅` identity on
resolve.** `reclassify`'s step 6b writes `group_key: &item.group_key`
unchanged, so once the user supplies a missing attribute via overrides the
item's identity permanently records that attribute as absent
(`type=flat·filter=∅·…` survives the resolve — proved by assertion). It will
never converge with a sibling carrying the real value, which defeats T006's
stated `ON CONFLICT(root_id, relative_path, group_key)` rationale. Correctly
fixing it means re-keying from override-merged metadata, and that can split
one item into several keys — i.e. it IS the re-split decision this group of
tasks owns, which is why Phase 2a pinned it instead of half-shipping it. The
current behaviour is asserted as-is in
`reclassify_fully_resolved_clears_needs_review`; that assertion must be
revisited here.

- [ ] T012 Make scan create the source group and **no inbox item** in `crates/app/inbox/src/classify.rs` and the scan command path (FR-015) — ⛔ **BLOCKED 2026-07-20 on a missing design decision, proved executable.** Deleting the scan-time placeholder makes the folder permanently unclassifiable: the only two callers of `materialize_sub_items` both need an item row to already exist. `classify()` is keyed on `inbox_item_id` and fails `InboxItemNotFound` without one (`classify.rs:87`); `reclassify_v2()` accepts a `sourceGroupId` but rebuilds `file_records` from persisted `inbox_classification_evidence` / `inbox_file_metadata`, which are only ever written against an item id (`reclassify.rs:626-700`). No item ⇒ no evidence ⇒ no item. The UI compounds it: `useInboxClassification(itemId)` fires on selecting an *item* row, so with no row nothing ever triggers classification. **Pinned by `source_group_without_items_cannot_be_classified_today_058` (`crates/app/inbox/src/reclassify.rs`)** — real FITS on disk + real source group + no item row materializes zero sub-items; seed an item first and it materializes, so the test is not vacuous. Unblocking needs a **group-scoped classification entry point that reads headers from disk** (enumerate → extract → `materialize_sub_items`, which already seeds each sub-item's own evidence/metadata/cache, so nothing else has to be re-keyed). That operation is defined nowhere: `contracts/operations.md` redefines only `inbox.scan.folder` and `inbox.list`. Scan itself must NOT do it — no per-file header reads at scan time (Constitution §I, `commands/inbox.rs:322`)

  **Partially unblocked 2026-07-20.** The missing operation now EXISTS as domain
  code: `classify_source_group(pool, source_group_id, root_absolute_path)`
  (`crates/app/inbox/src/classify.rs:488`, commit `882ec25e`), pinned by
  `classify_source_group_materializes_sub_items_from_a_bare_group_058`. It
  enumerates the group's files, builds records via the shared
  `build_file_records`/`classify_one_file`, and calls the already-group-keyed
  `materialize_sub_items`, deliberately skipping every item-keyed step.
  **Trap: do NOT pass `sg.lane` into `materialize_sub_items`** — that is #854;
  derive from `sg.format` as `reclassify_v2` does.

  ⚠️ **It is NOT reachable from the UI, and this is the remaining T012/T020
  blocker.** Verified 2026-07-20: `classify_source_group` has **no
  `#[tauri::command]` wrapper, no entry in `contracts/operations.md`, and no
  generated binding** — grep returns the definition, its doc-comments, and one
  test caller, nothing else. So the chain "T013-UI → T020" is incomplete:
  T013's UI half renders a source-group row, but selecting one still cannot
  trigger classification, because `useInboxClassification(itemId)` is keyed on
  an item id that a source group does not have. Deleting the placeholder (T020)
  before this lands reproduces the exact failure mode T012 already documents —
  every scanned folder becomes permanently unclassifiable while `cargo check`,
  clippy and `tsc` all stay green. **Required before T020**: a command wrapper,
  a contract operation, regenerated bindings (`just check-generated` clean), and
  UI wiring that drives classification from `sourceGroupId` when the selected
  row is a source group
- [X] T013 Represent the scanned-but-unclassified folder in `inbox.list` as a source-group row that is **structurally non-confirmable** — no item id to pass to confirm, rather than a guard that refuses one (FR-016, `contracts/operations.md`) — **backend done**; the UI half lands with T012, which is the first thing that can make the array non-empty. `InboxSourceGroupListItem` + `sourceGroups` on `InboxListResponse` (`crates/contracts/core/src/inbox.rs`), populated by `list_unclassified_source_groups` (`crates/persistence/db/src/repositories/inbox.rs`). FR-017 is a **consequence of the predicate**, not a separate swap step: the query returns only groups with zero item rows, so the moment `materialize_sub_items` writes one the group drops out. Two carve-outs worth knowing: (a) master items carry a NULL `source_group_id` (`q_desktop.rs:108`), so `NOT EXISTS` alone would list a masters-only folder a SECOND time alongside its master rows — excluded via `file_count > 0`; (b) that required the scanned sub-frame count on the group itself, since it previously only ever existed on the placeholder → migration **`0075_source_group_file_count.sql`** (additive, no backfill), written by scan. Inert on this branch: every scanned folder still gets a placeholder, so `sourceGroups` is always empty until T012 — **UI half DONE 2026-07-20**, landed ahead of T012 rather than with it. It is additive and inert (the array is always empty today), so it carries no risk, and it removes the "zero consumers in app code" blocker T020 inherited. `InboxList` gains a `sourceGroups` prop rendering a leading block of rows with testid `inbox-source-group-<id>`, carrying **no `_onClick`, no `_selected` and no item id** — non-confirmable structurally, not by a guard. They stay out of the grouping engine (`groupByDimensions` keys on `InboxListItem` fields a group lacks, and an unclassified folder has no dimension value anyway). **The lane filter derives from `format`, never from `group.lane`** — `inbox_source_groups.lane` is `move`/`catalogue`, and filtering on it hides every group under any lane filter (#854); two-direction control: `return group.lane;` fails the guard test with `Unable to find an element by: [data-testid="inbox-source-group-sg-fits"]` and renders "No detections.", restoring passes. A specific kind filter hides source groups (an unclassified folder matches no frame type). New file `__tests__/InboxList.sourceGroups.test.tsx` (7 tests). **T022's CHK010 half landed in the same change**, as that task requires: `deriveInboxStats` takes an optional second `sourceGroups` argument and counts each as one folder in the `unresolved` bucket; two-direction control: deleting the loop fails with `expected 1 to be 3` on `totals.folders`. ⚠️ **Still NOT selectable** — selection needs a group-scoped classify command that does not exist over IPC yet (see the new note under T012)
- [ ] ⛔ T014 Split `rescan_and_wait_for_item` in `crates/e2e-tests/tests/inbox_ui_journeys.rs:135-138` into a source-group-row variant and an item-row variant
- [ ] ⛔ T015 Split `select_only_item` (`crates/e2e-tests/tests/inbox_ui_journeys.rs:148-170`) likewise: selecting a source-group row asserts Confirm is **absent**; selecting an item row asserts Confirm is present. The current helper waits for `inbox-confirm-btn` to mount, which is exactly what a source-group row must never provide
- [ ] ⛔ T016 Update the five journeys in `crates/e2e-tests/tests/inbox_ui_journeys.rs` that call those helpers — including all three SC-005 journeys — to use the correct variant per step
- [ ] ⛔ T017 Replace the source-group row with the folder's item rows when classification completes (FR-017), preserving selection (FR-023) per the **CHK011 rule**: N=1 -> select that item; N>1 -> select the folder group header, never a sibling; N=0 -> the source-group row stays selected ([#1178](https://github.com/platevault/platevault/issues/1178))

**Checkpoint** — foundational work complete. Layer-1 green, and the five
journeys pass against the new boundary before any story phase begins.

---

## Phase 3: User Story 1 — Every Inbox row tells the truth about itself (P1) 🎯 MVP

**Goal**: no row states something false about itself. This is the #711 exit
condition.

**Independent test**: scan and classify uniform, mixed and needs-review
folders; every row's list badge, detail badge and own classification result
agree, and no row reports `classified` without a frame type.

- [X] T018 [P] [US1] Stop writing `state = 'classified'` on a row that carries no frame type. **Fix site corrected 2026-07-20**: the violation does NOT originate in `classify.rs:~467` — it is the hardcoded SQL literal in `upsert_inbox_sub_item`, `crates/persistence/db/src/repositories/inbox.rs:536` (INSERT) and `:543` (`DO UPDATE SET state = 'classified'`). Scoping T018 to `classify.rs` alone will not clear SC-003. The `state` CHECK constraint permits `pending_classification | classified | plan_open | resolved`, so `pending_classification` is the replacement for a needs-review row (verified: substituting `'unclassified'` fails with `CHECK constraint failed`). The pin in `needs_review_resolves_atomically_onto_its_natural_key_058` asserts the CURRENT violating value and **must be flipped** as part of this task. Note the existing `.ok()` swallows a failed write — surface the error rather than preserving that behaviour (FR-007) — **DONE 2026-07-20. Both writers had to change; the corrected fix site was necessary but not sufficient.** `upsert_inbox_sub_item` now derives `state` from `frame_type.is_some()` in both the INSERT and the `DO UPDATE` (`excluded.state`), AND `classify()`'s step 9 stops flipping the folder aggregate to `'classified'` unconditionally — an aggregate never carries a frame type, which is the original #711 shape. The step-9 `.ok()` is replaced by a surfaced `ContractError`. Pin flipped to `pending_classification`. Two-direction control on each writer separately: reverting step 9 alone fails the T023 sweep with `SC-003: 3 row(s) ... [("item-u", ...), ("item-m", ...), ("item-r", ...)]`; reverting `upsert_inbox_sub_item` alone fails it with `SC-003: 1 row(s) ... [("…", "classified", "type=unknown")]` plus the persistence_db pin `left: "classified" / right: "pending_classification"`
- [ ] ⛔ T019 [US1] Remove the unconditional materialisation gate at `crates/app/inbox/src/classify.rs:433` so a homogeneous folder yields exactly one item rather than a parent plus one child (FR-002, FR-004). **Do not remove the `state != 'plan_open'` filter itself** — that is one of the two interlocks PG-3 retains — ⛔ **BLOCKED 2026-07-20 on T020, which is itself blocked on T012.** "Exactly one item" is reached by deleting the PARENT, not by suppressing the child: the gate at `:433` is `item.source_group_id.as_deref().filter(|_| item.state != "plan_open")`, and once the `plan_open` filter is retained the only removable part is the source-group requirement — which materialisation needs, since `sg_id` is its first argument. The other reading (stop materialising for a homogeneous folder, leaving the parent as the single row) directly contradicts FR-001/T020. Both readings resolve only once T012's design decision exists
- [ ] ⛔ T020 [US1] Stop creating the placeholder row entirely (FR-001, FR-004, FR-006). **T024 depends on this being complete** — ⛔ **BLOCKED 2026-07-20: T020 IS T012.** Both name the same deletion (`persist_folder_placeholder`, `apps/desktop/src-tauri/src/commands/inbox.rs:367`) and inherit the same blocker, re-verified independently rather than inherited: (a) `classify()` fails `InboxItemNotFound` without an item row (`classify.rs:87`); (b) `reclassify_v2` cannot materialise from a bare source group — pinned by `source_group_without_items_cannot_be_classified_today_058`; (c) the UI drives classification from `selectedItem?.inboxItemId` (`InboxPage.tsx:409`), and `sourceGroups` from T013 has **zero consumers in app code** (grep: only `mocks.ts`, one test fixture and `bindings/index.ts`), so no source-group row is rendered or selectable. Deleting the placeholder today makes every scanned folder invisible AND permanently unclassifiable, while `cargo check`, clippy and tsc all stay green. **#1157 restated correctly 2026-07-20** — the standing description is wrong and following it yields a no-op "fix". The claim "once the placeholder stops being created, every `WHERE ... AND group_key = ''` lookup starts matching calibration-master rows instead" holds for neither such lookup: `link_placeholder_to_source_group` (`inbox.rs:~336`) and `get_inbox_placeholder_row` (`q_desktop.rs:~78`) are BOTH additionally scoped by `relative_path`, and a master row's `relative_path` is the master FILE's path (`scan.rs:~98`) while the placeholder's is the leaf FOLDER path. They cannot collide through any production call — both call sites in `persist_folder_placeholder` (`apps/desktop/src-tauri/src/commands/inbox.rs:~421`, `:~434`) pass the folder path. Adding `AND is_master_item = 0` is harmless but buys nothing, and would read as "#1157 handled" when it is not. The real post-T020 fact is different: with no placeholder ever written, both functions become **dead code** and must be deleted together with their two call sites, not guarded
- [ ] T021 [P] [US1] Make the list badge read the item's own classification result rather than falling back to `state` in `apps/desktop/src/features/inbox/InboxList.tsx` (FR-008). If #1099 has merged, this is already done — verify rather than duplicate — **VERIFIED 2026-07-20, do not implement here.** #1099 merged to `main` as `ef90b074` and adds a `classificationResult` predicate to `classificationLabel`. It is **not on this branch**: `git merge-base --is-ancestor ef90b074 HEAD` exits non-zero, and `classificationResult` occurs 0× in this branch's `InboxList.tsx` vs 3× in `origin/main`'s. The branch is 8 commits behind `main`. T021 therefore lands by rebasing/merging `main`, **not** by re-implementing it here — a second implementation would conflict with `ef90b074` on that rebase
- [X] T022 [P] [US1] Align the Inbox summary counts with the visible rows for uniform, split and needs-review folders (FR-009, SC-004). **CHK010: source-group rows ARE counted.** **Scope: `deriveInboxStats` (`apps/desktop/src/features/inbox/InboxPage.tsx:869`), NOT `status.rs`.** SC-004 concerns the Inbox page's own stats strip/header/footer, which derive client-side from the same list the page renders and therefore reconcile by construction today. What 058 changes is the list's CONTENT: it gains source-group rows, and `deriveInboxStats` does distinct-FOLDER counting ("a mixed folder counts once overall"), so that rule needs revisiting with source-group rows included. `count_unacknowledged_inbox_items` is a DIFFERENT surface -- it feeds `status.summary`'s dashboard badge and **deliberately** excludes `plan_open` ("states that need user attention"); do NOT change it. It is separately one of the four `exclude_split_placeholder!` sites, so T024 touches it -- that is about suppression, not `plan_open`. *(An earlier revision of this task claimed a pre-existing SC-004 violation from the list/count `plan_open` difference. That was wrong -- it conflated two surfaces. Corrected [#1178](https://github.com/platevault/platevault/issues/1178).)* — ⛔ **BLOCKED 2026-07-20 on T013's UI half, i.e. on T012.** The correction above independently re-verified and upheld: `count_unacknowledged_inbox_items` has exactly ONE production caller, `apps/desktop/src-tauri/src/commands/status.rs:55` (the status-bar badge), and is not the Inbox stats strip — it was NOT changed. The remaining work is CHK010 ("source-group rows ARE counted"), which has nothing to count: `sourceGroups` has zero consumers in app code, so no source-group row reaches `deriveInboxStats`. The reconciliation invariant CHK010 would extend (`sum(perType.folderCount) === totals.folders`) is **already pinned** at `apps/desktop/src/features/inbox/inboxStatsFromItems.test.ts:72-75` and `:90`, so no new test was added rather than a near-duplicate. Whoever lands T013's UI half must fold source groups into `deriveInboxStats` **and** the InboxList header/footer counts in the same change, or the stats strip and the header disagree — which is SC-004 itself. **Second SC-004 gap recorded 2026-07-20 (verification round 2), pre-existing and NOT introduced by this branch**: both count surfaces read the UNFILTERED array (`deriveInboxStats(items)`, `folderCount`/`masterCount` in `InboxPage.tsx`), while `InboxList` renders `filtered`, which applies the lane filter and the kind filter. With any filter active the summary reports more rows than the list shows, which violates SC-004's wording ("the Inbox summary counts equal the number of rows the list shows") literally. On the folder-shape axes SC-004 names the news is good — uniform, split, needs-review and `plan_open` all reconcile by construction, because neither count surface reads `state` or `frameType` for inclusion, so `folders + masters === items.length` for every state. Whoever closes T022 must decide explicitly whether SC-004 is scoped to folder shapes (met today) or to visible rows under filters (not met)
- [X] T023 [US1] Layer-1 tests asserting SC-001 (zero badge disagreements across all three folder shapes) and SC-003 (zero items with `classified` state and no frame type) — **SC-003 DONE**: `no_item_reports_classified_without_a_frame_type_sc003` (`crates/app/inbox/src/reclassify.rs`) runs the REAL classify pass over uniform, mixed and needs-review folders and sweeps the whole table, asserting a non-vacuous fixture (≥3 item rows) first. It is deliberately table-wide, not per-writer: the two writers that produced the violation are on different code paths and a test scoped to either passes while the other still lies (proved — each revert fails it with a different offender set). **SC-001 is NOT met and is NOT ticked by this task** — a badge-agreement assertion is not writable while the parent row still exists, because the aggregate's own `inbox_classifications` row says `classified`/`light` for a homogeneous folder while its item row now says `pending_classification`/NULL. That disagreement IS the parent row, and it disappears at T020, not here. SC-001 closes with T020. **Scope corrected 2026-07-20 (verification round 2): the sweep is table-wide in its SELECT but classify-only in its FIXTURE.** It never confirms an item, opens a plan or cancels one, so it could not and did not guard the plan-lifecycle writers — `cancel_inbox_plan` and `handle_plan_discarded`/`handle_plan_completed` were still writing the literal `'classified'` onto a NULL-`frame_type` row, reachable because `confirm()` gates on `needs_review` and the cached classification result but never on `item.state` or `item.frame_type`. Fixed in `676d9ad3` by deriving the state in SQL (`reset_inbox_item_to_unconfirmed`); guarded by two further tests, `cancel_does_not_report_classified_without_a_frame_type_sc003` (`app_core`) and `discarded_plan_does_not_report_classified_without_a_frame_type_sc003` (`app_core_inbox`). `app_core` depends on `app_core_inbox`, so these cannot be folded into the sweep — SC-003 needs three tests. The sweep's own anti-vacuity guard also counted rows rather than CLASSIFIED rows, so a regression leaving everything at `pending_classification` kept it green; a positive-direction assertion was added
- [ ] ⛔ T024 [US1] Delete **all four** read-side suppression call sites and the `exclude_split_placeholder!` macro: `crates/persistence/db/src/repositories/inbox.rs:1494` (definition), `:1565`, `:1603`, `:1788`, and `crates/persistence/db/src/repositories/q_desktop.rs:184` (plus its import at `:13`). Introduce no replacement suppression (FR-026, SC-007). **Blocked by T020 — see sequencing constraint 1** — ⛔ **NOT STARTED 2026-07-20, correctly**: T020 is blocked, and deleting the suppression first reproduces #1038. Line numbers in this task have shifted; the macro is now defined at `inbox.rs:1480` and used at `:1551`, `:1589`, `:1778` and `q_desktop.rs:184` (import at `:13`) — grep the macro name, do not trust these either
- [X] T025 [US1] Correct the stale comment at `crates/e2e-tests/tests/inbox_ui_journeys.rs:~392-394` claiming classify "purges the superseded parent row". It was hidden, not deleted — and after T020 there is no parent at all — **DONE**: there were **two** such comments, not one (`:226-228` and `:415-419`); both now say the row is hidden by the read-side `exclude_split_placeholder!` predicate and still exists in `inbox_items`

**Checkpoint** — US1 independently deliverable. SC-001, SC-003, SC-004, SC-007 pass.

---

## Phase 4: User Story 2 — Confirming an ordinary folder still works end to end (P1)

**Goal**: the flow that #1038 broke twice stays working.

**Independent test**: the three SC-005 journeys pass — catalogue-in-place zero
moves, confirm-then-apply-to-shown-destination, and
bulk-reclassify-unblocks-confirm.

- [X] T026 [P] [US2] Verify `inbox.confirm` still operates on exactly one `inbox_item_id` and alters no sibling (FR-010, SC-006). Per `contracts/operations.md` this needs **no change** — confirm and `inbox_plan_links` are already sibling-safe. Add the regression test rather than refactoring — **Open decision recorded 2026-07-20 (verification round 2), do NOT gate it here.** `confirm()` inspects `item.needs_review` (`confirm.rs:173`) and `classification.result` (`:~213`) but never `item.state` or `item.frame_type`, so a row with NO authoritative frame type can generate a filesystem plan. Constitution II makes that worth an explicit decision rather than an accident of gate ordering. Exposure today is exactly ONE row shape: the folder placeholder (`needs_review = 0`, `frame_type` NULL). Every classify-produced row with a NULL `frame_type` has `needs_review = 1` (`classify.rs:~959` sets `frame_type_str = None` only when `is_needs_review`), so gate 3 already blocks those. Adding a `frame_type IS NOT NULL` gate NOW would therefore break confirm for every uniform folder, because the placeholder is precisely the row the workflow is bound to — the user selects it, confirms it, and the plan links to its id (documented on `exclude_split_placeholder!`). The shape disappears at T020 by construction. Decide at T020 whether to add the gate as a belt-and-braces invariant or rely on the placeholder's removal — **DONE 2026-07-20.** No production change was needed, as this task predicted; the regression test is `confirm_alters_exactly_one_item_and_leaves_its_sibling_untouched_sc006` (`crates/app/inbox/src/confirm.rs`). It builds TWO REAL siblings under one source group — identity `(root_id, relative_path, group_key)` — because the existing `setup_classified_item` writes a legacy row via `insert_inbox_item` with no `source_group_id` and an empty `group_key`, so two of those are not siblings in the sense SC-006 is about. Confirming one asserts the other's `state`/`frame_type`/`needs_review`/`content_signature`/`group_key`/`file_count` are identical to a pre-confirm snapshot, that it owns no `inbox_plan_links` row, and that its own `inbox_classifications` row survived; a positive-direction assertion on the confirmed item (`state -> plan_open`, link present) keeps it non-vacuous. Two-direction control on PRODUCTION code — `update_inbox_item_state` re-keyed from `WHERE id = ?` to `WHERE relative_path = (SELECT relative_path FROM inbox_items WHERE id = ?)`, a plausible wrong-key bug since siblings share a folder: FAIL `SC-006: confirming one item must not alter its sibling / left: ("plan_open", Some("flat"), 0, …) / right: ("classified", Some("flat"), 0, …)`; RESTORED `1 passed, 202 filtered out`. **The `confirm()` frame-type gate recorded above is still deliberately NOT added** — that decision stands and belongs to T020
- [X] T027 [US2] Point the UI's confirm call at the item id rather than the folder's placeholder id in `apps/desktop/src/features/inbox/InboxPage.tsx`. This is the narrow change the spec identified: the machinery was always correct, only the id it was handed was wrong — **VERIFIED 2026-07-20, no production change needed — the defect this task describes does not exist in the current code.** `handleConfirm` already passes `selectedItem.inboxItemId` (`InboxPage.tsx:605-607`), and `selectedItem` is resolved from the rendered list by id, not by position (`InboxPage.tsx:300`, issue #644). The id then passes straight through `inbox_confirm` (`apps/desktop/src-tauri/src/commands/inbox.rs:113`) into `confirm()` with no remapping. Pinned rather than refactored: `apps/desktop/src/features/inbox/__tests__/InboxPage.confirmTargetsSelectedItem.test.tsx`, whose fixture fails all three plausible regressions — the two siblings share one `sourceGroupId`, the SECOND is selected, and both item ids differ from that source-group id. **Naming trap worth recording: `groupId` is NOT the folder id.** The contract says it "Equals `inbox_item_id`" (`bindings/index.ts`); `sourceGroupId` is the folder-scoped one, and it is what `InboxDetail`'s remount key reads (`InboxPage.tsx:1156`). A first draft of this test used `groupId` as the shared folder id and passed — a fixture that invents a field cannot fail for the right reason. Two-direction control (`handleConfirm` -> `inboxItemId: selectedItem.sourceGroupId ?? ''`): FAIL `expected "vi.fn()" to be called with … - "inboxItemId": "item-flats" / + "inboxItemId": "sg-folder-1"`; RESTORED `Test Files 1 passed (1) / Tests 2 passed (2)`
- [X] T028 [P] [US2] Ensure the resulting plan is reachable on the plan surface after confirming (FR-024) — **DONE 2026-07-20.** The reachability chain is `inbox_plan_list_open` -> `list_open_inbox_plans` (`crates/app/core/src/inbox_plan.rs:264`) -> `list_unacknowledged_across_roots`, which carries `exclude_split_placeholder!()`. That is exactly why #1038 dropped confirmed plans off the review surface, and the macro's own docstring documents it. The UNSPLIT half was already guarded by `list_open_keeps_confirmed_placeholder_with_materialized_sub_item`; the gap was the other side of the `> 1` bound, which is the shape FR-001 makes universal. Added `list_open_reaches_a_confirmed_sub_item_of_a_split_folder` (same file): two distinct sub-item group keys so the suppression IS active and the placeholder is correctly hidden, then a SUB-ITEM is confirmed and its plan must still be listed **with its actions** (not merely its id). Two-direction control on PRODUCTION code — the `i.group_key = ''` clause deleted from `exclude_split_placeholder!`, i.e. the over-suppression class #1038 was: FAIL `FR-024: the confirmed sub-item's plan must be reachable on the plan surface, got []`; RESTORED `11 passed, 320 filtered out`. **This test is a live tripwire for T024**: it fails the moment the suppression is widened rather than deleted
- [ ] ⛔ T029 [US2] Ensure selection is not silently dropped when classification swaps a source-group row for item rows (FR-023), implementing the **CHK011 rule** (see T017). The detail pane is keyed `sourceGroupId ?? inboxItemId` (`InboxPage.tsx:1156`) -- source group FIRST, and siblings share one -- so it already survives the swap. The task is *which item the pane shows*, not preventing a remount. Verify before adding handoff logic — ⛔ **BLOCKED 2026-07-20 on T017, which is blocked on T012.** Verified before adding handoff logic, as instructed, and the task's own reading is correct on both halves. (a) The remount half is already handled and needs nothing: `key={selectedItem.sourceGroupId ?? selectedItem.inboxItemId}` (`InboxPage.tsx:1156`) is stable across the swap because a materialized sub-item inherits the placeholder's `sourceGroupId`, and the `pendingReclassifySelectionId` handoff (`InboxPage.tsx:312`) already bounds the re-split case, covered by `InboxPage.reclassifySelection.test.tsx`. (b) The CHK011 half — *which* item the pane shows for N=1 / N>1 / N=0 — is not implementable: it is triggered by a source-group row being replaced, and `sourceGroups` still has **zero consumers in app code** (grep across `apps/desktop/src`: one occurrence, the `inbox.crossRoot.test.tsx` fixture). With no source-group row ever rendered there is no swap to preserve selection across, and any rule written now could not be failed on purpose in either direction. Lands with T017/T012
- [ ] T030 [US2] Run the three SC-005 journeys and record verbatim output. These are the gate; a green run here is the primary evidence the feature has not regressed the confirm flow — ⚠️ **NOT RUN — SC-005 IS NOT VERIFIED.** Layer-2 is single-occupancy and another lane may hold port 5173, so this was deliberately not executed and is deliberately NOT ticked. Static verification only, and it passed: all three journeys exist (`crates/e2e-tests/tests/inbox_ui_journeys.rs:362`, `:551`, `:631`), `cargo clippy -p e2e_tests --all-targets` is clean (which compiles the test targets), and every `data-testid` the file references resolves to real app source — `bulk-apply-btn`, `bulk-exposure-s`, `bulk-frame-type`, `inbox-confirm-btn`, `inbox-missing-attr-banner`, `inbox-review-plans-btn`, `inbox-unclassified-alert`, `plan-apply-all`, `plan-panel`, `reclassify-select-all`. **Compiling and targeting real testids is not evidence the journeys pass.** A human or a dedicated single-occupancy lane MUST run these three before this feature is called done

**Checkpoint** — US1 + US2 together are a shippable increment.

---

## Phase 5: User Story 3 — A mixed folder's parts are handled independently (P2)

**Blocked by T003 (#1102).**

**Goal**: N siblings, each independently actionable, none speaking for the others.

**Independent test**: confirm one sibling of a three-way split; the other two
are unchanged in state, classification and plan binding.

- [ ] T031 [US3] Ensure a folder with N distinct groups yields exactly N items and no aggregate (FR-003, SC-002)
- [X] T032 [P] [US3] Ensure no sibling is designated primary or authoritative (FR-006) — audit any remaining "first id wins" resolution beyond `resolve_item_id` — **audit clean.** Only two other first-wins reads exist and neither designates a sibling: `cone_search::pick_tier` (`cone_search.rs:122`) picks the first *file* of one frameset and returns `None` unless every other file agrees within `POINTING_TOLERANCE_DEG`; `reclassify.rs:349` iterates the *whole* `list_item_ids_for_source_group` result. `target_recommendations.rs:118` likewise picks the first *file* within one item, not a sibling
- [X] T033 [US3] Apply the #1102 decision from T003 to `resolve_item_id` in `crates/app/inbox/src/target_recommendations.rs:~227-231`, replacing `ids.into_iter().next()` — **done.** `RecommendationTarget` and `resolve_item_id` deleted; `target_recommendations(pool, inbox_item_id: &str, radius)` now takes one item id, so a source group has no entry point at all. Regression test `siblings_of_one_source_group_each_get_their_own_recommendation`. **Caller change still needed** (file owned by another lane): `apps/desktop/src-tauri/src/commands/inbox.rs:265-284`
- [ ] T034 [P] [US3] Implement grouping the Inbox list by folder so siblings appear together under one header (FR-025, D-007, SC-010). **CHK016: add `i.group_key` as the ORDER BY tiebreak** -- `list_unacknowledged_across_roots` orders by `r.path, i.relative_path`, which both TIE for siblings of one folder, so sibling order is currently whatever SQLite returns. Matches the existing sub-item query at `inbox.rs:649` ([#1178](https://github.com/platevault/platevault/issues/1178))
- [ ] T035 [US3] **Retire `mixed` (PG-1)** — remove the `_ => ("unclassified", "mixed", None)` arm at `crates/app/inbox/src/classify.rs:404`, the `inbox-mixed-alert` affordance, `mixedSummary` and the two guards in `InboxPage.tsx`, and the three `inbox_mixed_*` i18n keys. **In the same task**, replace the sync signal in `inbox_ui_mixed_folder_splits_into_single_type_items` with the appearance of the split item rows — see sequencing constraint 4
- [ ] T036 [P] [US3] Correct the reachability comment at `apps/desktop/src/features/inbox/InboxPage.tsx:~599-606`. It is **accurate today** — the spec's earlier claim that it was stale was withdrawn after Layer-2 verification. It becomes wrong only once T035 lands, so update it then, not before
- [ ] T037 [US3] Layer-1 test for SC-006: confirming one sibling leaves the others untouched

---

## Phase 6: User Story 4 — Machine-derived classification is not re-asked (P2)

**Goal**: the user is never asked to re-supply what the headers already said.

**Independent test**: split a mixed folder; no sibling prompts for a frame type
the headers already determined.

- [X] T038 [US4] Ensure re-classification re-derives items from the files on disk without propagating state, plans or confirmations between siblings (FR-014)
- [X] T039 [P] [US4] Ensure re-scanning an unchanged folder produces no item identity churn (FR-018, SC-008)
- [X] T040 [US4] Anchor folder-level re-scan comparison to the source group rather than any single item (FR-019)
- [X] T041 [US4] Layer-1 test for SC-008 asserting stable item identity across an unchanged re-scan

---

## Phase 6b: The needs-review split (CHK003 decision, scope addition)

**Added 2026-07-20 by the CHK003 decision on [#1178](https://github.com/platevault/platevault/issues/1178).**
`spec.md` recorded this as "a gap to size, not a decision taken"; it is now
taken. A needs-review item whose files receive two or more *different*
user-supplied frame types MUST split into that many sibling items rather than
come to rest in `mixed` with Confirm disabled -- a dead end the user can only
escape by re-editing answers that were correct.

**This is a scope addition, not a task-breakdown refinement.** It is recorded
here rather than routed through `/speckit.iterate` because the decision closes a
gap the specification already names; if it grows beyond these three tasks,
stop and iterate properly.

- [ ] T050 Make resolving a needs-review item into N distinct frame types materialise N sibling items rather than a single `mixed` item, reusing the existing materialisation path rather than a bespoke split
- [ ] T051 Handle the item-identity hazard: splitting moves resolved files onto a different item id **mid-interaction**. See the documented remount hazard at `crates/e2e-tests/tests/inbox_ui_journeys.rs:390-399`. Selection after the split follows the **CHK011 N>1 rule** -- the folder group header, never a sibling
- [ ] T052 Layer-1 test: a needs-review item resolved into two frame types yields exactly two siblings, each carrying its own frame type, with no `mixed` item and no orphaned original row

---

## Phase 7: Polish & cross-cutting

- [ ] T042 [P] Verify SC-002b — a scanned but unclassified folder appears as exactly one row that is not an inbox item
- [X] T043 [P] Verify SC-009's boundary honestly. D-005 remains a recorded decision but **its mechanism is descoped** to `specs/tiny/reclassify-split-per-item-and-rederivation.md`. State plainly in the verification report that SC-009 is not satisfied by this feature, rather than marking it done → `specs/058-inbox-drop-parent-items/sc-009-boundary.md`: **SC-009 NOT met, do not tick; the exit bar is the other eleven criteria**
- [ ] T044 [P] Confirm both PG-3 interlocks are still present and documented — `crates/app/inbox/src/reclassify.rs:346-362` and `classify.rs:433`. Neither is removed by this feature; removing only one would leave the follow-on's requirement unmet while appearing done
- [ ] T045 [P] Fix the in-tree migration citations: `crates/app/inbox/src/classify.rs:390` and `confirm.rs:211` both cite migration `0048` for the `result` CHECK collapse. It is `0049`
- [X] T046 [P] Update `docs/journeys/J02-ingest-review-reclassify-confirm-move/journey.md` with a behaviour delta and version bump, and refresh `docs/journeys/INDEX.md` via `journeys.py index .` → v3→v4, Δ4 (S1, S2, SC1, +SC6, +SC7, +G2, +G3); `journeys.py lint .` = 18 journeys, 0 errors
- [X] T047 [P] Update the Layer-2 coverage matrix in `specs/037-e2e-integration-testing/contracts/coverage-matrix.md` → area #3 note + dated "Spec 058" section (obligation/state table, the three SC-005 journeys, the SC-009 exclusion)
- [ ] T048 Run the full gate set: workspace `cargo nextest`, `cargo clippy --workspace --all-targets -D warnings`, `cargo fmt --check`, `just typecheck`, `just lint`, desktop `vitest`, and the Layer-2 Inbox journeys
- [ ] T049 Signal the lane holding #968/#994/#995/#997 that the landing window is known, so the inbox file splits can be sequenced

---

## Dependencies

```text
Setup (T001-T003)
  └─> Foundational (T004-T017)          T003 also gates Phase 5
        ├─> US1 (T018-T025)  🎯 MVP     T024 REQUIRES T020
        │     └─> US2 (T026-T030)
        │           ├─> US3 (T031-T037) requires T003
        │           └─> US4 (T038-T041)
        └─> Polish (T042-T049)
```

- **US1 is the MVP.** It is the #711 exit condition and is independently
  shippable.
- **US2 depends on US1** only because confirming a truthful row requires the
  row to be truthful first.
- **US3 and US4 are independent of each other** and can run in parallel once
  US2 is green.

## Parallel opportunities

- Foundational: T007 and T008 (different layers, same concept)
- US1: T018, T021, T022 — but **not** T024, which is ordered
- US3: T032, T034, T036
- Polish: T042–T047 are all independent

## Implementation strategy

Ship **US1 alone** first. It fixes the live user-visible defect, it is the
#711 exit condition, and it is independently verifiable via SC-001/003/004.
US2 follows as the regression guard on the flow that broke twice. US3 and US4
are P2 and can land later without leaving the product in an inconsistent
state.

## Verification note

Twelve success criteria, and SC-009 is knowingly **not** met by this feature —
see T043. Do not let a completion sweep tick it. The remaining eleven are the
real exit bar, with SC-005 (the three journeys) as the gate that has caught
every regression on this surface so far.
