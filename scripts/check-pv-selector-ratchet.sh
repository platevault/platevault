#!/usr/bin/env bash
# .pv-* CSS selector ratchet for e2e test files.
#
# Invariant: e2e test files (Playwright TS and Rust journeys) must NOT select
# DOM elements by .pv-* CSS class names. After the data-testid migration, these
# selectors should be [data-testid="..."] or [data-kind="..."] instead.
#
# Intentional exceptions (toHaveClass assertions, regex class checks, and
# comments) are excluded by the grep filters below.
#
# This ratchet is sealed at zero: any new .pv-* selector in a test file fails
# the build. It covers the Rust e2e files that the eslint alm/require-root-testid
# rule cannot reach.
#
# Usage:
#   bash scripts/check-pv-selector-ratchet.sh          # exits 0 on pass, 1 on fail

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Playwright TS: locator('.pv-*'), querySelector('.pv-*'), const FOO = '.pv-*'
ts_hits=$(grep -rn "'\\.pv-[a-z]" tests/e2e/ \
  | grep -v 'toHaveClass\|toHaveAttribute\|/pv-' \
  | grep -v '^\s*//' \
  | grep -v '^\s*\*' \
  || true)

# Rust: querySelector('.pv-*'), By::Css(".pv-*"), etc.
rs_hits=$(grep -rn "'\\.pv-[a-z]" crates/e2e-tests/tests/ \
  | grep -v '^\s*//' \
  | grep -v '^\s*///' \
  || true)

all_hits="${ts_hits}
${rs_hits}"
count=$(printf '%s\n' "$all_hits" | grep -c . || true)

if [ "$count" -gt 0 ]; then
  echo "ERROR: $count .pv-* class selector(s) found in e2e test files."
  echo "Replace with [data-testid=\"...\"] or [data-kind=\"...\"] selectors."
  echo ""
  printf '%s\n' "$all_hits" | grep .
  exit 1
fi

echo "OK: zero .pv-* class selectors in e2e test files."
