# TinySpec: Split reclassify into per-item classification and folder re-derivation

**Branch**: spec/reclassify-split
**Date**: 2026-07-19
**Status**: draft — blocked on spec 058 Q-5
**Complexity**: medium (this is the target architecture spec 058 descopes; it is
not a self-contained refactor)

## What

`reclassify_v2` (`crates/app/inbox/src/reclassify.rs:302`) does two unrelated
jobs under one name: it carries a **user's classification intent** ("these files
are darks"), and it performs a **folder-wide re-derivation of identity**
(re-reading the directory and reconciling the rows it previously produced).

Because it is folder-scoped, it carries a folder-wide plan interlock
(`reclassify.rs:347-360`): the operation is refused outright if *any* sibling in
the source group has an open plan. A user who confirmed the lights in a folder
cannot then reclassify its darks. That is a lifecycle coupling between rows the
user sees as independent, and it contradicts spec 058's D-003 ("No shared plan.
A plan opened against one sibling neither blocks nor represents the others",
`specs/058-inbox-drop-parent-items/spec.md:181-182`) and FR-022 (`spec.md:417`).

Separate the two jobs, and the interlock has nothing left to guard.

## Decisions (owner-approved)

1. **Per-item reclassify is the only user-facing classification action.**
   Scoped to one item; blocks only on that item's own plan. `reclassify` (v1,
   `reclassify.rs:67`) already has this shape, and its per-item check
   (`:82`) is already D-003-compatible.
2. **Folder re-derivation is a separate, identity-scoped operation.** It is
   triggered by disk change (scan / re-scan), not by a user's classification
   intent, and it **never blocks**. It recomputes what the folder's items should
   be and reconciles existing rows against that answer.
3. **The interlock is retired by irrelevance, not deleted defensively.** Once
   re-derivation is unreachable from a user classification action, the
   folder-wide refusal is guarding a path that no longer exists. Removing it is
   a consequence of the split, not a separate risk-taking act.
4. **Supersede-and-surface, never silently cancel.** When re-derivation orphans
   a plan-linked sibling — its group no longer exists on disk — the item is
   marked **superseded** and the user is told their files changed underneath an
   open plan. The user decides what happens to the plan. Silently destroying
   confirmed work is worse than blocking; silently skipping leaves the stale
   "keep and show" row that D-005 rejects (`spec.md:116-117`).
5. **Event-driven inversion, not a new dependency edge.** `cancel_plan` lives at
   `crates/app/core/src/plan_apply.rs:1871`; package `app_core`
   (`crates/app/core/Cargo.toml:2`) is **not** a dependency of
   `app_core_inbox` (verified: `crates/app/inbox/Cargo.toml`). Treat that as the
   signal it is — inbox should not be cancelling plans. Inbox emits a
   supersession event; the plan layer listens and decides. The codebase already
   does exactly this in `crates/app/inbox/src/plan_listener.rs`, which at
   `:139-141` already transitions an item back to `classified` ("allow re-split")
   when a plan is cancelled, failed, or partially applied. Plan resolution
   re-opening re-split is established territory, not a new pattern.

## Verified findings (read on `origin/main` @ `5059e164`)

- **There are two plan interlocks, not one.** Besides `reclassify.rs:347-360`,
  the classify path skips re-derivation entirely for a plan-open item:
  `classify.rs:433` filters `source_group_id` on `item.state != "plan_open"`
  before calling `materialize_sub_items` at `:434-435`. Decision 3 must account
  for both; retiring only the reclassify interlock leaves re-derivation still
  refusing plan-open items on the scan path.
- **The empty-signature claim is wrong in both the spec and the code.**
  `folder_signature` (`crates/app/inbox/src/signature.rs:69-76`) hashes a sorted
  (here: empty) list and hex-encodes the digest, so `folder_signature([])`
  returns the SHA-256 of empty input — the fixed 64-char constant
  `e3b0c442…b855` (verified: `printf '' | sha256sum`), **not** an empty string.
  `reclassify_v2` reaches it by passing an empty slice
  (`reclassify.rs:820-822`). Consequences:
  - Every item that has been through `reclassify_v2` carries the **same
    universal constant**, in every folder and every library. The confirm
    staleness guard (`confirm.rs:197-198`) therefore compares equal trivially
    and is **vacuous on main today** — a live defect independent of 058.
  - `research.md:172` and `PENDING_REVIEW_QUESTIONS.md` Q-5 both describe this
    signature as "empty". So does the code comment at `reclassify.rs:648-649`
    ("the signatures will be zero-length … yielding an empty sub-group sig").
    All three are wrong. An "empty means stale" rule cannot be implemented as an
    emptiness check.
