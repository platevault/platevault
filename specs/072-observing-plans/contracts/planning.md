# Planning IPC contract

Version: 1. Requests and responses are JSON with UUID identities and camelCase fields, following the [library contract](../../064-library-inventory/contracts/library.md). Angles are degrees, elevations meters, durations and lead times whole minutes. Instants are RFC 3339 UTC strings, and local times are RFC 3339 strings with the site's offset. Nights are ISO dates in the site's zone. `ErrorResponse`, `TargetCoverage` and `NativePath` keep their library wire forms. Every mutation carries the expected revisions it depends on and returns its record only after its transaction commits.

## Inputs

- `SiteInput`: `{name, latitudeDeg, longitudeDeg, elevationM?, timeZone}` with the validation in the [data model](../data-model.md#durable-entities).
- `PlanCriteria`: `{minAltitudeDeg, darkness, moon, minDurationMinutes}` as listed in the [criteria table](../data-model.md#criteria). Every field is required.
- `WindowQuery`: `{targetId, siteId, firstNight, nights, criteria}` with `nights` from 1 to 366.
- `ReminderInput`: `{targetId, criteria, leadMinutes}` with `leadMinutes` from 1 to 1440.
- `ExportSelection`: `{query: WindowQuery, windowKeys: string[]}` with at least one key.

## Commands

| Command | Request | Response and behavior |
| --- | --- | --- |
| planning_list_sites | none | Sites with revisions, `defaultSiteId` or null, and the settings revision. |
| planning_save_site | siteId?, expectedRevision?, site: SiteInput | Site at revision 1 when created, or the next revision. An edit moves subscriptions on that site to `needs_reconfirmation` and names them. An unknown zone name is InvalidInput. |
| planning_set_default_site | siteId or null, expectedRevision | Settings with the new default. Subscriptions on another site, or every subscription when the default is cleared, move to `needs_reconfirmation` and are named. |
| planning_target_overview | targetId | Target, Planned mark, sites, default site, subscription state, Target coverage and Project gaps. Read-only. |
| planning_compute_windows | query: WindowQuery | Window set with its basis and one entry per night: windows or a no-window reason. Read-only; writes nothing and starts nothing. |
| planning_set_planned | targetId, planned, expectedRevision | TargetPlan. The Target record and its decision revision stay unchanged. Enables no reminder. |
| planning_review_reminders | reminder: ReminderInput | Review naming the default site with its revision and zone, the criteria, the lead time, the settings revision, the permission state, `appClosedDelivery` and the next reminders these values would produce. Writes nothing. No default site is InvalidInput naming `defaultSite`. |
| planning_enable_reminders | reminder: ReminderInput, siteId, siteRevision, settingsRevision, expectedRevision? | Requests permission when it is `not_determined`, then commits the subscription as `enabled` or `blocked` with its reason. No default site is InvalidInput naming `defaultSite`, and missing criteria or lead time is InvalidInput; neither stores anything. A site that is not the default, or a site or settings revision that no longer matches, is Conflict. Starts no indexing. |
| planning_disable_reminders | targetId, expectedRevision | Subscription `disabled`. The scheduler stops when no subscription stays enabled. |
| planning_reminder_status | offset, limit | `schedulerRunning`, permission state, `appClosedDelivery`, subscriptions, upcoming reminders and delivery records, newest first. Read-only. |
| planning_open_notification_settings | none | `{opened: true}`, or `{opened: false, reason}` where the platform has no settings target. Changes no record. |
| planning_review_calendar_export | selection: ExportSelection | Review with the site, zone, night range, selected windows in time order, `snapshotDigest` and a suggested file name. A key absent from the recomputed set is Conflict naming it. Writes nothing. |
| planning_export_calendar | selection: ExportSelection, snapshotDigest | Recomputes the snapshot; a different digest is Conflict. Opens the native save dialog. Returns `{saved: false}` when canceled, else `{saved: true, path, byteCount, sha256, windowCount}` after the file is synced. |

No command reads or writes an image file, opens a network connection or asks for an account.

## Window set

- `basis`: `targetId`, `targetRevision`, `designation`, `site {id, name, revision, latitudeDeg, longitudeDeg, elevationM}`, `timeZone`, `criteria` and `method`.
- `nights[]`: `night`, `windows[]` and `noWindowReason` when the list is empty.
- `windows[]`: `key`, `startUtc`, `endUtc`, `startLocal`, `endLocal`, `timeZone`, `durationMinutes` and `siteName`.
- `unavailableReason`: `target_coordinates_unknown` or `unsupported_coordinate_frame`, with no nights.

No window field claims weather, equipment, availability or processing readiness.

## Reminders

- `permission`: `{state: granted | denied | not_determined | unavailable, reason?}`.
- `appClosedDelivery`: `{available: false, reason: "no_installed_scheduler"}`.
- `subscription`: `targetId`, `siteId`, `siteName`, `siteRevision`, `criteria`, `leadMinutes`, `state`, `blockReason`, `revision` and times. A `blocked` subscription with reason `permission_denied` offers the actions `settings` and `retry`; the other reasons offer `retry`.
- `upcoming[]`: `targetId`, `designation`, `siteName`, `windowKey`, `dueAt`, `startLocal`, `endLocal` and `timeZone`.
- `deliveries[]`: `windowKey`, `siteName`, `state` (`sending`, `submitted`, `failed`, `uncertain`), `reason` and times.

Every reminder and notification names its site. No response says delivered.

## Target overview

- `target` with its decision revision, `plan {planned, revision}`, `sites[]`, `defaultSiteId` and `subscription` or null.
- `coverage`: the `library_target_coverage` result for the Target.
- `projectGaps[]`: `projectId`, `name`, `revision` and the items 065 reports unmet or unknown, each with its kind, criterion, progress or evidence state and reason.

## Errors

InvalidInput, NotFound, Conflict, AccessDenied and PersistenceFailure use the library `ErrorResponse`. They name the Target, site, subscription, window key or path and say whether reload, review or retry applies. Conflict carries the current revision. A permission denial is a committed `blocked` state, never an error and never success. Unknown evidence is data, never a zero or a window.

## Development verification

The isolated rebuilt shell registers these commands beside the library and Project commands, with the same loopback-only dev bridge and release exclusion. It registers `tauri-plugin-dialog` and `tauri-plugin-opener` for their Rust APIs and adds no webview capability. Backend IPC proof does not certify the Plan area or the Settings sites section. The clean-slate frontend must retain and validate them through MCP, together with fresh J29 and J20 S6 and S7 validation.
