# Autonomous rebuild decisions

Date: 2026-10-03
Authority: the user approved conservative product defaults and, on 2026-10-04, authorized resolving all repository human-approval gates with no human signoff. These choices settle authorization, not implementation verification. Requirements review, tests, exact-head independent review, Sniff and original-file protection still apply.

The [accepted Rust computation boundary](../../docs/adr/0003-use-rust-scientific-execution-and-a-clean-local-catalog-for-the-platevault-rebuild.md), generated from decision `astro-plan-trutg`, governs specs 063 through 072 and supersedes historical ADR-0001. The retained frontend-astronomy decision records the earlier spec-044 boundary.

## Workflow redesign 2026-10-06

The user settled decisions D-W1 to D-W63 on 2026-10-06. Rounds 6 and 7 amended that set, and the 2026-10-07 answers added D-W72 to D-W74. The user's 2026-10-08 answer added D-W75. Harness v5 feedback added D-W76 to D-W92 from 2026-10-12 to 2026-10-14. The F4 grilling added D-W93 to D-W106 on 2026-10-14 and made Project the processing unit, with calibration matched at intake. Owner answers on 2026-10-15/16 added D-W107 to D-W116. The second batch added D-W117 to D-W121 and amended D-W107, D-W108, D-W110 and D-W113. Round 9 C15 added D-W122 on 2026-10-17: intake records metadata corrections, and Apply delivers them with a corrected-values count. Provisional D-W123 proposes FITS header mapping; the non-FITS delivery route remains open to the owner. The [workflow decisions log](workflow-decisions.md) records each decision. Where an entry below conflicts with a D-W decision, that decision governs; superseded D-W entries are void.

Stage model (the F4 Project model of D-W93 to D-W116 replaces the run stages of 2026-10-06):

1. A Project is the processing unit (D-W1, D-W94). It has goals and holds the sessions the user adds, in groups by rig and framing (D-W9, D-W29, D-W95, D-W96). *Provisional* (D-W94): it names subjects and a rig list, which decide only its suggestions.
2. Intake splits a night's frames into sessions by framing, so a group holds whole sessions (D-W107). Calibration is matched at ingestion and pinned on each light session. A Project adds only settled sessions and checks their calibration read-only (D-W101, D-W105). Every change is pending until Apply, which builds the Project's View from the originals and swaps it in (D-W100). The Results are the files in the Project's `Output/` folder (D-W98).
3. The user closes the Project through Wrap up: Clean up, then Trash for rejected frames, `Processing/` files and duplicate copies, then Archive, with Close project… as its last step. A Closed or Archived Project is locked for good, and Duplicate continues it (D-W80, D-W97). *Provisional* (D-W97): there is no Reopen, and Wrap up opens only once no change is pending.

Matching sessions are suggested and never added automatically (D-W96). Goal progress shows "in project" and "captured", and "in project" never exceeds "captured" (D-W36, D-W96). Delivery order: contract amendment, then backend deltas, then the final UI (D-W28).

## Decision register

### D01

Owners: LIB, PRJ, VSEL.

- Geometric preselection requires confirmed framing, equipment, pointing, orientation and footprint overlap. Superseded by D-W33 and D-W37: a candidate is a session whose confirmed Target is a Project subject and whose rig is a Project rig. Geometry does not decide candidacy; it orders suggestions and assigns mosaic panels (D-W38).
- Unknown evidence is listed for manual selection, never treated as zero distance.
- Standalone session selection remains explicit; an OBJECT label does not assign a Target or supply coordinates. Superseded in part by D-W1 and D-W8: there is no standalone selection, because every run belongs to a Project. An OBJECT label still assigns no Target and supplies no coordinates, so a session without a confirmed Target is never a candidate.
- Angular separation may order suggestions but never decides eligibility alone.
- Amended by D-W94 to D-W96: processing happens only in a Project. Geometry forms a Project's framing groups and orders its suggestions. *Provisional* (D-W96): a suggestion is a Ready session whose confirmed Target is a subject and whose rig is on the rig list.

### D02

Owners: VSEL, PREP.