- **The orphan path is a silent no-op, not an invalidation.**
  `materialize_sub_items` purges vanished groups via
  `delete_sub_item_if_unlinked` (`classify.rs:998`), whose SQL refuses to delete
  a plan-linked row (`crates/persistence/db/src/repositories/inbox.rs:610-619`).
  Without decision 4, removing the interlock leaves an item with an open plan
  corresponding to nothing on disk, still visible in the queue.

## Dependency

**Gated on spec 058's Q-5 landing first.** The owner decided confirm-time
staleness is a **per-item** property, with `reclassify_v2` computing real
per-group signatures — which requires threading a root absolute path into
reclassify (available at the command layer,
`apps/desktop/src-tauri/src/commands/inbox.rs`, but deliberately not carried in
the request today). Re-derivation cannot mark anything superseded if it cannot
detect supersession. Do not start decision 3 before that lands.

## Context

| File | Role |
|------|------|
| `crates/app/inbox/src/reclassify.rs` | Modify — remove the folder-wide interlock (`:347-360`); separate the classification-intent path from the re-derivation path |
| `crates/app/inbox/src/classify.rs` | Modify — `:433` plan-open filter; the purge loop at `:995-1002` must signal supersession instead of skipping |
| `crates/app/inbox/src/plan_listener.rs` | Context/Modify — the inversion pattern to follow; the listener side that reacts to a supersession event |
| `crates/persistence/db/src/repositories/inbox.rs:610-619` | Context — the plan-linked delete refusal that makes the orphan silent |
| `crates/app/core/src/plan_apply.rs:1871` | Context — `cancel_plan`, deliberately **not** called from inbox |
| `crates/app/inbox/src/confirm.rs:197-198` | Context — the staleness guard whose anchor Q-5 fixes |

## Requirements

1. A user's classification action MUST act on exactly one inbox item and MUST
   NOT be refused because a sibling has an open plan.
2. A user's classification action MUST still be refused when **that item** has
   an open plan.
3. Folder re-derivation MUST NOT be reachable from a user classification action,
   and MUST NOT refuse to run because any item has an open plan — including on
   the scan/classify path (`classify.rs:433`).
4. When re-derivation no longer produces a sibling that has an open plan, that
   item MUST be marked superseded and MUST NOT be left as a queue row that
   claims to describe files on disk.
5. The user MUST be told, explicitly, that a confirmation was superseded by a
   change on disk, and MUST retain the decision over the open plan. The system
   MUST NOT cancel or discard the plan without the user.
6. Supersession MUST be communicated from inbox to the plan layer by event, not
   by a direct call — no new `app_core_inbox` → `app_core` dependency edge.
7. Re-derivation MUST NOT propagate state, classification, or plan bindings
   between siblings (spec 058 FR-014).

## Out of scope

- Everything owned by spec 058: removing placeholder parent rows (D-001), the
  scan/classify boundary (D-006), folder grouping (D-007), the
  `exclude_split_placeholder!` deletion, and the needs-review sentinel question
  (058 Q-7).
- **Spec 058 Q-5 itself.** Real per-group signatures are a 058 deliverable; this
  spec consumes the result.
- Any change to plan review, plan application, or the filesystem-mutation safety
  model.
- Any change to how frame types are inferred from headers.

## Open questions

- ~~**058 FR-020 needs amending.**~~ **RESOLVED (2026-07-19): 058 was amended;
  decision 4 stands.** FR-020 had already been descoped out of 058 by Q-6, and
  D-005 already carried the "*supersede and surface, never silently cancel*"
  refinement — but D-005's opening paragraph and SC-009 still said the plan is
  cancelled, contradicting the refinement below them. Both now read "marked
  superseded, plan blocked from application pending the user's decision". No
  document still asserts automatic cancellation.
- **Who is the user-facing surface for a superseded item?** A queue row in a
  distinct state, a notification, or the plan surface — undecided. Requirement 5
  fixes the obligation, not the affordance.
- **Should the vacuous confirm guard be fixed ahead of both specs?** The defect
  is live on main today and is arguably independent of either spec. Fixing it
  standalone would give 058 Q-5 a working guard to build on; deferring keeps it
  bundled with the signature work. Not decided.
- **Does anything besides scan legitimately trigger re-derivation?** Decision 2
  names disk change as the trigger. Whether an explicit user "re-scan this
  folder" action is also required is unexamined.

## Next gates

Per the constitution this is a reference note, not a tracked feature. If it is
promoted, `plan.md` / `data-model.md` / `contracts/` / `tasks.md` are owned by
the plan gate — in particular the supersession event's shape, the superseded
item state, and the migration (if any) are deliberately not specified here.
