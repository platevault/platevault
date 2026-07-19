# Feature Specification: Inbox — Drop Parent Items

**Feature Branch**: `spec/057-inbox-drop-parent-items`

**Created**: 2026-07-19

**Status**: Draft

**Input**: Product-owner decision: "Drop the concept of parent inbox items
entirely. A folder produces one or more real inbox items, never a parent plus
children. Homogeneous folder → exactly one item. Mixed folder → N sibling
items. Siblings are linked by sharing a source group. Upon split
classification, the linkage is broken. Greenfield — no backwards
compatibility."

**Resolves**: [#711](https://github.com/platevault/platevault/issues/711) —
inbox list-row classification badge disagrees with its own detail panel.

**Supersedes the read-side workarounds in**: PR #1038 (`1eae04e9`) and the
follow-up PR #1081 (open at time of writing).

## Product Intent

A user who points PlateVault at a folder of subframes expects the Inbox to show
them **what is in that folder**. If the folder holds one kind of frame, that is
one thing. If it holds lights and darks together, that is two things. In both
cases every row the user sees should be a row they can act on: select it, read
its frame type, confirm it, and find its plan afterwards.

Today the Inbox shows something else. Every scanned folder produces an extra,
invisible-by-intent bookkeeping row — a "folder placeholder" — that carries no
frame type and no classification, yet is the row the user actually selects and
confirms for ordinary folders. For a folder that splits, the placeholder is
superseded by the real single-type rows but is not removed, so it lingers in the
list advertising a classification it does not have.

This has produced a visible, reproducible lie. In #711 Instance A a list row
reads **CLASSIFIED** while opening it shows `unclassified`, a blocking
"Frame types required" banner, and a disabled Confirm button. In Instance B the
row reads **NEEDS REVIEW** while the item is in fact a confirmable light frame.
The list and the detail panel disagree about the same item id, in both
directions — a false-safe and a false-danger.

The badge is not rendering the wrong thing. The badge is rendering the database
faithfully, and **the database contains a false statement**. Classification sets
the placeholder's state to `classified` while leaving it with no frame type and
no group key, so a row that has never been classified truthfully claims it has.

Two attempts have already patched the read side rather than the cause, and the
second exists only to repair the first. That is the signal that the model, not
the query, is wrong. This feature removes the parent concept so that every row
in the Inbox is a real, actionable item that states only true things about
itself.

## Recorded Decisions

These were decided by the product owner before specification. They are recorded
here so a future reader can see they were considered, not overlooked. They are
not open for re-litigation during planning.

### D-001 — A folder produces only real items

A scanned folder yields **exactly one** inbox item when all its files belong to
one group, and **N sibling items** when classification finds N distinct groups.
There is no parent row, no placeholder row, and no aggregate row in any case.

### D-002 — Sibling linkage is a set relationship, not pairwise

Siblings are related by sharing one source group. This must hold for any N, not
only N = 2. Nothing in the model may assume a folder splits into at most two
items, and nothing may designate one sibling as primary, first, or authoritative
on behalf of the others.

### D-003 — Split classification breaks the linkage

Once classification has split a folder into distinct single-type items, those
items are **independent**. See [Linkage Semantics](#linkage-semantics) for the
exact meaning — this is a required deliverable of the spec, not an aside.

### D-004 — Greenfield: no backwards compatibility

**Decided by the product owner. This is a decision, not an oversight.**

No migration is written for existing parent+child rows. Legacy `sg-migrate-*`
source-group behaviour is not preserved. The model is not designed around
existing `plan_open` parent rows surviving the change. Existing library
databases do not need their inbox state preserved.

**Accepted risk**: v0.5.0 is already published with a working updater, so real
users may already hold a library database. Under this change, an existing
database's **open inbox plans and confirmed-but-unapplied inbox items would be
stranded** — the rows the plans and confirmations bind to are the very rows
being removed. The product owner has judged this acceptable given the current
user base and the cost of writing and testing a migration for a model that is
itself being deleted.

Planning MUST still decide *how* the stranding presents: silent breakage is not
acceptable even when data loss is. See
[PENDING_REVIEW_QUESTIONS.md](PENDING_REVIEW_QUESTIONS.md) Q-1.

## Linkage Semantics *(required by D-003)*

"The linkage is broken" is made precise as a split between two kinds of
relationship. The source group survives as an **identity** relationship and is
extinguished as a **lifecycle** relationship.

### What the source group still means after a split

The source group continues to answer exactly one question: *which inbox items
were derived from this folder?* It is retained because the folder on disk is
still one folder — a re-scan or re-classification reads one directory and must
reconcile its result against the rows that directory previously produced. It is
the anchor for folder-level facts that are genuinely folder-level: the root, the
relative path, the folder content signature, the format, and the lane.

### What the source group no longer means after a split

It confers no shared lifecycle. Concretely, after a folder has split into
siblings:

- **No shared state.** Each sibling has its own state. Confirming one sibling
  does not move another out of the queue.
- **No shared classification.** Each sibling carries its own frame type and its
  own classification result. No sibling's badge is derived from another's.
- **No shared plan.** Each sibling binds its own plan independently. A plan
  opened against one sibling neither blocks nor represents the others.
- **No shared signature.** Each sibling has its own content signature covering
  only its own files, and its own staleness verdict at confirm time.
- **No delegation.** No operation resolves "the item for this folder" and acts
  on it. Any code path that needs to act on a folder acts on an explicit,
  named item, or on all siblings explicitly.

### Observable difference

Before: selecting a split folder's placeholder row shows a state badge derived
from a row that has no frame type, and confirming it operates on a row whose
evidence spans multiple frame types.

After: there is no such row to select. Every selectable row has a frame type,
a truthful badge, and a confirm outcome that concerns only its own files.

### The one operation that stays folder-wide

Re-classification necessarily re-reads every file in the directory, because
frame type is derived from file headers and the files share a directory. It is
therefore scoped to the source group by construction. This is **re-derivation,
not lifecycle coupling**: it recomputes what the folder's items should be and
reconciles the existing rows against that answer. It does not propagate state,
plans, or confirmations between siblings.

The reconciliation rules this implies — in particular what happens to a sibling
that a re-scan no longer produces but that already has a plan — are a genuine
open question. See [PENDING_REVIEW_QUESTIONS.md](PENDING_REVIEW_QUESTIONS.md)
Q-2.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Every Inbox row tells the truth about itself (Priority: P1)

A user scans a library root and reviews the Inbox queue. Every row shows a frame
type and a state that match what they see when they open that row. There is no
row whose badge contradicts its own detail panel, and there is no row that
cannot be acted upon.

**Why this priority**: This is #711, the defect that motivates the feature, and
it is a trust defect. A user who catches the Inbox stating something false about
their library has no basis for trusting the destructive plans it proposes later.
Everything else in this feature is machinery in service of this outcome.

**Independent Test**: Scan a folder of uniform lights and a folder mixing lights
and darks. For every row in the resulting queue, compare the list badge with the
detail panel and with the item's own classification result. All three agree for
every row, in both folders.

**Acceptance Scenarios**:

1. **Given** a folder whose files are all light frames, **When** the user scans
   and classifies it, **Then** the Inbox shows exactly one row for that folder,
   badged `light`, and opening it shows a detail panel that agrees.
2. **Given** a folder containing both lights and darks, **When** the user scans
   and classifies it, **Then** the Inbox shows exactly two rows for that folder
   — one `light`, one `dark` — and no third row.
3. **Given** any row in the Inbox queue, **When** the user selects it, **Then**
   the detail panel's classification badge matches the list row's badge.
4. **Given** any row in the Inbox queue, **When** the user reads its state
   badge, **Then** that state reflects a classification the row actually
   carries — no row reports `classified` without a frame type.

---

### User Story 2 — Confirming an ordinary folder still works end to end (Priority: P1)

A user scans an ordinary single-type folder, confirms it to inventory, and then
reviews and applies the resulting plan. The row they selected stays selected
through classification and confirmation, and "Review plans" appears.

**Why this priority**: Equal to US1 because this is precisely the regression
#1038 caused and #1081 repaired. The parent row is today the row that confirm
and plan links bind to for a homogeneous folder; removing it without moving
those bindings would reintroduce the exact failure that blocked roughly nine
PRs. This story exists to make that failure mode a first-class acceptance
criterion rather than something discovered in E2E.

**Independent Test**: Scan a uniform folder, confirm it, and assert the plan is
reachable on the plan surface and applies to the shown destination — the three
Real-UI journeys that #1038 broke.

**Acceptance Scenarios**:

1. **Given** a scanned uniform folder, **When** the user confirms it, **Then**
   a plan is created bound to that row and "Review plans" becomes available.
2. **Given** a confirmed uniform folder with an open plan, **When** the user
   opens the plan surface, **Then** that folder's plan is listed.
3. **Given** a user has selected a row, **When** classification completes,
   **Then** the selection is not silently dropped.
4. **Given** a user bulk-reclassifies frame types on a blocked folder, **When**
   reclassification completes, **Then** Confirm becomes enabled.

---

### User Story 3 — A mixed folder's parts are handled independently (Priority: P2)

A user scans a folder holding lights, darks, and flats. They get three rows.
They confirm the lights now and leave the darks and flats for later. The lights
leave the queue; the darks and flats stay, unaffected.

**Why this priority**: This is the payoff of D-003 and the reason Option 1
(parent always, never split) was rejected. It is P2 rather than P1 because the
mixed case is less common than the uniform case, but it is the case that
justifies the whole model.

**Independent Test**: Scan a three-type folder, confirm exactly one sibling, and
assert the other two are untouched in state, classification, and plan binding.

**Acceptance Scenarios**:

1. **Given** a folder that split into three siblings, **When** the user confirms
   one, **Then** the other two remain in the queue with their own states.
2. **Given** a folder that split into N siblings, **When** the user opens plans
   after confirming two of them, **Then** exactly two plans exist for that
   folder, each naming its own frame type.
3. **Given** a folder that split into N siblings, **When** the user views the
   Inbox summary counts, **Then** the folder's contribution to those counts
   matches the number of rows shown in the list.

---

### User Story 4 — Machine-derived classification is not re-asked (Priority: P2)

When a mixed folder splits, the user is not asked to re-state the frame type of
each resulting item. The split items arrive already classified, because the
frame types were derived from the files' own headers.

**Why this priority**: This is the reason Option 2a was rejected. Re-asking the
user to classify a split's output re-does machine work on a known answer and
turns a helpful split into busywork proportional to N.

**Independent Test**: Scan a mixed folder with readable headers and assert every
resulting sibling carries a frame type without any user input.

**Acceptance Scenarios**:

1. **Given** a mixed folder whose files carry readable frame-type headers,
   **When** it splits, **Then** each resulting sibling is already classified and
   requires no further user classification.
2. **Given** a folder where some files have unreadable frame types, **When** it
   splits, **Then** only the unclassifiable files are gathered into a
   needs-review item, and the classifiable siblings are unaffected by it.

---

### Edge Cases

- **A folder with no classifiable files at all.** Every file is
  unclassifiable. The folder must still produce a row the user can see and act
  on, rather than vanishing — it becomes a single needs-review item, not zero
  items and not a placeholder.
- **A needs-review item that the user fully resolves.** Once the user assigns
  frame types such that nothing is left needing review, the item must stop
  reporting needs-review. This currently relies on an in-place group-key rewrite
  to a synthetic value chosen specifically to dodge a uniqueness constraint
  against a sibling — see [research.md](research.md) §4.
- **A re-scan that changes the split.** A folder previously split into three
  now yields two, or one, or four. Which existing rows survive, and what happens
  to a row that no longer corresponds to any group but already carries a plan.
  See Q-2.
- **A re-scan that finds the folder unchanged.** Must not churn item ids, or
  the user's selection and any open plans are disturbed for no reason.
- **Two folders at the same relative path under different roots.** Identity must
  remain root-scoped.
- **A folder whose files all move into one group after reclassification.** A
  previously split folder becoming homogeneous must converge on a single item
  without leaving orphans.

## Requirements *(mandatory)*

### Functional Requirements

**Model**

- **FR-001**: A scanned folder MUST produce at least one inbox item and MUST
  NOT produce any item that lacks a classification identity.
- **FR-002**: A folder whose files all belong to one group MUST produce exactly
  one inbox item.
- **FR-003**: A folder whose files belong to N distinct groups MUST produce
  exactly N inbox items.
- **FR-004**: The system MUST NOT create, retain, or expose an inbox item that
  represents a folder as a whole in addition to that folder's real items.
- **FR-005**: Items derived from one folder MUST be identifiable as a set via
  their shared source group, for any N.
- **FR-006**: The system MUST NOT designate any sibling as primary or
  authoritative on behalf of its siblings.

**Truthfulness**

- **FR-007**: Every inbox item MUST carry a classification identity that is
  consistent with its own reported state; the system MUST NOT record a state of
  `classified` on an item that carries no frame type.
- **FR-008**: The classification shown for an item in the Inbox list MUST agree
  with the classification shown in its detail panel and with the item's own
  classification result, for every item.
- **FR-009**: Inbox summary counts MUST count each visible item consistently
  with the list, with no folder counted twice and none omitted.

**Lifecycle**

- **FR-010**: Confirmation MUST operate on exactly one inbox item and MUST NOT
  alter the state, classification, or plan binding of that item's siblings.
- **FR-011**: A plan MUST bind to exactly one inbox item.
- **FR-012**: Each sibling MUST be independently confirmable while its siblings
  remain unconfirmed.
- **FR-013**: Staleness detection at confirm time MUST be evaluated against the
  files belonging to the item being confirmed.
- **FR-014**: Re-classification MUST re-derive a folder's items from the files
  on disk without propagating state, plans, or confirmations between siblings.

**Re-scan**

- **FR-015**: Re-scanning an unchanged folder MUST NOT change the identity of
  its existing items.
- **FR-016**: The system MUST anchor folder-level re-scan comparison to the
  source group rather than to any single item.

**User-visible continuity**

- **FR-017**: A user's selection MUST NOT be silently dropped as a result of
  classification producing the folder's items.
- **FR-018**: After confirming an item, the resulting plan MUST be reachable on
  the plan surface.

**Removal**

- **FR-019**: The system MUST NOT retain read-side logic whose only purpose is
  to hide a superseded aggregate row from lists or counts.
- **FR-020**: No migration of existing parent-and-child inbox rows is provided
  (D-004). The absence of a migration MUST be recorded in the shipped change
  notes so an existing user is not silently surprised.

### Key Entities

- **Source group**: The folder-level identity for a scanned directory — its
  root, its path relative to that root, its content signature, its format, and
  its lane. Owns facts that are true of the directory itself. Relates to one or
  more inbox items. Is not itself an item and is never shown as a queue row.
- **Inbox item**: One actionable unit of the queue — a set of files from one
  folder that share a classification identity. Carries its own frame type,
  state, evidence, signature, and at most one plan binding. Every item is
  selectable, and every item states only facts about its own files.
- **Sibling set**: The inbox items derived from one source group. A set, of any
  size, with no distinguished member and no shared lifecycle.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every item in a scanned queue, the list badge, the detail
  panel badge, and the item's own classification result agree — zero
  disagreements, measured across uniform, mixed, and needs-review folders.
  (This is the #711 exit condition.)
- **SC-002**: Scanning a folder with one frame type yields exactly one queue
  row; scanning a folder with N frame types yields exactly N rows.
- **SC-003**: Zero inbox items exist in any state carrying a `classified` state
  without a frame type.
- **SC-004**: The Inbox summary counts equal the number of rows the list shows,
  for every combination of uniform, split, and needs-review folders.
- **SC-005**: The three Real-UI journeys that regressed under #1038 pass:
  catalogue-in-place zero-moves, confirm-then-apply-to-shown-destination, and
  bulk-reclassify-unblocks-confirm.
- **SC-006**: Confirming one sibling of an N-way split leaves the other N−1
  unchanged in state, classification, and plan binding.
- **SC-007**: Every read-side predicate that exists solely to suppress an
  aggregate row is deleted, and no replacement suppression logic is introduced.
- **SC-008**: Re-scanning an unchanged folder produces no item identity churn.

## Rejected Alternatives

Recorded with tradeoffs so they are not revisited without new information.

### Option 1 — Keep the parent always; never split

Make the folder-level row the single authoritative item in all cases, and never
materialize single-type items at all. A mixed folder stays one row.

**Genuine advantage**: The simplest possible model, one row per folder, and it
would have made #711 Instance A disappear without any of this work — the
aggregate row would no longer be superseded because nothing would supersede it.

**Rejected because** it reverts a deliberate earlier decision (spec 041 iterate:
mixed folders resolve into single-type items at ingest, behind a
missing-mandatory gate) that was taken for a reason that still holds. It also
leaves the metadata confirm gate with nothing coherent to gate on for a mixed
folder: the gate asks whether an item's mandatory metadata is present, and for a
row spanning lights and darks the answer is neither yes nor no. The user would
be back to confirming a folder wholesale or not at all, which is what the
single-type work was done to escape.

### Option 2a — Split into siblings, but require the user to re-classify each

Adopt the sibling model, but treat the split output as unclassified and require
the user to state each sibling's frame type.

**Genuine advantage**: Maximally explicit — nothing enters inventory without the
user having affirmed it, and it sidesteps every question about trusting
header-derived classification.

**Rejected because** classification is derived from the files' own headers. The
split exists *because* the machine already determined the frame types; asking
the user to restate them re-does known machine work and imposes effort
proportional to N on a user whose files were readable all along. The
needs-review path already exists for the case where the machine genuinely cannot
tell, which is the case where user input carries information.

### Option 2b — Split into siblings, carrying classification forward *(chosen)*

The derived frame types are carried onto the siblings, which arrive classified.
User input is required only where the machine could not determine a frame type.
This is D-001 through D-003.

### Not considered a real option — patch the read side again

Two attempts have already done this: #1038 hid the aggregate row whenever any
sibling existed, which broke homogeneous folders because for those the aggregate
row is the one confirm and plans bind to; #1081 narrowed it to genuine splits,
which fixed the regression and knowingly returned #711 Instance A for the
unsplit case. #1081's own follow-up notes state that fixing it properly means
making the real items authoritative rather than hiding the row the workflow
depends on. A third read-side patch would leave authority silently flipping
between rows depending on group count, with nothing in the model declaring which
row is authoritative.

## Assumptions

- The existing source-group record already holds the folder-level identity this
  model needs (root, relative path, content signature, format, lane), so no new
  folder-level concept is introduced — verified, see [research.md](research.md)
  §3.
- Sibling coexistence at one folder path is already supported, because the
  current parent and child rows already coexist that way — verified, see
  [research.md](research.md) §3.
- Classification remains derived from file headers, and the needs-review bucket
  remains the mechanism for files whose frame type cannot be determined.
- The lane distinction (move versus catalogue) remains a folder-level property
  of the source group, not a per-item property.
- No change is intended to how plans are reviewed or applied, beyond which item
  a plan binds to.

## Out of Scope

- Any change to how frame types are inferred from headers.
- Any change to plan review, plan application, or the filesystem-mutation
  safety model.
- Any change to the metadata confirm gate's criteria (only to which item it is
  evaluated against).
- Migration of existing inbox data (D-004).

## Dependencies

- PR #1081 is open at the time of writing and touches the same read-side
  predicates this feature deletes. The interaction between the two is a
  sequencing question for planning — see
  [PENDING_REVIEW_QUESTIONS.md](PENDING_REVIEW_QUESTIONS.md) Q-3.

## Next Gates

Per the constitution, this specification must pass review before planning.
`plan.md`, `data-model.md`, `contracts/`, and `tasks.md` are deliberately not
included here — they are owned by the plan gate. [research.md](research.md)
records the current-code evidence gathered during specification so the planner
does not have to re-derive it.
