#!/usr/bin/env bash
# DB boundary guard — keystone enforcement for the persistence-layer boundary.
#
# Invariant: ALL production SQL lives inside `crates/persistence/db`. ZERO raw
# sqlx query/exec sites are permitted in production Rust code outside that crate.
# This script counts those sites and FAILS if any exist. The checked-in baseline
# (db-boundary-baseline.txt) is sealed EMPTY and MUST stay empty — it is a locked
# zero, not a tunable ratchet. Any new leak fails CI.
#
# History: this began as a shrink-only ratchet during the persistence-layer
# hardening effort. Once every app-layer query was drained into
# crates/persistence/db (run `db-boundary-zero`), the baseline was sealed at
# zero. New SQL must be added as a persistence/db repository method — never as an
# app-layer sqlx call.
#
# Why a script and not clippy `disallowed-methods`: clippy cannot path-scope a
# lint to "everywhere except crates/persistence/db". clippy.toml here provides a
# coarse secondary signal only; this guard is the real boundary enforcement.
#
# "Production" = `*.rs` files, excluding:
#   - crates/persistence/db/**         (the sanctioned home for SQL)
#   - any path containing a `tests/` segment (integration tests)
#   - the example reference module (query_builder_example.rs)
#   - query sites that appear at/after the first `#[cfg(test)]` line in a file
#     (inline unit-test modules are not production code)
#   - entire files the compiler excludes from production builds, i.e. file-level
#     test modules (see is_test_only_file)
#
# Usage:
#   scripts/check-db-boundary.sh            # enforce zero (CI mode)
#   scripts/check-db-boundary.sh --generate # re-seal the empty baseline; refuses if any leak exists
#   scripts/check-db-boundary.sh --list     # print current per-file counts

set -euo pipefail

# Repo root = parent of this script's directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASELINE="$SCRIPT_DIR/db-boundary-baseline.txt"

# Patterns that denote a raw sqlx query/exec site.
PATTERN='sqlx::query|query_as|query_scalar|\.fetch_(one|all|optional)|\.execute\('

# True when the compiler excludes this ENTIRE file from production builds.
#
# Two ways a whole file can be test-only, both checked against the compiler's
# actual rule rather than the file's name — a production file called `tests.rs`
# is still counted, which is why this is not a name-based exemption:
#
#   1. The file declares the inner attribute `#![cfg(test)]` in its header
#      region (blank/comment/attribute lines only). Note this is NOT matched by
#      the inline `#[cfg(test)]` cutoff regex below: the `!` makes it an inner
#      attribute applying to the whole file, not a cutoff for what follows.
#   2. The file is a module whose parent declares it `#[cfg(test)] mod <name>;`.
#      Extracting an inline `#[cfg(test)] mod tests { .. }` into its own file
#      leaves the attribute on the parent's declaration, so the file itself
#      contains no cfg(test) marker at all.
is_test_only_file() {
  local file="$1"
  local first_item modname dir parent inner

  # (1) Inner attribute in the header region. Restricted to the leading run of
  # blank/comment/attribute lines so an `#![cfg(test)]` nested inside an inline
  # `mod foo { .. }` (legal, but scopes to that module only) does not count.
  first_item="$(grep -nvE '^[[:space:]]*(//.*)?$|^[[:space:]]*#!?\[' "$file" | head -1 | cut -d: -f1 || true)"
  inner="$(grep -nE '^[[:space:]]*#!\[cfg\(test\)\]' "$file" | head -1 | cut -d: -f1 || true)"
  if [[ -n "$inner" ]] && { [[ -z "$first_item" ]] || [[ "$inner" -lt "$first_item" ]]; }; then
    return 0
  fi

  # (2) Parent declares this module under #[cfg(test)].
  modname="$(basename "$file" .rs)"
  dir="$(dirname "$file")"
  if [[ "$modname" == "mod" ]]; then
    # `foo/mod.rs` is module `foo`, declared by foo's own parent directory.
    modname="$(basename "$dir")"
    dir="$(dirname "$dir")"
  elif [[ "$modname" == "lib" || "$modname" == "main" ]]; then
    return 1 # crate roots have no parent module
  fi
  for parent in "$dir/mod.rs" "$dir.rs" "$dir/lib.rs" "$dir/main.rs"; do
    [[ -f "$parent" ]] || continue
    # `#[cfg(test)]` on the line immediately preceding the `mod <name>;` decl.
    if grep -A1 -E '^[[:space:]]*#\[cfg\(test\)\][[:space:]]*$' "$parent" \
      | grep -qE "^[[:space:]]*(pub[[:space:]]*(\([^)]*\))?[[:space:]]+)?mod[[:space:]]+${modname}[[:space:]]*;"; then
      return 0
    fi
  done
  return 1
}

