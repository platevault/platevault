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

# ── Check 1: No raw hex colors in component CSS (barrel + partials) ───────────
echo ""
echo "1. Checking for raw hex colors in component CSS..."
HEX_HITS=""
for f in "${COMPONENTS_CSS[@]}"; do
  h=$(strip_comments "$f" | grep -nP '#[0-9a-fA-F]{3,8}\b' || true)
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
  h=$(strip_comments "$f" | grep -nP '\b[0-9]+ms\b' || true)
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
# --mantine-color-* and --pv-color-* are not in tokens.css
LEGACY_HITS=$(grep -rnP "(--mantine-color-|--pv-color-)" \
  --include="*.tsx" --include="*.ts" \
  "$SRC_DIR" | grep -v "\.test\." | grep -v "bindings/" || true)
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
# Match var(--pv-radius) or --pv-radius followed by a non-dash character (i.e., not a suffix).
# The grep uses a negative lookahead: --pv-radius not followed by -
BARE_RADIUS_HITS=$(grep -rnP "var\(--pv-radius\)" \
  --include="*.tsx" --include="*.ts" \
  "$SRC_DIR" | grep -v "\.test\." | grep -v "bindings/" || true)
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
# CSS is covered by stylelint's no-unknown-custom-properties, which parses the
# stylesheets and understands same-file scoping. It cannot see token references
# written as string literals in inline styles, which is the remaining surface —
# and the one where a bare `var(--pv-radius)` reached production (spec 028 R-4).
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
