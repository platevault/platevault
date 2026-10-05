# View IPC contract

Version: 1. Requests and responses are JSON with UUID identities and camelCase fields, following the [library contract](../../064-library-inventory/contracts/library.md). Exposures are seconds and angles degrees. `ExpectedSession`, `ExpectedAsset`, `ObservationFingerprint` with decimal-string `modifiedNs`, `ErrorResponse`, `SessionSummary` and `NativePath` keep their library wire forms.

Edits of the View's unsaved work, its draft under D08, carry `expectedDraftRevision`. The value 0 means no unsaved work exists yet; the edit then starts it from the latest committed revision. Save carries `expectedRevision` and `expectedDraftRevision`. Each mutation returns its result only after its transaction commits. The commands marked *edit* change only the unsaved work and return the `ViewRecord`.

## Inputs

- `ViewOriginInput`: `{kind: "project", projectId}`, `{kind: "target", targetId, expectedRevision}` or `{kind: "sessions", sessions: ExpectedSession[]}`.
- `CriteriaInput`: `{minFootprintCoverage, suggestionRadiusDeg}`. The framing and equipment snapshots come from the origin and are never client-supplied.
- `CandidateFilters`: optional `dateFrom`, `dateTo`, `night`, `channels[]`, `exposureMin`, `exposureMax`, `equipmentIds[]`, `qualityStates[]`, `locationIds[]`, `availability[]`, `objectText`, `missingObject`. Expanded filters: `targetIds[]`, `cameras[]`, `gainMin`, `gainMax`, `offsetMin`, `offsetMax`, `binning[]`, `setTemperatureMin`, `setTemperatureMax`. Absent fields do not filter.
- `CandidateSort`: `{key, direction}`. Keys are `date`, `night`, `channel`, `exposure`, `camera`, `frames`, `integration`, `availability`, `skyDistance` and `overlap`. Rows without the sorted evidence come last.
- `Membership`: `"draft"` or `"committed"`; `committed` reads the latest revision unless `revision` is given.
- `QualityAction`: `mark_usable`, `mark_unusable` or `reject_for_project`.

## Commands

| Command | Request | Response and behavior |
| --- | --- | --- |
| view_create | origin, name? | View at revision 0 with draft revision 1. A Project origin preselects; other origins hold only their chosen sessions. Writes only View rows. Creates no Project or folder and changes no quality. |
| view_list | projectId?, targetId?, offset, limit | View summaries: id, name, origin, projectId, targetId, revision, committedAt, `hasDraft` and `draftStale`. Computes no summary totals. |
| view_detail | viewId | Header, latest revision, draft header, criteria, session choices with reasons, summaries for the revision and the draft, unresolved sources, `projectContextChanged` and open choices. Read-only. |
| view_candidates | viewId, membership, filters, sort, selectedOnly, offset, limit | Candidate rows with evidence and selection state, `matchCount`, `selectedCount` and `selectedOutsideFilters`. Starts no measurement or rehash and writes nothing. |
| view_frames | viewId, membership, sessionId?, state?, offset, limit | Members with copies, path display, channel, exposure, state, reason, quality when chosen, current applicable quality, availability, changed-since-review flag and each copy's current `ExpectedAsset`. |
| view_update_details | viewId, expectedDraftRevision, name, projectId?, criteria | *Edit.* Sets these values. Changing the Project or criteria selects nothing. The profile belongs to PREP handoff settings. |
| view_select_sessions | viewId, expectedDraftRevision, sessions: ExpectedSession[] | *Edit.* Chooses the sessions as `manual`, with their members under D02. A stale or superseded session is Conflict with successors. |
| view_select_matching | viewId, expectedDraftRevision, filters | *Edit.* Chooses every session matching the filters as `select_matching` and records the filters. |
| view_deselect_sessions | viewId, expectedDraftRevision, sessionIds | *Edit.* Removes those choices and their members. A criteria-based choice becomes a session exclusion. |
| view_clear_selection | viewId, expectedDraftRevision | *Edit.* Leaves no selected session. Criteria-based choices become session exclusions. Other Views stay unchanged. |
| view_set_frames | viewId, expectedDraftRevision, memberKeys, state | *Edit.* Sets those members `included` or `excluded`. A non-member is InvalidInput. Files and library quality stay unchanged. |
| view_save | viewId, expectedRevision, expectedDraftRevision | Revision n+1 when the draft's base is n. A blank name is InvalidInput. Changes no quality and creates no folder. |
| view_discard_draft | viewId, expectedDraftRevision | Removes the draft. A View at revision 0 is removed with it. |
| view_refresh | viewId | Durable refresh review against the latest revision, with its items. Changes no membership. |
| view_apply_refresh | reviewId, viewId, expectedRevision, expectedDraftRevision, accept, decline | *Edit.* Applies the accepted items and excludes declined additions. A stale review or item is Conflict. |
| view_quality_scope | viewId, membership, action, memberKeys | The named scope: library or Project name, frames, sessions and seconds per channel, and refused non-members. Read-only. |
| view_apply_quality | viewId, membership, expectedDraftRevision?, action, expected: ExpectedAsset[], expectedProjectRevision? | Updated assets or Project after the scoped write. Membership stays unchanged. A Retired copy is InvalidInput. |
| view_revision | viewId, revision | The committed revision with every member, copy and review basis. Read-only; PREP, CAL and STO consume it. |

