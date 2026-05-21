# Data Model: First-Run Source Setup

**Branch**: `003-first-run-source-setup` | **Date**: 2026-05-20

This model covers only the entities owned by the first-run setup feature.
Downstream entities (scan records, inventory items, project envelopes)
reference `RegisteredSource` by id but are owned by their own specs.

## Entity: `RegisteredSource`

A durable record of a directory the user has registered as an input root
for the library. Created during the first-run wizard or later from
Settings. One row per (kind, path) pair.

| Field | Type | Required | Notes |
|------|------|---------|------|
| `id` | UUID v4 (text) | yes | Primary key. Stable across renames or path remapping. |
| `kind` | enum `raw \| calibration \| project \| inbox` | yes | Determines which downstream consumer treats this root as canonical. |
| `path` | string (absolute filesystem path) | yes | Normalized to OS-canonical form before storage. Unique within `kind`. |
| `kind_subtype` | string \| null | no | Optional refinement (e.g. `master_dark`, `master_bias`) — reserved for calibration; unused at first-run, populated later. |
| `created_at` | ISO 8601 timestamp (text) | yes | Server-local time the row was inserted. |
| `created_via` | enum `first_run \| settings_add \| settings_restart` | yes | Provenance for audit and analytics. |
| `last_seen_at` | ISO 8601 timestamp (text) \| null | no | Updated by the inventory scanner; null at registration. |

### Constraints

- `(kind, path)` is unique. Attempting to register a duplicate within a
  kind returns the `path.already.registered` contract error.
- `path` MUST be absolute. Relative paths are rejected at the contract
  layer before reaching the repository.
- `path` MUST exist and be a directory at registration time. Later
  disappearance is allowed and surfaced by the scanner, not by this
  feature.

### State Transitions

```text
[absent]
   │  source.register
   ▼
[active]
   │  user removes via Settings
   ▼
[deleted]   (row deleted; future re-register starts fresh)
```

No soft-delete in v1. A removed-and-re-added directory gets a new `id`.

## Entity: `FirstRunState`

A single-row table (or key/value record) describing whether and when the
first-run wizard has been completed. Acts as the durable counterpart to
the `alm.first-run.completed` `localStorage` flag.

| Field | Type | Required | Notes |
|------|------|---------|------|
| `singleton_id` | constant `"first_run"` | yes | Enforces single-row semantics. |
| `completed_at` | ISO 8601 timestamp (text) \| null | no | Null while the wizard has not yet finished. Set by `firstrun.complete`. |
| `last_step` | enum `welcome \| raw \| calibration \| project \| inbox \| finish` | yes | Last step the user reached. Used to resume a refreshed in-progress wizard. |
| `sources_buffer` | JSON array of `{kind, path}` \| null | no | Optional durable mirror of the `localStorage` buffer; written opportunistically so a crash doesn't lose progress. Cleared on `firstrun.complete`. |
| `updated_at` | ISO 8601 timestamp (text) | yes | Server-local time of the most recent update. |

### State Transitions

```text
[not_started]            (no row, or completed_at = null, last_step = welcome)
       │  user advances through steps
       ▼
[in_progress]            (last_step ∈ {raw, calibration, project, inbox})
       │  firstrun.complete
       ▼
[completed]              (completed_at set; sources_buffer cleared)
       │  Settings → Restart
       ▼
[in_progress]            (completed_at cleared; last_step reset to welcome)
```

A row in `[completed]` is the steady state for most users. Restart drops
back to `[in_progress]` without deleting `RegisteredSource` rows (see
research.md §5).

## Volatile Buffer: `localStorage` Mirror

Not a durable entity, but documented here so the boundary is clear.

| Key | Type | Owner | Notes |
|----|------|------|------|
| `alm.first-run.completed` | `"1"` \| absent | Wizard finish, Settings restart | Mirrors `FirstRunState.completed_at != null`. |
| `alm.first-run.sources` | JSON `SourceEntry[]` | Wizard add/remove | Mirrors `FirstRunState.sources_buffer` while wizard is open; cleared on finish. |

The wizard MUST treat `localStorage` as a cache, not a source of truth.
On mount it reads the cache for optimistic render, then reconciles with
the DB-backed `FirstRunState` and overwrites the cache if they disagree.

## Relationships

```text
RegisteredSource  ┐
                  │  N : 1
                  ▼
FirstRunState (singleton)   (logical only; no FK)

RegisteredSource → consumed by inventory scanner, calibration matcher,
                    project envelope, and inbox watcher specs.
```

No referential integrity is enforced between `RegisteredSource` and
`FirstRunState`. The relationship is logical: completing the wizard
implies at least one `RegisteredSource` of kind `raw` exists.
