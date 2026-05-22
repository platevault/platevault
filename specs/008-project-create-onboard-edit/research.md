# Research: Project Create, Onboard, And Edit

**Spec**: 008-project-create-onboard-edit | **Date**: 2026-05-09

## R1. Wizard Versus Single-Form For Create

### Question

Should "New project" be a multi-step wizard or a single long-form modal?

### Decision

**REVISED (GRILL 2026-05-22, A1)**: ~~Multi-step wizard~~ → **Single-form
dialog** with four fields: name (required), tool (required), optional initial
sources, optional notes. The prior five-step wizard decision (Identity → Tool →
Sources → Channels → Confirm) is explicitly reversed.

### Rationale for single-form

- The required information at create time is minimal: name, tool, optional
  sources, optional notes. Channels are inferred automatically from sources
  and do not need their own step at create time.
- A single dialog eliminates wizard-fatigue and URL-step complexity for a
  form that rarely exceeds a screen height.
- The form composes cleanly with spec 010's guided first-project flow without
  a structural fork: spec 010 wraps the same dialog with extra surrounding
  context.
- Channel inference still runs (R4), but surfacing it as a separate step adds
  indirection for a value the user rarely overrides at create time. Overrides
  are available post-create through the edit pane.

### Prior wizard rationale (now superseded)

The original rationale cited scroll-in-scroll pain from a multi-select picker
in a single form, and per-step validation benefits. These remain valid concerns
but the GRILL session concluded the create surface is simple enough that they
do not outweigh wizard overhead.

### Alternatives considered (post-reversal)

- **Multi-step wizard**: now the rejected option. Reconsider if user testing
  shows meaningful friction from a single-form layout (e.g. large Inventory
  sets causing scroll issues in the source picker).
- **Inline-in-page form** (not modal): rejected because the Projects page
  already hosts a drawer; a second editing surface causes layout collisions.

## R2. Source Picking: Inventory Versus Arbitrary Disk

### Question

When a user adds a source to a project (create wizard, edit pane, or
post-hoc Add source), can they pick an arbitrary folder, or must they pick
a row that already exists in Inventory?

### Decision

**Inventory-only.** The source picker shows confirmed Inventory sessions;
there is no "browse arbitrary folder" option. If the user wants to add a
folder that Inventory has not seen, they must first add a library root and
let the scanner populate Inventory (spec 003 / spec 006).

### Rationale

- Every downstream feature (calibration matching, filesystem plans,
  manifests, cleanup) assumes a source has been scanned: frame count,
  filter, exposure, and integrity hashes already exist on the Inventory
  row. Picking an arbitrary path would bypass that pipeline and force
  every downstream consumer to handle "source-without-metadata" as a
  separate branch.
- Inventory-only picking enforces the local-first-custody principle: the
  Project never holds bytes, only `(inventoryId)` references whose root
  remap is a single config write.
- The data snapshot fields on `ProjectSource` (`name`, `frames`, `filter`,
  `exposure`) are filled from the Inventory row at link time. Without
  Inventory, the snapshot would be empty and the drawer would render
  placeholder rows.

### Alternatives considered

- **Arbitrary disk picking with eager scan-on-pick**: rejected because it
  conflates two distinct user intents (add a library root vs add a project
  source) and makes the create wizard unpredictably slow when the chosen
  folder holds thousands of frames.
- **Arbitrary disk picking with deferred scan**: rejected because the
  Channels step (R4) requires per-source filter data; without a scan, the
  inference cannot run and the wizard would have to be split into two
  sessions.

## R3. Tool Inference Versus Explicit Selection

### Question

When the user creates a project, should the processing tool be inferred
from the source content (e.g. presence of `.xisf` → PixInsight) or
selected explicitly?

### Decision

**Explicit selection with a default**. The Tool step shows a radio group
seeded with `PixInsight` as default. The user can change the selection at
any time before Confirm. Inference is not run.

### Rationale

- File format and tool choice are not 1:1. Users routinely process FITS
  through PixInsight, debayer XISF in Siril for experiments, and feed
  planetary AVI/SER into AutoStakkert before passing TIFs to PixInsight.
- The current user base is PixInsight-leaning (per `PRODUCT.md`); a
  PixInsight default minimises clicks for the majority while preserving
  full control for Siril and Planetary Suite users.
- Tool drives the FilesystemPlan scaffold (folder layout, project marker
  file format). Inferring it silently and then writing a different
  scaffold than the user expected violates the reviewable-filesystem-
  mutation principle.

### Alternatives considered

