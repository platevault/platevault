# Pending Review Questions — 058 Inbox Drop Parent Items

Questions raised during specification. **All ten are now answered** — Q-1, Q-2,
Q-4, Q-8 and then Q-5, Q-6, Q-7, Q-9 by the product owner (2026-07-19), Q-3 by
events, and **Q-10 by the product owner (2026-07-20)**, during implementation
rather than specification. Answers are recorded here and promoted to decisions
D-005 through D-007 in [spec.md](spec.md#recorded-decisions).

Two of the later answers change this feature's shape rather than merely filling
a blank, and are worth reading before the plan gate:

- **Q-6 descopes plan invalidation** out of 058 (FR-020/021/022 move to a
  follow-on micro-spec), and records the owner-approved target architecture so
  the follow-on does not re-derive it.
- **Q-9's premise was false.** The `mixed` branch does not become dead code. The
  question dissolves; a different, unrecorded gap is raised in its place.
  **Amended after Layer-2 verification:** the conclusion holds but the mechanism
  first recorded here was wrong, and the criticism of `InboxPage.tsx:599-606` is
  withdrawn — that comment is correct. See Q-9 for the evidence.

Line references in the answers below were re-verified against `main` at
`5059e164`. Several references in the original questions had drifted since
`22f94a9e`; corrections are noted inline where they occur.

---

# Answered

## Q-1 — How does the greenfield decision present to an existing user? — RESOLVED: not applicable

**Answer (product owner)**: There are no current installs. D-004 stands
unchanged, and no upgrade-presentation work is needed.

**Reasoning**: The stranding risk D-004 accepts cannot reach a user, because
there is no user holding a library database to strand. The question was
well-formed against the assumption that v0.5.0's published updater implied a
real installed base; that assumption was wrong.

**Consequence**: No migration UX is designed. No first-launch reset notice, no
legacy-row detection, no explanation dialog. D-004's accepted risk stays
recorded in [spec.md](spec.md) so that a future reader — for whom there *will*
be an installed base — understands that this feature's licence to break inbox
data was granted under conditions that no longer apply.

**Note for the future**: If any part of this work lands after the product has
real users, this question reopens. It is answered for the current moment, not
in principle.

---

## Q-2 — What happens to a sibling that a re-scan no longer produces? — RESOLVED: invalidate

**Answer (product owner)**: Invalidate it. Cancel the plan, mark the item stale,
and surface an explicit signal that the user's confirmation was superseded.

**Reasoning**: The confirmation was made against a world that no longer exists.
A plan describes pending filesystem mutations, so silently honouring a plan
whose basis has vanished is the dangerous option — Constitution II requires
every mutation to be reviewable, and a plan the user can no longer meaningfully
review fails that test.

**Rejected alternatives**:

- **Keep and show** — leaves a queue row representing a group that no longer
  exists on disk. Reintroduces exactly the class of defect this feature exists
  to remove: a row asserting something untrue about the library.
- **Keep and hide** — the worst failure mode. An open plan describing filesystem
  mutations, invisible to the user, still bound to a stale confirmation.
- **Block re-scan until the plan resolves** — one stale plan freezes
  reconciliation for the entire folder, so the user cannot fix the situation by
  re-scanning, which is the obvious remedy.

**Promoted to**: D-005.

**Coupling to Q-5**: The confirm staleness guard
(`crates/app/inbox/src/confirm.rs:198`) is the existing mechanism for exactly
this class of problem — a confirmation made against a state that has since
changed. It may already be the right hook for the invalidation signal rather
than a new mechanism. **Q-5 remains open**; this is a lead for the plan gate,
not a decision.

---

## Q-3 — Sequencing against PR #1081 — RESOLVED by events

**Answer**: #1081 merged as `b4e72263`, ahead of this spec. The recommendation
in the original question (land it first) is what happened.

**Consequence**: `exclude_split_placeholder!` now exists on `main`
(`crates/persistence/db/src/repositories/inbox.rs:1494`, invoked at `:1559`,
`:1597`, `:1782`). This feature **deletes the macro and all three invocations**
rather than correcting them — with no aggregate row there is nothing to
suppress (FR-026, SC-007).

---

## Q-4 — Does scan create items, or does classification? — RESOLVED: Option C

**Answer (product owner)**: Option C. **Scan creates the source group only. The
Inbox list displays unclassified source groups alongside classified items.**

The row visible before classification is the *source group*, not an
`inbox_items` row. No parent item ever exists, so D-001 holds unconditionally,
while a freshly-scanned folder is still visible to the user. Once classify runs,
the source-group row is replaced by its N item rows.

**Scope — read "no *parent* item", not "no item".** This answer constrains rows
that stand for a folder as a whole. It does not touch self-describing file-level
rows: a detected calibration master (spec 040) is created at scan time by
`persist_master_item`, carrying real frame type, filter and exposure read from
the file, so it asserts nothing classification has yet to determine. FR-015
originally paraphrased this answer as "MUST NOT create any inbox item", which
outlawed a shipped feature; it has been corrected to match this scope.

**Rejected alternatives**:

- **A — scan creates one provisional item that classify splits.** Rejected: a
  transient parent is still a parent. It revives the selection-churn coupling
  (FR-023, `useStaleSelectionCleanup` at
  `apps/desktop/src/features/inbox/InboxPage.tsx:319-326`) that caused the #1038
  outage, and it would mean D-001 holds only eventually rather than at all times.
- **B — scan creates only the source group, nothing displayed until classify.**
  Rejected as the primary approach, **retained as a fallback**. Because classify
  is a per-item IPC command rather than something that runs automatically on
  scan, the invisible window is not momentary: a user could scan a whole drive
  and be shown an empty Inbox.

**Promoted to**: D-006.

**Known cost, explicitly accepted**: the Inbox list becomes a **union of two row
types** — unclassified source groups and classified items — and selection must
survive the "one source-group row becomes N item rows" transition. This is a
real design task for the plan gate, not a solved problem. It is the same union
that Q-8's grouping construct needs, so the two should be designed together.

---

## Q-10 — What triggers classification for a source-group row? — RESOLVED: explicit user action — **AND SHIPPED**

**Answer (product owner, 2026-07-20)**: **An explicit per-row action.** The
source-group row carries a `Classify` control; classification runs only when the
user asks for it.

**Why this needed answering at all.** Unlike Q-1 to Q-9, this gap surfaced during
implementation, not specification. Q-4 resolved *what scan creates* (the source
group only) and FR-017 describes what happens *when classification completes* —
but nothing named the **trigger**, and Q-4 itself flagged the surrounding area as
"a real design task for the plan gate, not a solved problem". Meanwhile the row
was built inert by construction to satisfy FR-016, so no user gesture existed to
hang classification on. The consequence was concrete: `classify_source_group`
shipped with a backend, a Tauri command, both specta registrations and a
generated binding, and **zero UI callers**. The operation was reachable only from
a test.

**Two existing invariants dictated the shape** — it was not a free choice:

1. **Selection cannot carry it.** Selection is the `?selected=<inboxItemId>` URL
   param, resolved via `filteredItems.find(...)`. A `sourceGroupId` placed there
   matches no item, so `useStaleSelectionCleanup` clears it on the same commit —
   the row would appear to do nothing. Routing through `onSelect` would also
   destroy FR-016's guarantee that a source-group row selects nothing, which its
   tests assert directly.
2. **It is a mutation, not a fetch.** `classify_source_group` walks the folder,
   parses every file header and writes `inbox_items` rows via
   `materialize_sub_items`, returning only
   `{ sourceGroupId, materializedSubItemCount }`. There is no payload to cache,
   so the `useInboxClassification` fire-on-selection-and-cache idiom does not
   transfer.

**Rejected alternatives**:

- **Auto-classify on render.** Rejected on three counts. It makes *rendering a
  list* write to the database for every folder the user never touched. It raises
  one blocking `MetadataUnreadable` per FITS-less folder, unprompted, on load.
  And it transforms rows underneath the user with no gesture — the selection-churn
  coupling that caused the #1038 outage, which FR-023 exists to prevent and which
  Q-4 already rejected its **Option A** over. It also collapses toward Q-4's
  rejected **Option B**: if every group row classifies itself on sight, FR-016's
  visible-unclassified state becomes a flicker rather than a real state.
- **Classify during scan.** Rejected: contradicts Q-4/D-006 (scan creates the
  group only) and would make FR-016's row nearly unreachable — reopening a
  resolved decision rather than implementing one.

**FR-016 is unchanged.** The row still carries no `_onClick`, no `_selected` and
no item id, so nothing can hand one to `inbox.confirm`. The action carries the
`sourceGroupId` directly and leaves `onSelect` untouched. All seven pre-existing
FR-016 tests pass **unmodified**, which is the evidence the invariant survived
rather than being quietly relaxed.

**Shipped 2026-07-20** in `bce27a49`, both halves, with the resulting contract
recorded in [contracts/operations.md](contracts/operations.md) — which marks
`inbox.classify.sourceGroup` `[shipped]` and carries the caller obligations
(invalidate `inbox.list`, key busy state by `sourceGroupId` rather than a bare
boolean). This entry records *why the trigger is explicit*; that file records
*what the contract now requires*.

**Idempotency**: `upsert_inbox_sub_item` is
`ON CONFLICT(root_id, relative_path, group_key) DO UPDATE` and orphaned siblings
are pruned by `delete_sub_item_if_unlinked`, so a repeated action converges
rather than duplicating rows.

**Still open, deliberately**: preserving selection across the "one source-group
row becomes N item rows" transition (FR-023) remains **T029**. The explicit
trigger makes it tractable by giving the transition a user-gesture anchor; it
does not implement it.

---

## Q-8 — How are N sibling rows presented? — RESOLVED: group by folder

**Answer (product owner)**: Add a **folder / source-group grouping dimension**
to the Inbox list, keyed on the `source_group_id` that siblings already share —
"we already have the relationship id on the objects."

**Verified**: `GROUPING_DIMENSIONS`
(`apps/desktop/src/features/inbox/InboxControls.tsx:48`) currently offers
target, frameType, date, filter, exposure, instrument, source, format, and
orgState. There is **no** folder dimension, and `source` is the *root* basename
(`accessor: (i) => basename(i.rootAbsolutePath)`, `:80-83`), not the containing
folder. The grouping machinery (`useGrouping`, spec 043, persisted ordered
dimensions) already exists.

**Promoted to**: D-007.

**One correction to the framing.** This is slightly more than an accessor plus a
label. The grouping engine collapses bucket key and header label into a single
string — `apps/desktop/src/lib/grouping.ts:49` returns `{ key: s, label: s }`
from the accessor's value, and groups sort by label (`:58`). So an accessor
returning `sourceGroupId` produces **UUID group headers sorted in UUID order**,
and an accessor returning `relativePath` produces readable headers that
**collide across roots** — two folders at the same relative path under different
roots would merge into one group, which is the precise error the root-scoped
identity model exists to prevent.

**Cheapest correct fix**: widen the accessor to return the `{ key, label }` pair
the engine already models internally (`grouping.ts:23-26`, `:41`), so the key
can be `sourceGroupId` while the label is the folder path. This extends existing
structure rather than adding a parallel mechanism, and touches `keyOf`'s
collapse at `:49` plus the accessor signature. Every existing accessor keeps
working if the widened form is optional. **This is a recommendation, not a
decision** — the plan gate owns it.

**Also for the plan gate**: whether folder becomes the Inbox **default**
grouping. Worth it — it makes the mixed-folder case more legible than today
rather than less, which is the difference between this feature improving the
Inbox and merely making it correct. It composes with D-006, since both need the
same union of source-group and item rows.

**Related presentation defects this does not by itself fix**:
`InboxList.tsx:165-167` falls back to the root basename when the relative path
is empty, so N siblings of a root-level folder still render N identical Path
cells; `InboxList.tsx:185` sorts by relative path with no secondary key, so
sibling order within a folder is unstable. Grouping makes these less visible,
not absent. Worth a journey delta.

---

## Q-5 — What anchors the confirm staleness guard after reclassification? — RESOLVED: per-item — **AND SHIPPED**

> **Status (2026-07-19): the decision below is implemented on `main`.** PR #1105
> (`038781e2`) added `root_absolute_path` to `InboxReclassifyV2Request` and
> `reclassify.rs:827` joins it per file to compute real per-group signatures.
> The two in-tree comments named at the end of this answer are corrected, and
> `confirm.rs:1495` carries a `stale_signature_returns_error` test. **No work
> remains under Q-5.** The present-tense defect language below is retained as
> the historical record of why — read it as history, not as a task list.

**Answer (product owner)**: Confirm-time staleness stays a **per-item**
property. **FR-013 stands unchanged.** Reclassification is what must change:
`reclassify_v2` MUST compute real per-group signatures, which requires threading
a root absolute path into it. That path is available at the Tauri command layer
(`apps/desktop/src-tauri/src/commands/inbox.rs`) and is simply not carried into
the reclassify request today.

**Reasoning**: The signature answers a question about one row — *have the files
under this item changed since the classification the user is looking at?* An
anchor scoped more widely than the thing it describes cannot answer that
question honestly.

**Rejected**: falling back to the source group's folder signature
(`inbox_source_groups.content_signature`), which survives this feature and is
written from real file hashes at scan time. It is materially cheaper, and it was
rejected anyway: a folder-scoped anchor means a change to **any** file in the
folder invalidates **every** sibling's confirmation. That is a lifecycle
coupling — precisely the class D-003 declares extinguished — reintroduced
through the back door, and it would have required amending FR-013.

### A factual correction to this specification's own account

The premise stated in this question and in [research.md](research.md) §4.5 —
that reclassify writes an **empty** signature — is **wrong**, and the error
matters because it changes what fixes are possible.

`reclassify_v2` passes an empty file-path slice
(`crates/app/inbox/src/reclassify.rs:820-831`), so the per-group signature is
`folder_signature([])`. That function
(`crates/app/inbox/src/signature.rs:69-76`) hashes the file signatures and
hex-encodes the digest, so on empty input it returns **the SHA-256 of empty
input** — a fixed 64-character constant, not an empty string.

The consequence is sharper than the original framing. Every item that has ever
been through `reclassify_v2` carries the *same universal constant* as every
other such item, in every folder, in every library. The confirm guard
(`crates/app/inbox/src/confirm.rs:197-205`) therefore passes trivially, and
would also pass across unrelated items.

**This is a live defect on `main` today, independent of 058.** The guard is
already vacuous on the reclassify path; this feature does not create the problem,
it removes the parent row that was masking it and makes that path the only path.
It could be fixed without this feature, and arguably should be.

Note also that an "empty means stale" rule — one of the options originally
considered — **cannot be implemented as an emptiness check**, because the value
is not empty.

**Two in-tree comments repeat the same false premise** and must be corrected in
this feature's first code PR: `reclassify.rs:648-649` and `reclassify.rs:821`.

**Needs**: a regression test asserting the guard still fires after
reclassification — the existing tests cannot have been covering it.

---

## Q-6 — Should reclassify still block on any sibling having a plan? — RESOLVED: descoped, with the target recorded

**Answer (product owner)**: **Descoped out of 058.** FR-020, FR-021 and FR-022
move to a follow-on micro-spec. 058 keeps the existing interlock exactly as it
is and ships the parent-removal it is actually about.

**Reasoning**: The interlock cannot simply be deleted, because
`delete_sub_item_if_unlinked`
(`crates/persistence/db/src/repositories/inbox.rs:610-619`) refuses to purge a
plan-linked row **silently** — a no-op, not an invalidation. Remove the block
without an invalidation path and re-derivation leaves an orphaned row carrying
an open plan and nothing on disk behind it: the "keep and show" outcome D-005
rejects. So removing it is gated on building D-005's mechanism, which is the
largest unscoped piece of work in the feature and which was itself gated on Q-5.
Deciding a plan-lifecycle design under that much sequencing pressure, inside a
spec about removing placeholder rows, is how the original defect got two
read-side patches instead of one model fix.

**Consequence, recorded rather than hidden**: 058 ships with one lifecycle
coupling that contradicts its own D-003. A folder with one confirmed sibling
cannot have its other siblings reclassified until the follow-on lands. This is
written up in [spec.md](spec.md#the-one-lifecycle-coupling-that-knowingly-survives),
together with the **owner-approved target architecture** — per-item reclassify
as the only user-facing classification action, folder re-derivation as a
separate non-blocking identity-scoped operation triggered by disk change, the
interlock retired by irrelevance rather than deleted defensively,
supersede-and-surface rather than silent cancellation, and delivery by
event-driven inversion following `crates/app/inbox/src/plan_listener.rs` rather
than by adding a `crates/app/core` dependency edge to `crates/app/inbox`.

The follow-on is being authored under `specs/tiny/`.

See `specs/tiny/reclassify-split-per-item-and-rederivation.md` (PR #1097).

**Line reference correction**: this question cited `reclassify.rs:372-380`; the
interlock is at **`:347-360`** on current `main`.

---

## Q-7 — Does the needs-review sentinel workaround survive? — RESOLVED: give needs-review its own field

**Answer (product owner)**: **No.** Needs-review gets its own column/field,
distinct from the classification identity. Promoted to FR-028.

**Reasoning**: `group_key` currently carries three meanings at once —
classification identity, needs-review flag, and uniqueness discriminator — and
overloading one column is what allowed a row to claim `classified` while
carrying no frame type in the first place. D-004's greenfield decision (no
installed base, confirmed by Q-1) means a schema change is **cheapest now** and
will cost a real migration after release.

**The collision this feature was assumed to relieve, it actually worsens.** The
synthetic key exists to dodge the `(root_id, relative_path, group_key)` UNIQUE
against an already-materialised sibling. 058 makes N siblings per folder the
norm, so a needs-review item resolving to `dark` is **more** likely to find an
existing `dark` sibling to collide with, not less. Deferring the cleanup would
be deferring it into a harder problem.

### Two constraints the implementation must respect

**1. `clear_needs_review_sentinel` does three things, not one.**
`crates/persistence/db/src/repositories/inbox.rs:584-600` writes `group_key`
**and** `frame_type` **and** `state = 'classified'` in a single statement.
[research.md](research.md) describes it as purely a UNIQUE-constraint dodge; in
fact it is **the only path that makes a resolved needs-review item truthfully
classified**. Any replacement MUST preserve all three writes as one atomic
transition, or it recreates FR-007's exact violation — a `classified` state with
no frame type — in a new location. Promoted to FR-029.

**2. The #1086 regression test survives in intent, and is edited in mechanism.**
`reclassify_type_agreement_without_mandatory_attrs_stays_needs_review`
(`crates/app/inbox/src/reclassify.rs:1086`; this question originally cited
`:1027`, and the spec cited `1076-1146`) must keep passing.

Its invariant is **representation-independent**: frame-type agreement across an
item's files is not sufficient evidence to report that item classified; the
mandatory-attribute gate must pass; and all three surfaces — API response, item
row, and classification cache — must agree on the answer. The third assertion is
the anti-#711 clause, forbidding the cache from diverging from the row.

Nothing in that invariant requires "needs review" to live in `group_key`. So the
test's **setup and assertion will be edited** to read the new field. **This is
recorded explicitly so that no later reader mistakes that edit for a weakening
of the gate.** The invariant and SC-011 survive intact; only the representation
the test pokes at changes. Promoted to FR-030.

---

## Q-9 — Does the `mixed` classification branch become dead code? — RESOLVED: no, and the premise was false

**Answer**: **Keep `mixed` as is.** The question's premise does not hold, so it
largely answers itself. Promoted to FR-031.

**The finding**: `mixed` remains reachable — but by a different route than
this document first recorded. The original mechanism given here was refuted at
Layer 2; see the correction below.

`mixed` is reachable **only** via `classify.rs:404` (`_ => ("unclassified",
"mixed", None)`): a folder whose files span two or more distinct frame types
stores DB `result = "unclassified"` while returning API `classification_type =
"mixed"` for its **pre-materialization placeholder** item. That is the sole
live path, and removing the affordance would leave it with no rendered
explanation of why Confirm is disabled.

**The reclassify route is not a second path** — this is the correction. It was
recorded here as: a needs-review item whose files receive two different
`manual_override` values makes the distinct set over
`manual_override.or(frame_type)` (`classify.rs:1223`) size 2, so the item
reports `mixed`. That does not happen. `reclassify_v2` does write
`manual_override` (`reclassify.rs:556`), but the subsequent
`materialize_sub_items` → `seed_sub_item_cache` rebuild **deletes and
re-inserts that item's evidence with `manual_override: None`**
(`classify.rs:1023`, `:1038`). The distinct set therefore sees an empty set and
reports `unclassified`.

**Verified at Layer 2, not by reading.** Two files with unmapped `IMAGETYP` and
no `EXPTIME` were landed in one `__needs_review__` item, then given two
different frame types (`light` and `dark`) through the real per-file dropdowns
and the real "Apply manual overrides" button — one `reclassify_v2` carrying two
differing overrides, exactly the scenario recorded above. Result: no
`inbox-mixed-alert`, both files still reported as unclassified evidence, and
Type labels `["unclassified", "needs review"]`. Meanwhile
`inbox_ui_mixed_folder_splits_into_single_type_items` — which gates on
`inbox-mixed-alert` — passes, which is what pins the surviving path to
`classify.rs:404`.

Since 058 removes placeholder rows entirely, **058 is itself the change that
finally makes `mixed` unreachable.** That should be stated explicitly when the
plan gate sizes FR-031.

**A Layer-2 journey also depends on the affordance as a synchronisation
signal.** `crates/e2e-tests/tests/inbox_ui_journeys.rs:237` waits on
`inbox-mixed-alert` specifically because its appearance "proves the split was
materialized server-side" (comment at `:232-236`). Removing the affordance would
hang that journey — one of the three SC-005 journeys — rather than fail it
cleanly.

### Two follow-ups

**1. ~~A code comment becomes factually wrong.~~ WITHDRAWN — the comment is
correct.** This document previously flagged
`apps/desktop/src/features/inbox/InboxPage.tsx:599-606` for correction, on the
grounds that its claim — `classification.type === "mixed"` is "only reachable
when the SELECTED item is still the pre-materialization leaf-folder row" — was
a premise 058 invalidates.

That flag was wrong, and it was wrong because it rested on the refuted
reclassify mechanism above. The comment describes `classify.rs:404` precisely,
which the Layer-2 evidence confirms is the only live path. **No correction is
needed in 058's first code PR.**

Worth recording why this inverted: the comment was accurate, this specification
read it as stale, and then cited its own misreading as evidence that the
comment was misleading. Only running the scenario settled it. Treat
confidently-argued claims about this surface as unverified until a journey
drives them — that applies to this correction too, which is verified for the
override shape tested and not proven exhaustive over every possible one.

**2. An open design gap, for the plan gate to size — not to decide here.**
Resolving a heterogeneous needs-review bucket into two frame types is the
*expected* outcome of the user doing what they were asked to do. This feature's
own model says two types means two siblings. So that item arguably ought to
**split**, rather than come to rest in `mixed` with Confirm disabled — a dead end
the user can only escape by re-editing answers that were correct. Recorded as an
edge case in [spec.md](spec.md#edge-cases). It inherits the item-identity /
remount hazard already documented at `inbox_ui_journeys.rs:390-399`, because
splitting moves the resolved files onto a different item id mid-interaction.

---

# Corrections to concerns raised against this specification

Two concerns raised during review do not survive contact with the code, and are
recorded here so they are not re-raised at the plan gate.

**`write_minimal_fits` omitting `EXPTIME` is not a defect.** It is deliberate and
documented (`crates/e2e-tests/tests/common/mod.rs:1857-1863`): the omission
routes every frame type to the needs-review sentinel, which is what the
needs-review journeys want. `write_minimal_fits_with_exposure` (`:1883`) exists
for journeys that need a frame to actually classify, and the mixed-split journey
already uses it. No action.

**The real hidden E2E cost is different, and larger.** Two helpers assume a scan
yields exactly one *selectable* inbox item per folder:

- `rescan_and_wait_for_item` (`crates/e2e-tests/tests/inbox_ui_journeys.rs:135-138`)
  waits for at least one `inbox-item-*` testid immediately after scan.
- `select_only_item` (`:148-165`) takes the first `inbox-item-` suffix found,
  clicks it, and waits for `inbox-confirm-btn` to mount.

Under **D-006**, scan creates no inbox item at all — only a source group. Both
helpers therefore break unless the source-group row is rendered with an
`inbox-item-*` testid **and** mounts a Confirm button. But
[spec.md](spec.md#edge-cases) requires that the source-group row must **not** be
confirmable. **Those two requirements are in direct tension**, and the tension
must be resolved before these journeys can be repaired.

Call sites affected: `:224`/`:230`, `:368`/`:369`, `:493`/`:494`, `:554`/`:555`,
`:630`/`:631` — **five journeys, including all three SC-005 journeys.**

This is not itself an open question: it is a cost of the already-decided D-006
surfacing through Q-9's territory. **The plan gate must budget for it.**
