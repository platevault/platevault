#!/usr/bin/env bash
# Hot-read ratchet — catches per-operation hot reads from the high-frequency
# inbox / plan-apply / watcher code paths.
#
# Invariant: the count of hot-read call sites in the scoped directories must
# not exceed the checked-in baseline (hot-read-baseline.txt). The baseline
# is shrink-only: it may only decrease over time, never increase. Any new
# hot-read site added inside the scoped paths fails CI; removing one allows
# the baseline to be regenerated at a lower count.
#
# "Hot reads" are single-value fetches that run on every inbox classify/confirm
# pass or every watcher event instead of being cached in the application state.
# The patterns below match the specific call sites identified in GF-23/GF-24:
#   - settings::load_settings   (full settings reload per-operation)
#   - settings_repo::get_raw    (raw settings row fetch per-operation)
#   - equipment::list_cameras   (camera list reload per classify/confirm)
#   - get_project_canonical_target_id (project lookup per attribution pass)
#
# Scoped paths (only these are checked — noise from other crates is excluded):
#   crates/app/inbox/
#   crates/app/core/src/plan_apply/
#   apps/desktop/src-tauri/src/watcher.rs
#
# Why a script and not clippy disallowed-methods: clippy cannot path-scope a
# lint to specific subdirectory trees. This script is the real enforcement.
#
# "Production" = *.rs files, excluding:
#   - any path containing a `tests/` segment (integration tests)
#   - query sites inside an inline `#[cfg(test)]` item (unit-test modules)
#   - entire files the compiler excludes from production builds
#     (file-level #![cfg(test)] or parent-declared #[cfg(test)] mod)
#
# Usage:
#   scripts/check-hot-read-ratchet.sh              # enforce baseline (CI mode)
#   scripts/check-hot-read-ratchet.sh --generate   # regenerate baseline from current counts
#   scripts/check-hot-read-ratchet.sh --list       # print current per-file counts

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASELINE="$SCRIPT_DIR/hot-read-baseline.txt"

# Hot-read call-site patterns (see module doc above).
PATTERN='settings::load_settings|settings_repo::get_raw|equipment::list_cameras|get_project_canonical_target_id'

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

  # (1) Inner attribute in the header region.
  first_item="$(grep -nvE '^[[:space:]]*(//.*)?$|^[[:space:]]*#!?\[' "$file" | head -1 | cut -d: -f1 || true)"
  inner="$(grep -nE '^[[:space:]]*#!\[cfg\(test\)\]' "$file" | head -1 | cut -d: -f1 || true)"
  if [[ -n "$inner" ]] && { [[ -z "$first_item" ]] || [[ "$inner" -lt "$first_item" ]]; }; then
    return 0
  fi

  # (2) Parent declares this module under #[cfg(test)].
  modname="$(basename "$file" .rs)"
  dir="$(dirname "$file")"
  if [[ "$modname" == "mod" ]]; then
    modname="$(basename "$dir")"
    dir="$(dirname "$dir")"
  elif [[ "$modname" == "lib" || "$modname" == "main" ]]; then
    return 1
  fi
  for parent in "$dir/mod.rs" "$dir.rs" "$dir/lib.rs" "$dir/main.rs"; do
    [[ -f "$parent" ]] || continue
    if grep -A1 -E '^[[:space:]]*#\[cfg\(test\)\][[:space:]]*$' "$parent" \
      | grep -qE "^[[:space:]]*(pub[[:space:]]*(\([^)]*\))?[[:space:]]+)?mod[[:space:]]+${modname}[[:space:]]*;"; then
      return 0
    fi
  done
  return 1
}

