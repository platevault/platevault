#!/usr/bin/env bash
# ci-affected-crates.sh — map changed files to affected Cargo workspace members.
#
# Reads a newline-separated list of changed file paths (repo-root-relative) on
# stdin and prints the set of `-p <crate>` arguments for `cargo test`, covering:
#   1. every workspace member a changed rust-relevant file lives in, PLUS
#   2. the reverse-dependency closure of those members (workspace-internal
#      dependents), so a change to a low-level crate still exercises its
#      consumers.
#
# Conservative fallbacks (print the sentinel `ALL` and exit 0 — caller then runs
# the full `cargo test --workspace`):
#   - a rust-relevant changed file that maps to no workspace member, or
#   - no changed files map to any crate but rust-relevant files changed.
# Non-rust files (docs, frontend, etc.) on stdin are ignored.
#
# Usage:
#   git diff --name-only BASE...HEAD | scripts/ci-affected-crates.sh
#   scripts/ci-affected-crates.sh --self-test   # assert the mapping/closure logic
#
# Requires: cargo, jq.
set -euo pipefail

# A file is "rust-relevant" if a change to it could affect a Rust build/test.
is_rust_relevant() {
  case "$1" in
    *.rs) return 0 ;;
    */Cargo.toml | Cargo.toml) return 0 ;;
    crates/* | apps/desktop/src-tauri/* | tests/*) return 0 ;;
    *) return 1 ;;
  esac
}

# Emit "<name>\t<repo-relative-dir>" for every workspace member.
members_tsv() {
  cargo metadata --no-deps --format-version 1 2>/dev/null | jq -r '
    .workspace_root as $root
    | .packages[]
    | [.name, (.manifest_path | sub("/Cargo.toml$"; "") | sub("^" + $root + "/?"; ""))]
    | @tsv'
}

# Emit "<pkg>\t<workspace-internal-dependency>" edges (one per line).
edges_tsv() {
  local names_json
  names_json=$(cargo metadata --no-deps --format-version 1 2>/dev/null \
    | jq -c '[.packages[].name]')
  cargo metadata --no-deps --format-version 1 2>/dev/null | jq -r --argjson names "$names_json" '
    .packages[] as $p
    | $p.dependencies[]
    | select(.name as $d | $names | index($d))
    | [$p.name, .name]
    | @tsv'
}

# Compute the affected `-p` args from a newline-separated file list on stdin.
affected_args() {
  local files members edges
  files=$(cat)

  members=$(members_tsv)
  edges=$(edges_tsv)

  # 1. Direct crates: longest-prefix match of each rust-relevant file to a member dir.
  local direct="" saw_rust=0 f name dir best_name best_len len
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    is_rust_relevant "$f" || continue
    saw_rust=1
    best_name=""; best_len=-1
    while IFS=$'\t' read -r name dir; do
      [ -n "$dir" ] || continue
      case "$f" in
        "$dir"/*)
          len=${#dir}
          if [ "$len" -gt "$best_len" ]; then best_len=$len; best_name=$name; fi
          ;;
      esac
    done <<< "$members"
    if [ -z "$best_name" ]; then
      # rust-relevant file outside every member → cannot scope safely.
      echo "ALL"; return 0
    fi
    direct+="$best_name"$'\n'
  done <<< "$files"

  # No rust-relevant files at all → nothing to test here.
  if [ "$saw_rust" -eq 0 ]; then return 0; fi

  direct=$(printf '%s' "$direct" | sort -u | sed '/^$/d')

  # 2. Reverse-dependency closure (BFS over dependent edges).
  local closure="$direct" frontier="$direct" next dep pkg
  while [ -n "$frontier" ]; do
    next=""
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      while IFS=$'\t' read -r pkg dep; do
        if [ "$dep" = "$name" ] && ! grep -qxF "$pkg" <<< "$closure"; then
          closure+=$'\n'"$pkg"
          next+="$pkg"$'\n'
        fi
      done <<< "$edges"
    done <<< "$frontier"
    frontier=$(printf '%s' "$next" | sed '/^$/d')
  done

  # 3. Emit -p args, sorted & deduped for stable output.
  printf '%s\n' "$closure" | sort -u | sed '/^$/d' | while IFS= read -r name; do
    printf -- '-p %s ' "$name"
  done
  echo
}

self_test() {
  local out fail=0
  assert_contains() { # <label> <needle> <haystack>
    if grep -q -- "$2" <<< "$3"; then echo "ok: $1"; else echo "FAIL: $1 (missing '$2' in: $3)"; fail=1; fi
  }
  assert_empty() { # <label> <value>
    if [ -z "$(echo "$2" | tr -d '[:space:]')" ]; then echo "ok: $1"; else echo "FAIL: $1 (expected empty, got: $2)"; fail=1; fi
  }
  assert_eq() { # <label> <expected> <actual>
    if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 (expected '$2', got '$3')"; fail=1; fi
  }

  # A leaf-ish crate change includes itself.
  out=$(printf 'crates/patterns/src/lib.rs\n' | affected_args)
  assert_contains "changed crate maps to itself" "-p patterns" "$out"

  # A low-level crate change pulls in dependents (closure > just itself).
  out=$(printf 'crates/domain/core/src/lib.rs\n' | affected_args)
  assert_contains "domain_core change includes domain_core" "-p domain_core" "$out"
  if [ "$(printf '%s' "$out" | grep -o -- '-p' | wc -l)" -gt 1 ]; then
    echo "ok: domain_core change includes reverse deps"
  else
    echo "FAIL: domain_core change should include reverse deps (got: $out)"; fail=1
  fi

  # Docs-only file list yields no crates.
  out=$(printf 'docs/x.md\nREADME.md\n' | affected_args)
  assert_empty "docs-only files yield no crates" "$out"

  # A rust-relevant file outside any member is the conservative ALL sentinel.
  out=$(printf 'tests/orphan_top_level.rs\n' | affected_args)
  assert_eq "orphan rust file -> ALL" "ALL" "$(echo "$out" | tr -d '[:space:]')"

  # Mixed docs + one crate: docs ignored, crate scoped.
  out=$(printf 'docs/x.md\ncrates/patterns/src/lib.rs\n' | affected_args)
  assert_contains "mixed docs+crate scopes to crate" "-p patterns" "$out"

  [ "$fail" -eq 0 ] && echo "ci-affected-crates self-test: PASS" || { echo "ci-affected-crates self-test: FAIL"; return 1; }
}

case "${1:-}" in
  --self-test) self_test ;;
  *) affected_args ;;
esac
