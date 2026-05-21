# Research: Project Create, Onboard, And Edit

**Spec**: 008-project-create-onboard-edit | **Date**: 2026-05-09

## R1. Wizard Versus Single-Form For Create

### Question

Should "New project" be a multi-step wizard or a single long-form modal?

### Decision

**Multi-step wizard with five steps**: Identity → Tool → Sources → Channels
→ Confirm. The wizard is structurally analogous to the first-run source
setup (spec 003) but scoped to one project. URL state tracks the step so
deep-links and back-button work (spec 020).

### Rationale

- The required information spans heterogeneous shapes (text, single-select,
  multi-select picker, inferred preview). A single form would either force
  the picker to render in a constrained sub-area (causing scroll-in-scroll
  pain) or push the user through long vertical scrolling with no clear
  progress signal.
- The wizard form composes cleanly with spec 010's guided first-project
  flow: spec 010 wraps the same wizard with extra surrounding context, no
  fork in implementation.
- Validation can run per step (e.g. duplicate-name check before tool
  selection), which gives faster error feedback than a single
  submit-then-explain cycle.
- The Sources step routinely needs more vertical space than the other
  steps; a wizard lets it claim that space without affecting Identity or
  Tool layout.

### Alternatives considered

- **Single long-form modal**: rejected for the scroll/space reasons above.
  Reconsider only if user testing shows wizard fatigue.
- **Inline-in-page form** (not modal): rejected because the Projects page
  already hosts a drawer; opening a second editing surface in the same
  page caused layout collisions in early mockup attempts.
- **Two-step wizard** (Identity+Tool, Sources+Channels+Confirm): rejected
  because Channels is conceptually about the sources, not about identity;
  collapsing Sources and Channels together loses the "review inferred
  channels" beat.

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

## R7. Update Scope And `lifecycle == archived` Read-Only Rule

### Question

Which fields are editable through `project.update`, and what happens when
the project is `archived`?

### Decision

- Editable through `project.update`: `name`, `tool`, `notes`.
- Editable through their own contracts: `sources` (via
  `project.source.add` and a future `project.source.remove`), `lifecycle`
  (via `project.lifecycle.transition`, spec 009), and `calibrationSets`
  (via spec 007 contracts).
- `lifecycle == "archived"` → all edit operations refuse with
  `lifecycle.read_only`. Unarchive via spec 009 first.

### Rationale

- A single multi-field patch contract becomes a junk drawer; splitting by
  responsibility keeps audit events meaningful (a `project_renamed` event
  is distinct from a `project_source_added` event).
- Read-only-when-archived preserves the archive-as-museum invariant from
  spec 009 R1: an archived project's record is a historical snapshot.

### Alternatives considered

- **All fields editable on one PATCH contract**: rejected for audit
  granularity.
- **Allow edits on archived**: rejected for the museum invariant.
