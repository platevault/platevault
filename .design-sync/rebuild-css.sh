#!/usr/bin/env bash
# Regenerate the flattened design-system stylesheet that cfg.cssEntry points at.
# The design-sync converter copies cssEntry VERBATIM (it does not resolve @import),
# so we pre-flatten reset + tokens + components (the .alm-* classes) into one file.
# Run this from the repo root BEFORE every `package-build.mjs` run.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

mkdir -p apps/desktop/.ds-css
cat > apps/desktop/.ds-css/_aggregate.css <<'CSS'
@import '../src/styles/reset.css';
@import '../src/styles/tokens.css';
@import '../src/styles/components.css';
CSS

node --input-type=module -e "
import esbuild from './.ds-sync/node_modules/esbuild/lib/main.js';
await esbuild.build({
  entryPoints: ['apps/desktop/.ds-css/_aggregate.css'],
  bundle: true,
  outfile: 'apps/desktop/.ds-css/flattened.css',
  loader: { '.css': 'css' },
  logLevel: 'warning',
});
"
echo "flattened: $(wc -c < apps/desktop/.ds-css/flattened.css) bytes, \
$(grep -oc '\.alm-' apps/desktop/.ds-css/flattened.css) .alm- rules"
