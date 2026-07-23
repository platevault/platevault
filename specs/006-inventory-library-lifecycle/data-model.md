# Data Model: Inventory Lifecycle

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md) | **Date**: 2026-05-20

Inventory does not introduce new persisted entities. It is a read projection
over entities already defined in spec 002's
`specs/002-data-lifecycle-state-model/data-model.md`. This file specifies the
projection DTOs (the shape the Tauri `inventory.list` command returns) and
records the cross-references to spec 002 state families.

Conventions:

- `id` fields are UUIDv4.
- All state names match the spec 002 vocabulary unless noted as
  presentational.
- Projection DTOs are read-only; mutations go through
  `inventory.session.review` which delegates to `lifecycle.transition`.

---

## InventorySource (projection)

A group header in the inventory ledger. One per `LibraryRoot` that has at
least one acquisition or calibration session under it (sources with zero
sessions are filtered out by default to keep the ledger clean — surfaced
in a future "all sources" admin view).

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | uuid | yes | Mirrors `LibraryRoot.id`. |
| `path` | string | yes | Mirrors `LibraryRoot.current_path`. |
| `kind` | enum(`local_disk`,`external_disk`,`removable`,`network_share`) | yes | Projection of `LibraryRoot.kind` plus media-class refinement. |
| `state` | enum(`active`,`missing`,`disabled`,`reconnect_required`) | yes | Mirrors `LibraryRoot.state` (spec 002 §LibraryRoot). |
| `sessions` | InventorySession[] | yes | Pre-filtered to sessions whose state is not `ignored` and not `discovered`. |

### Invariants

- `id` MUST equal a live `LibraryRoot.id`. The projection does not invent
  source ids.
- `sessions` MUST be sorted by `captured_on` descending, then by `name`.
- `kind` mapping from `LibraryRoot.kind`:
  - `local` → `local_disk`
  - `external` → `external_disk` (or `removable` when the OS reports the
    mount as ejectable; left to `crates/fs/inventory/`)
  - `network` → `network_share`

### Source-State Effects

| `state` | New project links | Existing project links | Review actions |
|---|---|---|---|
| `active` | allowed | allowed | allowed |
| `missing` | refused (`source.unavailable`) | warning band on linked projects | allowed (best-effort, may refuse on apply) |
| `reconnect_required` | warning band | warning band | allowed |
| `disabled` | refused | warning band | refused (`transition.refused` with `reason: "source_disabled"`) |

---

## InventorySession (projection)

One row in the inventory ledger. Projects one `AcquisitionSession` OR one
`CalibrationSession` into a unified DTO.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | uuid | yes | Mirrors the underlying session id. |
| `name` | string | yes | Display name derived from target + capture date, or a calibration-set descriptor. Not user-editable from this surface in v1. |
| `source_id` | uuid | yes | FK → `InventorySource.id` (= `LibraryRoot.id`). |
| `frames` | u32 | yes | Count of `FileRecord` rows linked to the underlying session. |
| `type` | enum(`light`,`dark`,`flat`,`bias`) | yes | See research.md §2. `dark_flat` is reserved but not stored or returned in v1. *(`mixed` removed 2026-07-03: Inbox single-type ingest, spec 041, splits mixed folders at ingest so a session is never mixed.)* |
| `target` | string \| null | yes | `Target.primary_designation` when linked; `null` for calibration sessions or unlinked acquisition sessions. |
| `filter` | string \| null | yes | Effective filter (`reviewed > inferred > observed`). |
| `exposure` | string \| null | yes | Effective exposure in human form (e.g. "300s"). |
| `state` | enum(`discovered`,`candidate`,`needs_review`,`confirmed`,`rejected`,`ignored`) | yes | Canonical spec 002 session state (research.md §3 R-Projection-Wide). No presentational projection. UI maps display labels locally. |
| `camera` | string | no | Equipment fact. |
| `gain` | string | no | Equipment fact. |
| `binning` | string | no | Equipment fact. |
| `set_temp` | string | no | Equipment fact. |
| `captured_on` | string (date) | no | Earliest capture date among member frames. |
| `provenance` | object | no | `{target?, filter?, inferred?, confirmed_by?}` — provenance summary, not the full `ProvenancedValue.history`. |
| `linked` | object | no | `{projects?: [{id, name}], session?, calibration?}` — outbound references for the drawer. |

### Invariants

- `(id, source_id)` is unique; `id` alone is unique across the projection.
- `state` is the canonical spec 002 value; it is NOT projected or collapsed
  server-side. Sessions with `state == "ignored"` are excluded from the
  default ledger and surfaced only via `reviewFilter=ignored` (FR-010).
  Sessions with `state ∈ {discovered, candidate}` display as "Needs review"
  in the UI via local label mapping; the API returns the canonical value.
- `type` is always a single concrete kind. Mixed folders are split into
  single-type items at Inbox ingest (spec 041), so no server-derived `mixed`
  sentinel exists. *(The pre-041 `mixed` detection was removed 2026-07-03.)*
