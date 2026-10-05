# Application handoff IPC contract

Version: 1. Requests and responses are JSON with UUID identities and camelCase fields, following the [library contract](../../064-library-inventory/contracts/library.md). Paths are `NativePath`, sizes bytes, times RFC 3339. `ObservationFingerprint` with decimal-string `modifiedNs`, `ExpectedAsset`, `FileIdentity` and `ErrorResponse` keep their library wire forms. Every mutation carries the expected revision of the record it changes and returns only after its transaction commits. Field meanings and states are in the [data model](../data-model.md).

## Inputs

- `ApplicationInput`: `{profileId?, displayName, executablePath, arguments?}`. A missing `profileId` is a generic Open in... application, and only it takes `arguments`, which may contain `{viewFolder}`, `{inputList}` and `{outputFolder}`.
- `HandoffSettingsInput`: `{applicationId, mode, linkType?, parent, folderName, outputParent?}`. `linkType` applies to `linked` only and defaults to `symlink`; `hardlink` must be named.
- `ItemModeInput`: `{itemKey, mode, linkType?}`. `itemKey` is the VSEL member key or the CAL assignment ID.
- `CorrectionChoiceInput`: `{itemKey, field, choice}` with `choice` `configuration`, `patched_copy`, `accept_source` or `exclude`.
- `ReviewConfirmation`: `{membershipConfirmed, criteriaConfirmed, approvedItems}`. Both flags must be true, and `approvedItems` must equal the set of items with `requiresApproval`.

## Commands

| Command | Request | Response and behavior |
| --- | --- | --- |
| prep_list_profiles | none | Manifest version and each profile with every class, its state and evidence. Generic Open in... is listed as not a verified profile. |
| prep_locate_application | applicationId?, expectedRevision?, application: ApplicationInput | Application with the observed executable fingerprint, observed version or unknown, and each class's applicable state. Never runs the executable. A missing path is NotFound. |
| prep_list_applications | none | Located applications with their current presence read through a no-follow probe. |
| prep_view_settings | viewId | Saved settings or null, plus the suggested parent (null on first use) and a folder name unique at read time. Writes nothing. |
| prep_save_settings | viewId, expectedRevision?, settings: HandoffSettingsInput | Settings at a new revision. Writes no file. |
| prep_review | viewId, viewRevision, expectedSettingsRevision, itemModes?: ItemModeInput[], corrections?: CorrectionChoiceInput[] | A durable review: selection with session and member identities, saved criteria apart from browsing filters, profile and capability snapshot, calibration assignments and exceptions, excluded count, items with blocks and alternatives, View, output and control paths, mode and link limits, operation count, footprint and free space. Writes no file and hashes nothing. |
| prep_confirm_review | reviewId, expectedRevision, confirmation: ReviewConfirmation | The confirmed review. An unapproved, extra or refused item change is InvalidInput naming the item; a changed View, settings or application revision is Conflict. |
| prep_start | reviewId, expectedRevision | Preparation and its operation in Running. This acknowledgment is not success. |
| prep_status | operationId | Operation with state, progress, per-item failures and, once terminal, the outcome. |
| prep_pause | operationId | Acknowledged; the operation reaches Paused at the next item boundary. |
| prep_cancel | operationId | Acknowledged; the operation reaches Canceled at the next item boundary. |
| prep_retry | preparationId, expectedRevision | A new operation in Running over planned, blocked and uncertain items after revalidation. A newer View membership revision is Conflict naming it. |
| prep_list | viewId?, offset, limit | Preparation summaries: id, View, revision, membership revision, state, item counts, View path and `supersededBy`. |
| prep_detail | preparationId | Preparation with folders, items and entries, leftovers, operations and launches. |
| prep_open | preparationId, expectedRevision, applicationId? | A launch in `verifying`. Refused unless the preparation is Prepared. |
| prep_launch_status | launchId | Launch with state, verification progress, drift and the offered actions. `executable_missing` offers Choose application and Reveal View. |
| prep_reveal | preparationId | Reveals the recorded View folder after its identity is verified. A missing or replaced folder is SourceUnavailable or IdentityConflict. |

No command writes a source file, changes library quality, edits View membership or calibration records, or marks a View Complete.

## Review content

- `items[]`: `itemId`, `role`, `itemKey`, `source` (the chosen copy), `mode`, `linkType`, `consumedPath`, `footprintBytes`, `requiresApproval`, `blocks[]` `{reason, detail, path}`, `alternatives[]` `{mode, linkType?, footprintBytes, consequence}` and `effectiveValues[]` `{field, catalogValue, headerValue, applicationReads, choice}`.
- `modes[]`: each mode with its semantics, state `offered` or `refused`, the refusing class or check, link limits and total footprint.
- `checks`: source presence, collisions, permissions, link or hardlink eligibility, clone support and free space, each with its result and check time.
- `counts`: members, included, excluded, unresolved, calibration inputs, operations and blocked items.

## Events

`prep_progress` carries one committed operation or launch snapshot. Polling `prep_status` or `prep_launch_status` stays the durable truth after a disconnect or restart.

## Errors

InvalidInput, NotFound, Conflict, IdentityConflict, AccessDenied, SourceUnavailable, PersistenceFailure and Canceled use the library `ErrorResponse`. Each names the View, review, preparation, item, application or path and says whether reload, review or retry applies. Conflict carries the current revision. A refused mode, a blocked item or drift is data in the response, never a zero, a fallback or a success.

## Contract extensions

RES (070) calls `require_view_open` in the `prep_start` and `prep_retry` transactions and reads Running prepare and retry operations through `running_view_operations`. RES reads the output location from `Catalog::latest_preparation`. STO (071) reads prepared entries and `supersededBy`, uses `render_handoff_file`, and adds `Catalog::entry_custody` to Open verification. VSEL (066) reads the handoff settings for its View detail. Each feature versions its own additive fields.

## Development verification

The isolated rebuilt shell registers these commands beside the library commands, with the same loopback-only dev bridge and release exclusion, and forwards `prep_progress`. Backend IPC proof does not certify the preparation surface. The clean-slate frontend must retain and validate it through MCP, together with fresh J23 and J24 validation.
