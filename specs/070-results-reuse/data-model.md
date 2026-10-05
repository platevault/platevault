# Results, reuse and completion data model

## Durable entities

Attachments, kinds, acceptance decisions, product inputs and completion decisions are Tier 1 user decisions in the clean library catalog. Discovery observations are Tier 2: a later discovery can derive them again from the filesystem. Every write commits in one writer transaction. RES writes only the tables listed here, plus the VSEL membership revision that a product input change creates (research CS1).

- FolderRoot: root ID, native path and recorded folder identity. A library location exposes its root through `Location::root()`. A Result uses the output folder that PREP recorded for the View's latest preparation revision, or, for an attached file, its parent folder observed at attach time (R2, CS3).
- ResultFile: UUID, View ID, origin `output_location` or `attached`, FolderRoot, lossless relative path below the root and the absolute path for display. It carries the fingerprint (qualified volume and file identity, size, nanosecond mtime and optional SHA-256), type, the full adapter `CaptureMetadata` for FITS and XISF files (R6), and availability Available, Offline, Missing, Unreadable or IdentityConflict. It also has a write state Pending or Settled, an output class (below), the kind or null, a decision revision starting at 1, and the last observed and last verified times. The View, root and relative path are unique together.
- ResultDecision: append-only rows with Result ID, kind and label, the accepted fingerprint with its SHA-256 as basis, the decision revision it wrote and the decision time. The latest row is the effective acceptance. No row means unaccepted.
- ProductInput: product View ID, Result ID, the acceptance decision it names, originating View ID, position, the membership revision that added it and the revision that removed it, null while current (R13).
- ViewCompletion: append-only rows with View ID, state `complete` or `reopened`, completion revision, the View's membership revision and latest preparation revision at that time, and the decision time. The latest row is effective. A View without a row is open.
- Discovery: per View, the output root, state Completed, Partial or Failed, complete and incomplete scopes, issues, the settle window and the observation time.

Every referenced View, Result and decision must exist. Foreign keys enforce it, and a missing record returns NotFound.

## Kinds and output classes

| Value | Meaning |
| --- | --- |
| `final_image` | A finished image |
| `linear_integration` | A linear stack of one channel or filter |
| `channel_product` | A processed single-channel product |
| `mosaic_panel` | One panel of a mosaic |
| `other` | Another explicit reusable kind; a non-blank label is required |

The user chooses the kind at attach or acceptance. Header values never set it (R9).

The output class is `candidate` or `recognized`. A recognized file names its role from the matching recognized-output rule (`intermediate_calibrated`, `intermediate_registered`, `intermediate_other`, `temp_cache` or `log`), the rule, its profile and its evidence. Attached files are always candidates. Neither class implies acceptance, and neither blocks it (R5).

## Provenance

Each Result keeps two separate facts (R8):

1. View association: the View and its basis, `output_location` for a discovered file or `user_linked` for an attached file. The basis records where the file was found and names no input frame.
2. Input-frame lineage: `unknown` for every Result in this version. Header evidence such as a stack count appears as evidence and never names frames.

No field states or implies that the View's planned or prepared membership was used. Acceptance, verification, reuse and completion change neither fact.

## Discovery

`results_discover` reads the View's recorded output location and the files attached to the View. It writes no file and hashes nothing.

1. Verify the output folder identity without following links. A mismatch or an unavailable folder leaves every output-origin file of that root at its last-observed values with Offline or IdentityConflict, and none becomes Missing.
2. Walk the folder with unsupported formats included. Links are not followed. Unreadable subfolders and foreign volumes become incomplete scopes.
3. Probe each attached file of the View under its own root.
4. Probe every observed file again at the start and the end of the settle window. A file whose fingerprints differ, or that vanished, is Pending (R4).
5. Classify output-origin files with the profile's recognized-output rules.
6. In one transaction, update observations by View, root and relative path, keeping Result IDs. A recorded output-origin file absent from a complete scope becomes Missing. A Result with an acceptance or a kind is never deleted, and the discovery record is replaced.

