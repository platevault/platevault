# Database migrations

The `persistence_db` crate owns the SQLite schema. `Database::connect` opens a
file-backed store and `Database::migrate` applies the embedded migrations in
version order.

## Pre-1.0 database boundary

Development databases created before the pre-1.0 baseline are unsupported.
Delete and recreate those files; do not attempt to repair them by editing
`_sqlx_migrations` or by running a partial migration chain. This is a hard
reset because the baseline defines the schema and seeded rows together.

The desktop app uses `alm.db` in Tauri's app-data directory unless
`ALM_DB_URL` points to another SQLite URL. Stop the app before deleting the
database. Delete SQLite's `-wal` and `-shm` sidecars when they exist, then
start the app and let startup run the migrations.

## Migration policy

- `0001` is the frozen pre-1.0 baseline. Do not edit, rename, or reorder it
  after it lands.
- Every later schema or data change is a new append-only migration numbered
  `0002`, `0003`, and so on.
- A final pre-1.0 resquash is optional. It requires a new owner decision,
  followed by another coordinated reset of all development databases.

For a normal change, add the next migration under `migrations/`, update the
repository code in the same change, and verify a fresh database plus an
upgraded database. Run the persistence database tests before sharing the
change.
