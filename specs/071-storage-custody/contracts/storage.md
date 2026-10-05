# Storage custody IPC contract

Version: 1. Requests and responses are JSON with UUID identities and camelCase fields, following the [library contract](../../064-library-inventory/contracts/library.md). Sizes are bytes and times are RFC 3339 UTC. `NativePath`, `ExpectedSession`, `ExpectedAsset`, `ObservationFingerprint` with decimal-string `modifiedNs`, `ErrorResponse` and `Location` keep their library wire forms. A review carries `revision`; confirming it names `expectedRevision`. Every command that starts work returns a committed Running operation, never terminal success.

## Inputs

- `CleanupScope`: `view` for a Complete View, or `replaced_entries` for entries of replaced preparation revisions.
- `FileKey`: an opaque string from preview naming one file under one View root. It is stable while the file's source record and relative path stay the same.
- `ProtectedSelection`: `{fileKey, recordId}`. `recordId` must equal the product or master the preview named for that file.
- `TransferDestination`: `{locationId, expectedRevision, folder}`, where `folder` is a native relative path inside the location.
- `ItemFolder`: `{assetId, folder}` moves one item to another folder below the destination; the basename never changes.
- `ReferenceChoice`: `{entryId, mode}` with mode `symlink` or `keep_local_copy`.

## Commands

| Command | Request | Response and behavior |
| --- | --- | --- |
| storage_overview | none | Locations with role, lifecycle and availability, View footprints by reclaim class, and transfer operations with phase counts. Reads no file bytes and offers no removal. |
| storage_duplicate_groups | cause?, offset, limit | Library-wide groups with `identical`, `candidate` or `conflicting` cause, each naming every physical copy, its location and availability. Display only. |
| storage_cleanup_preview | viewId, scope | Groups with counts, sizes, proposed action and default selection, files with the per-file evidence of the [data model](../data-model.md#per-file-evidence), per-volume Trash support and consulted reference kinds. Starts no hash and writes nothing. |
| storage_review_cleanup | viewId, scope, expectedViewRevision, selected: FileKey[], protected: ProtectedSelection[] | Durable CleanupReview listing exactly the selected and retained entries with action `send_to_os_trash`. Each item shows its proof or blockers. Each volume shows Trash support with movable and blocked counts. Hashes selected files and kept copies off the UI thread; writes no image file. |
| storage_apply_cleanup | reviewId, expectedRevision | Running cleanup operation. Unblocked items are re-verified and moved to the OS Trash one at a time; blocked items stay. |
| storage_review_transfer | kind, sessions: ExpectedSession[], destination: TransferDestination, itemFolders?: ItemFolder[], referenceChoices?: ReferenceChoice[] | Durable TransferReview with source and destination paths, bytes, source identities and snapshots, affected Views, current and proposed reference modes and footprint. It also shows destination volume identity, free space, writability, expected reclaim and blockers. A filing review previews every relative path. A new review supersedes the previous one; no file changes. |
| storage_start_transfer | reviewId, expectedRevision | Running transfer operation. Conflict while the review has any blocker, its records changed, or the destination volume or root differs. |
| storage_retry_transfer | operationId, expectedRevision | Running operation resuming recorded items after revalidation. Items already done keep their phases. |
| storage_operation | operationId | Kind, state, revision, per-item phase or outcome, ItemReference outcomes, Direct-source path statuses, expected and observed reclaim, and the summary naming removed, retired, retained and blocked entries. Durable truth after restart. |
| storage_list_operations | kind?, viewId?, offset, limit | Storage operations newest first, including interrupted ones after restart. |
| storage_view_custody | viewId | Per preparation revision, the entries removed and remaining, and each repaired reference with its recorded target. VSEL and PREP show this as the View's custody record. |

No command deletes a file permanently. Trash execution and transfers run off the UI thread.

## Blockers and offers

Blockers are data, never errors. Cleanup reasons are `stale_identity`, `insufficient_proof`, `source_unavailable`, `ambiguous_ownership`, `trash_unsupported`, `protected_not_selected` and `output_pending`. Transfer reasons are `collision`, `identity_conflict`, `insufficient_space`, `not_writable`, `source_unavailable`, `mode_choice_required`, `references_unverified`, `config_update_unsupported` and `destination_unregistered`. A refused Trash item carries `offers: ["keep_files", "reveal_location"]` and `revealPath`; neither offer removes a file.

## Errors

InvalidInput, NotFound, Conflict, IdentityConflict, SourceUnavailable and PersistenceFailure use the library `ErrorResponse`. They name the View, review, operation, session, asset, location or path and say whether reload, review or retry applies. Conflict carries the current revision. Scope `view` for a View that is not Complete is InvalidInput naming `replaced_entries` as the available scope.

## Long-running work

`storage_operation_progress` events carry operationId, revision, kind, state and per-outcome counts. Polling `storage_operation` is the durable truth after disconnect or restart; an event alone proves no outcome.

## Contract extensions

VSEL (066) shows `storage_view_custody` on the View. PREP (069) reads `Catalog::entry_custody` before Open. RES (070) blocks Mark Complete while `Storage::running_for_view` names an operation. Each seam is listed in [research](../research.md#cross-spec-seams).

## Development verification

The isolated rebuilt shell registers these commands beside the library and Project commands, with the same loopback-only dev bridge and release exclusion. Backend IPC proof does not certify the Cleanup, Archive, Filing or Storage surfaces. The clean-slate frontend must retain and validate them through MCP, together with fresh J27, J28 and J30 validation.