- Selecting a session initially includes its available Unreviewed or Usable frames in the draft; library-Unusable frames start excluded and remain visible for explicit inclusion.
- Unavailable frames remain named unresolved members.
- Review preparation explicitly confirms exact membership.
- No automatic quality action follows.
- The worked 208-frame fixture has confirmed remaining membership.
- Amended by D-W49 and D-W54: a run's picker starts with every available candidate selected. Rejecting a frame in the run's Review step removes it from the draft with the reason "Rejected", and un-rejecting restores it.
- Superseded in part by D-W94 and D-W100: the user adds sessions to a Project, and every change after its View exists is pending until Apply, whose sheet confirms the exact inputs.

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
- Input-write behavior that is unknown or write-prone blocks Linked and Direct-source use; isolated Copy or supported Clone is offered. Amended by D-W81: it blocks Symlinks, and Copies is offered; Direct source and a separate Clone mode are removed, and Copies clone where the volume supports it.
- A profile incapable of exact membership cannot receive an overinclusive folder.
- Unsupported configuration or product-input kinds remain explicitly blocked.
- One preparation may mix input modes per item. Items that cannot use the chosen mode are listed with paths and footprint, and each per-item change needs explicit approval (PREP-FR-08); no item changes mode silently.

### D05

Owners: CAL, STO.

- Adoption requires an explicit durable calibration-library destination.
- Copy and re-read/hash verification precede registering an adopted master; the generated source remains until separately reviewed cleanup. Amended by D-W70: that reviewed cleanup is the Project Done / Archive sheet's "Move N processing intermediates to Trash (size)", which keeps adopted masters and follows the D-W43 trash rules (STO-FR-16).
- Adoption review records the candidate's identity and SHA-256. The copied bytes, the destination re-read and the source immediately before registration must all match that digest; any mismatch blocks adoption and registers nothing.
- An existing entry at the destination path blocks adoption and is never overwritten; the path is checked again immediately before writing.
- No master becomes reusable merely by discovery.
- Amended by D-W97 and D-W98: a generated master is found in the Project's `Processing/` folder, and its reviewed cleanup is Wrap up's "Move N processing files to Trash (size)".
- Amended by D-W119: PlateVault knows its own unregistered copy at the destination by its recorded operation entry and digest. When that copy is the entry there, the refusal names it and offers a reviewed Move to Trash, and adoption then retries. The copy is never overwritten, reused or registered.

### D06

Owners: STO.

- Archive journals per-item durable copy, destination verification, reference verification and source retirement.
- Failure stops retirement of the affected item; already verified items retain their recorded phases.
- Retire a source only when its current identity and digest match the copied snapshot, the destination re-verifies and every affected reference passes immediately before retirement. Any failure blocks that item and retains its source; source drift retains both versions for review.
- Retry revalidates identities and destination volume.

### D07

Owners: PLAN.

- Notifications start disabled.
- A default site and explicit criteria/lead time are required before enabling them; the UI names those values.
- No app-closed delivery is claimed without an installed, tested scheduler.
- Resume or restart recomputes upcoming windows and suppresses repeats of durably recorded delivered target/site/window identities.
- Permission denial remains visible and offers Settings/Retry.

### D08

Owners: LIB, VSEL.

- Run drafts have explicit Save and durable revisions.
- Unsaved or failed writes remain visibly unsaved with Retry.
- Optimistic revision checks refuse stale overwrites and offer reload/review.
- Acknowledgment is not durable success.
- Restart restores the last committed revision and identifies recoverable unsaved operations separately.
- Amended by D-W94 and D-W100: a Project's edits are saved as pending changes, and Apply is the reviewed step that changes its View.

### D09

Owners: VSEL, PREP, RES, STO.

- Refresh proposes a membership revision. Accepting changes and choosing Save run commits them as a new reviewed membership revision that survives restart; it never mutates an existing prepared revision or an external application's inputs.
- Reprepare needs review.
- Every new preparation revision is materialized in a new reviewed run folder, such as `<Run> (rev 2)/`, and a mosaic group's in `<Mosaic> (rev 2)/` with its `Panel N/` folders (D-W51, D-W67). An existing prepared folder is never replaced, reused or cleared in place (PREP-FR-06).
- Manual inclusions stay pinned across every refresh. Refresh lists them with reason manual inclusion and never proposes removing them for falling outside the saved criteria; only an explicit user removal ends one.
- Retry resumes recorded items, never filename-based inference.
- Replaced prepared entries use reviewed STO cleanup even before Complete.
- Mark Complete is blocked while an app-owned preparation or storage mutation affecting this run is Running. A Result is not required; Complete never implies an external job stopped or succeeded. Unrelated run operations do not block it. Amended by D-W72: Move run to Trash is blocked the same way, and also while one of the run's accepted Results is an input to another run.
- Creating a new membership or preparation revision of a Complete run requires explicit Reopen. Reviewed cleanup, identity-preserving archive reference repair, verified remap, annotations and Result acceptance remain available without reopening or changing membership.
- Superseded by D-W94, D-W97 and D-W100: there are no runs, membership revisions or reprepare. Every change is pending until Apply, which builds a complete new View from the originals and swaps it in, keeping the old one as `View (previous)/`; it never moves or reuses entries from the current View. A Closed Project is locked for good. *Provisional* (D-W97): there is no Reopen.

