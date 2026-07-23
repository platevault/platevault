#!/usr/bin/env bash
# check-tokens.sh — CI guard for design token policy (spec 022 / spec 028)
#
# Fails if:
#   1. Raw hex colors appear in apps/desktop/src/styles/components.css
#      (all colors must use --pv-* CSS variables).
#   2. Raw `ms` values appear in components.css
#      (motion durations must use --pv-transition-* variables).
#   3. Legacy/non-PV token namespaces appear in TSX/TS source files
#      (--mantine-color-* and --pv-color-* do not exist in tokens.css).
#   4. Bare --pv-radius (without -sm/-md/-lg suffix) appears in TSX/TS
#      source files — pin the R-4 regression fix (spec 028, 2026-06-17).
#      Valid radius tokens: --pv-radius-sm, --pv-radius-md, --pv-radius-lg.
#
# Exceptions documented in components.css policy comment (spec 022 T011):
#   - Component-intrinsic geometry px values are intentionally raw.
#   - tokens.css is excluded from check 1/2 (it IS the token definition file).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# components.css is now an @import barrel; the actual rules live in the domain
# partials under styles/components/. Scan the barrel AND every partial so the
# token policy still covers all component CSS after the split.
COMPONENTS_CSS=("$REPO_ROOT/apps/desktop/src/styles/components.css" "$REPO_ROOT"/apps/desktop/src/styles/components/*.css)
SRC_DIR="$REPO_ROOT/apps/desktop/src"

PASS=true

echo "=== Token policy check (spec 022/028) ==="

# Strip /* ... */ comments while preserving line numbers (comment bytes → spaces,
# newlines kept) so the hex/ms greps below never false-positive on policy prose.
strip_comments() { perl -0777 -pe 's{/\*.*?\*/}{ (my $m=$&) =~ s/[^\n]/ /g; $m }gse' "$1"; }

# fatal_if_grep_broken CONTEXT RC... — grep documents exit 1 as "no match"
# (expected here; every check below treats zero hits as a pass) and exit >1
# as a real failure (e.g. an unsupported flag on a given platform's grep).
# Only the latter is fatal, so a broken grep invocation can never masquerade
# as "no violations found". Callers must pass every stage's exit code from
# "${PIPESTATUS[@]}", captured immediately after the pipeline runs — PIPESTATUS
# is clobbered by any intervening command, including a function call, so this
# function cannot read it itself.
fatal_if_grep_broken() {
  local context="$1"; shift
  local rc
  for rc in "$@"; do
    if [ "$rc" -gt 1 ]; then
      echo "FATAL: grep exited $rc (expected 0=match or 1=no-match) $context" >&2
      exit 2
    fi
  done
}

# ── Check 1: No raw hex colors in component CSS (barrel + partials) ───────────
echo ""
echo "1. Checking for raw hex colors in component CSS..."
HEX_HITS=""
for f in "${COMPONENTS_CSS[@]}"; do
  # -E, not -P: BSD/macOS grep has no -P. \b has no ERE equivalent, so the
  # trailing boundary is emulated by consuming a non-word char (or EOL) —
  # verified to match the same set of lines as the old \b version.
  h=$(
    set +e
    strip_comments "$f" | grep -nE '#[0-9a-fA-F]{3,8}([^0-9A-Za-z_]|$)'
    rc=("${PIPESTATUS[@]}")
    set -e
    fatal_if_grep_broken "while scanning ${f##*/} for hex colors" "${rc[@]}"
    exit 0
  )
  [ -n "$h" ] && HEX_HITS+="${f##*/styles/}:"$'\n'"$h"$'\n'
done
if [ -n "$HEX_HITS" ]; then
  echo "FAIL: Raw hex colors found in component CSS (use --pv-* tokens instead):"
  echo "$HEX_HITS"
  PASS=false
else
  echo "  OK: No raw hex colors."
fi

# ── Check 2: No raw ms values in component CSS (barrel + partials) ────────────
echo ""
echo "2. Checking for raw ms values in component CSS..."
MS_HITS=""
for f in "${COMPONENTS_CSS[@]}"; do
  # -E, not -P: same \b-emulation approach as check 1, on both sides of the
  # digit run this time (leading boundary too, so "10msWidth"-style
  # identifiers still don't false-positive).
  h=$(
    set +e
    strip_comments "$f" | grep -nE '([^0-9A-Za-z_]|^)[0-9]+ms([^0-9A-Za-z_]|$)'
    rc=("${PIPESTATUS[@]}")
    set -e
    fatal_if_grep_broken "while scanning ${f##*/} for raw ms values" "${rc[@]}"
    exit 0
  )
  [ -n "$h" ] && MS_HITS+="${f##*/styles/}:"$'\n'"$h"$'\n'
done
if [ -n "$MS_HITS" ]; then
  echo "FAIL: Raw ms values found in component CSS (use --pv-transition-* tokens instead):"
  echo "$MS_HITS"
  PASS=false
else
  echo "  OK: No raw ms values."
fi

# ── Check 3: No legacy token namespaces in TSX/TS source ─────────────────────
echo ""
echo "3. Checking for legacy/non-PV token namespaces in source files..."
# --mantine-color-* and --pv-color-* are not in tokens.css.
# -E, not -P: this is a plain literal alternation, no PCRE feature in use —
# BSD/macOS grep has no -P at all, so it errored on every invocation.
LEGACY_HITS=$(
  set +e
  grep -rnE "(--mantine-color-|--pv-color-)" \
    --include="*.tsx" --include="*.ts" \
    "$SRC_DIR" | grep -v "\.test\." | grep -v "bindings/"
  rc=("${PIPESTATUS[@]}")
  set -e
  fatal_if_grep_broken "while scanning for legacy token namespaces" "${rc[@]}"
  exit 0
)
if [ -n "$LEGACY_HITS" ]; then
  echo "FAIL: Legacy token references found (--mantine-color-* / --pv-color-* do not exist in tokens.css):"
  echo "$LEGACY_HITS"
  PASS=false
else
  echo "  OK: No legacy token namespaces."
fi

# ── Check 4: No bare --pv-radius (R-4 regression pin, spec 028) ─────────────
echo ""
echo "4. Checking for bare --pv-radius (undefined; use --pv-radius-{sm,md,lg}) in source files..."
# Matches the literal substring var(--pv-radius) — the required immediate
# closing paren is what excludes suffixed forms like var(--pv-radius-md):
# a plain literal search, no regex needed at all, so -F (fixed string) is
# both the most portable option and clearer than a lookaround would be.
# (The pattern never used a lookahead despite what an earlier comment here
# claimed; -F makes that explicit.)
BARE_RADIUS_HITS=$(
  set +e
  grep -rnF "var(--pv-radius)" \
    --include="*.tsx" --include="*.ts" \
    "$SRC_DIR" | grep -v "\.test\." | grep -v "bindings/"
  rc=("${PIPESTATUS[@]}")
  set -e
  fatal_if_grep_broken "while scanning for bare --pv-radius references" "${rc[@]}"
  exit 0
)
if [ -n "$BARE_RADIUS_HITS" ]; then
  echo "FAIL: Bare --pv-radius found (R-4 regression: token is undefined; use --pv-radius-md instead):"
  echo "$BARE_RADIUS_HITS"
  PASS=false
else
  echo "  OK: No bare --pv-radius references."
fi

# ── Check 5: Every [data-theme] block declares the full raw-token set ────────
echo ""
echo "5. Checking theme token completeness (all themes override the same raw set)..."
if node "$REPO_ROOT/apps/desktop/scripts/check-theme-completeness.mjs"; then
  echo "  OK: All themes are complete."
else
  echo "FAIL: A theme is missing raw tokens (see above)."
  PASS=false
fi

# ── Check 6: Text/surface token pairs meet WCAG AA contrast (handoff 02) ─────
echo ""
echo "6. Checking text/surface token contrast (WCAG AA)..."
if node "$REPO_ROOT/apps/desktop/scripts/check-contrast.mjs"; then
  echo "  OK: All contrast pairs meet AA."
else
  echo "FAIL: A text/surface pair is below AA contrast (see above)."
  PASS=false
fi

# ── Check 7: every var(--pv-*) in TS/TSX resolves to a real token ────────────
# stylelint's no-unknown-custom-properties covers CSS: it parses the stylesheets
# and understands same-file scoping. It cannot see a token reference written as
# a string literal in an inline style, which is the remaining surface — and the
# one where a bare `var(--pv-radius)` reached production (spec 028, R-4).
echo ""
echo "7. Checking var(--pv-*) references in TS/TSX resolve to real tokens..."
if node "$REPO_ROOT/apps/desktop/scripts/check-token-refs.mjs"; then
  echo "  OK: All TS/TSX token references resolve."
else
  echo "FAIL: A TS/TSX file references a token that does not exist (see above)."
  PASS=false
fi

# ── Result ────────────────────────────────────────────────────────────────────
echo ""
if [ "$PASS" = true ]; then
  echo "All token checks passed."
  exit 0
else
  echo "Token policy violations found. Fix the above issues."
  exit 1
fi
