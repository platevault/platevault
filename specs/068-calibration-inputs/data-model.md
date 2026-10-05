# Calibration inputs data model

## Durable entities

Calibration plans, decisions, adoption reviews, adoption operations and adopted masters are Tier 1 rows in the clean library catalog. Each mutation commits in one writer transaction against its expected revision. Calibration writes touch only the tables below. Accept and exception also bind the digest and `last_verified_at` of the assets they hash, as `verify_digest` does ([research](research.md) R14). Detected candidates, raw sets, evaluations and handoff state are recomputed on read and never stored.

- CalibrationPlan: View ID (primary key), plan revision starting at 1, required kinds and update time. A View without a row reads revision 0 with the default kinds dark and flat (R11). The plan revision guards every decision on that View.
- CalibrationDecision: an append-only row holding:
  - View ID and the committed View revision it was made at, as a foreign key to `view_revisions(view_id, revision)`;
  - light Session ID and its grouping revision;
  - the exact included light asset IDs;
  - kind, resolution (`accepted`, `exception` or `withdrawn`), input reference and input revision;
  - the input basis, the criteria snapshot, an optional reason, the plan revision written and the decision time.

  The latest row per View, light Session and kind is effective. Withdrawal appends a `withdrawn` row with no input.
- InputBasis: one entry per handed-off file. It holds `assetId` (raw set) or `masterId` (adopted master), `locationId`, lossless `relativePath` and the fingerprint whose `contentSha256` was hashed at decision time. Copies with equal SHA-256 appear once (D16). Library-Unusable members are left out and listed as excluded (R3).
- AdoptionReview: UUID, revision and state (`open` or `adopted`). It also holds:
  - the source: asset ID or RES output ID, with location or root, relative path, fingerprint and the SHA-256 hashed at review;
  - the classification: kind, form `master` and evidence basis `header_stack_count`, `header_imagetyp` or `name_only`;
  - the observed metadata snapshot and the origin;
  - the destination: Calibration location ID and relative path;
  - the creation time.
