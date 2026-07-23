# Pre-1.0 database release boundary

The pre-1.0 release uses migration `0001` as its frozen SQLite baseline.
Development databases from before this baseline are not supported upgrade
inputs.

## Release reset requirement

Before validating the release, stop the app and remove each development
database created before the baseline. Remove its `-wal` and `-shm` sidecars as
well. Launching the app against the same path recreates the file and applies
`0001` through the embedded migrator. Use `ALM_DB_URL` to make the path
explicit in automated checks.

Do not ship a release validation result from a database that was upgraded from
a pre-baseline development file. Run the fresh-database first-run checks after
the reset.

## Post-baseline migration contract

`0001` is immutable after landing. Schema and data changes append new
migrations as `0002+`; they do not edit or reorder an earlier migration.
Release validation must cover both a fresh database and an upgrade from the
immediately preceding migration.

A final pre-1.0 resquash is optional and requires a new owner decision. Without
that decision, the append-only `0002+` policy remains in force.
