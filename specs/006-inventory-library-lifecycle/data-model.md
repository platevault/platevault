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
| `type` | enum(`light`,`dark`,`flat`,`bias`,`dark_flat`,`mixed`) | yes | See research.md §2. `mixed` is presentational only. |
| `target` | string \| null | yes | `Target.canonical_name` when linked; `null` for calibration sessions or unlinked acquisition sessions. |
| `filter` | string \| null | yes | Effective filter (`reviewed > inferred > observed`). |
| `exposure` | string \| null | yes | Effective exposure in human form (e.g. "300s"). |
| `state` | enum(`needs_review`,`confirmed`,`rejected`) | yes | Presentational projection (research.md §3). |
| `canonical_state` | enum(`discovered`,`candidate`,`needs_review`,`confirmed`,`rejected`,`ignored`) | yes | Underlying spec 002 state. Carried so `inventory.session.review` knows the real source. |
| `camera` | string | no | Equipment fact. |
| `gain` | string | no | Equipment fact. |
| `binning` | string | no | Equipment fact. |
| `set_temp` | string | no | Equipment fact. |
| `captured_on` | string (date) | no | Earliest capture date among member frames. |
| `provenance` | object | no | `{target?, filter?, inferred?, confirmed_by?}` — provenance summary, not the full `ProvenancedValue.history`. |
| `linked` | object | no | `{projects?: [{id, name}], session?, calibration?}` — outbound references for the drawer. |

### Invariants

- `(id, source_id)` is unique; `id` alone is unique across the projection.
- `state` MUST be derived deterministically from `canonical_state`:
  - `discovered` → `needs_review`
  - `candidate` → `needs_review`
  - `needs_review` → `needs_review`
  - `confirmed` → `confirmed`
  - `rejected` → `rejected`
  - `ignored` → excluded from default ledger (filter only).
- `type == "mixed"` is only ever produced when member frames disagree on
  kind. The underlying session never stores `mixed`.
- `provenance` MUST NOT carry confidence/evidence detail; those live in
  spec 002 `ProvenancedValue.history` and are reachable from the audit
  log, not from this DTO (spec 002 FR-006).
- A row with `state == "needs_review"` MUST be eligible for `Confirm`;
  the projection guarantees this by refusing to emit `needs_review` for
  sessions that lack the required reviewed fields (see below).

### Required Reviewed Fields

Per research.md §7, for a session to project as `state == "needs_review"`
(i.e. eligible for one-click `Confirm` from the drawer) it must have at
least:

- `target` resolved to a `Target` row (acquisition sessions only).
- `filter` set (any provenance tag).
- `exposure` set (any provenance tag).

When any of these is missing, the row still appears in the ledger but
its primary CTA changes from `Confirm` to `Resolve fields` (footer
button), and `Confirm` is hidden. This is the action-bound review rule
from spec 002 FR-009/FR-010 applied to the Inventory surface.

For calibration sessions, the required reviewed fields are `kind`,
`exposure`, and the equipment match key (camera + binning + set_temp at
minimum); `target` is N/A and renders as em-dash.

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
| `InventorySession.canonical_state` | `AcquisitionSession.state` / `CalibrationSession.state` | Spec 002 §AcquisitionSession §CalibrationSession. |
| `InventorySession.state` | derived | Projection rule above. |
| `InventorySession.target` | `AcquisitionSession.target_id` → `Target.canonical_name` | Spec 002 §Target. |
| `InventorySession.frames` | `len(session.frame_ids)` | Spec 002 §AcquisitionSession.frame_ids. |
| `InventorySession.provenance.*` | `ProvenancedValue.history` summary | Summary only; detail lives in audit. |
| `InventorySession.linked.projects` | reverse FK from `Project.session_ids` | Spec 002 §Project. |

## Mutations

The only mutation this surface produces is a session review-state change.
Mutations are submitted via `inventory.session.review`, which is a
session-scoped wrapper around `lifecycle.transition` with pre-filled
`entity_type ∈ {acquisition_session, calibration_session}` chosen by the
backend based on the session id. Idempotency is inherited from spec 002:
re-applying the current state returns `state.unchanged`.

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