- AdoptionOperation: UUID, review ID, state (`running`, `completed`, `failed` or `interrupted`) and last recorded phase. It records the temporary-file relative path with its identity, the installed identity, the error response, start and finish times, and the master ID on completion. Phases appear in the [lifecycle](#adoption-lifecycle).
- AdoptedMaster: UUID, kind, destination location ID and relative path (unique pair), and destination fingerprint with SHA-256. It also holds the observed metadata of the copied bytes, provenance (review ID, source identity and SHA-256, origin, adoption time) and a revision. Library corrections of the source are not carried (R16). An indexed destination asset, matched by location, path and digest, links to the master.

Every referenced View revision, Session, asset, location, review and master must exist. Foreign keys enforce it, and a missing record returns NotFound.

## Kinds, forms and classification

| Form | Source | Kind rule | Reusable |
| --- | --- | --- | --- |
| raw_set | current Session from an indexed location | effective IMAGETYP maps through the v1 table to bias, dark or flat; master members excluded (R3) | after acceptance |
| candidate | indexed asset, or RES output once 070 lands | stack count above 1, IMAGETYP master token, or name only (R4) | never; Add to calibration library only |
| master | AdoptedMaster | kind recorded at adoption | after adoption, and acceptance per View |

Dark flats, light masters and unclassified frames are not calibration inputs (R2, R4).

## Criteria

Each criterion returns `compatible`, `incompatible` or `unknown`. It carries the light value, the input value, the evidence source of each side and tolerance `none`. A missing value on either side reads unknown, never compatible (D13).

| Criterion | Kinds | Rule |
| --- | --- | --- |
| image_type | all | input kind equals the requirement kind |
| camera | all | INSTRUME on both sides; CAMERAID compared when both record it, one-sided reads unknown (R7) |
| dimensions | all | width and height equal |
| binning | all | X and Y binning equal |
| gain | all | canonical decimals equal |
| offset | all | integers equal |
| exposure | dark | canonical decimals equal |
| set_temperature | dark | cooler setpoints equal as canonical decimals |
| channel | flat | effective FILTER text equal (R9) |
| optical_train | flat | same Confirmed Equipment ID, else a fully known header (TELESCOP, FOCALLEN) pair on both sides compared exactly (R8) |

Evidence without a verdict: measured temperature, readout mode, night distance in days, member availability and quality counts.

A candidate's verdict is compatible when every criterion is compatible. It is incompatible when any criterion is incompatible, and unknown otherwise.

## Requirements and states

A requirement is one light Session of a committed View revision, paired with one required kind. The included asset set comes from the revision's included members, grouped by Session (VSEL seam). Product inputs carry no requirement.

| State | Meaning | Enters handoff |
| --- | --- | --- |
| suggested | a compatible candidate is preselected and not accepted | no |
| accepted | effective `accepted` decision still applicable | yes |
| excepted | effective `exception` decision still applicable | yes |
| unresolved | named reason (below) | no |

Unresolved reasons are:

- `no_candidate`: no candidate lists for the requirement.
- `suggestion_unaccepted`: compatible candidates exist, none accepted.
- `criterion_unknown` and `criterion_incompatible`: the only candidates carry such criteria and no exception exists.
- `light_membership_changed` and `input_evidence_changed`: the R13 applicability checks failed.
- `input_unavailable`: the input is offline, unreadable, Retired or superseded.
- `light_type_unknown`: the member Session's own type is unknown.

A requirement is applicable to a later revision only under R13. `ready` is true when no requirement is suggested or unresolved.

## Candidate order

Compatible candidates are ordered by absolute night distance to the light Session, with unknown nights last. Ties put adopted masters before raw sets, then ascending ID. The first available one is preselected. A candidate that is offline, unreadable or partially available is never preselected, and neither is an unadopted one. A candidate from a Retired location is not listed (R10).

## Adoption lifecycle

A review records the source digest and checks the destination without writing. Confirming it runs these phases, each committed before the next file effect:

1. `intent`: the operation row is Running.
2. `temp_created`: the create-new temporary file and its identity are recorded.
3. `copied`: the streamed bytes hashed to the review digest and `sync_all` succeeded.
4. `installed`: the no-replace install succeeded, the folder was synced, and the installed identity is recorded.
5. `verified`: the destination re-read and the source re-hash both equal the review digest.
6. `registered`: the AdoptedMaster row, the review `adopted` state and the operation `completed` state commit together.

A failure records `failed` with its phase and error and registers nothing. A temporary file with the recorded identity is removed. An installed copy is left in place and named. Opening the catalog turns `running` into `interrupted`. Retrying the same review resumes from `installed` only when the destination's identity and digest equal the recorded ones. Otherwise an existing destination entry blocks (D05).

## Atomicity and durability

Plan, decision, review and master writes are one `BEGIN IMMEDIATE` transaction on the FULL-synchronous writer. Each checks the plan revision, the current committed View revision, input revisions and View completion. Accept and exception hash inputs before the transaction and re-check fingerprints inside it. Any failure leaves calibration rows unchanged and reports Conflict, NotFound, InvalidInput, IdentityConflict, SourceUnavailable or PersistenceFailure. A disposable `max_page_count` catalog proves that SQLITE_FULL returns PersistenceFailure and persists nothing. Restart restores every plan, decision, review, operation outcome and master.

## References and custody facts

`CalibrationReferences` answers `AssetReferences::references_to` with kind Calibration. It names each View whose effective decisions hold the asked assets as light members or inputs, with the plan revision. It also names each adopted master whose source asset or indexed destination asset is asked, with the master revision.

`calibration_custody_facts(view_id)` lists three kinds of fact. The first is candidate masters in that View's outputs. The second is adopted masters whose source lay there. The third is the retained generated sources, each with its kept copy. Every fact carries its no-follow fingerprint. Retired copies stay in decisions and read `input_unavailable`.
