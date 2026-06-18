//! SIMBAD TAP/Sesame client: maps SIMBAD responses to canonical target identity.
//!
//! Talks to the SIMBAD TAP `sim-tap/sync` endpoint (and Sesame `sim-id`) over
//! HTTPS via `reqwest`, with polite usage (debounce, min query length,
//! cancel-in-flight, identifying `User-Agent`). Never fabricates coordinates
//! (spec 035 FR-009).

// TODO(T019): implement `SimbadResolver` (reqwest client + `otype` → ObjectType
// mapping + response → CanonicalTarget/TargetAlias). Skeleton stub for now.