- `type` NEVER returns `dark_flat` in v1. Files with dark_flat IMAGETYP
  values land as `unclassified` at the inbox level (spec 005 ripple).
- `provenance` MUST NOT carry confidence/evidence detail; those live in
  spec 002 `ProvenancedValue.history` and are reachable from the audit
  log, not from this DTO (spec 002 FR-006).
- A row with `state ∈ {discovered, candidate, needs_review}` MUST be
  eligible for `Confirm`; the projection guarantees this by refusing to
  emit these states for sessions that lack the required reviewed fields
  (see below).

### Required Reviewed Fields

Per research.md §7, for a session with `state ∈ {discovered, candidate,
needs_review}` to be eligible for one-click `Confirm` from the drawer, it
must have at least:

- `target` resolved to a `Target` row (acquisition sessions only).
- `filter` set (any provenance tag).
- `exposure` set (any provenance tag).

When any of these is missing, the row still appears in the ledger but
its primary CTA changes from `Confirm` to `Resolve fields` (footer
button), and `Confirm` is hidden. This is the action-bound review rule
from spec 002 FR-009/FR-010 applied to the Inventory surface.

**Note on `captured_on`** (E2): The `InventorySession.captured_on` field
is the **earliest frame date** among the session's member frames. It is
intentionally different from `TargetSession.captured_on` in spec 023,
which uses the local-solar-noon boundary (spec 023 + spec 023 A5). Spec 006
uses the earliest frame date as a UX ordering label; spec 023 owns the
canonical observing-night identity. The divergence is intentional and
documented.

For calibration sessions, the required reviewed fields are `kind`,
`exposure`, and the equipment match key (camera + binning + set_temp at
minimum); `target` is N/A and renders as em-dash.

### Framing membership (Q27, cross-spec delta — owned by spec 008)

A light session may be a member of **at most one framing** (spec 008's Q27
framing layer: `project → framing → session → frames`). The `Framing` entity,
the tolerance-based clustering (target + optic-train + pointing + rotation), and
the membership store are **owned by spec 008**; this projection references
sessions by id and does **not** add a framing field or change any
`InventorySession` state. The Q27 incremental ingestion-attribution pass is the
first pre-ingest pass at the Inbox confirm gate (the Q22 duplicate sweep joins
the same pass when its iterate lands) and reads session-level geometry
(pointing/rotation/optic-train) persisted at confirm by spec-008 F-Framing-1;
NULL-geometry legacy sessions are excluded from clustering until a Q28 rescan
backfill (the Q12 strict-gate iterate, once applied, guarantees geometry on new
ingests).

### Lifecycle

No new lifecycle. State transitions delegate to spec 002's
`lifecycle.transition` via the wrapper `inventory.session.review`. The
projection is re-derived on every `inventory.list` request and on any
audit event with `entity_type ∈ {acquisition_session,
calibration_session, library_root, file_record}`.

---

## Cross-Reference Map

| This spec field | Spec 002 source | Notes |
|---|---|---|
| `InventorySource.*` | `LibraryRoot.*` | Direct mirror, `kind` refined. |
| `InventorySession.state` | `AcquisitionSession.state` / `CalibrationSession.state` | Canonical spec 002 value; no server-side projection. |
| `InventorySession.target` | `AcquisitionSession.target_id` → `Target.primary_designation` | Spec 002 §Target (A1: `canonical_name` → `primary_designation`). |
| `InventorySession.frames` | `len(session.frame_ids)` | Spec 002 §AcquisitionSession.frame_ids. |
| `InventorySession.provenance.*` | `ProvenancedValue.history` summary | Summary only; detail lives in audit. |
| `InventorySession.linked.projects` | reverse FK from `Project.session_ids` | Spec 002 §Project. |

## Mutations

The only mutation this surface produces is a session review-state change.
Mutations are submitted via `inventory.session.review`, which is a
session-scoped wrapper around `lifecycle.transition` with pre-filled
`entity_type ∈ {acquisition_session, calibration_session}` chosen by the
backend based on the session id. Idempotency is inherited from spec 002:
re-applying the current state returns `status: "noop"` (no audit entry,
no error). The `state.unchanged` error code is NOT used; the noop pattern
is the canonical response for idempotent re-application (A2).

**Mixed-session assign guard** (E5): *Removed 2026-07-03.* This guard rejected
a review transition when `session.state == "mixed"` with `session.mixed_state`.
It is obsolete: spec 041's Inbox single-type ingest splits mixed folders into
single-type items at ingest, so a session can never be `mixed` and the guard can
never fire. No `session.mixed_state` error code is emitted.

## Notes for Implementers

- The projection should be implemented as a single SQL query joining
  `library_root`, `acquisition_session`, `calibration_session`,
  `file_record`, and `target`, with `provenance` summarised by a
  per-field lateral join. Avoid N+1.
- The Tauri layer is responsible for filtering at the boundary —
  source/frame/review filters apply server-side so the wire payload is
  small and the UI doesn't re-filter a 10k-row list in JavaScript.
- The audit log is the source of truth for "Last action" displays; the
  projection summarises only the latest entry.