- **Inference from source content**: rejected for the silence reason and
  because inference accuracy on real-world libraries is low (XISF files
  used in Siril; FITS used in PixInsight; mixed extensions in planetary
  workflows).
- **No default**: rejected because forcing a choice every time the user
  creates a project is friction without benefit; the default can be moved
  in Settings (spec 018) once that surface ships.

## R4. Channel Detection

### Question

How are project channels (`["Ha","OIII","L",...]`) determined?

### Decision

**Auto-inferred from source filters with explicit user override on the
Channels wizard step.** Inference reads the `filter` field on each linked
`ProjectSource` (which itself was populated from FITS metadata during
scan) and produces a deduplicated, alphabetised list. The Channels step
shows the inferred list with each channel as a removable chip, plus an
"Add channel" input for manual additions (e.g. user wants to reserve a
channel for future capture).

The override is sticky: if the user removes an inferred channel and then
adds another source whose filter matches the removed channel, the channel
returns. If the user manually added a channel, it persists even when no
source contributes to it. The two cases are distinguished by a
`source: "inferred" | "manual"` flag on the channel record (stored on the
project; not surfaced in v1 UI but read by audit).

### Rationale

- Inference covers the 90% case where channel = filter. Manual override
  handles narrowband-with-pre-binning, RGB-from-OSC, and reservation
  cases.
- Sticky-manual prevents silent regressions when Inventory metadata
  changes (e.g. filter rename in Inventory).
- The `source` flag keeps the audit story honest: a later "channel set
  changed" event can attribute the change to inference or to the user.

### Alternatives considered

- **Pure inference (no override)**: rejected because narrowband-OSC users
  cannot describe their projects.
- **Pure manual (no inference)**: rejected because typing the same five
  filters every project is tedious and error-prone, especially for the
  Hubble-palette common case.
- **Inference only at create time, frozen after**: rejected because
  adding a new filter mid-project is a real workflow (e.g. adding an SII
  pass to an existing Ha/OIII project).

## R5. Naming Conventions

### Question

Are project names free-text, templated, or guided?

### Decision

**Free-text with light validation**: non-empty, length ≤ 120 chars, and
not a duplicate within the user's project list. No template enforcement.

### Rationale

- Naming preference is intensely personal in astrophotography (target +
  date + scope + filter set combinations vary by user). A template would
  either underspecify (looks identical to free text) or overspecify (the
  template doesn't match the user's existing naming).
- The duplicate check is scoped to the user's library; cross-library
  duplicates are not detected (and don't need to be — projects are
  library-local).
- Length cap is a database-hygiene measure, not a stylistic one. 120
  matches the cap on `lastAction.label`.

### Alternatives considered

- **Templated name** (`{Target} - {Date} - {Scope}`): rejected for
  rigidity; reconsider as a Settings-driven default once spec 018 ships.
- **Suggested name from sources**: rejected for v1; the suggestion would
  itself require a template, deferred to a future enhancement.
- **No validation**: rejected because empty names and silent duplicates
  break the drawer header rendering.

## R6. Onboarding Marker Reconciliation

### Question

When the user onboards an existing folder, how does the app handle a
project marker that may already exist (from a previous install, a sibling
tool, or a partial earlier onboard)?

### Decision

**Three-way reconciliation on the Detect step:**

1. **No marker present**: app proposes to write a new marker as part of
   the FilesystemPlan; user confirms.
2. **Marker present and parsable as our format**: app reads it, fills the
   wizard with the recovered metadata (name, tool, source list), and
   asks for confirmation. The onboard becomes a "link existing" rather
   than "create".
3. **Marker present but unparsable (foreign or corrupted)**: app refuses
   to overwrite. The user must rename or delete the foreign marker
   manually before retrying. The plan never includes a marker-write
   action in this case.

### Rationale

- Silent marker rewrite would destroy provenance from an older install
  or a sibling tool; refusing to write protects the user.
- Parsable-marker recovery handles the legitimate "I deleted the database
  but kept the folder" case (e.g. after a clean reinstall).
- The unparsable case is rare but high-impact; the conservative refusal
  is the right tradeoff.

### Alternatives considered

- **Always overwrite**: rejected, violates Reviewable Filesystem
  Mutation principle.
- **Always refuse if any marker exists**: rejected because it makes the
  legitimate reinstall recovery case impossible without manual marker
  deletion.

## R7. Update Scope And `lifecycle == archived` Read-Only Rule (Plus Blocked + Tool-Lock)

### Question

Which fields are editable through `project.update`, and what happens when
the project is `archived`?

### Decision

