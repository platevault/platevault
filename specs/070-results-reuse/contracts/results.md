# Results IPC contract

Version: 1. Requests and responses are JSON with UUID identities and camelCase fields, following the [library contract](../../064-library-inventory/contracts/library.md). `NativePath`, `ObservationFingerprint` with decimal-string `modifiedNs`, `ErrorResponse` and `Availability` keep their library wire forms. Every mutation carries the expected revision of the record it changes and returns committed state only after its transaction commits. No command writes, moves, renames or deletes a file.

## Inputs

- `ResultKind`: `final_image`, `linear_integration`, `channel_product`, `mosaic_panel` or `other`. `kindLabel` is required and non-blank for `other` and absent otherwise.
- `ExpectedResult`: `{resultId, decisionRevision, fingerprint}` as last read. A different current revision or fingerprint is Conflict.
- `AcceptItem`: `{expected: ExpectedResult, kind, kindLabel?}`.
- `ProductInputRef`: `{resultId, acceptanceRevision}` naming one acceptance of an accepted Result.

## Result record

`ResultFile` carries `id`, `viewId`, `origin` (`output_location` or `attached`), `root` `{id, path}`, `relativePath`, `path`, `fingerprint`, `type` (`fits`, `xisf`, `tiff` or `other` with `extension`), `header` (`imageType`, `filter`, `width`, `height`, `stackCount`, each null when unknown), `metadata` (the full adapter `CaptureMetadata`, empty for other types), `availability`, `writeState` (`pending` or `settled`), `outputClass` (`{class: candidate}` or `{class: recognized, role, ruleId, profileId, evidence}` with role `intermediate_calibrated`, `intermediate_registered`, `intermediate_other`, `temp_cache` or `log`), `kind`, `kindLabel`, `decisionRevision`, `lastObservedAt` and `lastVerifiedAt`. It also carries:

- `association`: `{viewId, basis}` with basis `output_location` or `user_linked`.
- `inputFrameLineage`: `{state: unknown, evidence[]}`. A stack count appears as evidence with source `header_count` and names no frames. Version 1 defines no other state.
- `acceptance`: null, or `{decisionRevision, acceptedAt, sha256, fingerprint, cleanupDefault: keep}`.

## Commands

| Command | Request | Response and behavior |
| --- | --- | --- |
| results_discover | viewId, settleMillis? (default 2000) | `ResultsListing` after one committed transaction: `outputLocation` or null, `profileId`, `settleMillis`, `state`, complete and incomplete scopes, issues, `candidates[]`, `recognized[]` grouped by role, and `attached[]`. Files still being written read Pending. Reads headers, hashes nothing. |
| results_list | viewId | The last committed `ResultsListing`. Reads no file. |
| results_detail | resultId | `ResultFile` plus every acceptance decision as history. Reads no file. |
| results_attach | viewId, path, kind, kindLabel? | `ResultFile` with origin `attached`, association `user_linked`, lineage `unknown` and no acceptance. Same View and path again is Conflict naming the Result. An unqualified volume is IdentityConflict. |
| results_accept | items: AcceptItem[] | Accepted `ResultFile` values. Each file is hashed and the decision binds that SHA-256 and fingerprint. Pending, Offline, Missing or changed files refuse the whole batch. Association and lineage stay unchanged. |
| results_verify | resultIds | Per Result: `matched` with `lastVerifiedAt`, `drifted` with current and basis digests, or `unavailable`. Writes only observations. |
| results_accepted | one of viewId, projectId or targetId | Accepted Results in that context with `basis` (`view`, `project`, `view_target`, `project_framing` or `confirmed_session_association`) and `dependentViews[]`, the Views whose current product inputs name the Result. Reads no file. |
| results_picker | projectId?, targetId? | Accepted Results grouped by originating View, each with kind, path, availability, association and lineage. Reads no file. |
| results_create_view | name, projectId?, inputs: ProductInputRef[] | New View with no sessions and its `productInputs[]`. Every product is rehashed and must match its acceptance; any refusal creates no View. |
| results_update_view_inputs | viewId, expectedMembershipRevision, add: ProductInputRef[], remove: resultIds | `productInputs[]` at one new membership revision. A Complete View is Conflict until Reopen. |
| results_view_inputs | viewId | `productInputs[]`, each with originating View, kind, path, `state` (`current`, `drifted`, `unavailable` or `superseded`) and `lastVerifiedAt`. Takes one stat probe per input and hashes nothing. |
| results_product_support | viewId, profileId | `unsupported[]` per product input with `resultId`, `kind` and `reason` (`no_product_input_evidence`, `kind_unsupported` or `mixed_inputs_unsupported`). Empty means supported. PREP review embeds it. |
| results_mark_complete | viewId, expectedCompletionRevision | `Completion` with state `complete`. No Result is required. Conflict when Complete already, stale, or while an operation affecting this View is Running; the message names each operation. Removes nothing and starts no cleanup. |
| results_reopen | viewId, expectedCompletionRevision | `Completion` with state `reopened`. Conflict unless Complete. |
| results_completion | viewId | `Completion` (`state` `open`, `complete` or `reopened`, revision, history) and `blockers[]` of Running operations `{kind, operationId}`. Reads no file. |

## Errors

InvalidInput, NotFound, Conflict, IdentityConflict, SourceUnavailable and PersistenceFailure use the library `ErrorResponse`. They name the View, Result or operation and say whether reload, review or retry applies. Conflict carries the current revision. An unsupported product input is InvalidInput naming the Result and kind. Unknown evidence is data, never a zero, an acceptance or a lineage claim.

## Long-running work

Discovery, acceptance, verification and product assignment run their file reads off the UI thread and return after their transaction commits. They emit no events; `results_list`, `results_detail` and `results_completion` are the durable truth after a disconnect. An interrupted command commits nothing.

## Contract extensions

- `project_detail.acceptedProducts` (RES version 1): the `results_accepted` entries for the Project, as 065 reserves.
- PREP review and prepare include product items and the `results_product_support` result. Prepare rehashes each product through `Catalog::result_proof` and refuses while `unsupported[]` is not empty.
- STO reads `results_accepted` for protected Keep and adds its Running storage mutations to `blockers[]`.

## Development verification

The isolated rebuilt shell registers these commands beside the library and Project commands, with the same loopback-only dev bridge and release exclusion. Backend IPC proof does not certify the Results surface. The clean-slate frontend must retain and validate it through MCP, with fresh J26 and J27 validation.
