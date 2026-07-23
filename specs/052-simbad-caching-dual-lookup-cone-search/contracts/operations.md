# Contracts: SIMBAD Resolver Caching, Dual-Lookup, and Cone-Search

**Feature**: 052-simbad-caching-dual-lookup-cone-search | **Date**: 2026-07-12

Language-neutral operation contracts (Constitution V). Realized as Rust DTOs in `crates/contracts/core`, exposed via Tauri commands, and generated into `packages/contracts` TS bindings (tauri-specta). Command names below are canonical; the registered Tauri fn name MUST match the invoke target exactly (no specta rename on the invoke target — known pitfall). All requests/responses carry the standard result-wrapper + error-code envelope (spec-046 error-code registry).

## Phase 1 / Phase 2 — no new contract

P1 (persistent cache, in-use persistence, enrichment, normalization) and P2 (dual lookup) are internal to the resolver and app-targets crates and the seed-builder tool. They change **behaviour behind existing operations**, not the operation surface:

- Existing target search / typeahead / resolve operations (spec-035) keep their request/response shapes; only their backing store (persistent redb cache) and persistence timing (in-use gate) change.
- The `magnitude` and `constellation` fields already exist on the target read model (populated, previously usually null).
- One **new local command** is added in P1 but takes no domain payload: `target.cache.clear` — clears the resolve cache (redb) and returns `{ cleared: bool }`; it never touches `canonical_target`. Documented here for completeness; not part of the P3 cone-search surface.

## Phase 3 — cone-search suggestion (NEW)

### `target.cone_search.suggest`

Run a cone-search around a light-frameset's derived pointing and return ranked, confidence-carrying target suggestions. Advisory only — creates nothing.

- **Request**:
  ```json
  {
    "frameset_id": "string",
    "reason": "ingest | on_demand"
  }
  ```
  The backend derives the pointing from the frameset's frames (WCS `CRVAL1/2` → mount `OBJCTRA/OBJCTDEC` → none); the client does not supply coordinates. `reason` distinguishes the automatic ingest run from a user-triggered re-run (FR-017).

- **Response**:
  ```json
  {
    "pointing": {
      "source": "wcs | mount | none",
      "center_ra_deg": 10.6847,
      "center_dec_deg": 41.269,
      "radius_deg": 1.0,
      "optics_known": true
    },
    "suggestions": [
      {
        "candidate": {
          "canonical_target_id": "string | null",
          "primary_designation": "M 31",
          "object_type": "galaxy",
          "ra_deg": 10.6847,
          "dec_deg": 41.269,
          "magnitude": 3.4,
          "constellation": "And"
        },
        "separation_deg": 0.02,
        "confidence": "high | medium | low",
        "preselected": true,
        "excluded": false
      }
    ]
  }
  ```
  - `source = "none"` ⇒ `suggestions: []` (no pointing → no suggestion; FR-012).
  - `canonical_target_id` is `null` when the candidate is resolved from cache/online but not yet adopted; it becomes non-null only after confirm (FR-004/FR-016).
  - `confidence` combines separation, `pointing.source` quality (WCS > mount), and catalogue prominence (OQ-1). Exactly the high-confidence candidates carry `preselected: true`; the system never sets `preselected` without a qualifying confidence, and never applies a link itself (FR-014).
  - `excluded: true` marks candidates in the default niche-otype exclusion set (OQ-2); still returned so the UI can show them for manual override (FR-015).
  - `radius_deg` is the FOV-derived radius, or the ~1° default when `optics_known: false` (FR-013).

- **Errors** (spec-046 registry):
  - `resolve.offline` — online-resolve disabled or network unavailable ⇒ cone-search unavailable; ingest proceeds without a suggestion (FR-018). Non-blocking.
  - `frameset.not_found` — unknown `frameset_id`.
  - `pointing.unavailable` — no reliable pointing (equivalent to `source = none`; may be returned as a `200` with empty suggestions instead, at impl's discretion — documented so the client handles both).

- **Notes**: Read-only. Produces no filesystem mutation and no `canonical_target` write.

### `target.cone_search.confirm`

Confirm a suggested candidate as the frameset's target. This is the single point at which a cone-search suggestion becomes durable.

- **Request**:
  ```json
  {
    "frameset_id": "string",
    "candidate": {
      "canonical_target_id": "string | null",
      "primary_designation": "M 31",
      "simbad_oid": 1575544
    }
  }
  ```
  When `canonical_target_id` is null, the backend adopts the candidate (dedup on `simbad_oid` → normalized designation, FR-007), writing the `canonical_target` row (in-use, FR-004) and enriching magnitude/constellation (FR-006), then links the frameset.

- **Response**:
  ```json
  {
    "canonical_target_id": "string",
    "created": true,
    "linked": true
  }
  ```
  `created` is `true` when a new durable row was written, `false` when an existing dedup match was reused.

- **Errors**: `candidate.invalid` — the candidate no longer resolves; `frameset.not_found`.

- **Notes**: This is the ONLY operation in the feature that writes a `canonical_target` row from the cone-search path. No suggestion is ever auto-confirmed (FR-016, SC-006).

## Contract invariants

- No operation in this feature mutates the filesystem.
- `target.cone_search.suggest` is read-only and never writes `canonical_target`; only `target.cone_search.confirm` (or the other in-use adoption paths from P1) does.
- Every candidate carries an explicit `confidence`; `preselected` is set only for high confidence and never implies a link (FR-014, constitution II).
- Errors use the spec-046 error-code registry; `resolve.offline` is a non-blocking degraded state, not a failure.
