# The Inbox

The Inbox is the single gate through which files enter your library. Whether
new captures land in a drop folder that needs sorting, or you point PlateVault
at a folder you have already organized by hand, the flow is the same: scan,
review the classification, fix anything the file headers didn't say, and
confirm. Confirming never moves a file by itself — it produces a reviewable
plan, and only applying that plan changes anything on disk (see
[The safety model](./09-safety-model.md)).

[screenshot: the Inbox with several classified items and the status bar breakdown]

## Scanning and classification

**Rescan** picks up new folders and files under your registered inbox and
library roots. Detected items appear in the queue with their frame type
(**Light**, **Dark**, **Flat**, **Bias**, **Master**), filter, exposure, and
file counts, read from the FITS/XISF headers.

A folder that mixes frame types — say lights and darks together, or two
different exposure lengths — is never shown as one ambiguous item. It splits
into several single-type items (for example `light · Ha · 300s`,
`light · Ha · 120s`, `dark · 300s`), each still visibly grouped back to its
shared source folder. The status bar's per-type breakdown always matches the
real contents of the queue.

You can search the queue (**Search detections…**), filter by file type
(**FITS** / **Video**) and kind, group by dimensions such as target,
frame type, exposure, or source (**Group by**, with a second level:
"Group: {label} · then: {label}"), and sort any column.

Selecting an item shows its **Detection details**: classification,
per-file metadata (**Object**, **Exposure**, **Gain**, **Temp**, **Binning**,
raw `IMAGETYP`), and where each file would go.

## Needs review — the missing-metadata gate

Some metadata is mandatory before a file can be filed correctly — most
commonly the filter for a light frame, or the target when there is no filter
and no coordinates in the header. When something mandatory is missing:

- A danger panel names exactly what is missing: "Missing required
  attribute(s): {attrs}", with the summary "{count} files missing required
  attribute(s) for their destination — confirm disabled. Assign the missing
  value(s) in “Needs review” above, then confirm."
- Affected rows get a "needs {attrs}" badge.
- **Confirm to inventory** is disabled — and this is not just a grayed-out
  button: the backend independently refuses a confirm attempt for the same
  reason, so there is no way to sneak an incomplete file past the gate.

[screenshot: an item in the Needs review state with the missing-attributes banner]

### Fixing it: bulk reclassify

Select the affected files and use the bulk override controls to set the
missing value — **Frame type**, filter (e.g. `Ha`), **Exposure (s)**, or
**Binning** (e.g. `2x2`) — then **Apply to selected ({count})**. Reclassifying
only rewrites PlateVault's own index: the files' bytes are never touched, and
your override survives a rescan. Once resolved, the item re-partitions into a
clean single-type item and **Confirm to inventory** re-enables.

> **Not yet available:** the reclassify controls currently cover the common
> fields listed above. A fully generic per-property editor (any path-relevant
> attribute) exists under the hood but has no UI yet.

## Confirming — move mode

Confirming a classified item from an unorganized source (an inbox, or a root
you marked **Needs organizing**) produces a *move plan*:

1. Press **Confirm to inventory** (or **Confirm all ({count})** for the whole
   queue; bulk confirm skips items that still need review and tells you so).
2. If more than one library root can host this frame type, PlateVault asks
   you to pick: "**Choose a destination library root** — More than one
   library root can host {category} frames. Pick where these files should go
   to generate the plan." With exactly one valid root, it is chosen
   automatically. With none, the confirm refuses: "No library root is
   registered for this frame type."
3. A toast confirms: "Plan created ({count} items). Review below before
   applying." The item stays in the queue, now marked "plan open" — it does
   not disappear.

Each planned file's destination is resolved from your per-frame-type folder
pattern (for example `{target}/{filter}/{date}/light/` — configurable under
[Settings → Naming](./08-settings.md#naming--folder-structure)) and shown in
full before anything happens.

## Confirming — catalogue-in-place

Files under a root you marked **Already organized** go through exactly the
same classification and needs-review gate, but confirming produces a
*catalogue plan* instead: every action is "catalogue in place", the plan
reports zero moves, and no destination picker appears — there is nothing to
pick, because the files are staying put. Applying such a plan only writes the
files' identity and metadata into PlateVault's index; on disk, nothing
changes byte-for-byte. Afterwards the files appear in derived views such as
[Sessions](./03-sessions.md).

The deciding factor between move and catalogue is the *root's* organization
state — chosen when you registered it — not the frame type or file kind.

## Reviewing and applying plans

Open plans collect in the **Review plans** section. Each plan row shows its
**Composition** (for example "{count} catalogued in place" or
"{moved} moved · {inPlace} catalogued in place") and lets you inspect every
action before committing.

- For plans that remove source files, you choose where they go: "Where should
  removed source files go?" — **Archive folder** or **System Trash**, with
  the honest hint "Archive keeps a recoverable copy; Trash is unrecoverable."
- **Apply** (or **Apply all** / **Apply selected ({count})**) executes the
  plan with live progress ("{applied} of {total}"). Success shows
  "Plan applied."; a failure reports exactly how far it got: "Apply failed
  after {applied} applied, {failed} failed."
- **Discard** throws the plan away without touching disk: "Plan discarded.
  Item is available for re-confirmation."

[screenshot: the Review plans section with one plan expanded showing per-file destinations]

Safety behaviors you can rely on here:

- A **stale plan** — the source files changed on disk after you confirmed —
  refuses to apply: "Source files changed — discard and re-confirm to
  regenerate this plan."
- A destination collision is refused rather than silently overwritten, and
  the refusal itself is written to the [audit log](./09-safety-model.md#the-audit-log).
- Two plans cannot race each other over the same files: "Another plan is
  currently working on the same files or folders. Wait for it to finish,
  then try again."

## Related journeys

- [Journey 2 — Ingest → review/reclassify → confirm (move mode)](../product/user-journeys.md#journey-2--ingest--reviewreclassify--confirm-move-mode)
- [Journey 3 — Ingest → confirm (catalogue-in-place)](../product/user-journeys.md#journey-3--ingest--confirm-catalogue-in-place)

Click-by-click scenario scripts:

- `e2e-agentic-test/041-inbox-plan-surface/mixed-folder-single-type-subitems/scenario.md`
- `e2e-agentic-test/041-inbox-plan-surface/missing-mandatory-gate/scenario.md`
- `e2e-agentic-test/041-inbox-plan-surface/reclassify-field-agnostic/scenario.md`
- `e2e-agentic-test/041-inbox-plan-surface/confirm-move-vs-catalogue/scenario.md`
- `e2e-agentic-test/041-inbox-plan-surface/plan-overlay-apply-audit/scenario.md`
- `e2e-agentic-test/025-filesystem-plan-application/plan-overlap-guard/scenario.md`
- `e2e-agentic-test/journeys/grand-inbox-journey/scenario.md`
