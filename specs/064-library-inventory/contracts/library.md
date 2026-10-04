# Library IPC contract

Version: 1. Requests/responses are JSON with UUID identities. Angles are degrees, exposures seconds, temperatures Celsius and sizes bytes. Native paths use `{encoding: unix-bytes|windows-utf16, payload: number[], display: string}`; display is never identity. Batch edits carry per-record expected decision revisions and observation fingerprints.

## Commands

| Command | Request | Response and behavior |
| --- | --- | --- |
| library_register_location | path, displayName, role | Location revision; registration does not scan or modify files. |
| library_list_locations | none | Registered locations with last-observed/access/availability states. |
| library_start_scan | locationId | Committed operationId and Running state, not terminal success. |
| library_scan_status | operationId | Counts, complete/incomplete scope, per-item failures and terminal state. |
| library_cancel_scan | operationId | Cancel request acknowledged; status names final applied observations. No source mutation. |
| library_list_sessions | filters, sort, offset, limit | Sessions, coveredLocationIds, provisional scope, counts, date basis, availability and last observation; unknown values stay explicit. Browsing starts no measurement. |
| library_session | sessionId | Asset identities, observed/corrected metadata and association evidence. |
| library_preview_metadata | expected assets, field, value | Proposed effective values, predecessor/successor session membership and conflicts; no writes. |
| library_confirm_metadata | previewId, expected assets | Atomic correction plus regroup/lineage, or Conflict with no changes. Original headers remain unchanged. |
| library_set_quality | expected assets, state | Fingerprint-bound library decision revision; no membership change. Drifted decisions do not count as applicable Usable. |
| library_search_targets | query?, cone? {raDeg, decDeg, radiusDeg}, limit | Offline seed and saved targets/aliases with distinct provenance; shared math provides cone filtering, never automatic association. |
| library_resolve_target | query | Qualified provider candidate or ProviderUnavailable; core local use remains available. |
| library_save_target | target fields, expectedRevision | Explicit durable user/provider target and aliases with provenance. |
| library_associate_target | expected sessions, targetId | Explicit confirmed association/evidence revision; no capture-key change. |
| library_save_equipment | camera/optical-train fields, expectedRevision | Durable evidence and confirmed state. |
| library_confirm_equipment | expected sessions, equipmentId | Explicit confirmation revision; source evidence remains inspectable. |
| library_target_coverage | targetId | Effective captured/applicable-usable/unreviewed exposure, unknownExposureCount, drift counts, coveredLocationIds/provisional scope and per-contribution date/availability/last observation. |
| library_review_remap | locationId, native proposedPath | Durable catalog review of per-asset identity/digests/collisions; no image writes. NoByteProof is explicit. |
| library_apply_remap | reviewed operationId, expectedRevision | Atomic per-location apply after every asset passes revalidated byte/identity checks; any refusal leaves all old paths unchanged. |
| library_update_location | locationId, displayName, expectedDecisionRevision | Durable display name; no scan/source changes. |
| library_retry_scope | locationId, native relative subtree | New recorded scan of the failed scope; uncertain scopes never imply Missing. |
| library_reselect_location | locationId, path, expectedDecisionRevision | Restores access only to the verified same volume/root identity; mismatch needs remap review. |
| library_list_operations | filters, offset, limit | Durable Activity operations, including interrupted scans after restart. |

## Errors

InvalidInput, NotFound, Conflict, IdentityConflict, SourceUnavailable, UnsupportedFormat, MetadataUnreadable, ProviderUnavailable and PersistenceFailure name the affected identity/path and retry/review applicability. Unknown evidence is data, never zero-valued success. Nothing reports saved success before its transaction commits.

## Long-running work

`library_scan_progress` events carry operationId, revision, counts and scope. Polling status is the durable truth after disconnect/restart; events alone do not prove terminal success. Scanning runs off the UI thread and permits progressive inspection. Recovery marks interrupted scan scope incomplete and requires safe rescan before absence reconciliation.

## Development verification

The isolated rebuilt shell exposes real core commands to a code-enforced loopback-only dev bridge using dev config/dev-tools. Legacy commands/jobs are not registered against this catalog. Release checks reject unauthenticated dev exposure. Backend IPC proof does not certify UI-dependent LIB criteria: the final clean-slate frontend must retain and validate real onboarding, Targets, Sessions, Settings and Activity through MCP and fresh J19 validation. Production MCP remains future optional work.
