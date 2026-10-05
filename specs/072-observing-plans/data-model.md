# Observing plans data model

## Durable entities

Planning records are Tier 1 user decisions in the clean library catalog. Every mutation commits in one writer transaction against its expected revision. Planning writes touch only the tables listed here and never a Target, session, Project or image file.

- ObservingSite: UUID, trimmed non-empty `name` unique among sites, `latitudeDeg` in [-90, 90], east-positive `longitudeDeg` in [-180, 180], optional finite `elevationM`, `timeZone` as an IANA name in the bundled database, decision revision starting at 1, created and updated times (research R2, R3).
- PlanningSettings: one row holding the optional `defaultSiteId` and its own decision revision. A missing default is explicit, never the first site.
- TargetPlan: saved Target ID, `planned` flag, decision revision and update time. A Target without a row reads not Planned at revision 0. Writing it never changes the Target row (R10).
- ReminderSubscription: saved Target ID as key, site ID and the site revision confirmed at activation, the PlanningSettings revision confirmed at activation, the criteria snapshot, `leadMinutes` from 1 to 1440, state, block reason, decision revision, activation and update times (R12).
- ReminderDelivery: Target ID, site ID, `windowStartUtc` at whole minutes, window end, night date, due instant, state, failure reason and record times. The triple of Target, site and window start is unique (R15).

Every referenced Target and site must exist; foreign keys enforce it, and a missing record returns NotFound.

## Criteria

| Field | Values | Meaning |
| --- | --- | --- |
| `minAltitudeDeg` | finite, in [0, 90) | Geometric target altitude above a flat horizon, without refraction |
| `darkness` | `civil`, `nautical`, `astronomical` | Sun below -6, -12 or -18 degrees |
| `moon` | `{kind: none}`, `{kind: below_horizon}`, `{kind: min_separation, minSeparationDeg}` with the angle in (0, 180) | No Moon limit; Moon center below the geometric horizon; separation at least the angle whenever the Moon is up |
| `minDurationMinutes` | whole, 1 to 1440 | Shortest window kept after inward rounding |

Every field is required in each request. No default criterion is filled in.

## Windows

Windows are computed on read and never stored. A request names a saved Target, a site, the first night, the number of nights from 1 to 366 and the criteria.

1. Each night runs from local noon on its date to local noon on the next date in the site's zone (R5).
2. The core intersects the dark interval, the target-above intervals and the Moon-allowed intervals, as research R7 describes.
3. Boundaries are rounded inward to whole minutes, and shorter windows than the minimum are dropped.
4. A window carries its key, `startUtc`, `endUtc`, local start and end as RFC 3339 with offsets, the zone name, `durationMinutes` and its night date.
5. A night without a window carries one reason: `never_dark`, `target_never_above`, `moon_excluded`, `shorter_than_minimum` or `no_overlap`.
6. The response basis names the Target and its decision revision, the site with its name and revision, the zone, the criteria and the method `skymath 0.7.2, geometric, no refraction`.

A Target without coordinates or with a frame other than `icrs` returns no windows and the reason `target_coordinates_unknown` or `unsupported_coordinate_frame` (R8).

## Window identity

A window key is the Target ID, the site ID and `startUtc` at whole minutes. Repeat suppression and calendar UIDs both use it. The same inputs produce the same key after restart, because windows depend on the night and never on the time of the request.

## Subscription states

| State | Entered by | Schedules reminders |
| --- | --- | --- |
| absent | never enabled | no |
| `enabled` | activation with granted permission | yes |
| `blocked` | activation or a pre-submission check without granted permission; reason `permission_denied`, `unbundled_process` or `platform_not_qualified` | no |
| `needs_reconfirmation` | a default-site change, a default cleared, or an edit of the subscribed site | no |
| `disabled` | explicit disable | no |

Only activation moves a subscription to `enabled`, and only with the current default site, its revision and explicit criteria and lead time. A `blocked` subscription keeps its values, so Retry repeats activation with them.

## Delivery states

| State | Meaning |
| --- | --- |
| `sending` | Committed before submission; the identity is now taken |
| `submitted` | The OS notification center accepted the request; the user may not have seen it yet |
| `failed` | The adapter refused or returned an error, with its reason |
| `uncertain` | A `sending` row found at catalog open; it is never sent again |

No state represents delivery to the user (PLAN-FR-07). Every state keeps the identity taken, so the scheduler never submits that window again.

## Reminder schedule

The schedule is computed on read and never stored. For each `enabled` subscription the core computes windows at the subscribed site with the subscribed criteria. It covers the night before the current site-local date through two nights after it. A reminder is due from window start minus lead time until window start (R16). Upcoming reminders are listed with their due instant, window and site name. App-closed delivery reads unavailable with reason `no_installed_scheduler` (R14).

## Target overview

The overview is read in one call and writes nothing. It holds the Target, its TargetPlan, the saved sites, the default site, the Target's ReminderSubscription and the 064 Target coverage. It also lists the Projects framing the Target, with each checklist item that 065 reports unmet or unknown and its progress or evidence (R23). It holds no window; windows need an explicit site and criteria.

## Calendar snapshot

An export review recomputes the windows of one Target and site, keeps the selected keys in time order and returns the snapshot digest. The digest is SHA-256 over the canonical JSON of the Target ID and revision, the site ID and revision, the zone, the night range, the criteria and the selected windows. Export writes the bytes rendered from that snapshot once. PlateVault keeps no copy and never rewrites the file. The response returns the path display, byte count, SHA-256 and window count.

## Atomicity and durability

Each planning mutation is one `BEGIN IMMEDIATE` transaction on the FULL-synchronous writer. It checks the expected revisions and the input validation, then increments the revision. A default-site change and a site edit update the affected subscriptions in the same transaction. Any failure leaves every planning row unchanged and reports Conflict, NotFound, InvalidInput or PersistenceFailure. A disposable `max_page_count` catalog proves that SQLITE_FULL returns PersistenceFailure and that nothing persists after reopen. Restart restores every committed site, setting, Planned mark, subscription and delivery row, and marks `sending` rows `uncertain`.