No command reads or writes an image file except `view_apply_quality`, which hashes sources read-only for library decisions.

## View detail

- `revision` and `draft`: name, projectId, criteria, revision numbers, times and, for the draft, `baseRevision` and `stale`.
- `profile`: null in version 1. PREP (069) fills it from its handoff settings; `profile_unset` stays in the open choices until a profile is set.
- `sessions[]`: session ID, grouping revision, state, reason, evidence and the current `SessionSummary` with successors when superseded.
- `summary` per membership: `channels[]` and `unknownChannel` rows with `includedFrames`, `includedSeconds`, `unreviewedFrames`, `usableFrames`, `unknownExposureCount`, `unknownImageTypeCount`, and `excluded` counts by reason. It also carries `unresolved[]` and `changedSinceReview[]`.
- `unresolved[]`: session ID, location ID and name, availability, failure reason, member keys, paths, `lastObservedFrames`, `lastObservedSeconds`, `verified: false` and `actions` naming `reconnect`, `locate` or `remove`.
- `openChoices[]`: `unsaved_draft`, `stale_draft`, `unresolved_members`, `quality_needs_review`, `changed_since_review`, `project_context_changed` and `profile_unset`, each with its count.

## View revision

`view_revision` returns an immutable committed revision. Reading an older revision is never Conflict; a consumer compares it with the View's latest `revision`.

- Header: `viewId`, `revision`, `name`, `projectId`, `criteria`, `basedOn` and `committedAt`.
- `sessions[]`: `sessionId`, `groupingRevision`, `state` (`selected` or `excluded`) and `reason`. Manual, select-matching and origin-session reasons are pinned manual inclusions.
- `members[]`: `memberKey`, `sessionId`, `state` (`included` or `excluded`), `reason`, `qualityWhenChosen`, `addedInRevision` and `copies[]` of `{assetId, decisionRevision, fingerprint}`. One member is one logical capture, and its copies are the review basis.

Unresolved is never a stored state. `view_detail` derives it from live availability and lists it with the open choices.

## Errors

InvalidInput, NotFound, Conflict and PersistenceFailure use the library `ErrorResponse`. They name the View, draft, session, member or asset and say whether reload, review or retry applies. A draft Conflict carries the current draft revision, and a save Conflict the current committed revision. A session Conflict carries successors when the session was superseded. Unknown evidence is data, never a zero distance, a zero overlap or a match.

## Contract extensions

VSEL adds `views[]` to `project_detail` with the `view_list` summary fields of each View whose Project is that Project. CAL, PIX, PREP, RES and STO read members through `view_revision` and the draft reads. Each feature versions its own additive fields. PREP adds `profile` to `view_detail`. RES adds Complete and Reopen state and its open check to `view_save`.

## Development verification

The isolated rebuilt shell registers these commands beside the library and Project commands, with the same loopback-only dev bridge and release exclusion. Backend IPC proof does not certify the View review surface. The clean-slate frontend must retain and validate it through MCP, together with fresh J20 S8, J21, J22 and J25 validation.
