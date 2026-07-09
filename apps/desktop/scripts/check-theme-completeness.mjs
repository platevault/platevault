#!/usr/bin/env node
// check-theme-completeness.mjs — CI guard that every [data-theme] block in
// tokens.css declares the full raw-palette token set.
//
// Warm Slate is the reference palette (it also backs the bare :root default,
// so the two share one declaration block). Every other theme MUST override the
// same raw tokens; a missing token silently falls back to Warm Slate's value
// and produces an off-theme color. This check fails the build on any omission.
//
// Dependency-free (Node built-ins only). Run: node scripts/check-theme-completeness.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src/styles/tokens.css');
const REFERENCE = 'warm-slate';

const css = readFileSync(SRC, 'utf8');

// Collect every declaration block whose selector targets a [data-theme="..."].
// The raw-token blocks contain no nested braces, so a flat selector{body} match
// is sufficient. One block may name several themes (e.g. ":root,
// [data-theme=\"warm-slate\"]"), so a token set is merged per theme name.
const blockRe = /([^{}]*)\{([^{}]*)\}/g;
const themeTokens = new Map(); // theme id -> Set<token name>

for (const [, selector, body] of css.matchAll(blockRe)) {
  const themeNames = [...selector.matchAll(/\[data-theme="([a-z0-9-]+)"\]/g)].map((m) => m[1]);
  if (themeNames.length === 0) continue;
  const tokens = [...body.matchAll(/(--alm-[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
  for (const theme of themeNames) {
    const set = themeTokens.get(theme) ?? new Set();
    for (const t of tokens) set.add(t);
    themeTokens.set(theme, set);
  }
}

const reference = themeTokens.get(REFERENCE);
if (!reference || reference.size === 0) {
  console.error(`FAIL: reference theme "${REFERENCE}" not found (or empty) in ${SRC}`);
  process.exit(1);
}

let ok = true;
for (const [theme, tokens] of themeTokens) {
  if (theme === REFERENCE) continue;
  const missing = [...reference].filter((t) => !tokens.has(t)).sort();
  if (missing.length > 0) {
    ok = false;
    console.error(`FAIL: [data-theme="${theme}"] is missing ${missing.length} token(s):`);
    for (const t of missing) console.error(`  ${t}`);
  }
}

if (ok) {
  console.log(
    `OK: all themes declare the ${reference.size} raw tokens from "${REFERENCE}" ` +
      `(${[...themeTokens.keys()].filter((t) => t !== REFERENCE).length} theme(s) checked).`,
  );
  process.exit(0);
}
process.exit(1);