A changed fingerprint of an accepted Result keeps its acceptance basis as history. Its product inputs then read `drifted`.

## Acceptance and verification

Acceptance follows the library quality pattern. Each item names `ExpectedResult {resultId, decisionRevision, fingerprint}` and a kind. Outside the writer lock, the catalog revalidates the root, probes the file, hashes it and probes it again. Inside the transaction it checks the expected revision and fingerprint, rechecks the file's stats and appends one decision per item. A Pending, Offline, Missing or changed file refuses the whole batch, and nothing is written. Acceptance changes no association or lineage value and no library, Project, VSEL or PREP record.

`results_verify` hashes named accepted Results. A digest matching the basis updates the last verified time. A mismatch records the current digest in the observation and keeps the basis, and the drift is cleared only by matching bytes returning or an explicit acceptance of the current bytes (D19).

## Product inputs

- Assignment: `results_create_view` and `results_update_view_inputs` name accepted Results by `{resultId, acceptanceRevision}`. Each product's current bytes are hashed and must match that acceptance's SHA-256 and identity. Offline, changed, unaccepted, Pending or superseded products refuse the whole change. Create writes one VSEL View with no sessions plus its product inputs in one transaction. Update writes one new VSEL membership revision and refuses a Complete View (R15).
- Totals: product inputs carry no frames. VSEL's integration summary, Project progress and Target coverage never count them, so integration is never counted twice.
- Calibration: product inputs never receive calibration assignments (CS8).
- Read state, from one no-follow stat probe per input (R14):

| State | Condition | Required action |
| --- | --- | --- |
| `current` | Stat equals the basis; shows the last verification time | None |
| `drifted` | Stat or a verified digest differs from the basis | Review: verify, accept current bytes and update, or remove |
| `unavailable` | Root or file not observable | Reconnect, or remove |
| `superseded` | The Result has a newer acceptance than the input names | Update explicitly, or keep the older basis |

Nothing replaces an input automatically.

## Product-input support

`product_input_support` is pure. With no capability record, every product input is unsupported with reason `no_product_input_evidence`. A kind the profile does not list is unsupported and names the kind. Raw sessions together with product inputs are unsupported with reason `mixed_inputs_unsupported` unless the profile records mixed support. An empty result means supported. PREP review shows the result, and prepare refuses while it is not empty. Nothing is converted.

## Completion

- Mark Complete: one transaction loads the View, checks the expected completion revision and that the View is not already Complete, and reads the Running operations affecting this View through each `ViewOperationSource` (CS5). These are PREP prepare and Retry operations of this View now, and STO storage mutations once 071 lands. Any Running operation is Conflict naming its kind and ID. Otherwise one `complete` row is appended. No other row changes, no file is read or removed, and no cleanup starts.
- Reopen: the View must be Complete; one `reopened` row is appended.
- Guard: `require_view_open` is Conflict naming the completion revision while the latest row is `complete`. VSEL's membership-revision write, PREP's preparation start and Retry, and RES product input changes call it.
- Allowed while Complete, without a reopen: VSEL notes, RES discovery, attach, acceptance and verification, LIB corrections, quality and verified remap, and STO reviewed cleanup and reference repair.

## Project and Target context

Accepted Results appear on the Project named by their View's Project ID. A Result appears on a Target when the Target is the View's originating Target, a framing Target of that Project, or the Target of a Confirmed association of a current member session. Each entry names its basis (R12). These reads take one reader snapshot and access no file.

## Atomicity and durability

Every RES command is one `BEGIN IMMEDIATE` transaction on the FULL-synchronous writer. It checks expected revisions and fingerprints and validates input, and any failure leaves every row unchanged. Errors are Conflict, NotFound, InvalidInput, IdentityConflict, SourceUnavailable or PersistenceFailure. Hashing runs outside the writer lock and is rechecked inside the transaction. A disposable `max_page_count` catalog proves that SQLITE_FULL returns PersistenceFailure and that nothing persists after reopen. Restart restores every committed Result, decision, product input and completion row.

## References

RES records no library asset IDs and registers no `AssetReferences` source (R18).
