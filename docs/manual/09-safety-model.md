# The safety model

Your image library is years of clear nights, cold fingers, and disk space.
PlateVault's most important feature is not a button — it is a promise about
what the app will never do with those files. This chapter explains that
promise precisely, because trust you cannot verify is just hope.

## The five guarantees

1. **Your files stay yours, where they are.** PlateVault indexes your
   library in place. It never copies your images into a private store, and
   cataloguing an already-organized folder changes nothing on disk —
   byte-for-byte. Even removing a registered source only deletes
   PlateVault's *registration*: "Files on disk are never touched — this only
   removes the registration."
2. **Every mutation is a plan you review first.** No move, copy, archive, or
   delete ever happens as a side effect of clicking something. Confirming an
   inbox item, generating a cleanup plan, requesting an archive — all of
   these *propose*. Only approving and applying a plan executes.
3. **Nothing is overwritten silently.** A destination collision is refused,
   not resolved by guessing — and the refusal itself is recorded.
4. **Destructive means recoverable first.** Cleanup and archive move files
   to an archive folder or the system trash; permanent deletion is a
   separate, later, deliberately awkward step.
5. **Everything leaves a record.** Every attempted action and its outcome —
   including refusals and failures — is written to the audit log.

## Reviewable plans

A plan is a complete, itemized list of filesystem actions, shown to you
before anything runs. The review overlay opens with the sentence that defines
the whole model:

> "Nothing has been changed on disk. Review every proposed item below;
> applying requires explicit approval."

Every row shows the item, the action, the source path, and its protection
status. You have exactly two ways out: **Approve & apply**, or **Discard
plan** — and discarding is always safe, because a plan that was never applied
never touched anything.

[screenshot: the plan review overlay with per-item actions and protection column]

Plans are also defensive about the world changing underneath them:

- **Staleness.** If the source files change on disk between confirm and
  apply, the plan refuses to run: "Source files changed — discard and
  re-confirm to regenerate this plan." And if the *plan* changed after you
  reviewed it: "The plan changed since you reviewed it. Review it again."
- **Overlap.** Two plans cannot operate on the same files at once: "Another
  plan is currently working on the same files or folders. Wait for it to
  finish, then try again."
- **Emptiness.** "This plan has no items to apply." — an empty plan cannot
  be approved, so there is no such thing as a rubber-stamp apply.
- **Approval is not optional.** Attempting to apply an unapproved plan is
  refused: "Approve the plan before applying it."

These are not merely disabled buttons. The same rules are enforced again by
the application core when an action is actually attempted — so a UI glitch, a
stray click, or an automation script cannot slip past them.

## No silent overwrite

When a planned action would land on a path that already exists, PlateVault
refuses that action rather than overwriting, reports it, and records the
refusal in the audit log. The same conservatism applies in reverse: when
creating a project's folder structure, a file already sitting where a folder
should go doesn't get clobbered — creation succeeds around it, tells you, and
leaves the folder plan for review.

The one mutation that auto-applies — the mkdir-only plan that scaffolds a new
project's folders — is the exception that proves the rule: every action in it
creates an empty directory, none can touch a user file, and it still leaves
both a plan row and an audit record behind.

## Archive before delete

Destruction in PlateVault is a staircase, not a trapdoor:

