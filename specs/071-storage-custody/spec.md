# Feature Specification: Storage operations: View cleanup, verified archive, reviewed filing

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `071-storage-custody`

**Created**: 2026-10-03

**Status**: Draft; product defaults and all human-approval gate waivers follow the root autonomous objective. Requirements analysis, implementation and verification remain required.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - Storage operations: View cleanup, verified archive, reviewed filing (Priority: P1)

Selectable View-scoped disposal to the OS Trash with retained-original proof, plus verified transfers (archive and filing) that rebuild affected View references and never retire a source before verification.

**Why this priority**: This feature owns the workflow steps listed below without imposing unrelated product features.

**Independent Test**: Exercise the acceptance scenarios through the running product with isolated inputs. Existing baseline code does not prove the redesigned behavior.

**Acceptance Scenarios**:

- **STO-AC-01**: Given a Complete View containing intermediates, prepared links, an accepted Result, and an unknown file, when cleanup opens, then intermediates and temp files are preselected. The Result remains in Keep and the unknown file remains unselected. Selecting every intermediate leaves Keep untouched.
- **STO-AC-02**: Given a Direct-source View, when its cleanup preview opens, then original subs appear in no cleanup group.
- **STO-AC-03**: Given a location where OS removal deletes immediately, when Send to Trash runs, then those files are refused and listed as blocked with Keep files and Reveal location, and nothing is permanently deleted.
- **STO-AC-04**: Given a prepared hardlink holds the last bytes after its original was deleted externally, when its removal is reviewed, then insufficient retained-original proof blocks removal.
- **STO-AC-05**: Given an archive destination fails hash verification or disconnects during transfer, when the operation settles, then the source is retained. Destination-verified, source-retained, reference-updated, pending and uncertain phases are distinguished. Retry resumes recorded work after revalidating identities.
- **STO-AC-06**: Given a filing destination collides with an existing file, when the filing plan is reviewed, then the item is blocked until another path or revised plan is chosen. Existing content, session boundaries, and View membership remain unchanged.
- **STO-AC-07**: Given a completed archive later disconnects, when its View is opened, then totals and membership remain unchanged and archived inputs show Offline. Preparing those inputs is refused.
- **STO-AC-08**: Given an approved prepared symlink and a verified duplicate, when they are sent to Trash, then the symlink target remains byte-identical and the duplicate action names the verified copy kept. No target directory is followed.
- **STO-AC-09**: Given mixed successful and blocked Trash items, when execution settles, then an exact partial summary names both sets and the View records removed and remaining entries; unsupported Trash removes zero files even after approval.
- **STO-AC-10**: Given archive reference repair fails, then source retirement is blocked and each reference is marked blocked or uncertain. A different destination volume at the same mount path is a conflict, and a cross-volume hardlink requires a separately approved supported mode. Direct-source configuration paths show their individual update status.
- **STO-AC-11**: Given replaced prepared entries before processing is Complete, when removal is reviewed, then the same per-item retained-original proof, protected products, no-follow and OS Trash rules apply. Unapproved or unproven entries remain.
- **STO-AC-12**: Given registered online/offline locations, View preparations, duplicate content and archive transfers, when Storage opens, then location availability, View footprints, content-identity duplicate candidates and transfer phases are shown separately. Candidate display never authorizes removal.
- **STO-AC-13**: Given selected Sessions and a chosen filing destination, when the default layout is previewed, then original basenames remain and every source/destination is listed. A collision blocks the item; applying a revised approved layout changes neither session boundaries nor fixed View membership.
- **STO-AC-14**: Given an archive or cross-volume filing item whose source bytes change after its snapshot is copied and destination-verified, when retirement is reached, then the current source identity or SHA-256 fails comparison with that snapshot. The item is blocked with drift named, both versions are retained and other items keep their recorded phases. A final destination or reference re-verification failure also retains the source. Retry requires reviewed current evidence, never automatic retirement of either version.
- **STO-AC-15**: Given an approved cleanup or filing plan, when a selected item changes in place before execution with its size and mtime preserved, then that item is blocked with drift named and left in place. The same holds when the retained original or kept copy it relies on changes. Other approved items proceed, and the summary names the blocked item.
- **STO-AC-16**: Given a same-volume filing item whose affected View reference cannot be updated, when filing runs, then the item is blocked with that reference named. Its source stays at its original path with its reviewed hash, and the View still resolves it there. Other items proceed, and after the reference is repaired, Retry moves the item only once its destination and references verify.

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

## Requirements

### Functional Requirements

