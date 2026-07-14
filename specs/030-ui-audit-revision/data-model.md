# Data Model: UI Audit & Revision

Changes to the data model required by the UI redesign. Most changes are in
settings/configuration domain, not core domain entities.

## Source Folder Type Unification

The source folder kind enum is a 4-value set used only as a user-facing folder
category in the setup wizard and settings. It does NOT determine per-image frame
type; that is detected from image metadata (FITS `IMAGETYP` header) during
scan/ingest.

```
SourceFolderKind:
  - light_frames    (was: raw)
  - calibration     (covers darks, flats, and bias — kind collapsed from 6→4)
  - project
  - inbox
```

Migration notes:
- `raw` → `light_frames` (migration 0010).
- `dark`, `flat`, `bias` → `calibration` (migration 0032). Where the same path
  was registered under multiple of these kinds, only the earliest entry is kept
  (INSERT OR IGNORE by `created_at ASC`) and duplicates are silently dropped.
- Per-image frame type (light / dark / flat / bias) remains authoritative from
  FITS `IMAGETYP` metadata, so no information is lost by collapsing the folder
  kind.

## Equipment Entities

New entities separate from the existing detected-equipment display in
calibration matching. These are user-managed configuration.

### Camera

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| name | String | Display name (e.g., "ASI2600MM Pro") |
| aliases | String[] | Alternative names from FITS INSTRUME |
| auto_detected | Boolean | True if discovered from FITS headers |

### Telescope

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| name | String | Display name (e.g., "Esprit 100ED") |
| aliases | String[] | Alternative names from FITS headers |
| focal_length_mm | Integer? | Native focal length |
| auto_detected | Boolean | True if discovered from FITS headers |

### OpticalTrain

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| name | String | User-defined or auto-generated from telescope+camera |
| telescope_id | UUID? | FK to Telescope (nullable for custom) |
| camera_id | UUID? | FK to Camera (nullable for custom) |
| focal_length_mm | Integer | Effective focal length (may differ from telescope native) |

### Filter

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| name | String | Display name (e.g., "Ha", "SII") |
| category | Enum | narrowband / broadband / dual_band / other / custom |
| auto_detected | Boolean | True if discovered from FITS metadata |

Predefined filters seeded on first run: Ha, SII, OIII, NII, L, R, G, B, HO,
SO, UV/IR Cut.

## Processing Tool Configuration

### ProcessingTool

| Field | Type | Notes |
|-------|------|-------|
| id | String | Tool identifier (pixinsight, siril) |
| enabled | Boolean | User toggle |
| executable_path | String? | Path to executable, validated |
| processing_dir | String | Relative to project root (default: "processing/") |
| output_dir | String | Relative to project root (default: "outputs/") |
| directory_template | JSON | Per-folder structure definition |

### DirectoryTemplate

JSON structure defining the project folder layout the app creates. The app
creates folder-level junctions/symlinks — one per session, not per file.

```json
// PixInsight/WBPP
{
  "lights_dir": "Lights/",
  "calibration_dir": "Calibration/",
  "calibration_dark": "Dark/",
  "calibration_flat": "Flat/",
  "calibration_bias": "Bias/",
  "processing_dir": "processing/",
  "outputs_dir": "outputs/",
  "notes_dir": "notes/"
}

// Siril
{
  "lights_dir": "lights/",
  "calibration_dir": "calibration/",
  "calibration_dark": "darks/",
  "calibration_flat": "flats/",
  "calibration_bias": "biases/",
  "processing_dir": "process/",
  "outputs_dir": "outputs/",
  "notes_dir": "notes/"
}
```

Lights and flats are sub-grouped by filter (e.g., `Lights/Ha/`). Each
session junction folder is prefixed with `DATE_` for lights and flats to
enable WBPP custom grouping (e.g., `DATE_2024-11-30/`). Darks and bias
use descriptive names without the DATE_ prefix (e.g., `300s_-10C/`).

See research.md R3 for the full directory structure diagram.

## Cleanup Policy

### CleanupAction (per data type)

| Field | Type | Notes |
|-------|------|-------|
| data_type | Enum | See list below |
| action | Enum | keep / archive / delete |

