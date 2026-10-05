# Project goals data model

## Durable entities

Project records are Tier 1 user decisions in the clean library catalog. Every mutation commits in one writer transaction against the expected Project revision. Project writes touch only the Project tables listed here.

- Project: UUID, trimmed non-empty name, optional notes, decision revision starting at 1, created and updated times. It holds ordered framing Targets and panels, an ordered set of equipment IDs, an ordered checklist, session links and rejection decisions. It has no capture-site field and no lifecycle state (research R12).
- ProjectTarget: saved Target ID, the Target decision revision the user confirmed, and snapshots of designation, coordinates and provenance at that revision. Coordinates stay null when the Target has none. Reads add the Target's current revision and `framingChanged` when the two differ. Framing keeps the snapshot until the user confirms again (R2).
- ProjectPanel: UUID, name unique within the Project, ICRS center `raDeg` in [0, 360) and `decDeg` in [-90, 90], `widthDeg` and `heightDeg` in (0, 180] and optional `positionAngleDeg` in [0, 360). Null orientation stays unknown, never zero. A panel with assigned links is removed only after those links are unassigned.
- Project equipment: ordered unique saved Equipment IDs used by VSEL for initial preselection. The set may be empty. Saving it changes no association, capture key or quality.
- ChecklistItem: UUID kept across edits, position, kind and criterion. Kinds are listed below. Each item names its criterion and progress basis.
- ProjectSessionLink: Project ID, session ID, optional panel ID, the session's grouping revision when linked and the link time. A session is linked only through an `ExpectedSession` that matches the current session.
- ProjectRejection: append-only decision rows with Project ID, asset ID, `rejected` flag, the asset's observation fingerprint as history, the Project revision written and the decision time. The latest row per Project and asset is effective. Withdrawal is a new row with `rejected` false.

Framing always holds at least one Target or panel (R3). Every referenced Target, Equipment, session and asset must exist; foreign keys enforce it, and a missing record returns NotFound.

## Checklist kinds

| Kind | Criterion | Progress basis |
| --- | --- | --- |
| integration | channel, `goalSeconds` whole and at least 1 | Captured, library-usable and Project-accepted seconds; met when accepted reaches the goal |
| frame_count | channel, `goalFrames` whole and at least 1 | Captured, library-usable and Project-accepted logical light frames; met when accepted reaches the goal |
| exposure_preference | `exposureSeconds` finite and above 0, optional channel | Each linked session's effective exposure: matches, differs or unknown |
| panel_coverage | all Project panels; the Project needs at least one panel | Linked sessions assigned to each panel; a panel without one reads no linked session |
| equipment | saved Equipment ID | Each linked session's equipment association: matches when Confirmed, suggested_match when Suggested, differs or unknown |
| missing_calibration | dark, flat, bias or dark_flat, optional channel | Unknown with reason `calibration_matching_unavailable` until 068 supplies matching evidence |

Only integration and frame_count have a met state. Meeting one changes no Project field.

## Link states

A link reads Current while its session is current. When a library correction supersedes the session, the link reads NeedsReview with the lineage successor IDs. It stays recorded, contributes no progress and is resolved only by an explicit link or unlink (R5). Unlinking removes the link row and keeps every rejection decision.

## Progress

Progress is computed on read in one reader transaction and is never stored. Reading it starts no rehash and writes nothing.

1. The basis is the current members of Current links. Retired copies count toward no total.
2. Each logical capture counts once, on an available copy when one exists (D16). Only light frames enter channel rows. Frames of unknown image type are counted separately.
3. The channel is the effective FILTER text. Unknown FILTER forms the unknown-channel row, which no goal reads (R7).
4. Captured counts every light capture. Captured seconds add known exposure; unknown exposure is counted, never zero.
5. Library-usable counts captures whose applicable quality is Usable as of the last completed verification (D19). Drifted, verification-pending, conflicting and conflicting-copy captures appear as counts outside usable.
6. Project-accepted counts library-usable captures with no effective rejection on any copy. A rejected library-Unreviewed capture stays captured and never becomes accepted.
7. Seconds are sums of per-frame exposure rounded to whole microseconds (R8). The wire shows seconds; met compares the integers.
8. Each channel row labels the oldest `lastVerifiedAt` behind usable and accepted totals. The row also carries provisional scope and covered location IDs, using the library rules.

Offline captures keep last-observed contributions with their availability labels, as Target coverage does.

## Per-session evidence

Each linked session shows its summary from `library_list_sessions`: identity, counts, availability and last observation. It also shows its distinct observed site coordinates with frame counts, or unknown (R14). Effective exposure appears as one value, several values or unknown. The equipment association appears with state and provenance, plus the assigned panel. These values come from library records; the Project stores none of them.

## Atomicity and durability

Each Project command is one `BEGIN IMMEDIATE` transaction on the FULL-synchronous writer. It checks the expected Project revision, the referenced records' expected revisions and the input validation, then increments the revision. Any failure leaves every Project row unchanged and reports Conflict, NotFound, InvalidInput or PersistenceFailure. A disposable `max_page_count` catalog proves that SQLITE_FULL returns PersistenceFailure and that nothing persists after reopen. Restart restores every committed Project, link, checklist item and rejection.

## References

`ProjectReferences` answers `AssetReferences::references_to` with kind Project. It names each Project whose Current or NeedsReview links hold any of the asked assets, or whose effective rejections name them. The revision is the Project revision. Retire review lists these Projects, and a changed Project revision refuses retire confirmation. Retired copies stay in Project records, read Retired and leave every Project total.
