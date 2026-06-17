# Contract: Artifact Events & Classify Response (FR-009, FR-025)

Fixes spec 012: `artifact.classified` is never emitted (absent from `event_bus.rs`); the
`artifact.classify` response shape diverges from the published flat-field contract.

## Events (event bus topics)
```
artifact.detected   { artifact_id, project_id, path, detected_at }
artifact.classified { artifact_id, project_id, classification, confidence?, classified_at }
```
- Both MUST be emitted by the watcher (FR-009). `artifact.classified` is **added** to the bus topic set.
- Classification carries a confidence level where inference is used (Constitution §II).

## `artifact.classify` response
Canonical shape is **flat fields** (matching the published contract), not a nested `{ artifact: … }`
envelope:
```
ArtifactClassifyResponse { artifact_id, classification, confidence?, classified_at }
```

## Conformance
- Test: subscribing to the bus, dropping a file into a watched root emits BOTH events with payloads
  validating against the schemas above.
- Test: `artifact.classify` runtime response validates against the flat schema; the nested envelope
  fails (regression guard against the drift).