### D10

Owners: LIB, PRJ, VSEL.

- Library quality and Project rejection are separate records. Library quality (P/X/U) is global; "Reject for this Project only" is a secondary, Project-scoped action (D-W42).
- Project rejection never changes library usable totals; library quality never changes fixed run membership.
- Explicitly linked sessions show captured, library-usable and Project-accepted totals separately. Superseded by D-W34, D-W36, D-W44, D-W66 and D-W72: a Project has no linked sessions. Each goal shows two labelled numbers. "in project" counts the frames in the saved memberships of the Project's runs outside its Trash, minus each run's exclusions and the frames rejected for the Project. "captured" counts all candidates plus the members of those runs, so "in project" never exceeds it.
- Project-accepted totals count only library-Usable frames not rejected for that Project, and are the fixed basis for marking integration/frame-count goals met. Superseded by D-W36 and D-W42: "in project" is the only basis for goal met and for Home's Next action. A quality-bar goal can restrict counting to Usable frames (D-W29).
- Exposure/equipment/calibration checks show evidence or unknown. Superseded by D-W29: the exposure-preference and equipment goals are dropped. Missing calibration and exposure mismatch are automatic warnings, not goals, and the mixed-equipment warning is gone because each run uses one rig (D-W37).
- Reaching a goal does not close the Project. Only the user marks a Project Done (D-W26). Amended by D-W80 and D-W97: Done becomes Close, and only the user closes a Project, through Wrap up's Close project….
- Amended by D-W96: each Project counts its own sessions, and "in project" counts them, minus the Project's exclusions. *Provisional* (D-W96): "captured" adds every matching suggestion.

### D11

Owners: LIB.

- Equipment definitions are explicit camera/optical-train records with confirmed versus observed evidence.
- Identity remap requires verified byte identity and location/volume evidence; same names or a reused mount path are insufficient.
- Offline evidence remains last-observed, not current verification.
- A location that cannot be re-verified leaves the library only through a reviewed Retire location that changes no file. Its copies read Retired, never Missing, leave integration totals and stay named unresolved in fixed runs. Reselect is refused afterwards, but registering the same folder again is allowed; its new assets inherit no retired quality decision, association or correction.
- Amended by D-W94: retired copies stay named unresolved in the Projects that hold them.

### D12

Owners: PRJ, VSEL.

- A Project may contain explicit target coordinates and user-defined panel footprints. Amended by D-W9 and D-W38: a Project holds several subjects (Targets or mosaics) at any separation, and a mosaic subject defines its panels by centre and rotation.
- Session linkage is an explicit association, not a by-product of proximity or a shared name. Superseded by D-W33 and D-W34: nothing is assigned at the Project level. Candidates are derived from confirmed Target and rig, and sessions are explicitly assigned only to runs, as each run's revisioned membership.
- Automatic panel coverage needs the same qualified geometry as D01. Superseded by D-W38: each session is assigned to a panel by its pointing, checked against the panel centre; ambiguous or off-panel sessions are flagged for the user.
- Superseded by D-W94 to D-W96: the user adds sessions to a Project explicitly, PlateVault suggests matching ones, and mosaic panels are groups the user marks as panels.

### D13

Owners: CAL, PREP.

- Calibration matching compares camera, dimensions, binning, gain/offset and recorded image type; dark exposure and flat channel/optical-train evidence are required where relevant.
- Missing or conflicting evidence is unknown/incompatible, never silently compatible.
- Automatic temperature tolerance is not guessed; any tolerance must be shown and fixture-qualified.
- Suggestions require explicit acceptance before handoff. Superseded by D-W5: calibration is automatic by default. Fully compatible matches are assigned automatically, recorded with identity and SHA-256 and re-verified at Prepare; only unknown or incompatible criteria need an explicit choice. The step shows a readiness line, with the full requirement table behind "Review matches".
- Scoped exceptions require reasons and never rewrite evidence.
- Superseded by D-W101 to D-W103: calibration is matched at ingestion and pinned on each light session, and a Project's Calibrate step is a read-only check.

### D14

Owners: STO.

Superseded by D-W11: "File into library" is dropped, and with it reviewed filing. Import (Copy or Move) and Archive remain, and both use the naming templates of D-W20. The collision rule (block, never overwrite) and the rule that no renaming patches headers carry over to them, and the rule that a source is kept until its destination verifies carries into Import Move (STO-IMP-FR-04). The filing entries below are kept for traceability.