# Count production query sites in a single file (sites before first #[cfg(test)]).
count_file() {
  local file="$1"
  local cutoff

  if is_test_only_file "$file"; then
    echo 0
    return
  fi

  # Line number of the first #[cfg(test)] (inline unit-test module marker).
  cutoff="$(grep -nE '#\[cfg\(test\)\]' "$file" | head -1 | cut -d: -f1 || true)"
  if [[ -n "$cutoff" ]]; then
    # Production region is everything strictly before the cfg(test) marker.
    head -n "$((cutoff - 1))" "$file" | grep -cE "$PATTERN" || true
  else
    grep -cE "$PATTERN" "$file" || true
  fi
}

# Enumerate candidate production files (sorted, repo-relative paths).
list_files() {
  cd "$ROOT"
  # Search source roots; prune persistence/db and any tests/ directory.
  find crates apps -type f -name '*.rs' \
    -not -path 'crates/persistence/db/*' \
    -not -path '*/tests/*' \
    -not -name 'query_builder_example.rs' \
    | sort
}

# Emit "count<TAB>path" for every file that has >=1 production query site.
collect() {
  local f n
  while IFS= read -r f; do
    n="$(count_file "$ROOT/$f")"
    if [[ "$n" -gt 0 ]]; then
      printf '%d\t%s\n' "$n" "$f"
    fi
  done < <(list_files)
}

case "${1:-}" in
  --generate)
    # Re-seal the baseline. The boundary is locked at ZERO, so this refuses to
    # bake in any leakage: if production query sites exist, drain them into
    # crates/persistence/db instead of recording a non-empty baseline.
    total="$(collect | awk -F'\t' '{s+=$1} END{print s+0}')"
    if [[ "$total" -ne 0 ]]; then
      echo "ERROR: refusing to generate a non-empty baseline ($total production query site(s) found)." >&2
      echo "The DB boundary is sealed at zero. Move these queries into crates/persistence/db:" >&2
      collect >&2
      exit 1
    fi
    {
      echo "# DB boundary baseline — production sqlx query/exec sites OUTSIDE crates/persistence/db."
      echo "# SEALED AT ZERO: this file must contain no count rows. All production SQL lives in"
      echo "# crates/persistence/db; new queries are added there as repository methods, never here."
      echo "# Generated by scripts/check-db-boundary.sh --generate (refuses to record any leakage)."
    } > "$BASELINE"
    echo "Sealed baseline: $BASELINE"
    echo "  files: 0   total production query sites: 0"
    ;;

  --list)
    collect
    ;;

  ""|--check)
    if [[ ! -f "$BASELINE" ]]; then
      echo "ERROR: baseline missing: $BASELINE" >&2
      echo "Run: scripts/check-db-boundary.sh --generate" >&2
      exit 2
    fi

    # The boundary is sealed at zero. The baseline must contain no count rows,
    # and there must be no production query sites outside crates/persistence/db.
    fail=0

    # (1) Guard the seal itself: a non-empty baseline would silently re-open the
    # boundary, so reject any count row hand-edited back in.
    if grep -vE '^[[:space:]]*#' "$BASELINE" | grep -qE '[^[:space:]]'; then
      echo "SEAL BROKEN: $BASELINE contains count rows; the baseline must stay empty (zero-tolerance)." >&2
      fail=1
    fi

    # (2) Enforce zero production query sites.
    while IFS=$'\t' read -r cnt path; do
      echo "BOUNDARY VIOLATION: $path has $cnt production query site(s); zero allowed outside crates/persistence/db." >&2
      fail=1
    done < <(collect)

    if [[ "$fail" -ne 0 ]]; then
      echo "" >&2
      echo "DB boundary guard failed: raw SQL is only allowed inside crates/persistence/db." >&2
      echo "Add the query as a persistence/db repository method instead of an app-layer sqlx call." >&2
      exit 1
    fi

    echo "DB boundary OK — 0 production query site(s) outside crates/persistence/db (sealed at zero)."
    ;;

  *)
    echo "usage: $0 [--check|--generate|--list]" >&2
    exit 2
    ;;
esac
