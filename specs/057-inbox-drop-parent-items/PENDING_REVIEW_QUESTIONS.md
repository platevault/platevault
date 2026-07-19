# Pending Review Questions — 057 Inbox Drop Parent Items

Questions that could **not** be resolved from the code and are not settled by
the product owner's recorded decisions. Each must be answered during the plan
gate. None of them reopen D-001 through D-004.

---

## Q-1 — How does the greenfield decision present to an existing user?

**Context**: D-004 accepts that an existing library database's open inbox plans
and confirmed-but-unapplied items are stranded, because the rows they bind to
are removed. v0.5.0 is already published with a working updater, so this can
reach a real user.

**Unresolved**: *Silent* stranding is not acceptable even when data loss is. The
options span: reset the inbox queue on first launch after upgrade and tell the
user; detect legacy rows and show a one-time explanation; refuse to start
against a legacy database; or do nothing and accept confusing residue.

**Why it matters**: An open plan describes pending filesystem mutations. A user
who believes a plan is queued and finds it silently gone has lost trust in the
plan surface, which is the product's core safety mechanism (Constitution II).

**Needs**: A product decision.

---

## Q-2 — What happens to a sibling that a re-scan no longer produces?

**Context**: A folder previously split into three now yields two — a file moved
groups, or headers changed. `delete_sub_item_if_unlinked`
(`crates/persistence/db/src/repositories/inbox.rs:610-619`) refuses to purge a
plan-linked row. Today such a row can quietly persist behind the parent. With no
parent, it is a visible orphan.

**Unresolved**: Is the plan-linked orphan kept and shown, kept and hidden,
invalidated with its plan cancelled, or blocked from re-scan until the plan
resolves?

**Why it matters**: This is the reconciliation rule the linkage semantics imply
but do not determine, and it is the one case where "the linkage is broken"
collides with "the folder is re-derived as a whole".

**Needs**: A product decision, then a data-model rule.

---

## Q-3 — Sequencing against PR #1081

**Context**: #1081 is open and modifies the same three predicates this feature
deletes, extracting them into `exclude_split_placeholder!`. It also adds a
regression test (`crates/app/core/src/inbox_plan.rs`) whose intent maps to
SC-005 but whose fixture is parent-shaped.

**Unresolved**: Land #1081 first and delete its macro here, or supersede it.

**Recommendation (not a decision)**: Land #1081. It repairs a live regression on
`main`, and this feature is a multi-artifact SpecKit change that will not land
quickly. Deleting a merged macro is cheap; leaving `main` regressed is not.

**Needs**: An engineering decision at plan time.

---

## Q-4 — Does scan create items, or does classification?

**Context**: `InboxScanFolderResponse.items` is one-row-per-folder by
construction (`apps/desktop/src-tauri/src/commands/inbox.rs:441-453`), because
scan creates the parent. But scan cannot know the group count — that requires
reading headers, which is classification's job.

**Unresolved**: Either scan creates one provisional item that classification
splits into N (which reintroduces a transient parent-like row, and with it the
selection-churn problem of FR-017), or scan creates the source group only and
classification creates all items (which leaves a scanned-but-unclassified folder
with no row to show).

**Why it matters**: This determines whether an aggregate row can exist even
transiently, which bears directly on D-001, and it determines what the user sees
between scan and classify.

**Needs**: A design decision, with FR-017 and the second option's empty-queue
window both explicitly weighed.

---

## Q-5 — What anchors the confirm staleness guard after reclassification?

**Context**: The confirm TOCTOU guard (`crates/app/inbox/src/confirm.rs:198`)
compares the item's content signature against the request's. Reclassify writes
an **empty** signature to re-materialized items
(`crates/app/inbox/src/reclassify.rs:665-674`) because it passes no file paths.
Today the parent's folder signature is a second anchor; after this change the
per-group signature is the only one.

**Unresolved**: Either reclassify computes real per-group signatures, or confirm
falls back to the source group's folder signature, or an empty signature is
defined as explicitly-stale and forces a re-classify.

**Why it matters**: The guard exists to stop a user confirming a plan built from
files that changed underneath them. An empty signature that compares equal to an
empty request signature would silently disable it.

**Needs**: An engineering decision. Whichever is chosen needs a regression test
asserting the guard still fires after reclassification.

---

## Q-6 — Should reclassify still block on any sibling having a plan?

**Context**: `crates/app/inbox/src/reclassify.rs:372-380` refuses to reclassify
when **any** item sharing the source group has a plan link.

**Unresolved**: This is a shared-lifecycle coupling, which D-003 says should not
survive. But it is also a genuine safety interlock: reclassification re-derives
the folder's items, and a plan bound to a row that re-derivation may delete is a
real hazard (this is Q-2 from the other direction).

**Why it matters**: It is the clearest case where D-003's "no shared lifecycle"
and re-derivation's folder-wide nature genuinely conflict. It should be resolved
deliberately, not by mechanically applying D-003.

**Needs**: A product decision, coupled with Q-2.

---

## Q-7 — Does the needs-review sentinel workaround survive?

**Context**: `clear_needs_review_sentinel`
(`crates/persistence/db/src/repositories/inbox.rs:585-598`) rewrites the group
key in place to a synthetic `type=<ft>·resolved=<item_id>` value purely to dodge
the `(root_id, relative_path, group_key)` UNIQUE against an existing sibling. It
exists because reclassify v1 mutates in place instead of re-splitting.

**Unresolved**: Whether resolving a needs-review item should instead re-derive
the folder's items (merging the resolved files into the correct sibling, which
may already exist), retiring the synthetic key entirely.

**Why it matters**: A group key that encodes an item id is not a classification
identity, and FR-007 requires every item's identity to be consistent with its
state. The synthetic key is a uniqueness hack wearing an identity field's
clothes.

**Needs**: A data-model decision.

---

## Q-8 — How are N sibling rows presented so the user can tell them apart?

**Context**: `InboxList.tsx:165-167` falls back to the root basename when the
relative path is empty, so N siblings of a root-level folder render N identical
Path cells. `InboxList.tsx:185` sorts by relative path with no secondary key, so
sibling order is unstable between renders.

**Unresolved**: What distinguishes sibling rows visually — frame type alone, an
explicit shared-folder affordance, grouping siblings together — and what the
stable sort key is.

**Why it matters**: The model makes multiple rows per folder routine where it
was previously rare. This is a **new** UX problem created by the change, not an
existing defect, and it is the most likely way a technically correct
implementation still produces a confusing Inbox.

**Needs**: A design decision. Worth a journey delta.

---

## Q-9 — Does the `mixed` classification branch become dead code?

**Context**: `canConfirm` requires `classification.type === 'single_type'`
(`apps/desktop/src/features/inbox/InboxPage.tsx:832-841`). The parent is exactly
the row that classifies as `mixed`. With no parent, it is unclear whether any
row can still classify `mixed`.

**Unresolved**: Whether `mixed` remains reachable, and if not, whether
`InboxDetail.tsx:1037-1048` (`inbox-mixed-alert`), `mixedSummary` (`:842-843`),
the `handleConfirm` guard (`:607`), and the root-pick guard (`:691`) should be
removed.

**Why it matters**: Dead branches around a confirm gate are a hazard — a future
reader may assume `mixed` is reachable and reason about a state that cannot
occur. Answer depends on Q-4.

**Needs**: An engineering decision, after Q-4.