1. **Cleanup** defaults to the **Archive folder** — "App-managed archive
   folder — reversible until you empty it". Choosing **System trash**
   instead is explicit, with its own honest hint ("OS-native recycle bin /
   trash"), and in the Inbox the difference is spelled out: "Archive keeps a
   recoverable copy; Trash is unrecoverable."
2. Archived items remain listed, searchable, and auditable on the
   [Archive page](./05-cleanup-and-archive.md#the-archive-page).
3. **Send to trash** moves archived files to the OS recycle bin — still
   recoverable by your operating system.
4. **Delete permanently** is the only irreversible step, and it demands you
   type the literal word `DELETE`: "This permanently deletes the archived
   files for {name}. Type DELETE to confirm — this cannot be undone." A
   click-through cannot do it; muscle memory cannot do it.

Lifecycle states follow the same discipline. A project only becomes
`archived` through an applied archive plan — the transition is otherwise
refused: "A filesystem plan is required before this transition. Create or
approve a plan first."

## Protected sources

Protection is a per-source safety level that decides how hard cleanup has to
work to touch a file:

- **Protected** — "Cleanup plans require explicit approval for this
  source's files." Protected items surface in scans as locked
  ("Protected — never proposed for cleanup"), and if one is ever included in
  a plan, it must be individually acknowledged during review — tracked as
  "{done} of {total} require acknowledgement" — before **Approve & apply**
  unlocks. You cannot approve-and-miss a protected file by accident.
- **Normal** — "Standard plan review applies; no extra acknowledgement
  required."
- **Unprotected** — "Destructive plan actions proceed without additional
  confirmation."

Some categories are protected wholesale by policy — for example "Master
calibration frames are protected and excluded from cleanup plans". The
default level for newly ingested sources is yours to set
([Settings → Cleanup → Source Protection](./08-settings.md#cleanup)), with
per-source overrides on each Data Sources card ("Inherits global default"
until you change it). A plan blocked by protection says so plainly: "This
plan is blocked by a protected item. Resolve the protection first."

## The audit log

**Settings → Audit Log** is the app's memory of everything it did — and
everything it declined to do. Every event carries a **Timestamp**, **Event**,
**Entity**, **Actor**, and **Outcome** — and the outcomes are honest:
**applied**, **ok**, **refused**, **failed**, **paused**. Refusals are
first-class events, not silent no-ops: a lifecycle transition denied for lack
of a plan is recorded as "Transition {fromState} → {toState} for {entityType}
requires an approved filesystem plan".

You can search ("Search events, entities, details…"), filter by date range,
page through history, and **Export** the log to a file. Projects add their
own layer on top: every lifecycle-relevant change appends an immutable
[manifest snapshot](./04-projects.md#manifests-and-notes), never rewriting an
earlier one.

[screenshot: the Audit Log pane showing a mix of applied and refused events]

## Inference is labeled, always

Wherever PlateVault infers instead of reads — classifying an artifact as an
intermediate or master, matching a calibration frame, resolving a target
name — the inference carries a confidence level and says so ("{kind} (low
confidence)", "Unattributed", mismatch indicators, "approximate" tooltips on
planner placeholders). A guess presented as a fact would be a safety bug;
see [Targets and planning](./07-targets-and-planning.md#the-planner-columns--what-is-real-today)
for the strictest application of that rule.

## What this means in practice

You can explore PlateVault fearlessly. Scans are read-only. Reviews are
read-only. Confirmations create proposals. The only moments your disk changes
are the ones where you pressed an explicit apply on a plan you could read in
full — and if you are ever unsure what happened, the audit log will tell you,
including the things that were refused on your behalf.

## Related journeys

The safety model is woven through every journey rather than being one of its
own — see especially:

- [Journey 2 — Ingest → review/reclassify → confirm (move mode)](../product/user-journeys.md#journey-2--ingest--reviewreclassify--confirm-move-mode) (stale plans, collision refusal)
- [Journey 6 — Cleanup: scan → review → apply](../product/user-journeys.md#journey-6--cleanup-scan--review--apply) (protection acknowledgement)
- [Journey 7 — Archive → (delete from archive)](../product/user-journeys.md#journey-7--archive--delete-from-archive) (plan-gated lifecycle, typed DELETE)

Click-by-click scenario scripts:

- `e2e-agentic-test/025-filesystem-plan-application/plan-overlap-guard/scenario.md`
- `e2e-agentic-test/016-source-protection-defaults/protection-defaults-take-effect/scenario.md`
- `e2e-agentic-test/041-inbox-plan-surface/plan-overlay-apply-audit/scenario.md`
- `e2e-agentic-test/audit-log/` (audit surface scenarios)
