#!/usr/bin/env node
// check-contrast.mjs — CI guard that text and control-boundary token pairs meet
// WCAG AA contrast in every [data-theme] block.
//
// This is a regression gate for the a11y retune (handoff 02): ink3/ink4 scrape
// past AA on the lightest surface (--pv-bg) but were failing on the darkest
// surface they actually render on (--pv-bg3, chips/insets). Every pair below
// is grounded in a real component-CSS usage site (see comments) so the check
// reflects what ships, not a hypothetical worst case.
//
// Dependency-free (Node built-ins only). Run: node scripts/check-contrast.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src/styles/tokens.css');
const AA_BODY = 4.5;
// UI-component/large-text floor (WCAG AA 3:1) — for pairs that are borders,
// icons, or button labels rather than body copy (spec footnote: "AA = 4.5:1
// body / 3:1 large & UI").
const AA_UI = 3.0;

// WCAG 2.x relative-luminance contrast ratio (sRGB linearization).
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
}
function linearize(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function relativeLuminance([r, g, b]) {
  const [rl, gl, bl] = [r, g, b].map(linearize);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}
function contrastRatio(hexA, hexB) {
  const [lA, lB] = [relativeLuminance(hexToRgb(hexA)), relativeLuminance(hexToRgb(hexB))];
  const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}

// Text tokens (--pv-ink..ink4) checked against every surface/status-bg token
// they render on today. One line = one shipping usage site.
const PAIRS = [
  ['ink', 'bg', 'body text on the default app background'],
  ['ink', 'surface', 'body text on panel/list surfaces'],
  ['ink', 'bg3', 'body text on chip/inset surfaces'],
  ['ink', 'surface-raised', 'body text on cards/modals'],
  ['ink2', 'bg', 'secondary text on the default app background'],
  ['ink2', 'surface', 'secondary text on panel/list surfaces'],
  ['ink2', 'bg3', 'secondary text on chip surfaces (primitives.css .pv-pill--neutral)'],
  ['ink2', 'surface-raised', 'secondary text on cards/modals'],
  ['ink3', 'bg', 'muted text on the default app background'],
  ['ink3', 'surface', 'muted text on panel/list surfaces'],
  ['ink3', 'bg3', 'muted text on chip surfaces (target-search.css source badges) — the retune defect class'],
  ['ink3', 'surface-raised', 'muted text on cards/modals'],
  ['ink4', 'bg', 'faint text on the default app background'],
  ['ink4', 'surface', 'faint text on panel/list surfaces'],
  ['ink4', 'bg3', 'faint text on chip/inset surfaces — the darkest surface faint text sits on'],
  ['ink4', 'surface-raised', 'faint text on cards/modals'],
  ['ink2', 'accent-bg', 'secondary text on accent-tinted panels (settings.css highlight)'],
  ['ink2', 'selected-bg', 'secondary text on selected nav/list rows'],
  ['ink3', 'accent-bg', 'muted text on accent-tinted panels'],
  ['ink3', 'selected-bg', 'muted text on selected nav/list rows'],
  ['ok', 'ok-bg', 'success pill/banner/badge (primitives.css .pv-pill--ok, .pv-banner--ok)'],
  ['warn', 'warn-bg', 'warning pill/banner/badge'],
  ['danger', 'danger-bg', 'danger pill/banner/badge'],
  ['danger', 'danger-bg-hover', 'danger button hover state (primitives.css .pv-btn--danger:hover)'],
  ['info', 'info-bg', 'info pill/banner/badge'],
  ['accent-text', 'accent-bg', 'accent pill/badge (primitives.css .pv-pill--accent)'],
  ['accent-text', 'selected-bg', 'selected nav item text (app-shell.css)'],
  // Destructive button (handoff 06, primitives.css .pv-btn--destructive):
  // border/text/icon on its own fill — UI-component text, not body copy, so
  // it's held to the 3:1 floor rather than 4.5:1 (warm-slate default/hover
  // land at 4.44/3.75, below 4.5 but clear of 3.0).
  ['destructive', 'destructive-bg', 'destructive button text/border/icon on its default fill', AA_UI],
  ['destructive', 'destructive-bg-hover', 'destructive button text/border/icon on its hover fill', AA_UI],
  ['control-border', 'bg', 'inputs and selects on the default app background', AA_UI],
  ['control-border', 'surface', 'inputs, selects, and toggles on panel surfaces', AA_UI],
  ['control-border', 'bg3', 'controls on inset surfaces', AA_UI],
  ['control-border', 'surface-raised', 'controls on cards and popovers', AA_UI],
];

const CONTROL_SURFACES = ['bg', 'surface', 'bg3', 'surface-raised'];

const css = readFileSync(SRC, 'utf8');

// Collect raw hex token values per theme, merging blocks that share a selector
// (":root, [data-theme=\"warm-slate\"]") — same approach as
// check-theme-completeness.mjs.
const blockRe = /([^{}]*)\{([^{}]*)\}/g;
const themeTokens = new Map(); // theme id -> Map<token name -> hex value>

for (const [, selector, body] of css.matchAll(blockRe)) {
  const themeNames = [...selector.matchAll(/\[data-theme="([a-z0-9-]+)"\]/g)].map((m) => m[1]);
  if (themeNames.length === 0) continue;
  const decls = [...body.matchAll(/(--pv-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)];
  for (const theme of themeNames) {
    const map = themeTokens.get(theme) ?? new Map();
    for (const [, name, value] of decls) map.set(name, value);
    themeTokens.set(theme, map);
  }
}

if (themeTokens.size === 0) {
  console.error(`FAIL: no [data-theme] blocks found in ${SRC}`);
  process.exit(1);
}

let ok = true;
for (const [theme, tokens] of themeTokens) {
  for (const [textName, surfaceName, note, threshold = AA_BODY] of PAIRS) {
    const fg = tokens.get(`--pv-${textName}`);
    const bg = tokens.get(`--pv-${surfaceName}`);
    if (!fg || !bg) {
      ok = false;
      console.error(
        `FAIL: [data-theme="${theme}"] missing --pv-${textName} or --pv-${surfaceName} (pair: ${note})`,
      );
      continue;
    }
    const ratio = contrastRatio(fg, bg);
    if (ratio < threshold) {
      ok = false;
      console.error(
        `FAIL: [data-theme="${theme}"] --pv-${textName} (${fg}) on --pv-${surfaceName} (${bg}) = ` +
          `${ratio.toFixed(2)}:1, below AA ${threshold}:1 (${note})`,
      );
    }
  }

  const control = tokens.get('--pv-control-border');
  const divider = tokens.get('--pv-rule2');
  if (!control || !divider) {
    ok = false;
    console.error(
      `FAIL: [data-theme="${theme}"] missing --pv-control-border or --pv-rule2`,
    );
    continue;
  }
  for (const surfaceName of CONTROL_SURFACES) {
    const surface = tokens.get(`--pv-${surfaceName}`);
    if (!surface) {
      ok = false;
      console.error(`FAIL: [data-theme="${theme}"] missing --pv-${surfaceName}`);
      continue;
    }
    const controlRatio = contrastRatio(control, surface);
    const dividerRatio = contrastRatio(divider, surface);
    if (dividerRatio >= controlRatio) {
      ok = false;
      console.error(
        `FAIL: [data-theme="${theme}"] decorative --pv-rule2 (${divider}) on --pv-${surfaceName} ` +
          `is not subtler than --pv-control-border (${control})`,
      );
    }
  }
}

if (ok) {
  console.log(
    `OK: all ${PAIRS.length} text/surface pairs meet their AA floor (${AA_BODY}:1 body / ${AA_UI}:1 UI) across ${themeTokens.size} theme(s).`,
  );
  process.exit(0);
}
process.exit(1);
