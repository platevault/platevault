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
- [X] T007 [P] Narrow `group_key` to classification identity only in `crates/app/inbox/src/classify.rs` and `reclassify.rs`; stop writing `__needs_review__` and the synthetic `type=<ft>·resolved=<id>` key — **done**: `materialize_sub_items` now always runs `group_file` when a frame type is known, so a missing-mandatory file keeps its identity. ⚠️ **The original "the absent dimension renders as `SENTINEL_MISSING`, which is what keeps it distinct from a resolved sibling" justification was FALSE and caused a regression — corrected 2026-07-20.** `target` is mandatory for lights (`mandatory_set_for`) but `Dimension` (`grouping.rs:126-151`) has no Target variant, so OBJECT cannot influence the key at all: a light with OBJECT and one without share a `group_key`. The verdict was stored via `or_insert_with`, so the FIRST enumerated file won and a file missing a mandatory attribute became confirmable on filename order alone. Fixed by OR-folding (`entry.1 |= needs_review`) with a two-order regression test, `light_missing_target_keeps_needs_review_beside_a_resolved_sibling`. A file with **no determinable frame type** keys on the new `GROUP_KEY_TYPE_UNKNOWN` (`"type=unknown"`) — an identity value, not a flag; nothing branches on it and `FrameType::as_str` never yields `"unknown"`. **Side effect to note for T050**: a heterogeneous needs-review folder now materialises one sibling per frame type instead of one shared sentinel bucket, which is the CHK003 outcome arriving early
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
- [X] T013 Represent the scanned-but-unclassified folder in `inbox.list` as a source-group row that is **structurally non-confirmable** — no item id to pass to confirm, rather than a guard that refuses one (FR-016, `contracts/operations.md`) — **backend done**; the UI half lands with T012, which is the first thing that can make the array non-empty. `InboxSourceGroupListItem` + `sourceGroups` on `InboxListResponse` (`crates/contracts/core/src/inbox.rs`), populated by `list_unclassified_source_groups` (`crates/persistence/db/src/repositories/inbox.rs`). FR-017 is a **consequence of the predicate**, not a separate swap step: the query returns only groups with zero item rows, so the moment `materialize_sub_items` writes one the group drops out. Two carve-outs worth knowing: (a) master items carry a NULL `source_group_id` (`q_desktop.rs:108`), so `NOT EXISTS` alone would list a masters-only folder a SECOND time alongside its master rows — excluded via `file_count > 0`; (b) that required the scanned sub-frame count on the group itself, since it previously only ever existed on the placeholder → migration **`0075_source_group_file_count.sql`** (additive, no backfill), written by scan. Inert on this branch: every scanned folder still gets a placeholder, so `sourceGroups` is always empty until T012
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

