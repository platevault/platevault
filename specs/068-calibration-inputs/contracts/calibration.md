# Calibration IPC contract

Version: 1. Requests and responses are JSON with UUID identities and camelCase fields, following the [library contract](../../064-library-inventory/contracts/library.md). Exposures are seconds, temperatures Celsius, dimensions pixels. These keep their library wire forms: `ExpectedSession`, `ExpectedAsset`, `ObservationFingerprint` with decimal-string `modifiedNs`, `NativePath`, `ErrorResponse` and `SessionSummary`. Every mutation carries `expectedRevision` and returns the committed record only after its transaction commits. No read starts a rehash.

## Inputs

- `InputRef`: `{form: "raw_set", sessionId, groupingRevision}` or `{form: "master", masterId, revision}`. A `candidate` is never an `InputRef`.
- `DecisionItem`: `{lightSessionId, kind, input: InputRef}`, where `kind` is `bias`, `dark` or `flat`.
- `AdoptionSource`: `{assetId, expected: ExpectedAsset}`, or `{resultId}` once 070 lands.
- `AdoptionDestination`: `{locationId, relativePath: NativePath}`. The location must be a Calibration role, Active and online. The parent folder must already exist. The path is relative, without traversal, and names a file that does not exist.

## Commands

| Command | Request | Response and behavior |
| --- | --- | --- |
| calibration_list_inputs | kind?, form?, locationId?, offset, limit | Raw sets, adopted masters and detected candidates, grouped by kind, camera, gain/offset, channel and dimensions/binning. Each row lists its evidence values, missing evidence, member and availability counts, the classification basis, and origin with provenance for masters. Retired copies are omitted. |
| calibration_input | input: InputRef or candidate assetId | One input's evidence, members, excluded members, availability and provenance. |
| calibration_match | sessions: ExpectedSession[], kinds | Per light Session and kind, every listed candidate with criteria and verdict, plus the preselected candidate. Takes no View and writes nothing. Stale sessions are Conflict with successors. |
| calibration_view_plan | viewId, viewRevision | The plan revision and required kinds. For each requirement: its state, preselected suggestion, ordered candidates with Why this match criteria, unadopted master candidates, and the effective decision with `decidedAtRevision` and applicability. |
| calibration_set_required_kinds | viewId, viewRevision, expectedRevision, kinds | The plan at revision +1. An empty set is allowed and recorded. A duplicate or unknown kind is InvalidInput. |
| calibration_accept | viewId, viewRevision, expectedRevision, items: DecisionItem[] | The plan after hashing every input file. An item with any non-compatible criterion is InvalidInput naming those criteria. A candidate or unadopted master is InvalidInput. Drift, offline or unreadable files are refused, naming each item. The write is all-or-nothing. |
| calibration_record_exception | viewId, viewRevision, expectedRevision, item: DecisionItem, reason | The plan after hashing the input. Snapshots its incompatible and unknown criteria with the trimmed non-empty reason. An all-compatible input is InvalidInput (accept it instead). Input evidence is unchanged. |
| calibration_withdraw | viewId, viewRevision, expectedRevision, items: {lightSessionId, kind}[] | The plan with `withdrawn` rows appended. |
| calibration_handoff | viewId, viewRevision | The PREP read: `ready`, accepted and excepted assignments with criteria, reason and `inputs[]`, and `unresolved[{lightSessionId, kind, reason}]`. Suggestions never appear as assignments. |
| calibration_review_adoption | source: AdoptionSource, destination: AdoptionDestination | A durable AdoptionReview after hashing the source and checking the destination, with classification, evidence, origin and the source SHA-256. Writes no file. An existing destination entry is IdentityConflict scoped to its path. A pending RES output, a non-master or a Retired source is InvalidInput. |
| calibration_adopt | reviewId, expectedRevision | The settled AdoptionOperation. When `completed` it carries the registered AdoptedMaster. When `failed` it carries the phase and error, with the candidate retained and no master. Retrying an `interrupted` or `failed` review resumes only by recorded identity. |
| calibration_list_adoptions | state?, offset, limit | Durable operations, including `interrupted` ones after restart. |
| calibration_custody_facts | viewId | Candidate masters, adopted masters and retained generated sources for the View's outputs, each with its fingerprint (STO seam). |

## Why this match

Each criterion row is `{criterion, verdict, lightValue, inputValue, lightSource, inputSource, tolerance: "none", note?}`. The verdict is `compatible`, `incompatible` or `unknown`. Sources name the header keyword, catalog correction or Confirmed Equipment ID. Evidence rows without a verdict list measured temperature, readout mode, night distance, availability and quality counts. An accepted or excepted decision keeps its snapshot beside the current evaluation.

## Handoff

`assignments[]` items are `{id, lightSessionId, kind, form, resolution, decidedAtRevision, criteria[], reason?, inputs[]}`. `resolution` is `accepted` or `exception`. Each `inputs[]` entry is `{assetId | masterId, locationId, relativePath, fingerprint}`; its `fingerprint.contentSha256` is the basis that PREP re-verifies before any effect. The unresolved reasons are listed in the [data model](../data-model.md#requirements-and-states).

## Errors

InvalidInput, NotFound, Conflict, IdentityConflict, SourceUnavailable, AccessDenied, NoByteProof and PersistenceFailure use the library `ErrorResponse`. They name the View, Session, input, review or destination, and say whether reload, review or retry applies. Conflict carries the current revision, plus successors when a Session was superseded. Writes refuse three cases with Conflict: a View revision that is not the latest committed one, a stale plan revision, and a Complete View. Unknown evidence is data, never a zero or a compatible verdict.

## Contract extensions

RES (070) adds `{resultId}` sources and output candidates through `discovered_outputs`, and the View completion state. STO (071) consumes custody facts through its `CustodyFacts` trait. PREP (069) reads `calibration_handoff`. 065 may read `calibration_match` for `missing_calibration`. Each consumer versions its own additive fields.

## Development verification

The isolated rebuilt shell registers these commands beside the library commands. It keeps the same loopback-only dev bridge and the same release exclusion. Backend IPC proof does not certify the Calibration surface. The clean-slate frontend must retain and validate that surface through MCP, together with fresh J23 S1 to S7 and J26 S8 to S9 validation.
