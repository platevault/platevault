# Data Model: Retire Legacy Target Tables

## Removed (greenfield deletion)

| Object | Source migration | Action |
|--------|------------------|--------|
| `target` table (gen-1) | 0002 | remove CREATE |
| `acquisition_session.target_id` | 0002 | remove column (+ index/FK if any) |
| `targets` + `.notes`/`.updated_at` | 0017 / 0027 | delete files |
| `target_aliases` | 0027 | delete file |
| `target_catalog_refs` | 0017 | delete file |
| `catalog_equivalences` | 0017 | delete file |
| `acquisition_session.acq_target_id` | 0027 | delete file (column gone) |
| `projects.target_id` | 0027 | delete file (column gone) |
| `project_sources.target_id` | 0027 | delete file (column gone) |

After deletion, `projects.canonical_target_id` (0033) is the only project↔target link.

## Kept + extended (gen-3, edit migration 0031)

### `canonical_target` (extended)

Existing columns unchanged (`id`, `simbad_oid`, `primary_designation`, `object_type`,
`ra_deg`, `dec_deg`, `source`, `resolved_at`). **Add:**

| Column | Type | Notes |
|--------|------|-------|
| `display_alias` | `TEXT` (nullable) | user-owned presentation label; `NULL` = show `primary_designation`. Never matched/normalized. Preserved across re-resolution. |

Effective display label = `display_alias` if non-null else `primary_designation`.

### `target_alias` (extended)

`kind` CHECK extended: `('designation', 'common_name', 'user')`. User-added aliases are
`kind='user'`; only these are user-removable. Existing `UNIQUE (target_id, normalized)`
enforces no-duplicate-alias (FR-008).

## Entities (logical)

- **CanonicalTarget**: id, primary_designation, display_alias?, effective_label,
  object_type, ra_deg, dec_deg, simbad_oid?, source, aliases[].
- **TargetAlias**: id, target_id, alias, normalized, kind ∈ {designation, common_name,
  user}.

## Validation rules

- Add alias: trimmed non-empty; normalized; rejected if `(target_id, normalized)` exists
  (duplicate) → user-facing error. Stored `kind='user'`.
- Remove alias: permitted only for `kind='user'` rows; removing a designation/common_name
  is refused.
- Set display alias: trimmed; empty string is treated as clear (NULL).
- Primary designation: read-only (no command mutates it).

## State / precedence

- Display label precedence: `display_alias` (user) > `primary_designation` (canonical).
- Re-resolution (`upsert_resolved`) updates SIMBAD-derived fields only; `display_alias`
  and `kind='user'` aliases are preserved (FR-012).
