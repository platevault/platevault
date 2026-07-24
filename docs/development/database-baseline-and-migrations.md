# Pre-1.0 database baseline

This guide defines the development database boundary for the SQLite store.

## Unsupported databases

Any database created before the pre-1.0 baseline is unsupported. Recreate it
from the migrations shipped by the checkout under test. Do not edit
`_sqlx_migrations`, copy tables between schema generations, or skip migration
versions to preserve test data.

The reset is destructive to the selected SQLite file. Preserve fixtures or
exports outside the database file before removing it.

## Reset procedure

1. Stop the desktop app and any process using the database.
2. Determine the database URL. `PV_DB_URL` takes precedence. Without it,
   the app creates `alm.db` under Tauri's app-data directory.
3. Remove the selected file and its SQLite sidecars (`<file>-wal` and
   `<file>-shm`) if present.
4. Start the app or test command. `Database::migrate` creates the file and
   applies the embedded migration chain from `0001`.
5. Confirm the first-run flow or test fixture creates the expected seed data.

For the Windows native development checkout, the default file is:

```powershell
$db = "$env:APPDATA\dev.astro-plan.astro-library-manager\alm.db"
Remove-Item -LiteralPath $db, "$db-wal", "$db-shm" -Force -ErrorAction SilentlyContinue
```

For an explicit development URL, remove the path named by `PV_DB_URL` after
stripping the `sqlite://` prefix and query string. Use a path-specific remove
command; never delete an entire app-data directory.

## Frozen baseline and append-only changes

Migration `0001` is the frozen pre-1.0 schema and seed baseline. Once it lands,
its filename, version, checksum, table definitions, and seed statements are
immutable. Any later change must append a new migration (`0002+`) and must not
rewrite an earlier migration to make an existing database appear fresh.

Each migration change follows this workflow:

1. Add the next unused version under `crates/persistence/db/migrations/`.
2. Update repository queries and tests in the same change.
3. Run the migration tests against a fresh database.
4. Run the migration tests against a database created by the preceding
   migration set.
5. Review the SQL and migration version in the diff before merging.

A final pre-1.0 resquash may replace the append-only chain only after a fresh
owner decision. That decision must include a new baseline version, a reset
window for every development database, and updated release instructions.