- [ ] T018 [P] [US1] Stop writing `state = 'classified'` on a row that carries no frame type. **Fix site corrected 2026-07-20**: the violation does NOT originate in `classify.rs:~467` — it is the hardcoded SQL literal in `upsert_inbox_sub_item`, `crates/persistence/db/src/repositories/inbox.rs:536` (INSERT) and `:543` (`DO UPDATE SET state = 'classified'`). Scoping T018 to `classify.rs` alone will not clear SC-003. The `state` CHECK constraint permits `pending_classification | classified | plan_open | resolved`, so `pending_classification` is the replacement for a needs-review row (verified: substituting `'unclassified'` fails with `CHECK constraint failed`). The pin in `needs_review_resolves_atomically_onto_its_natural_key_058` asserts the CURRENT violating value and **must be flipped** as part of this task. Note the existing `.ok()` swallows a failed write — surface the error rather than preserving that behaviour (FR-007)
- [ ] T019 [US1] Remove the unconditional materialisation gate at `crates/app/inbox/src/classify.rs:433` so a homogeneous folder yields exactly one item rather than a parent plus one child (FR-002, FR-004). **Do not remove the `state != 'plan_open'` filter itself** — that is one of the two interlocks PG-3 retains
- [ ] T020 [US1] Stop creating the placeholder row entirely (FR-001, FR-004, FR-006). **T024 depends on this being complete**
- [ ] T021 [P] [US1] Make the list badge read the item's own classification result rather than falling back to `state` in `apps/desktop/src/features/inbox/InboxList.tsx` (FR-008). If #1099 has merged, this is already done — verify rather than duplicate
- [ ] T022 [P] [US1] Align the Inbox summary counts with the visible rows for uniform, split and needs-review folders (FR-009, SC-004). **CHK010: source-group rows ARE counted.** **Scope: `deriveInboxStats` (`apps/desktop/src/features/inbox/InboxPage.tsx:869`), NOT `status.rs`.** SC-004 concerns the Inbox page's own stats strip/header/footer, which derive client-side from the same list the page renders and therefore reconcile by construction today. What 058 changes is the list's CONTENT: it gains source-group rows, and `deriveInboxStats` does distinct-FOLDER counting ("a mixed folder counts once overall"), so that rule needs revisiting with source-group rows included. `count_unacknowledged_inbox_items` is a DIFFERENT surface -- it feeds `status.summary`'s dashboard badge and **deliberately** excludes `plan_open` ("states that need user attention"); do NOT change it. It is separately one of the four `exclude_split_placeholder!` sites, so T024 touches it -- that is about suppression, not `plan_open`. *(An earlier revision of this task claimed a pre-existing SC-004 violation from the list/count `plan_open` difference. That was wrong -- it conflated two surfaces. Corrected [#1178](https://github.com/platevault/platevault/issues/1178).)*
- [ ] T023 [US1] Layer-1 tests asserting SC-001 (zero badge disagreements across all three folder shapes) and SC-003 (zero items with `classified` state and no frame type)
- [ ] T024 [US1] Delete **all four** read-side suppression call sites and the `exclude_split_placeholder!` macro: `crates/persistence/db/src/repositories/inbox.rs:1494` (definition), `:1565`, `:1603`, `:1788`, and `crates/persistence/db/src/repositories/q_desktop.rs:184` (plus its import at `:13`). Introduce no replacement suppression (FR-026, SC-007). **Blocked by T020 — see sequencing constraint 1**
- [ ] T025 [US1] Correct the stale comment at `crates/e2e-tests/tests/inbox_ui_journeys.rs:~392-394` claiming classify "purges the superseded parent row". It was hidden, not deleted — and after T020 there is no parent at all

**Checkpoint** — US1 independently deliverable. SC-001, SC-003, SC-004, SC-007 pass.

---

## Phase 4: User Story 2 — Confirming an ordinary folder still works end to end (P1)

**Goal**: the flow that #1038 broke twice stays working.

**Independent test**: the three SC-005 journeys pass — catalogue-in-place zero
moves, confirm-then-apply-to-shown-destination, and
bulk-reclassify-unblocks-confirm.

- [ ] T026 [P] [US2] Verify `inbox.confirm` still operates on exactly one `inbox_item_id` and alters no sibling (FR-010, SC-006). Per `contracts/operations.md` this needs **no change** — confirm and `inbox_plan_links` are already sibling-safe. Add the regression test rather than refactoring
- [ ] T027 [US2] Point the UI's confirm call at the item id rather than the folder's placeholder id in `apps/desktop/src/features/inbox/InboxPage.tsx`. This is the narrow change the spec identified: the machinery was always correct, only the id it was handed was wrong
- [ ] T028 [P] [US2] Ensure the resulting plan is reachable on the plan surface after confirming (FR-024)
- [ ] T029 [US2] Ensure selection is not silently dropped when classification swaps a source-group row for item rows (FR-023), implementing the **CHK011 rule** (see T017). The detail pane is keyed `sourceGroupId ?? inboxItemId` (`InboxPage.tsx:1156`) -- source group FIRST, and siblings share one -- so it already survives the swap. The task is *which item the pane shows*, not preventing a remount. Verify before adding handoff logic
- [ ] T030 [US2] Run the three SC-005 journeys and record verbatim output. These are the gate; a green run here is the primary evidence the feature has not regressed the confirm flow

**Checkpoint** — US1 + US2 together are a shippable increment.

