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
//
// Glyph outlining itself lives in lib/wordmark.mjs (shared with
// generate-lockup.mjs); this script only owns the splash-specific splicing.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { wordmarkPaths, FRAME_COLOR, ACCENT_COLOR } from './lib/wordmark.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const splashPath = join(__dirname, '..', 'splash.html');

// Matches the splash CSS this replaces (previously .pv-wordmark's
// font-size/letter-spacing) — see splash.html's pv-content layout.
const FONT_SIZE = 34;

const START_MARKER = '<!-- pv-wordmark:generated:start -->';
const END_MARKER = '<!-- pv-wordmark:generated:end -->';

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
  const svg = wordmarkSvg(wordmarkPaths({ fontSize: FONT_SIZE }));
  const next = html.slice(0, startIdx) + svg + html.slice(endIdx + END_MARKER.length);
  writeFileSync(splashPath, next);
  // eslint-disable-next-line no-console
  console.log('splash.html pv-wordmark regenerated');
}

main();
