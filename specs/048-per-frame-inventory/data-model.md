# Data Model: Per-Frame Inventory with Live Session Membership

**Feature**: 048-per-frame-inventory | **Date**: 2026-07-04

Principle: reuse existing tables. This feature adds **no** new frame/session tables and keeps sessions derived. Changes are (a) actually populating existing columns for all frame types, (b) driving the existing `file_record.state` machine for raw frames, (c) a per-root config in the settings KV, (d) a derived flag on calibration matches.

## Entities

### Per-frame inventory entry — existing `file_record` (`0002_lifecycle.sql:25-39`)

No schema change required. Semantics this feature enforces:

| Column | Type | This feature |
|--------|------|--------------|
| `id` | TEXT PK | unchanged |
| `root_id` | TEXT → `library_root` | unchanged (local-first custody) |
| `relative_path` | TEXT | unchanged; `UNIQUE(root_id, relative_path)` is the identity key |
| `size_bytes` | INTEGER | **now the real on-disk size** at apply (was 0); backfilled on reconcile (R7) |
| `mtime` | TEXT | recorded at apply; refreshed on reconcile |
| `content_hash` | TEXT (nullable) | **sha256, lazy** — populated only on user-initiated relink (R3); never eager |
| `state` | TEXT CHECK | driven for raw frames: `classified` (present/ingested) ↔ `missing` ↔ back to present; `protected` honored by cleanup |
| `first_seen_at` / `last_seen_at` | TEXT | `last_seen_at` updated each reconcile where present |

**Presence state transitions** (raw frames, mirroring the artifact reconciler):

```
(apply) ──────────────▶ classified (present)
classified ──rescan-absent──▶ missing
missing ──rescan-present-at-path──▶ classified (recovered)
classified ──rescan-changed-size──▶ classified (size updated, NOT missing)
```

- `missing` is never auto-deleted (FR-010): the row is retained and excluded from active membership/counts/totals.
- `protected` frames are excluded from cleanup candidates (FR-021).

### Session membership — existing `acquisition_session.frame_ids` / `calibration_session.frame_ids`

JSON arrays of `file_record.id`. No schema change; the fix is population:

- **Acquisition (light)**: already appended (`ingest_sessions.rs::upsert_session`). No change beyond real sizes on the referenced records.
- **Calibration (dark/flat/bias)**: `plan_listener.rs:214` currently inserts `'[]'` → **change to append the applied calibration frame's `file_record.id`** (write its `file_record` first). Idempotency preserved via the existing `source_inbox_item_id` guard and set-dedup like the acquisition path.
- **Active membership** for counts/totals = referenced `file_record` ids whose `state != 'missing'`. Missing ids remain in the array (flag-missing mode) or are removed (auto-reconcile mode, FR-010) but the underlying record is retained regardless.

### Library root — existing `library_root`

No schema change (per R1 decision A). Per-root config lives in the settings KV.

### Per-root reconcile/detection config — settings KV (spec-018)

Scoped per root id (illustrative keys; final key names fixed in impl):

| Key | Values | Default |
|-----|--------|---------|
| `reconcile.mode` | `flag_missing` \| `auto_reconcile` | `flag_missing` |
| `detection.live` | bool | `true` (opt-out for removable/network) |
| `detection.scheduled` | off \| cadence | off |
| `detection.on_open` | bool (library/project open) | off |
| `detection.follow_symlinks` | bool | `false` |

Absent keys resolve to defaults. Set in the wizard when adding a root; editable in settings.

### Reconciliation run — transient + audit events

Not a persisted entity. A pass over a root produces:
- `file_record.state` transitions (above),
- audit events on the spec-002 bus, modeled on the artifact events: `frame.missing`, `frame.recovered` (names finalized in contracts), plus a run summary for progress,
- membership effect per the root's `reconcile.mode`.

### Cleanup candidate (per-frame) — derived, no new table

Produced by `cleanup_generator` from present `file_record` rows: `{ frame_id (root_id+relative_path), session_id, frame_type, size_bytes, protection, confidence }`, grouped by session. Feeds the existing reviewable plan model (spec-017 PlanItem path ops); reclaimable bytes = Σ present selected `size_bytes`.

### Calibration match flag — derived annotation

On the calibration match surface (`crates/calibration/core`): a boolean/derived "source missing / unverifiable" computed from whether the referenced calibration `file_record` is `missing`. Cleared on recovery. No lifecycle table.

## Relationships

```
library_root 1───* file_record        (root_id)                 [existing, custody]
file_record  *───1 acquisition_session (via frame_ids JSON)      [existing; populated]
file_record  *───1 calibration_session (via frame_ids JSON)      [NEW population]
file_record  1───? calibration_match   (referenced frame → flag) [derived flag]
library_root 1───* settings KV rows    (per-root config)         [NEW, spec-018 KV]
file_record  *───* cleanup PlanItem     (candidate → plan op)     [derived at generate]
```

## Invariants

- **INV-1**: A `file_record`'s identity is `(root_id, relative_path)`; two rows never share it (existing UNIQUE).
- **INV-2**: Reconciliation changes only records/UI — never the filesystem (FR-008).
- **INV-3**: `content_hash` is null unless a relink required it; hashing is never eager (FR-004, R3).
- **INV-4**: A `missing` record is never hard-deleted by reconciliation (FR-010).
- **INV-5**: Sessions carry no review/lifecycle state; membership and counts are derived from `file_record` presence (FR-005).
- **INV-6**: Cleanup candidates exclude `missing` and `protected` frames (FR-021, FR-022).
- **INV-7**: Walks/watches skip symlink/junction traversal unless the root enabled it (FR-017).
