# Pending Review Questions — 057 Inbox Drop Parent Items

Questions raised during specification. **Five are now answered** (2026-07-19) —
Q-1, Q-2, Q-4 and Q-8 by the product owner, Q-3 by events. Answers are recorded
here and promoted to decisions D-005 through D-007 in
[spec.md](spec.md#recorded-decisions).

**Four remain genuinely open** and must be resolved at the plan gate: Q-5, Q-6,
Q-7, Q-9.

Line references verified against `22f94a9e`.

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

# Open

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

**Raised in priority by Q-2's answer**: D-005 requires an invalidation signal
when a re-scan supersedes a confirmation, and this guard is the existing
mechanism for that class of problem. Whether it is reused or a separate
invalidation path is built is now part of this question.

**Needs**: An engineering decision, with a regression test asserting the guard
still fires after reclassification.

---

## Q-6 — Should reclassify still block on any sibling having a plan?

**Context**: `crates/app/inbox/src/reclassify.rs:372-380` refuses to reclassify
when **any** item sharing the source group has a plan link.

**Unresolved**: This is a shared-lifecycle coupling, which D-003 says should not
survive. But it is also a genuine safety interlock.

**Changed by Q-2's answer**: D-005 now supplies a principled alternative that
did not exist when this question was written — instead of *blocking*
re-derivation because a plan exists, re-derivation proceeds and any plan whose
basis vanished is *invalidated*. That is consistent with both D-003 and
Constitution II, and suggests the interlock can be removed rather than
preserved.

**Still open because** removing a safety interlock deserves an explicit decision
rather than inference, and the invalidation path (Q-5) must exist and be tested
first. Sequencing matters: do not delete the interlock before invalidation
works.

**Needs**: A product decision, after Q-5.

---

## Q-7 — Does the needs-review sentinel workaround survive?

**Updated 2026-07-19 after `22f94a9e` (#1086).** That PR closed #711 Instance B
by re-checking the mandatory-attribute gate before promoting a sentinel-carrying
row, and by gating the classification-cache write with it
(`crates/app/inbox/src/reclassify.rs:186-201`, sentinel cleared at `:221`).

**What did not change**: `clear_needs_review_sentinel`
(`crates/persistence/db/src/repositories/inbox.rs:584-599`) still rewrites the
group key in place to a synthetic `type=<ft>·resolved=<item_id>` value, purely
to dodge the `(root_id, relative_path, group_key)` UNIQUE against an existing
sibling. The workaround survives #1086 intact.

**The question sharpens rather than resolves.** #1086 made the sentinel *more*
load-bearing, not less: `inbox_confirm` gates on
`group_key == SENTINEL_NEEDS_REVIEW` directly
(`crates/app/inbox/src/confirm.rs:174`), and the classification cache is now
gated by the same check. So `group_key` currently carries three distinct
meanings at once — a classification identity, a needs-review flag, and a
uniqueness discriminator.

**Unresolved**: Whether resolving a needs-review item should instead re-derive
the folder's items, merging the resolved files into the correct sibling (which
may already exist), retiring the synthetic key entirely.

**Why it matters**: A group key that encodes an item id is not a classification
identity, and FR-007 requires every item's identity to be consistent with its
state. Overloading one column with three meanings is what let a row claim
`classified` while carrying no frame type in the first place.

**Needs**: A data-model decision. Any change must preserve #1086's Instance B
fix, which has its own regression test at `reclassify.rs:1027`.

---

## Q-9 — Does the `mixed` classification branch become dead code?

**Context**: `canConfirm` requires `classification.type === 'single_type'`
(`apps/desktop/src/features/inbox/InboxPage.tsx:832-841`). The parent is exactly
the row that classifies as `mixed`.

**Unresolved**: Whether `mixed` remains reachable, and if not, whether
`InboxDetail.tsx:1037-1048` (`inbox-mixed-alert`), `mixedSummary` (`:842-843`),
the `handleConfirm` guard (`:607`), and the root-pick guard (`:691`) should be
removed.

**Narrowed by Q-4's answer**: under D-006 no `inbox_items` row is ever created
before classification, and classification produces only single-type items. So
`mixed` looks unreachable for items. The remaining question is whether an
unclassified **source-group** row needs its own equivalent of the mixed
affordance — a scanned-but-unclassified folder is precisely a folder whose
contents are not yet known to be uniform.

**Needs**: An engineering decision, after the D-006 row-union design exists.