# Count production hot-read sites in a single file.
#
# An inline `#[cfg(test)]` item exempts ITS OWN SCOPE only, not the rest of the
# file. The item's extent is found by its closing brace at the attribute's own
# indentation, which rustfmt guarantees. Brace-depth counting is deliberately
# avoided (string literals with braces would desynchronise it); the indentation
# rule errs strict rather than permissive.
count_file() {
  local file="$1"

  if is_test_only_file "$file"; then
    echo 0
    return
  fi

  PAT="$PATTERN" awk '
    BEGIN { pat = ENVIRON["PAT"] }

    skipping {
      if ($0 ~ ("^" indent "\\}")) { skipping = 0 }
      next
    }

    pending {
      if ($0 ~ /^[[:space:]]*#\[/) { next }
      pending = 0
      if ($0 ~ /\{/) { skipping = 1 }
      next
    }

    /^[[:space:]]*#\[cfg\(test\)\]/ {
      indent = $0
      sub(/#.*$/, "", indent)
      if ($0 ~ /\{/) { skipping = 1 } else { pending = 1 }
      next
    }

    $0 ~ pat { n++ }
    END { print n + 0 }
  ' "$file"
}

# Enumerate candidate production files in the scoped paths (sorted, repo-relative).
list_files() {
  cd "$ROOT"
  {
    # Directory scopes
    find crates/app/inbox \
         crates/app/core/src/plan_apply \
         -type f -name '*.rs' \
         -not -path '*/tests/*' \
         2>/dev/null || true
    # Single-file scope
    if [[ -f apps/desktop/src-tauri/src/watcher.rs ]]; then
      echo apps/desktop/src-tauri/src/watcher.rs
    fi
  } | sort
}

# Emit "count<TAB>path" for every file that has >=1 production hot-read site.
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
    # Regenerate the baseline from current counts. The baseline is shrink-only:
    # committing a higher total than the previous baseline is the author's
    # responsibility to avoid (CI enforces it).
    {
      echo "# Hot-read ratchet baseline — per-operation hot-read call sites in high-frequency paths."
      echo "# Shrink-only: total may only decrease. Add a site → fail CI. Remove one → --generate."
      echo "# Scoped to: crates/app/inbox/, crates/app/core/src/plan_apply/, src-tauri/watcher.rs."
      echo "# Pattern:   settings::load_settings|settings_repo::get_raw|equipment::list_cameras"
      echo "#            |get_project_canonical_target_id"
      echo "# Generated by: scripts/check-hot-read-ratchet.sh --generate"
      echo "#"
      echo "# count<TAB>repo-relative-path"
      collect
    } > "$BASELINE"
    total="$(collect | awk -F'\t' '{s+=$1} END{print s+0}')"
    echo "Generated baseline: $BASELINE"
    echo "  total hot-read sites: $total"
    ;;

  --list)
    collect
    ;;

  ""|--check)
    if [[ ! -f "$BASELINE" ]]; then
      echo "ERROR: baseline missing: $BASELINE" >&2
      echo "Run: scripts/check-hot-read-ratchet.sh --generate" >&2
      exit 2
    fi

    # Use awk to compare current counts against the baseline in one pass.
    # Baseline lines: "<count>\t<path>" (comments stripped).
    # Current lines:  same format from collect().
    # awk receives both streams on stdin separated by a sentinel line.
    result="$(
      {
        grep -vE '^[[:space:]]*#|^[[:space:]]*$' "$BASELINE"
        echo "__SENTINEL__"
        collect
      } | awk -F'\t' '
        /^__SENTINEL__$/ { reading_current = 1; next }
        !reading_current { baseline[$2] = $1 + 0; btotal += $1 + 0; next }
        {
          cnt = $1 + 0; path = $2
          ctotal += cnt
          allowed = (path in baseline) ? baseline[path] + 0 : 0
          if (cnt > allowed) {
            print "HOT-READ RATCHET: " path " has " cnt " site(s), baseline allows " allowed " — ratchet exceeded."
            fail = 1
          }
        }
        END {
          if (ctotal > btotal) {
            print "HOT-READ RATCHET: total " ctotal " site(s) exceeds baseline " btotal "."
            fail = 1
          }
          if (fail) {
            print "FAIL " ctotal " " btotal
          } else {
            print "OK " ctotal " " btotal
          }
        }
      '
    )"

    verdict="$(printf '%s\n' "$result" | tail -1)"
    messages="$(printf '%s\n' "$result" | sed '$d')"

    if [[ -n "$messages" ]]; then
      printf '%s\n' "$messages" >&2
    fi

    if [[ "$verdict" == FAIL* ]]; then
      current_total="${verdict#FAIL }"; current_total="${current_total%% *}"
      echo "" >&2
      echo "Hot-read ratchet failed: remove the new site or move it behind a cache." >&2
      echo "After reducing counts, run: scripts/check-hot-read-ratchet.sh --generate" >&2
      exit 1
    fi

    current_total="${verdict#OK }"; current_total="${current_total%% *}"
    baseline_total="${verdict##* }"
    echo "Hot-read ratchet OK — $current_total site(s) (baseline: $baseline_total)."
    ;;

  *)
    echo "usage: $0 [--check|--generate|--list]" >&2
    exit 2
    ;;
esac