---

## Phase 5: User Story 3 — A mixed folder's parts are handled independently (P2)

**Blocked by T003 (#1102).**

**Goal**: N siblings, each independently actionable, none speaking for the others.

**Independent test**: confirm one sibling of a three-way split; the other two
are unchanged in state, classification and plan binding.

- [ ] T031 [US3] Ensure a folder with N distinct groups yields exactly N items and no aggregate (FR-003, SC-002)
- [ ] T032 [P] [US3] Ensure no sibling is designated primary or authoritative (FR-006) — audit any remaining "first id wins" resolution beyond `resolve_item_id`
- [ ] T033 [US3] Apply the #1102 decision from T003 to `resolve_item_id` in `crates/app/inbox/src/target_recommendations.rs:~227-231`, replacing `ids.into_iter().next()`
- [ ] T034 [P] [US3] Implement grouping the Inbox list by folder so siblings appear together under one header (FR-025, D-007, SC-010). **CHK016: add `i.group_key` as the ORDER BY tiebreak** -- `list_unacknowledged_across_roots` orders by `r.path, i.relative_path`, which both TIE for siblings of one folder, so sibling order is currently whatever SQLite returns. Matches the existing sub-item query at `inbox.rs:649` ([#1178](https://github.com/platevault/platevault/issues/1178))
- [ ] T035 [US3] **Retire `mixed` (PG-1)** — remove the `_ => ("unclassified", "mixed", None)` arm at `crates/app/inbox/src/classify.rs:404`, the `inbox-mixed-alert` affordance, `mixedSummary` and the two guards in `InboxPage.tsx`, and the three `inbox_mixed_*` i18n keys. **In the same task**, replace the sync signal in `inbox_ui_mixed_folder_splits_into_single_type_items` with the appearance of the split item rows — see sequencing constraint 4
- [ ] T036 [P] [US3] Correct the reachability comment at `apps/desktop/src/features/inbox/InboxPage.tsx:~599-606`. It is **accurate today** — the spec's earlier claim that it was stale was withdrawn after Layer-2 verification. It becomes wrong only once T035 lands, so update it then, not before
- [ ] T037 [US3] Layer-1 test for SC-006: confirming one sibling leaves the others untouched

---

## Phase 6: User Story 4 — Machine-derived classification is not re-asked (P2)

**Goal**: the user is never asked to re-supply what the headers already said.

**Independent test**: split a mixed folder; no sibling prompts for a frame type
the headers already determined.

- [ ] T038 [US4] Ensure re-classification re-derives items from the files on disk without propagating state, plans or confirmations between siblings (FR-014)
- [ ] T039 [P] [US4] Ensure re-scanning an unchanged folder produces no item identity churn (FR-018, SC-008)
- [ ] T040 [US4] Anchor folder-level re-scan comparison to the source group rather than any single item (FR-019)
- [ ] T041 [US4] Layer-1 test for SC-008 asserting stable item identity across an unchanged re-scan

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
- [ ] T043 [P] Verify SC-009's boundary honestly. D-005 remains a recorded decision but **its mechanism is descoped** to `specs/tiny/reclassify-split-per-item-and-rederivation.md`. State plainly in the verification report that SC-009 is not satisfied by this feature, rather than marking it done
- [ ] T044 [P] Confirm both PG-3 interlocks are still present and documented — `crates/app/inbox/src/reclassify.rs:346-362` and `classify.rs:433`. Neither is removed by this feature; removing only one would leave the follow-on's requirement unmet while appearing done
- [ ] T045 [P] Fix the in-tree migration citations: `crates/app/inbox/src/classify.rs:390` and `confirm.rs:211` both cite migration `0048` for the `result` CHECK collapse. It is `0049`
- [ ] T046 [P] Update `docs/journeys/J02-ingest-review-reclassify-confirm-move/journey.md` with a behaviour delta and version bump, and refresh `docs/journeys/INDEX.md` via `journeys.py index .`
- [ ] T047 [P] Update the Layer-2 coverage matrix in `specs/037-e2e-integration-testing/contracts/coverage-matrix.md`
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
