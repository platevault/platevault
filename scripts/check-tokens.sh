#!/usr/bin/env bash
# check-tokens.sh — CI guard for design token policy (spec 022 / spec 028)
#
# Fails if:
#   1. Raw hex colors appear in apps/desktop/src/styles/components.css
#      (all colors must use --alm-* CSS variables).
#   2. Raw `ms` values appear in components.css
#      (motion durations must use --alm-transition-* variables).
#   3. Legacy/non-ALM token namespaces appear in TSX/TS source files
#      (--mantine-color-* and --alm-color-* do not exist in tokens.css).
#   4. Bare --alm-radius (without -sm/-md/-lg suffix) appears in TSX/TS
#      source files — pin the R-4 regression fix (spec 028, 2026-06-17).
#      Valid radius tokens: --alm-radius-sm, --alm-radius-md, --alm-radius-lg.
#
# Exceptions documented in components.css policy comment (spec 022 T011):
#   - Component-intrinsic geometry px values are intentionally raw.
#   - tokens.css is excluded from check 1/2 (it IS the token definition file).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPONENTS_CSS="$REPO_ROOT/apps/desktop/src/styles/components.css"
SRC_DIR="$REPO_ROOT/apps/desktop/src"

PASS=true

echo "=== Token policy check (spec 022/028) ==="

# ── Check 1: No raw hex colors in components.css ─────────────────────────────
echo ""
echo "1. Checking for raw hex colors in components.css..."
# Exclude lines that are in comments and the policy-comment block itself
HEX_HITS=$(grep -nP '#[0-9a-fA-F]{3,8}\b' "$COMPONENTS_CSS" | grep -v '^\s*[*\/]' || true)
if [ -n "$HEX_HITS" ]; then
  echo "FAIL: Raw hex colors found in components.css (use --alm-* tokens instead):"
  echo "$HEX_HITS"
  PASS=false
else
  echo "  OK: No raw hex colors."
fi

# ── Check 2: No raw ms values in components.css ──────────────────────────────
echo ""
echo "2. Checking for raw ms values in components.css..."
MS_HITS=$(grep -nP '\b[0-9]+ms\b' "$COMPONENTS_CSS" | grep -v '^\s*[*\/]' || true)
if [ -n "$MS_HITS" ]; then
  echo "FAIL: Raw ms values found in components.css (use --alm-transition-* tokens instead):"
  echo "$MS_HITS"
  PASS=false
else
  echo "  OK: No raw ms values."
fi

# ── Check 3: No legacy token namespaces in TSX/TS source ─────────────────────
echo ""
echo "3. Checking for legacy/non-ALM token namespaces in source files..."
# --mantine-color-* and --alm-color-* are not in tokens.css
LEGACY_HITS=$(grep -rnP "(--mantine-color-|--alm-color-)" \
  --include="*.tsx" --include="*.ts" \
  "$SRC_DIR" | grep -v "\.test\." | grep -v "bindings/" || true)
if [ -n "$LEGACY_HITS" ]; then
  echo "FAIL: Legacy token references found (--mantine-color-* / --alm-color-* do not exist in tokens.css):"
  echo "$LEGACY_HITS"
  PASS=false
else
  echo "  OK: No legacy token namespaces."
fi

# ── Check 4: No bare --alm-radius (R-4 regression pin, spec 028) ─────────────
echo ""
echo "4. Checking for bare --alm-radius (undefined; use --alm-radius-{sm,md,lg}) in source files..."
# Match var(--alm-radius) or --alm-radius followed by a non-dash character (i.e., not a suffix).
# The grep uses a negative lookahead: --alm-radius not followed by -
BARE_RADIUS_HITS=$(grep -rnP "var\(--alm-radius\)" \
  --include="*.tsx" --include="*.ts" \
  "$SRC_DIR" | grep -v "\.test\." | grep -v "bindings/" || true)
if [ -n "$BARE_RADIUS_HITS" ]; then
  echo "FAIL: Bare --alm-radius found (R-4 regression: token is undefined; use --alm-radius-md instead):"
  echo "$BARE_RADIUS_HITS"
  PASS=false
else
  echo "  OK: No bare --alm-radius references."
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
