# Dead-caller guard

A function can be implemented, unit-tested, reviewed, and merged while nothing
in the shipped call graph invokes it. Its tests pass, so CI is green and the
feature is absent from the user's perspective. Issues #712, #879, #943, and #878
are all this shape and all reached `main`.

## Why rustc does not catch it

| Lint | Behaviour on a `pub fn` with no caller |
|---|---|
| `dead_code` | Silent. Does not fire on `pub` items in a lib crate. |
| `unreachable_pub` | Silent. Fires on the opposite condition — items that *cannot* be reached outside the crate, suggesting `pub(crate)`. |
| `unused` | Silent. Covers bindings and imports, not exported items. |

A `pub fn` in a `pub mod` is externally reachable in principle, so rustc treats
it as live. With `#![warn(unreachable_pub, dead_code, unused)]` all active,
rustc emits nothing for the #712 shape.

`cargo udeps` and `cargo machete` detect unused *dependencies*, not unused
functions, and do not apply.

## What the gate covers

`scripts/check-dead-callers.sh`, wired as `just dead-callers` and a CI step in
the Rust lane. It fails when a module-level `pub fn` in `crates/` has no
production caller.

- Definitions: functions at column 0 in `crates/**/src/**/*.rs`. Indented
  functions are `impl` methods, reached through traits or receivers that a
  name-based scan cannot see, and are excluded.
- References: `crates/**` and `apps/desktop/src-tauri/src/**`, minus `tests/`
  paths, minus each `#[cfg(test)]` item's own brace scope. Comment lines are
  stripped, so a doc comment naming a function does not disguise it as live.
- Baseline: `scripts/dead-callers-baseline.txt`, 40 names, shrink-only. A name
  absent from the baseline fails the build.

`--self-test` builds a probe tree containing a called function, a test-only
function, a doc-comment-only function, and a function called after an inline
test module, then asserts the exact expected result. Enforcement runs it before
reporting success, so a green result cannot be vacuous.

Detected: `should_snapshot`, `write_session_snapshot` (#712),
`find_or_create_camera_by_alias`, `find_or_create_telescope_by_alias` (#879),
`rank_candidates` (#943 Rust half).

## What the gate cannot cover

Two of the four issues have no dead symbol, so no caller-graph check reaches
them.

| Case | Shape | Why it escapes |
|---|---|---|
| #878 | `get_ingestion_settings` / `update_ingestion_settings` have real callers. The persisted values are never read by the scan/ingest pipeline. | Every symbol is live. The dead thing is the data path. |
| #943, UI half | `confirm.rs` accepts `chosenAttribution`; no UI code populates it. | The Rust field is optional and legitimately absent in most requests. |

Both require knowing which consumer *should* read a value — not derivable from
the call graph.

## Review convention for the uncovered half

A task that adds a producer is incomplete until a consumer reads what it
produces. Before ticking a task or approving a PR that adds persisted state, a
request field, or a computed value:

1. Name the production call site that consumes it, as `path:line`.
2. If the consumer is a later task, link that task and leave the producing task
   open.
3. If no consumer exists and none is scheduled, do not merge the producer.

A test is not a consumer. "The type is wired through the DTO" is not a
consumer. The check is whether a user action reaches the code.