- Reviewed filing uses a user-chosen destination and previews every relative path.
- Default naming retains original basenames; collisions block, never overwrite.
- No inferred target/channel renaming patches headers.
- Every filing item, same-volume or cross-volume, keeps its source path until its destination and every affected reference verify, as root FR-011 requires. A failure blocks that item and retains its source at its original path, following D06 sequencing.

### D15

Owners: LIB, VSEL, PREP.

- Catalog corrections can cover grouping metadata such as filter, exposure and equipment, with original evidence retained.
- A correction creates a new grouping revision; old session identities and fixed run asset membership remain traceable and unchanged.
- Header corrections are delivered only through verified isolated patched Copy/Clone or supported tool configuration. Amended by D-W81: patched Copies, cloned or not.
- Amended by D-W94: the fixed run membership of the second bullet becomes the sessions a Project holds. *Provisional*: a correction never changes them. *Open* (D-W100): whether a correction that re-splits a session a Project holds reaches the open Projects that hold it as a pending change.
- Amended by D-W122 (Round 9 C15): the user makes corrections in the session's intake flow, where each corrected value shows beside the recorded one. Apply creates and changes no correction: it delivers every recorded correction by the routes of the third bullet, with no per-value choice, and shows "N corrected values".

### D16

Owners: LIB, VSEL, STO.

- Storage shows registered locations and availability, run footprints, archive transfers, and library-wide duplicate candidates based on content identity.
- Candidate display does not authorize disposal.
- Content-identical copies count once in totals and run membership while every physical copy stays registered and protected.
- Whole-library duplicate removal and application-managed restore remain outside run Clean up.
- Amended by D-W86, D-W94 and D-W97: there is no Storage surface. Settings > Locations shows locations and footprints, and the Sessions Duplicates filter shows duplicates. Copies count once in a Project's totals, and duplicate removal stays outside a Project's Clean up.

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

### D19

Owners: LIB, PRJ, VSEL, PIX, CAL, PREP, RES, STO, PLAN.

- PlateVault counts a recorded file toward a decision- or proof-bound total only against a recorded identity and SHA-256 basis. The same holds when it assigns, opens, prepares, reuses, cleans, archives, imports or trashes the file, or retires it as a source after archive or Import Move. The basis is recorded when the user reviews, inspects or accepts the file, or when an operation starts and snapshots it. Bases include quality decisions, cached measurements, logical-capture proof, remap reviews, inspected and accepted products, adoption reviews and adopted masters, calibration assignments, retained-original and kept-copy proof, and cleanup, archive, Import and trash plans. Filing is withdrawn (D-W11, D-W43).
- An observation that nothing ties to the value it supports stays labelled unverified, such as the import-time digest of a measurement matched only by file name. It detects later drift but never makes the value verified.
- Immediately before each effect other than a count, the current identity and SHA-256 must match every basis that applies. Equal size and mtime never substitute. A count uses each item's last completed verification, at review, inspection, acceptance, readable rescan or reuse, and labels its verification time. Displaying a total starts no rehash, and an item reads verification pending, outside applicable totals, while a started rehash runs.
- A mismatch blocks that item and names the drift. The basis stays as history beside the current bytes, and nothing is launched, registered, overwritten, removed or retired. Counts exclude the item from applicable totals instead of blocking.
- Offline or unreadable means unverified, never matched. Counts keep the labelled last-observed state; every other effect blocks.
- Drift resolves only when bytes matching the basis return, the user explicitly reviews or accepts the current bytes, or the item is explicitly excluded. Nothing resolves it automatically.
- D05 and D06 apply this rule to adoption and archive. Metadata-only indexing and captured totals of Unreviewed captures stay as LIB specifies; copies of a retired location (D11) leave totals instead of keeping a last-observed count. Retire location is catalog-only: it reads and changes no file bytes, so no rehash applies. It commits only against its review, the expected location revision and the availability recorded in that review. Calendar export consumes no recorded file. Verification ends at launch; PlateVault claims nothing about inputs while an external application runs.
- Amended by D-W93 and D-W98: a Result needs no acceptance and is never reused as an input, so the accepted-product bases go. Apply records each copy's digest (D-W100).

## Verification still required

Profile capability probes and scientific method qualification are implementation prerequisites, not invented capabilities. Supported-platform checks remain required. If an issue survives five failed fixes, record its exact requirement, reproduction, attempt evidence and safe blocked behavior in the backlog; do not replace it with a stub or silently remove it from scope.
