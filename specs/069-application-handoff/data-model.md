# Application handoff data model

## Durable entities

Application, settings, review, preparation, item, operation and launch rows are Tier 1 records in the clean library catalog. Each mutation commits in one writer transaction against the expected revision, and every intent commits before its filesystem action. PREP writes only the tables listed here and the files of R18 below the reviewed View folder.

- Application: UUID, kind `profile` or `generic`, profile ID for a profile, display name, executable `NativePath`, the executable fingerprint when located, observed version or null, argument list for a generic application, decision revision and update time. Locating never runs the executable (research R4, R5).
- HandoffSettings: View ID as key, application ID, View mode `linked`, `direct_source`, `copy` or `clone`, link type `symlink` or `hardlink` for Linked, parent path with its folder identity, folder name, optional output override parent with its folder identity, decision revision and save time. The folder name passes the `safe-filename` rules. Saving writes no file. Hardlink is stored only when the request names it (R9, R14, R15).
- PreparationReview: UUID, View ID and committed View revision, settings revision, application ID and revision, the capability snapshot (manifest version and each class's applicable state and evidence for the observed version), View, output and control paths, parent identity, destination facts (filesystem type, symlink, hardlink and clone support, free bytes and check time), saved criteria snapshot, counts and footprint, state `open`, `confirmed`, `started` or `superseded`, the confirmation and its time (R16).
- ReviewItem: review ID, item ID, role `light`, `calibration` or `handoff_file`, the VSEL member key or CAL assignment ID, the chosen copy as a source reference, mode, link type, consumed relative path, footprint bytes, alternatives with footprints, `requiresApproval`, blocks and effective values.
- Preparation: UUID, View ID, per-View revision number starting at 1, unique review ID, View membership revision, View folder, output folder and control folder each with path and folder identity once created, state, `supersededBy`, record revision, creation and preparation times.
- PreparationItem: preparation ID, item ID, role, kind, source reference, consumed path or null for Direct source, staging path, state, current attempt, source SHA-256 basis, entry SHA-256, entry fingerprint, link target, patched fields with values, block reason and update time. Rows with role `leftover` record staging files that never became entries (R21).
- PreparationOperation: UUID, preparation ID, kind `prepare` or `retry`, state, progress counts (planned, prepared, blocked, uncertain, bytes hashed and written), pause or cancel request, issues, revision, start and finish times.
- Launch: UUID, preparation ID, application ID and revision, the executable fingerprint and version observed, argv, state, verification progress, drift list, and start and finish times.

A source reference is `{assetId? | masterId?, locationId, relativePath, fingerprint}`. Library assets come from VSEL copies; adopted masters come from CAL (research S1, S3). Every referenced View revision, location, asset and application must exist; foreign keys enforce it, and a missing record returns NotFound.

## Profile manifest

The bundled `assets/profiles/profiles.json` is versioned, read-only data, not catalog state. Each profile lists the classes `input`, `layout`, `configuration`, `productInput`, `inputWrite`, `recognizedOutput` and `launch`. A class is `verified`, `unsupported` or `unknown`. Verified and unsupported carry evidence: source `installed_probe` or `documentation`, reference, covered application versions and recording date. A class whose evidence lists no observed version reads unknown for that installation. A profile reads verified only when every class reads verified or unsupported. The generic application has no manifest entry and every class reads unknown (R3 to R5).

## Modes and items

| Mode | Entry | Requires | Footprint |
| --- | --- | --- | --- |
| Linked, symlink | Link to the absolute source path | `inputWrite` verified read-only; symlink support at the destination | Zero data bytes |
| Linked, hardlink | Hard link to the source | As symlink, plus explicit choice and eligibility (R9) | Zero data bytes |
| Direct source | Original path in a handoff file | `inputWrite` verified read-only; verified file-list or configuration input, or an exact folder rule (R11) | Handoff file bytes |
| Copy | Verified byte copy | Free space | Source bytes |
| Clone | Verified clone | Qualified primitive on the source volume (R10) | Zero at creation, growing with changes |
| Patched Copy or Clone | Verified copy or clone with mapped keywords patched | Qualified keyword mapping (R13) | As Copy or Clone |

The View mode is suggested by R8 and applies to every item unless an item is approved for another mode. Items whose mode differs from the View mode carry `requiresApproval`.

Item blocks are `unresolved_member`, `source_unavailable`, `source_retired`, `drift`, `unsupported_member_kind`, `calibration_unresolved` with the CAL reason, `mode_refused` naming the class, `link_unsupported`, `hardlink_ineligible` naming the failed check, `clone_unsupported`, `patch_unsupported`, `collision` and `free_space`. A block names the item, its path and the reason. An item with a block never counts as prepared (R17).

## Effective values

For each item and field whose catalog value differs from the observed header value, the review lists the catalog value, the header value, the value the application will read and the choice. Choices are `configuration`, `patched_copy`, `accept_source` and `exclude`. Linked and Direct-source items read the header value. `exclude` names VSEL's Exclude from View and leaves the review unconfirmable until a new View revision is reviewed. A correction reads delivered only for a verified patched entry or a verified configuration capability (R12, R13).

## Layout

The View folder holds the consumed layout, `output/` by default and the control folder `.platevault/` with `staging/` and handoff files. Without verified profile layout evidence, lights sit in `lights/<night>-<sequence>/<original basename>` and calibration in `calibration/<kind>/<assignment sequence>/<original basename>`. No folder or file name carries a channel or corrected value, so no name implies that it overrides a header (PREP-FR-01). Paths are unique within the plan; a duplicate blocks review. The control folder is never part of the consumed layout.

## States

| Record | States | Transitions |
| --- | --- | --- |
| Review | open, confirmed, started, superseded | open to confirmed by explicit confirmation; confirmed to started by Prepare; open or confirmed to superseded when a newer review of the View is recorded |
| Item | planned, in_progress, prepared, blocked, uncertain | planned or blocked or uncertain to in_progress by a committed intent; in_progress to prepared after verification or to blocked; in_progress to uncertain at restart |
| Operation | Running, Prepared, Partial, Failed, Canceled, Paused | Running to exactly one terminal state (R19); Running to Paused at restart (R22) |
| Preparation | Running, Prepared, Partial, Failed, Canceled, Paused | The state of its latest operation |
| Launch | verifying, launching, launched, blocked, executable_missing, launch_failed, interrupted, outcome_unknown | verifying to blocked on drift or to launching; launching to launched, executable_missing or launch_failed; verifying to interrupted and launching to outcome_unknown at restart |

Prepared requires every item prepared, zero blocked items and a consumed layout holding exactly the prepared entries. No launch state changes the Preparation, the View, its decisions or completion (R25).

## Atomicity and durability

Every command is one `BEGIN IMMEDIATE` transaction on the FULL-synchronous writer, checking expected revisions and input before it writes. Start commits the preparation, every item as planned and the Running operation before any directory is created. Each chunk of up to 16 items commits its intents before its effects and its outcomes after them. Finishing commits the reconciliation and the terminal state together, and sets `supersededBy` on older revisions of the View when the state is Prepared. Any failure leaves the prior committed rows. A disposable `max_page_count` catalog proves that SQLITE_FULL returns PersistenceFailure and that nothing persists after reopen. Restart restores every committed record and applies R22.

## References

`PreparationReferences` answers `AssetReferences::references_to` with kind View. It names each preparation revision whose items reference any of the asked assets, with the preparation record revision. Retire review lists them, and a changed record revision refuses retire confirmation. Retired copies keep their entries (R27).
