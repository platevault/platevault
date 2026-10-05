# Project IPC contract

Version: 1. Requests and responses are JSON with UUID identities and camelCase fields, following the [library contract](../../064-library-inventory/contracts/library.md). Exposures and goals are seconds, angles degrees. `ExpectedSession`, `ExpectedAsset`, `ObservationFingerprint` with decimal-string `modifiedNs`, `ErrorResponse` and `SessionSummary` keep their library wire forms. Every mutation carries `expectedRevision` for the Project and returns the committed Project only after its transaction commits.

## Inputs

- `TargetFraming`: `{targetId, expectedRevision}`. The Target must be saved; its current revision must equal `expectedRevision`, and its coordinates, designation and provenance are snapshotted.
- `PanelInput`: `{id?, name, raDeg, decDeg, widthDeg, heightDeg, positionAngleDeg?}`. A missing `id` creates a panel; an existing `id` keeps its identity and links.
- `ChecklistItemInput`: `{id?, kind, ...criterion}` with the kinds and criteria in the [data model](../data-model.md#checklist-kinds).
- `SessionLinkInput`: `{session: ExpectedSession, panelId?}`. Linking an already linked session updates its panel assignment.

## Commands

| Command | Request | Response and behavior |
| --- | --- | --- |
| project_create | name, notes?, targets: TargetFraming[] with the prefilled Target first, panels: PanelInput[], equipmentIds | Project at revision 1. Writes only Project rows. |
| project_update | projectId, expectedRevision, name, notes?, targets, panels, equipmentIds | Project replacing framing, notes and equipment. A panel with assigned links cannot be removed. Writes no View, link or quality record. |
| project_set_checklist | projectId, expectedRevision, items: ChecklistItemInput[] | Project with the ordered checklist. Items without `id` get one; omitted items are removed. |
| project_link_sessions | projectId, expectedRevision, links: SessionLinkInput[] | Project with the links added or reassigned. A stale or superseded session is Conflict naming its current revision and successors. Nothing is linked by proximity, OBJECT or name. |
| project_unlink_sessions | projectId, expectedRevision, sessionIds | Project without those links; rejection decisions stay. |
| project_set_rejection | projectId, expectedRevision, expected: ExpectedAsset[], rejected | Project with one rejection decision per asset. Library quality, library totals and View membership stay unchanged. A Retired copy is InvalidInput. No rehash. |
| project_list | targetId?, offset, limit | Project summaries: id, name, revision, Target designations, panel count, linked-session count and checklist item count. `targetId` lists the Projects framing that Target. No progress is computed. |
| project_detail | projectId | Project, framing with `framingChanged`, links with state and per-session evidence, per-channel progress, checklist progress and evidence, and effective rejections. Read-only; starts no rehash. |

No command reads or writes an image file.

## Project detail

- `framing.targets[]`: confirmed snapshot, `currentRevision` and `framingChanged`. `framing.panels[]` as stored.
- `links[]`: `sessionId`, `panelId`, `state` Current or NeedsReview with `successors`, the session summary, `captureSites[]` `{latitudeDeg, longitudeDeg, frames}` plus `unknownSiteFrames`, `exposureSeconds[]` and the equipment association.
- `progress`: `channels[]` and `unknownChannel` rows with `capturedSeconds`, `capturedFrames`, `usableSeconds`, `usableFrames`, `acceptedSeconds`, `acceptedFrames`, `unreviewedSeconds`, `rejectedFrames`, `unknownExposureCount`, `unknownImageTypeCount`, `driftedDecisions`, `verificationPending`, `conflictingDecisions`, `conflictingCopies`, `duplicateCandidates`, `usableLastVerifiedAt` and `acceptedLastVerifiedAt`. The response also carries `provisional` and `coveredLocationIds`.
- `checklist[]`: the item, `basis`, and either `{captured, usable, accepted, goal, met}` for integration and frame_count or `evidence[]` per session or panel. Evidence states are `matches`, `suggested_match`, `differs`, `unknown` and `no_linked_session`, each with a reason.
- `rejections[]`: asset ID, session ID when linked, decision time and the Project revision that wrote it.

## Errors

InvalidInput, NotFound, Conflict and PersistenceFailure use the library `ErrorResponse`. They name the Project, Target, panel, session or asset and say whether reload, review or retry applies. Conflict carries the current revision, and session successors when a session was superseded. Unknown evidence is data, never a zero or a met state.

## Contract extensions

VSEL (066) adds Project-scoped Views to `project_detail` and calls `project_set_rejection` from Project-owned Views. RES (070) adds accepted products. Each feature versions its own additive fields. PLAN (072) reads checklist progress to show gaps beside coverage and saved-site names beside capture sites.

## Development verification

The isolated rebuilt shell registers these commands beside the library commands, with the same loopback-only dev bridge and release exclusion. Backend IPC proof does not certify the Projects surface. The clean-slate frontend must retain and validate it through MCP, together with fresh J20 and J22 validation.
