# Autonomous rebuild decisions

Date: 2026-10-03
Authority: the user approved conservative product defaults and waived human specification-approval gates for this run. These choices settle product behavior, not implementation verification. Requirements review, tests, exact-head independent review, Sniff, and original-file protection still apply.

## Decision register

### D01

Owners: LIB, PRJ, VSEL.

- Geometric preselection requires confirmed framing, equipment, pointing, orientation and footprint overlap.
- Unknown evidence is listed for manual selection, never treated as zero distance.
- Standalone session selection remains explicit; an OBJECT label does not assign a Target or supply coordinates.
- Angular separation may order suggestions but never decides eligibility alone.

### D02

Owners: VSEL, PREP.

- Selecting a session initially includes its available Unreviewed or Usable frames in the draft; library-Unusable frames start excluded and remain visible for explicit inclusion.
- Unavailable frames remain named unresolved members.
- Review preparation explicitly confirms exact membership.
- No automatic quality action follows.
- The worked 208-frame fixture has confirmed remaining membership.

### D03

Owners: PIX.

- Rust preserves native samples, scaling, channels, CFA evidence and invalid-sample masks.
- No debayering.
- CFA data may be inspected as the recorded mosaic plane; no RGB-derived metric is claimed.
- Built-in and imported metrics keep input identity, method/version, units and source.
- SubframeSelector CSV is the initial supported import format; unsupported exports are named, not guessed.
- Numerical methods and tolerances require fixture qualification in PIX planning.

### D04

Owners: PREP, RES.

- PixInsight/WBPP, Siril and SETI Astro Suite Pro are required profile targets.
- Their installed/documented capability evidence must precede verified-profile claims.
- Generic Open in does not claim a verified profile.
- Input-write behavior that is unknown or write-prone blocks Linked and Direct-source use; isolated Copy or supported Clone is offered.
- A profile incapable of exact membership cannot receive an overinclusive folder.
- Unsupported configuration or product-input kinds remain explicitly blocked.

### D05

Owners: CAL, STO.

- Adoption requires an explicit durable calibration-library destination.
- Copy and re-read/hash verification precede registering an adopted master; the generated source remains until separately reviewed cleanup.
- No master becomes reusable merely by discovery.

### D06

Owners: STO.

- Archive journals per-item durable copy, destination verification, reference verification and source retirement.
- Failure stops retirement of the affected item; already verified items retain their recorded phases.
- Source retirement requires verified destination and all affected references.
- Retry revalidates identities and destination volume.

### D07

Owners: PLAN.

- Notifications start disabled.
- A default site and explicit criteria/lead time are required before enabling them; the UI names those values.
- No app-closed delivery is claimed without an installed, tested scheduler.
- Resume recomputes upcoming windows and suppresses repeats by target/site/window identity.
- Permission denial remains visible and offers Settings/Retry.

### D08

Owners: LIB, VSEL.

- View drafts have explicit Save and durable revisions.
- Unsaved or failed writes remain visibly unsaved with Retry.
- Optimistic revision checks refuse stale overwrites and offer reload/review.
- Acknowledgment is not durable success.
- Restart restores the last committed revision and identifies recoverable unsaved operations separately.

### D09

Owners: VSEL, PREP, RES, STO.

- Refresh creates a proposed membership revision; accepting it never mutates an existing prepared revision or an external application's inputs.
- Reprepare needs review.
- Retry resumes recorded items, never filename-based inference.
- Replaced prepared entries use reviewed STO cleanup even before Complete.
- Mark Complete is blocked while an app-owned preparation or storage mutation affecting this View is Running. A Result is not required; Complete never implies an external job stopped or succeeded. Unrelated View operations do not block it.
- Creating a new membership or preparation revision of a Complete View requires explicit Reopen. Reviewed cleanup, identity-preserving archive/filing reference repair, verified remap, annotations and Result acceptance remain available without reopening or changing membership.

### D10

Owners: LIB, PRJ, VSEL.

- Library quality and Project rejection are separate records.
- Project rejection never changes library usable totals; library quality never changes fixed View membership.
- Explicitly linked sessions show captured, library-usable and Project-accepted totals separately.
- Project-accepted totals count only library-Usable frames not rejected for that Project, and are the fixed basis for marking integration/frame-count goals met.
- Exposure/equipment/calibration checks show evidence or unknown.
- Reaching a goal does not close the Project.

### D11

Owners: LIB.

- Equipment definitions are explicit camera/optical-train records with confirmed versus observed evidence.
- Identity remap requires verified byte identity and location/volume evidence; same names or a reused mount path are insufficient.
- Offline evidence remains last-observed, not current verification.

### D12

Owners: PRJ, VSEL.

- A Project may contain explicit target coordinates and user-defined panel footprints.
- Session linkage is an explicit association, not a by-product of proximity or a shared name.
- Automatic panel coverage needs the same qualified geometry as D01.

### D13

Owners: CAL, PREP.

- Calibration matching compares camera, dimensions, binning, gain/offset and recorded image type; dark exposure and flat channel/optical-train evidence are required where relevant.
- Missing or conflicting evidence is unknown/incompatible, never silently compatible.
- Automatic temperature tolerance is not guessed; any tolerance must be shown and fixture-qualified.
- Suggestions require explicit acceptance before handoff.
- Scoped exceptions require reasons and never rewrite evidence.

### D14

Owners: STO.

- Reviewed filing uses a user-chosen destination and previews every relative path.
- Default naming retains original basenames; collisions block, never overwrite.
- No inferred target/channel renaming patches headers.

### D15

Owners: LIB, VSEL, PREP.

- Catalog corrections can cover grouping metadata such as filter, exposure and equipment, with original evidence retained.
- A correction creates a new grouping revision; old session identities and fixed View asset membership remain traceable and unchanged.
- Header corrections are delivered only through verified isolated patched Copy/Clone or supported tool configuration.

### D16

Owners: LIB, STO.

- Storage shows registered locations and availability, View footprints, archive transfers, and library-wide duplicate candidates based on content identity.
- Candidate display does not authorize disposal.
- Whole-library duplicate removal and application-managed restore remain outside View cleanup.

### D17

Owners: LIB, all app workflows.

- Development builds include the functional Tauri MCP bridge for backend IPC, events, window/DOM interaction and end-to-end verification. Development verification binds only to loopback; the unauthenticated bridge is never exposed remotely.
- Release builds do not expose the unauthenticated development bridge.
- Production MCP enablement/password/interface/port is an optional future authenticated contract.

### D18

Owners: LIB, PLAN.

- Core library functionality needs neither an account nor a network connection.
- Optional external target enrichment records provider provenance and failures; it never prevents indexing or replaces observed capture evidence.
- Reusable coordinate math, resolver, target matching and format-header functions belong in the named shared packages where the existing contracts fit.

## Verification still required

Profile capability probes and scientific method qualification are implementation prerequisites, not invented capabilities. Supported-platform checks remain required. If an issue survives five failed fixes, record its exact requirement, reproduction, attempt evidence and safe blocked behavior in the backlog; do not replace it with a stub or silently remove it from scope.