- **STO-FR-01**: Cleanup previews groups with counts, sizes, proposed actions, and Inspect files. Recognized calibrated, registered/aligned, and other intermediates are preselected, including stacking/calibration XISF and temp/cache files. Prepared links, copies, clones, verified duplicates, logs, manifests, and unknown files start unselected. Accepted Results and candidate or reusable masters remain in protected Keep. Removing a protected product needs separate explicit selection naming the product and dependent Views. Users can toggle groups and individual files. Selecting a group never authorizes deleting a whole directory.
- **STO-FR-02**: Each file shows path, role, other View or Project references, retained-original evidence, and estimated bytes. Link sizes are never presented as guaranteed reclaim.
- **STO-FR-03**: Originals outside the View are protected. Direct-source originals are never candidates, and in Direct-source mode only processing outputs attributed to this View are eligible. Unknown files stay unselected. Library raw files are outside View cleanup.
- **STO-FR-04**: Review cleanup lists exactly the selected and retained entries; the default action is Send to OS Trash. Removing a prepared copy or a hardlink needs verified retained originals; removing a duplicate names the copy kept. Review records each selected entry's identity and SHA-256, a link's identity and target path without following it, and the retained original or kept copy it relies on. Execution re-verifies them immediately before each move to Trash (D19). Trash support is shown per location with movable and blocked counts, and an OS action that deletes immediately counts as unsupported. Stale identity, drift, insufficient proof, an unavailable source, or ambiguous ownership stops the affected item. Link entries are trashed without following their targets.
- **STO-FR-05**: Trash execution shows progress, per-item outcomes, and an exact complete or partial summary, and the View records what was removed and what remains. Unsupported Trash refuses the item and offers Keep files or Reveal location. There is no permanent-delete fallback. Restoring relies on the OS Trash, with no guarantee once it is emptied.
- **STO-FR-06**: Archive review shows destination paths, bytes, source identities, affected Views, and reference updates. Membership and exclusions stay fixed. It also shows destination volume identity, free space, and writability; a different volume at the same path is a conflict. Each View's current and proposed reference mode is shown. A cross-volume hardlink is never rebuilt as a hardlink: the user chooses a supported mode or keeps the local copy, with no implicit conversion.
- **STO-FR-07**: Verified transfer copies a source snapshot, writes durably and re-reads the destination to compare hashes. Retire a source only when its current identity and digest match that snapshot, the destination re-verifies and every affected reference passes immediately before retirement. Any failed check blocks the item and retains its source; source drift retains both versions for review. References report completed, blocked or uncertain; Direct-source configuration paths name their update status. Expected and observed reclaim remain separate.
- **STO-FR-08**: If the archive is disconnected later, totals and membership are kept, inputs show Offline, and preparing or opening refuses rather than omits them. After an interruption the user sees destination-verified, source-retained, reference-updated, and pending work. Retry resumes the recorded work and never relies on filename presence. Failure sequencing follows D06 in the root decision register.
- **STO-FR-09**: File into library (from Sessions): choose a destination and see the layout, source and destination paths, counts, collisions, footprint, affected View references, and files already indexed. Review filing approves only the displayed operations and records each item's identity and SHA-256; each move or transfer re-verifies them immediately before it runs (D19). A collision needs another path or a revised plan. Item progress and outcomes are shown. Every item, same-volume or cross-volume, keeps its source path until its destination verifies against the reviewed digest and every affected reference reports completed (root FR-011, D14). A blocked or uncertain reference, or a failed verification, blocks that item and keeps its source at its original path; other items proceed. Cross-volume filing uses verified transfer. Filing never overwrites, never merges sessions, and never changes membership. Index-in-place remains valid.
- **STO-FR-10**: Replaced preparation entries may be removed before Complete only through the same reviewed scope, retained-original proof, protected-product and OS Trash handling as View cleanup. Reprepare never bypasses custody rules.
- **STO-FR-11**: Storage shows registered locations and availability, View footprints, library-wide content-identity duplicate candidates and archive transfers. LIB supplies location evidence. Candidate display does not authorize duplicate disposal; removal remains governed by reviewed custody scope.
- **STO-FR-12**: Destination collisions never overwrite. External drift in app-written references or operation entries is identified before mutation and blocks the affected stale item for review.

### Owned interaction steps

- I2
- I3
- I4
- I5
- J
- L
- Cross-flow: Cleanup/Trash failure
- Cross-flow: Archive interruption
- Storage: locations, availability, View footprints, duplicate candidates and archive transfers
- Cross-flow: Destination collision

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision.

## Success Criteria

### Measurable Outcomes

- **PV-STO-SC-01**: Every acceptance scenario produces its stated outcome and refusal behavior.
- **PV-STO-SC-02**: Every owned interaction step has a requirement and independently observable acceptance evidence.
- **PV-STO-SC-03**: Original inputs remain unchanged except through separately reviewed and approved filesystem operations.

## Assumptions

- [Product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the confirmed interactions and illustrative worked example.
- This feature is independently specified; dependencies on other feature contracts are resolved in planning.
- Conservative defaults and all human-approval gate waivers follow the root autonomous objective and decision register. Tests, requirements analysis, independent review and delivery evidence remain mandatory.

## Decisions before feature approval

- Root decisions D05, D06, D09, D14 and D16 define protected adopted-master sources, transfer phases, replacement cleanup, reviewed filing layout and Storage candidate scope. Whole-library duplicate disposal and application-managed restore remain outside View cleanup.
- Root decision D19 binds cleanup, archive and filing to re-verified identity and SHA-256; D06 is its archive form.