- Editable through `project.update`: `name`, `tool`, `notes`.
- Editable through their own contracts: `sources` (via
  `project.source.add` and `project.source.remove`), `lifecycle`
  (via `project.lifecycle.transition`, spec 009), and `calibrationSets`
  (via spec 007 contracts).
- `lifecycle == "archived"` → all edit operations refuse with
  `lifecycle.read_only`. Unarchive via spec 009 first.
- **Tool lock (R-Tool-Lock)**: `tool` is immutable when `lifecycle in
  {prepared, processing, completed, blocked}`. The `blocked` state is
  explicitly included in the lock set (GRILL 2026-05-22, R-Tool-Lock). The
  `project.update` contract returns `tool.locked` with `details.current_lifecycle`
  when a tool change is refused. Recovery path for tool-locked projects is
  manual re-creation via `project.create` (no `project.duplicate` in v1).

### Rationale

- A single multi-field patch contract becomes a junk drawer; splitting by
  responsibility keeps audit events meaningful (a `project_renamed` event
  is distinct from a `project_source_added` event).
- Read-only-when-archived preserves the archive-as-museum invariant from
  spec 009 R1: an archived project's record is a historical snapshot.
- Including `blocked` in the tool-lock set prevents tool changes during an
  inconsistent state, which could invalidate the blocking reason (e.g. a
  `tool_unconfigured` block with a different tool would be resolved by the
  lock rather than the user configuring the original tool).

### Alternatives considered

- **All fields editable on one PATCH contract**: rejected for audit
  granularity.
- **Allow edits on archived**: rejected for the museum invariant.
- **Exclude `blocked` from tool-lock**: rejected; `blocked` may be entered from
  `prepared`/`processing`/`completed` and the tool lock must persist.

## R8. Pagination on `project.list`

### Question

How should `project.list` handle large project libraries?

### Decision

**Cursor-based pagination** (GRILL 2026-05-22, R-Pagination). Request accepts
optional `cursor?: string` and `limit?: int` (default 50, max 200). Response
includes `nextCursor?: string` (omitted on last page) wrapping the projects
array.

Cursor format: opaque base64-encoded `(createdAt, id)` tuple, server-controlled.
Clients MUST treat cursors as opaque; the encoding may change between server
versions. Omitting `cursor` returns the first page.

### Rationale

- Offset pagination is O(n) at high offsets in SQLite. Cursor pagination is
  O(log n) with a covering index on `(created_at, id)`.
- Opaque cursor hides the sort key from callers, allowing the server to change
  sort order without a contract break.

### Alternatives considered

- **Offset pagination**: rejected for performance reasons.
- **No pagination**: rejected; large libraries could have hundreds of projects.

## R9. Channel Drift Detection

### Question

How does the UI know when automatically-inferred channels may be stale after
a source addition, if the user has manually overridden channels?

### Decision

**`channelDrift` field on `project.get` response** (GRILL 2026-05-22,
R-ChannelDrift). The server sets `channelDrift.hasNewSources = true` when a
source has been added after the last explicit channel review (re-infer or
dismiss). The `suggestedAction` is `"re_infer"` when the new sources
introduce filters not yet represented in the channel list, or `"dismiss"`
when channels are already comprehensive.

Two contracts reset the drift flag:
- `project.channels.reinfer`: triggers fresh channel inference from all sources;
  resets `hasNewSources` to false; overwrites manual additions with inference.
- `project.channels.dismiss_drift`: keeps existing manual overrides; resets
  `hasNewSources` to false; records user's explicit dismiss choice in audit.

### Rationale

- Silent channel list changes after manual overrides would violate the
  user's expectation that manual changes are sticky (research R4).
- Surfacing a drift banner rather than auto-updating respects the sticky-manual
  invariant while still informing the user.

## R10. Inventory-Confirmed Enforcement on `source.add`

### Question

Should `project.source.add` accept any Inventory session id, or only
confirmed sessions?

### Decision

**Confirmed only** (GRILL 2026-05-22, R-Inventory-Confirmed). The use case
resolves `inventory_session_id` via the `AcquisitionSession` FK and checks
`state == "confirmed"` per the spec 002 six-state lifecycle. Unconfirmed sessions
(discovered, candidate, needs_review, rejected, ignored) are rejected with new
error code `source.not_confirmed` (with `details: { actual_state }`). Contract
schema is NOT changed to enforce this (it remains a `Uuid`); enforcement is
use-case-side only.

### Rationale

- Linking an unconfirmed session bypasses the review pipeline that ensures
  frame count, filter, and exposure metadata are reliable.
- Downstream features (calibration matching, channel inference, manifests) all
  assume source metadata is reviewed; an unreviewed session would produce
  silent inference errors.
