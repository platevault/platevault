#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only
//
// Outlines the splash window's "PlateVault" wordmark as SVG paths and
// splices the result into splash.html between the generated-content
// markers. Space Grotesk 700, -0.02em — mirrors the docs repo's lockup
// wordmark outliner (platevault.github.io/scripts/brand/wordmark.mjs) so
// splash, lockups, and og-image render the identical glyph shapes with no
// font dependency at the point of use (docs repo's
// src/assets/brand/README.md: "Wordmark is always outlined paths, never
// live text — it must render identically with no font dependency").
//
// fontkit, not opentype.js: opentype.js 2.x corrupts a later glyph's curve
// data when outlining "Vault" after a prior glyph lookup in the same
// process for this exact font+string (reproducible truncation, discovered
// building the docs repo generator). fontkit (the pdfkit/foliojs shaping
// engine) outlines the same file correctly.
//
// Run: node scripts/generate-splash-wordmark.mjs  (from apps/desktop/,
// wired as the `wordmark:generate` package script)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as fontkitNs from 'fontkit';

// fontkit's CJS export shape isn't reliably synthesized as a default export
// under Node's ESM loader — grab the namespace and unwrap.
const fontkit = fontkitNs.default ?? fontkitNs;

const __dirname = dirname(fileURLToPath(import.meta.url));
const splashPath = join(__dirname, '..', 'splash.html');

// Matches the splash CSS this replaces (previously .pv-wordmark's
// font-size/letter-spacing) — see splash.html's pv-content layout.
const FONT_SIZE = 34;
const LETTER_SPACING_EM = -0.02;
const PLATE_GLYPH_COUNT = 'Plate'.length;
const FRAME_COLOR = '#f0ebe2';
const ACCENT_COLOR = '#e8a86a';

const START_MARKER = '<!-- pv-wordmark:generated:start -->';
const END_MARKER = '<!-- pv-wordmark:generated:end -->';

/**
 * Outlines "Plate" and "Vault" as two path `d` strings sharing one
 * continuous shaped run (so kerning across the "e"/"V" boundary matches a
 * single "PlateVault" render). Paths are pre-translated so the baseline
 * sits at y=ascender, i.e. they drop directly into a `viewBox="0 0 width
 * height"` with no further offset needed at the call site.
 */
function wordmarkPaths() {
  const woffUrl = import.meta.resolve(
    '@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff',
  );
  const font = fontkit.openSync(fileURLToPath(woffUrl));
  const scale = FONT_SIZE / font.unitsPerEm;
  const ascender = (font.ascent / font.unitsPerEm) * FONT_SIZE;
  const descender = (font.descent / font.unitsPerEm) * FONT_SIZE;
  const run = font.layout('PlateVault');

  let x = 0;
  let plateD = '';
  let vaultD = '';
  for (let i = 0; i < run.glyphs.length; i++) {
    const glyph = run.glyphs[i];
    const path = glyph.path.scale(scale, -scale).translate(x, ascender);
    if (i < PLATE_GLYPH_COUNT) {
      plateD += path.toSVG();
    } else {
      vaultD += path.toSVG();
    }
    x += run.positions[i].xAdvance * scale + LETTER_SPACING_EM * FONT_SIZE;
  }
  // letterSpacing was added after the *last* glyph too — that's the width of
  // the shaped run for advance purposes but not the visual ink extent.
  const width = x - LETTER_SPACING_EM * FONT_SIZE;

  return { plateD, vaultD, width, height: ascender - descender };
}

function wordmarkSvg({ plateD, vaultD, width, height }) {
  const w = width.toFixed(2);
  const h = height.toFixed(2);
  return `${START_MARKER}
        <svg class="pv-wordmark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="PlateVault">
          <path d="${plateD}" fill="${FRAME_COLOR}"></path>
          <path d="${vaultD}" fill="${ACCENT_COLOR}"></path>
        </svg>
        ${END_MARKER}`;
}

function main() {
  const html = readFileSync(splashPath, 'utf8');
  const startIdx = html.indexOf(START_MARKER);
  const endIdx = html.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`splash.html is missing ${START_MARKER} / ${END_MARKER} markers`);
  }
  const svg = wordmarkSvg(wordmarkPaths());
  const next = html.slice(0, startIdx) + svg + html.slice(endIdx + END_MARKER.length);
  writeFileSync(splashPath, next);
  // eslint-disable-next-line no-console
  console.log('splash.html pv-wordmark regenerated');
}

main();
