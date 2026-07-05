# Cleanup and archive

Processing runs leave behind intermediate files you no longer need once the
final image is done, and finished projects eventually deserve to move out of
the active library. Both operations are, by nature, the most dangerous things
a library manager can do — so PlateVault wraps both in the same
scan → review → apply discipline, and never deletes anything outright as a
first step. The full rationale lives in
[The safety model](./09-safety-model.md); this chapter shows the workflow.

## Cleanup: scan → review → apply

Cleanup lives on the project detail page, in the **Cleanup preview** section.

### 1. Scan (read-only)

**Scan for cleanup candidates** previews what could be reclaimed: "Scan this
project to preview cleanup candidates. Scanning is read-only — nothing is
removed without explicit plan approval." Candidates are grouped by kind
(**Intermediates**, **Masters**, **Finals**) with per-file **Size** and
classification **Confidence**, and a running "{size} reclaimable" total.

Protected items appear locked and unselectable, labeled
"Protected — never proposed for cleanup", with the reason spelled out (for
example "Master calibration frames are protected and excluded from cleanup
plans"). A project with nothing to clean says so: "**No cleanup candidates** —
The cleanup policy keeps every data type, or no processing artifacts have
been observed for this project."

[screenshot: cleanup preview with grouped candidates and the reclaimable total]

### 2. Generate the plan

Choose the **Destructive destination**:

- **Archive folder** (default) — "App-managed archive folder — reversible
  until you empty it".
- **System trash** — "OS-native recycle bin / trash".

Then press **Generate cleanup plan**. Only now does a real, reviewable plan
exist — and the destination is fixed into it, shown read-only from here on.

### 3. Review and apply

The **Review cleanup plan** overlay lists every affected item, one row per
file, and opens with the reassurance that matters: "Nothing has been changed
on disk. Review every proposed item below; applying requires explicit
approval."

If the plan touches protected items, each one must be individually
acknowledged (**Acknowledge**, tracked as "{done} of {total} require
acknowledgement") before **Approve & apply** becomes clickable. You can
always walk away with **Discard plan** — disk untouched either way.

Applying shows live progress ("Applying {applied} of {total}…") and finishes
with "Cleanup plan applied." Files move to your chosen destination — when
that is the Archive folder, nothing is deleted at all. Re-scanning afterwards
shows the cleaned files gone from the candidate list. An empty plan cannot be
approved.

[screenshot: the Review cleanup plan overlay with a protected item awaiting acknowledgement]

> **Not yet available:** a pre-flight free-space check ("would this fit at
> the destination?") is not implemented yet — the plan's required-bytes
> figure currently always reads zero.

## Archiving a finished project

Archiving moves a completed project's files into an app-managed archive
folder, and it is the *only* way a project's lifecycle reaches `archived`:

1. Pressing "Archive" on a completed project is **refused** unless an
   archive plan already exists and has been applied — "A filesystem plan is
   required before this transition. Create or approve a plan first." The app
   never silently flips a lifecycle state.
2. The archive plan goes through the same review overlay as cleanup —
   protected items acknowledged, approve, apply. The files move into the
   app-managed archive folder, and only then does the project flip to
   `archived`. Its Edit pane becomes read-only: "This project is archived.
   Settings are read-only."

> **Not yet available — important:** there is currently **no button in the
> app that generates an archive plan**. The archive workflow's review and
> apply machinery is fully in place, and the "Archive" action correctly
> refuses until a plan exists — but creating that plan has no UI entry point
> yet. Until it ships, archiving cannot be completed from the UI alone.

## The Archive page

The **Archive** page lists archived projects ("Projects appear here after
they're archived.") with search ("Search archive…"), an "archived" status
pill, and per-item details: **Original path**, **Size on disk**, **Archived**
date, **Reason**, and a real per-item **Audit history**.

From here you can send an archived item further along:

- **Send to trash** — moves the archived files to the OS recycle bin.
- **Delete permanently** — the strongest action in the app, guarded
  accordingly: "This permanently deletes the archived files for {name}. Type
  DELETE to confirm — this cannot be undone." Anything other than the literal
  word `DELETE` leaves the button disabled.

A reveal button (**Reveal in Explorer** in the current build; platform-native
wording such as **Show in File Explorer** / **Reveal in Finder** arrives with
a pending update) opens the item's location, and is disabled when there is
nothing on disk to reveal.

[screenshot: the Archive page with an item selected showing its audit history]

> **Not yet available:**
>
> - **Restore** (un-archive) is deferred by design: moving files back is a
>   filesystem mutation, so it needs its own reviewable plan generator, which
>   does not exist yet. The Restore control ships hidden or disabled rather
>   than pretending to work.
> - The Archive page covers **projects only**. There is no master or target
>   archival concept, and no Sessions tab — sessions no longer have a
>   lifecycle to archive (see [Sessions](./03-sessions.md)).
> - Some layout polish (single-column page, richer list) is still pending;
>   the core plan-gated archive → trash → delete flow works without it.

One documented deviation worth knowing: archive plans move files into an
app-managed folder (`.astro-plan-archive/<planId>/`) rather than a
user-patterned destination, so that trash and delete can reliably find an
item's files later.

## Related journeys

- [Journey 6 — Cleanup: scan → review → apply](../product/user-journeys.md#journey-6--cleanup-scan--review--apply)
- [Journey 7 — Archive → (delete from archive)](../product/user-journeys.md#journey-7--archive--delete-from-archive)

Click-by-click scenario scripts:

- `e2e-agentic-test/017-cleanup-archive-review-plans/cleanup-scan-review-apply/scenario.md`
- `e2e-agentic-test/017-cleanup-archive-review-plans/archive-lifecycle/scenario.md`
- `e2e-agentic-test/journeys/full-project-lifecycle/scenario.md` (Phases E–F)
