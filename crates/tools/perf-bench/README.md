# perf-bench

Perf measurement harness for the inbox scan/classify hot paths.

Generates a synthetic fixture tree (N FITS files in nested session directories),
runs `scan_root` and `classify_source_group` against a real file-backed `SQLite`
database with all migrations applied, and prints one JSON line per scenario to
stdout.

## Usage

```sh
just perf-bench              # PERF_N=500 (default; CI-safe)
PERF_N=5000 just perf-bench  # deeper run for local baselines
```

## Output

One JSON object per scenario:

```
{"scenario":"scan_root","n":500,"wall_ms":246,"items":10,"sqlx_stmts":0}
{"scenario":"classify_source_groups","n":500,"wall_ms":404,"groups":10,"classified_ok":10,"sqlx_stmts":2721}
```

| Field | Description |
|---|---|
| `wall_ms` | Wall-clock milliseconds for the use-case call (setup excluded) |
| `sqlx_stmts` | SQLite statement executions (via `sqlx` tracing events) |
| `items` / `groups` | Count of scanned items or source groups processed |

`wall_ms` timing excludes fixture creation and DB migration.
`scan_root` always reports `sqlx_stmts: 0`; it is pure filesystem.

## Fixture shape

50 FITS files per session directory; `PERF_N=500` yields 10 sessions.
Files carry realistic FITS headers (IMAGETYP, OBJECT, FILTER, EXPTIME, GAIN,
NAXIS1/2, DATE-OBS, INSTRUME) with varied values to exercise the classify path.

## Not a `cargo test` target

The binary is dev-only (`publish = false`). No `#[test]` functions are defined
here, so `cargo test --workspace` is unaffected. `just perf-bench` runs the
binary with `--release` for representative timing.
