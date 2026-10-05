# View selection data model

## Durable entities

View records are Tier 1 user decisions in the clean library catalog. Every mutation commits in one writer transaction against an expected revision. View writes touch only the View tables listed here, except the scoped quality actions in [Quality actions](#quality-actions).

- View: UUID, origin `project`, `target` or `sessions`, the origin Project or Target ID, the latest committed revision and created and updated times. The revision is 0 until the first Save. The origin never changes.
- ViewRevision: View ID, revision from 1, trimmed non-empty name, optional Project ID, criteria, the revision it was based on, the applied refresh review ID if any, and the commit time. Committed rows never change (R3). The profile is a PREP handoff setting keyed by View ID, not a View column (R5).
- ViewDraft: View ID, draft revision from 1, base revision, name that may be blank, Project ID, criteria and the update time. A View has at most one draft. A draft is recoverable unsaved work, never committed membership (R2).
- ViewCriteria: the framing snapshot, the equipment ID snapshot, `minFootprintCoverage` in (0, 1] with default 0.5 and `suggestionRadiusDeg` in (0, 180] with default 2.0 (R7, R8, R22).
- FramingSnapshot: source `project`, `target` or `none`, the Project revision when the source is a Project, Targets and panels. Each Target keeps its ID, revision, designation and coordinates, or null coordinates. Each panel keeps its ID, name, `raDeg`, `decDeg`, `widthDeg`, `heightDeg` and optional `positionAngleDeg`; null orientation stays unknown.
- SessionChoice: the owning `view_revisions` row, session ID, grouping revision when chosen, state `selected` or `excluded`, reason and evidence. Reasons are `geometry_suggestion`, `refresh_match`, `manual`, `select_matching` with its filters, and `origin_sessions` (R12).
- ViewMember: the owning `view_revisions` row, member key, the session it was chosen through, state `included` or `excluded`, reason, the applicable quality when chosen and `addedInRevision`. The member key is the smallest copy asset ID when chosen. One member is one logical capture (D16).
- MemberCopy: member key, asset ID, decision revision and observation fingerprint when chosen, ordered by asset ID. These form the review basis that PREP re-verifies.
- RefreshReview: UUID, View ID, base revision, criteria, items, state `reviewed` or `applied`, and created and applied times.

Every referenced Project, Target, Equipment, session and asset must exist; foreign keys enforce it, and a missing record returns NotFound. Each `view_revisions` row owns its session choices and members.

The tables are `views`, `view_revisions`, `view_session_choices`, `view_members`, `view_member_copies` and `view_refresh_reviews`. A draft and its committed successor share one `view_revisions` row with an integer key, a nullable `revision` and a `state` of `draft` or `committed`. `UNIQUE(view_id, revision)` lets sibling features reference a committed revision by `(view_id, revision)`.

## Revision lifecycle

| Event | Effect |
| --- | --- |
| `view_create` | View at revision 0 with unsaved work at draft revision 1 holding the origin choices |
| Edit with no unsaved work | Copies the latest committed revision into new unsaved work at draft revision 1 |
| Later edit | Draft revision plus one; committed rows unchanged |
| `view_save` | The unsaved work becomes revision n+1 when its base is n; else Conflict |
| `view_discard_draft` | Removes the unsaved work; a View at revision 0 is removed with it |
| Restart | Committed revisions and the unsaved work return unchanged and separately |

A draft whose base differs from the latest revision reads `stale`. The user can discard it or read it beside the current revision, and Save refuses it.

## Initial membership

Selecting a session adds each of its logical captures once, computed in the write transaction from the capture's applicable quality (D02, R14).

| Applicable quality | State | Reason |
| --- | --- | --- |
| Unreviewed, Usable | included | `initial` |
| Unusable | excluded | `library_unusable` |
| ChangedContent, VerificationPending, Conflicting, ConflictingCopies | excluded | `quality_needs_review` with the state |

Later edits set `view_exclusion`, `explicit_inclusion` or `restored`. A refresh addition sets `refresh_added` with the review ID. Library quality changes after selection change no stored state.

A member is unresolved when it is included and none of its copies is Available (R15). A member is changed since review when its current fingerprint differs from its recorded basis (R16). Neither condition changes the stored state.

## Geometry evidence

Evidence is computed on read and never stored as membership, except the evidence recorded with a criteria-based choice (R11).

| Class | Condition | Distance | Footprint | Preselectable |
| --- | --- | --- | --- | --- |
| footprint | every light frame has pointing, orientation and field of view | separation of the mean pointing | yes | when it matches and the equipment qualifies |
| pointing_only | every light frame has pointing; some lack field of view or orientation | separation of the mean pointing | no | never |
| position_unknown | a light frame lacks pointing | none | no | never |

The field of view lists each input with its source: `header` or `equipment` with the equipment ID (R6). A match names the framing Target or panel and, for panels, the lowest coverage across frames (R7). Unknown values stay null; no distance or coverage reads 0.

## Candidates

A candidate row is one current session of light or unknown image type (R20). It shows:

- the session, date basis and night
- channel, exposure, camera and optical train with the equipment association state
- frames, captures, integration and counts per applicable quality state
- availability, last observation and location IDs
- geometry evidence and the suggestion state `preselectable`, `suggested`, `pointing_only` or `none`
- its selection state and reason in the chosen membership
- `measurements` as null until PIX supplies them (S3)

A page reports `matchCount`, `selectedCount` and `selectedOutsideFilters`. Filters, sorting and paging change no stored row.

## Summary

The summary is computed on read from the chosen membership (R19).

1. Channel rows count included, available and unchanged captures once each, with included microseconds shown as seconds.
2. Unknown FILTER forms the unknown-channel row. Unknown exposure and unknown image type are counted separately, never as zero.
3. Each row shows included Unreviewed and Usable counts, and excluded counts by reason, including library-Unusable.
4. Unresolved members are listed per session and location with availability, failure reason, paths and last-observed frames and seconds labelled unverified.
5. Changed-since-review members are listed separately and leave the totals.

The worked membership reads Ha 111 / 9h 15m, OIII 97 / 8h 05m and 208 / 17h 20m.

## Refresh items

| Kind | Cause | Accept effect |
| --- | --- | --- |
| added_session | matches the criteria, not chosen, not excluded | Selects it with reason `refresh_match`; members follow D02 |
| added_captures | new captures joined a member session | Adds those captures under D02 |
| removed | a criteria-based member whose current session fails the criteria | Removes those members |
| regrouped | a member session was superseded | Points the choice at the successors; members unchanged |
| unavailable | a member has no Available copy | None; listed only |
| manual_inclusion | a pinned manual choice outside the criteria | None; kept |
| kept_exclusion | an excluded session or capture | None; kept |

Declining an added session records a session exclusion. Members added by an accepted item carry `addedInRevision` after Save and read as needing image and calibration review (R25).

## Quality actions

| Action | Scope | Accepted members | Writer |
| --- | --- | --- | --- |
| mark_usable | library | included members | library quality decision, after hashing |
| mark_unusable | library | any member | library quality decision, after hashing |
| reject_for_project | the View's Project | any member of a Project-owned View | 065 Project rejection |

Each action names its scope before confirmation and changes no member state (R18).

## Atomicity and durability

Each View command is one `BEGIN IMMEDIATE` transaction on the FULL-synchronous writer. It checks the expected revisions, the expected sessions and assets and the input validation, then increments the revision. Any failure leaves every View row unchanged and reports Conflict, NotFound, InvalidInput or PersistenceFailure. A disposable `max_page_count` catalog proves that SQLITE_FULL returns PersistenceFailure and that nothing persists after reopen. Restart restores every committed revision and the unsaved work, each labelled.

## References

`ViewReferences` answers `AssetReferences::references_to` with kind View. It names each View whose committed revisions or draft hold any of the asked assets as copies. Its revision is the latest committed revision (R26). Retire review lists these Views, and a changed reference refuses retire confirmation. Retired copies stay members, read Retired and count as unresolved.
