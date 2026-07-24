#!/usr/bin/env bash
# .pv-* CSS selector ratchet for e2e test files.
#
# Invariant: e2e test files (Playwright TS and Rust journeys) must NOT select
# DOM elements by .pv-* CSS class names. After the data-testid migration these
# selectors must be [data-testid="..."] or [data-kind="..."] instead.
#
# Catches .pv-* preceded by a dot in any quote context — single-quoted, double-
# quoted, or bare (e.g. By::Css(".pv-foo"), locator('.pv-foo'), querySelector).
#
# Intentional exceptions excluded by the grep -v filters:
#   - toHaveClass / toHaveAttribute: class existence checks, not selectors
#   - /pv-/: regex patterns in test assertions
#   - .pv-mono: decorative typography class — no structural testid equivalent;
#     typography tests legitimately query it for font-stack verification
#   - comment lines (// ...)
#
# Sealed at zero: any new .pv-* selector (other than the above) fails the build.
# Covers the Rust e2e files that the eslint alm/require-root-testid rule cannot.
#
# Usage:
#   bash scripts/check-pv-selector-ratchet.sh          # exits 0 on pass, 1 on fail

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Playwright TS: locator('.pv-*'), locator(".pv-*"), const FOO = '.pv-*', etc.
# Exclude toHaveClass/Attribute, /pv-/ regex, pv-mono (typography-only class),
# and comment lines.
ts_hits=$(grep -rn '\.pv-[a-z]' tests/e2e/ \
  | grep -v 'toHaveClass\|toHaveAttribute\|/pv-' \
  | grep -v '\.pv-mono' \
  | grep -v ':[[:space:]]*//' \
  | grep -v ':[[:space:]]*\*' \
  || true)

# Rust: querySelector(".pv-*"), By::Css(".pv-*"), etc. — both quote styles.
# Exclude Rust comment lines (//!, ///, //).
rs_hits=$(grep -rn '\.pv-[a-z]' crates/e2e-tests/tests/ \
  | grep -v ':[[:space:]]*//[/!]\?' \
  || true)

all_hits="${ts_hits}
${rs_hits}"
count=$(printf '%s\n' "$all_hits" | grep -c '[^[:space:]]' || true)

if [ "$count" -gt 0 ]; then
  echo "ERROR: $count .pv-* class selector(s) found in e2e test files."
  echo "Replace with [data-testid=\"...\"] or [data-kind=\"...\"] selectors."
  echo "Exception: .pv-mono is allowed (typography-only class, no testid equivalent)."
  echo ""
  printf '%s\n' "$all_hits" | grep '[^[:space:]]'
  exit 1
fi

echo "OK: zero .pv-* class selectors in e2e test files."
