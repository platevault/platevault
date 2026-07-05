# Contracts Delta — Spec 049 Source View Generation

New IPC operations and settings keys added by this feature. Removal /
regeneration / stale contracts are owned by spec 026 (`preparedview.remove`,
`preparedview.regenerate`) and are **not** re-specified here.

## New operations

| Command | Schema | Purpose |
|---------|--------|---------|
| `sourceview.generate` | [`sourceview.generate.json`](./sourceview.generate.json) | First-materialization: build a reviewable generation plan (origin `prepared_view_generation`, plan type `source_view_generation`). Returns `planId` for the spec 017/025 pipeline. Never writes to disk before apply. |
| `sourceview.verify` | [`sourceview.verify.json`](./sourceview.verify.json) | Read-only pre-processing check that every link resolves; reports broken items; no mutation, no auto-repair. |

Both follow the repo envelope convention (`contractVersion`, `requestId`,
`oneOf` success/failure, `$defs.Error`) matching spec 026's `preparedview.*`.

## Backend command registration note

Tauri command function names MUST match the dotted invoke targets used by the
generated bindings; do **not** rename the invoke targets via specta (see project
memory "tauri-specta command-name mismatch"). Register as `sourceview_generate`
/ `sourceview_verify` mapped to the `sourceview.generate` / `sourceview.verify`
contract ids.

## Settings keys (spec 018 KV — no migration)

Delivered through the existing `settings.get` / `settings.update` scope/values
transport. Two new flat `SettingsState` fields, section **Source Views**:

| Key | Type | Default | Constraint |
|-----|------|---------|------------|
| `source_view_link_kind_intra_drive` | `"hardlink" \| "symlink" \| "junction"` | `"hardlink"` | UI greys out any kind not currently achievable (symlink without privilege → Developer Mode guidance). |
| `source_view_link_kind_cross_drive` | `"symlink" \| "junction"` | `"symlink"` | `hardlink` is **not** an allowed value (cannot cross volumes — FR-004a). |

Optional structured per-project destination override key
`source_view.<project_id>.destination` (KV; no migration) backs FR-021b.
