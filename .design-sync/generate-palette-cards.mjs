#!/usr/bin/env node
// Generate the design project's palette cards from the app's own tokens.
//
// These cards were hand-authored once and then drifted: they missed the whole
// destructive family, carried a pre-correction Warm Clay red, and covered only
// four of the six themes. Hand-deriving them again would drift again, so this
// reads both sources of truth instead:
//
//   apps/desktop/src/styles/tokens.css   -> the per-theme raw palette values
//   apps/desktop/src/data/theme.ts       -> THEMES (id, label, mode) registry
//
// A theme added to the registry and tokens.css therefore gets a card for free.
//
// Usage: node .design-sync/generate-palette-cards.mjs [--out DIR]
//        (run from the repo root; writes app-<theme>.html per theme)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const TOKENS = 'apps/desktop/src/styles/tokens.css';
const REGISTRY = 'apps/desktop/src/data/theme.ts';

const outArg = process.argv.indexOf('--out');
const OUT = outArg === -1 ? '.ds-css/palettes' : process.argv[outArg + 1];

/** Swatch order. Grouped as surfaces -> ink -> line -> accent -> status, which
 *  is how the cards read left-to-right. A token absent from a theme is skipped
 *  rather than rendered empty. */
const SWATCHES = [
  'bg', 'surface', 'surface-raised', 'bg3',
  'ink', 'ink2', 'ink3', 'ink4',
  'rule',
  'accent', 'accent-hover', 'accent-deep', 'accent-bg', 'accent-text', 'on-accent',
  'ok', 'warn', 'danger', 'info',
  'destructive', 'destructive-bg',
];

/** Parse `--pv-name: value;` pairs out of one CSS block body. */
function parseDecls(body) {
  const out = {};
  for (const m of body.matchAll(/--pv-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

function blockBody(css, selector) {
  const i = css.indexOf(selector);
  if (i === -1) return null;
  const start = css.indexOf('{', i);
  const end = css.indexOf('}', start);
  return start === -1 || end === -1 ? null : css.slice(start + 1, end);
}

/** Resolve one level of `var(--pv-x)` against the theme, then :root. */
function resolve(value, theme, root) {
  const m = /^var\(\s*--pv-([a-z0-9-]+)\s*\)$/.exec(value);
  if (!m) return value;
  return theme[m[1]] ?? root[m[1]] ?? value;
}

const css = readFileSync(TOKENS, 'utf8');
const root = parseDecls(blockBody(css, ':root') ?? '');

// Pull the registry entries without importing TypeScript: id/label/mode only.
const registrySrc = readFileSync(REGISTRY, 'utf8');
const themes = [
  ...registrySrc.matchAll(
    /id:\s*'([a-z-]+)',\s*\n\s*label:\s*'([^']+)',\s*\n\s*mode:\s*'(light|dark)'/g,
  ),
].map(([, id, label, mode]) => ({ id, label, mode }));

if (themes.length === 0) {
  console.error(`ERROR: parsed 0 themes from ${REGISTRY} — the registry shape changed.`);
  process.exit(1);
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

mkdirSync(OUT, { recursive: true });
let written = 0;
const problems = [];

for (const { id, label, mode } of themes) {
  const body = blockBody(css, `[data-theme="${id}"]`);
  if (!body) {
    problems.push(`${id}: in the registry but has no [data-theme] block in tokens.css`);
    continue;
  }
  const theme = parseDecls(body);
  const val = (name) => {
    const raw = theme[name] ?? root[name];
    return raw === undefined ? undefined : resolve(raw, theme, root);
  };

  // Card chrome uses the theme's own colours, so each card previews itself.
  const bg = val('bg');
  const surface = val('surface');
  const ink = val('ink');
  const ink3 = val('ink3');
  const rule = val('rule');
  const accent = val('accent');
  const onAccent = val('on-accent');

  if (!val('destructive')) {
    problems.push(`${id}: no --pv-destructive (every theme should define it)`);
  }

  const chips = SWATCHES.map((name) => {
    const v = val(name);
    if (!v) return null;
    return `      <div class="sw"><div class="chip" style="background:${v}"></div>` +
      `<div class="meta"><b>${esc(name)}</b><span>${esc(v)}</span></div></div>`;
  }).filter(Boolean).join('\n');

  const html = `<!-- @dsCard group="Palettes" -->
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>App — ${esc(label)} (${mode})</title>
<style>
@import url('../fonts/fonts.css');
  html, body { margin:0; padding:0; }
  body { background:${bg}; color:${ink}; font-family:'Inter', system-ui, sans-serif; padding:20px 22px; }
  h1 { font-size:15px; margin:0 0 2px; letter-spacing:-0.02em; }
  p.note { font-size:11px; color:${ink3}; margin:0 0 14px; max-width:52em; line-height:1.45; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(128px, 1fr)); gap:10px; }
  .sw { border:1px solid ${rule}; border-radius:8px; overflow:hidden; background:${surface}; }
  .chip { height:44px; }
  .meta { padding:6px 8px; font-size:10px; display:flex; flex-direction:column; gap:1px; }
  .meta b { font-weight:600; }
  .meta span { color:${ink3}; font-family:ui-monospace, monospace; font-size:9px; }
  .accentbar { margin-top:14px; padding:10px 12px; border-radius:8px;
               background:${accent}; color:${onAccent};
               font-size:12px; font-weight:600; letter-spacing:-0.01em; }
</style>
</head>
<body>
  <h1>App — ${esc(label)} (${mode})</h1>
  <p class="note">Generated from <code>${TOKENS}</code> — do not hand-edit. Raw palette tokens for the <code>${esc(id)}</code> theme, on the <code>--pv-*</code> contract.</p>
  <div class="grid">
${chips}</div>
  <div class="accentbar">PlateVault — ${esc(label)} · every frame accounted for</div>
</body>
</html>
`;

  writeFileSync(join(OUT, `app-${id}.html`), html);
  written += 1;
}

console.log(`generated ${written} palette card(s) into ${OUT}`);
for (const p of problems) console.warn(`WARN ${p}`);

// A silent partial run is the failure mode that produced the stale set in the
// first place: fewer cards than themes looks like success at a glance.
if (written !== themes.length) {
  console.error(`ERROR: ${themes.length} themes in the registry but ${written} cards written.`);
  process.exit(1);
}