Data types:
light_frames, dark_subs, flat_subs, bias_subs, calibration_masters,
registered_frames, calibrated_frames, debayered_frames, local_normalization,
drizzle_data, integration_cache, stack_output_intermediate, temporary_files,
process_logs, process_icons_tool_config

### CleanupTrigger

| Field | Type | Notes |
|-------|------|-------|
| mode | Enum | manual / auto_on_completion |

## Calibration Matching Tolerances

New settings (currently hardcoded or absent):

| Setting | Type | Default |
|---------|------|---------|
| temperature_tolerance_c | Float | 5.0 |
| exposure_tolerance_s | Float | 2.0 |
| aging_threshold_days | Integer | 365 |
| require_same_camera | Boolean | true |
| require_same_gain | Boolean | true |
| require_same_binning | Boolean | true |

## Ingestion Settings

Moved from data sources to ingestion config:

| Setting | Type | Default |
|---------|------|---------|
| watcher_enabled | Boolean | true |
| scan_on_startup | Boolean | true |
| follow_symlinks | Boolean | false |
| follow_junctions | Boolean | false |
| hashing_mode | Enum | lazy |
| metadata_extraction | Enum | fits_xisf_sidecar |
| default_filter | String | "L" |
| exposure_group_margin_s | Float | 2.0 |
| temperature_group_tolerance_c | Float | 5.0 |

## Project Lifecycle State

Simplify from 6 states to 5:

```
Before: setup → ready → prepared → processing → completed → archived
After:  setup → ready → processing → completed → archived
```

The `prepared` state is removed. Generating source views transitions directly
from `ready` to `processing`.

## Source View Strategy

Simplify from 6 options to 4:

```
Before: manifest_only, symbolic_links, ntfs_junctions, hard_links, full_copy, hybrid
After:  symbolic_links, ntfs_junctions, hard_links, full_copy
```

## Status Bar Data

Not a persisted entity — aggregated at runtime:

| Field | Source |
|-------|--------|
| inbox_pending_count | Count of unconfirmed inbox sessions |
| library_file_count | Total indexed files across all roots |
| library_size_bytes | Total size of indexed files |
| cleanup_reclaimable_bytes | Sum across all completed projects |
| volume_health | Per-volume: path, total_bytes, free_bytes, warning (free < 10%) |
| root_health | Per-root: path, online/offline status |

## Catalog List

Expanded from current:

| Catalog | Object Count |
|---------|-------------|
| Messier | 110 |
| NGC / IC | ~13,000 |
| Caldwell | 109 |
| Sharpless (Sh2) | 313 |
| Abell Planetary Nebulae | 86 |

Each catalog has: downloaded (boolean), enabled (boolean), last_synced (date).

## Audit Entry — Generalized Mutation Record

*(Iteration 2026-07-14, grilling Q15 / #647.)* The durable audit entry
generalizes from a lifecycle-transition record to a generic mutation record.
Target shape (constitution §II fields):

| Field | Meaning |
|-------|---------|
| timestamp | When the mutation was attempted |
| actor | user \| system |
| action | What was attempted (generalizes the lifecycle `trigger`) |
| entity (type + id) | What was mutated — extends beyond the lifecycle `EntityType` enum to settings, protection, equipment, sources, and roots |
| outcome + reason | applied \| refused \| failed, with a reason/code as first-class queryable detail |
| before → after (optional) | Value pair for settings/protection changes |

Mapping onto the existing `audit_log_entry` table
(`crates/persistence/db/migrations/0002_lifecycle.sql`):

- `at` → timestamp; `actor` unchanged; `trigger` → action.
- `from_state` / `to_state` are subsumed by the optional before→after pair
  (lifecycle transitions keep using them; non-lifecycle mutations carry
  before→after in the structured detail).
- reason/code becomes first-class queryable detail (not buried in free-form
  payload).
- `severity` (workflow | diagnostic) and `request_id` are retained.

The ephemeral bus event stream is unchanged in shape; audit-worthy mutations
write the durable row and emit the bus event (durable row is authoritative).
