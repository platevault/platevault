#!/usr/bin/env bash
# Regenerate the flattened design-system stylesheet that cfg.cssEntry points at.
# The design-sync converter copies cssEntry VERBATIM (it does not resolve @import),
# so we pre-flatten reset + tokens + components (the .pv-* classes) into one file.
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
  // tokens.css @font-faces the bundled Inter .woff2 files (spec 055). esbuild has no
  // loader for those and hard-fails the whole flatten unless they stay external. External
  // is also what we want: the design project serves its own copies from fonts/, so the
  // url()s are rewritten on upload rather than inlined or hashed here.
  external: ['*.woff2'],
  logLevel: 'warning',
});
"
rules=$(grep -o '\.pv-[a-z0-9-]*' apps/desktop/.ds-css/flattened.css | sort -u | wc -l)
echo "flattened: $(wc -c < apps/desktop/.ds-css/flattened.css) bytes, ${rules} distinct .pv- classes"

# The failure this guards against is silent: if the aggregate stops resolving
# components.css, the build still succeeds and ships a bundle with tokens but no
# component classes. Anything below a floor means the flatten did not work.
if [ "$rules" -lt 20 ]; then
  echo "ERROR: only ${rules} .pv- classes in flattened.css — the component partials did not inline." >&2
  exit 1
fi
