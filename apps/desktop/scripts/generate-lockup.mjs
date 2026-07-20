#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only
//
// Generates the horizontal brand lockup (pv-mark-two-tone + outlined
// "PlateVault" wordmark) as a standalone SVG — no in-app UI consumes this
// yet; it exists so marketing/docs surfaces (README, release notes, a future
// hosted page) have one canonical mark+wordmark asset instead of hand-
// assembling the two pieces per use. Transparent background (unlike the
// icon tile / og-image) so it composites over any surface.
//
// pv-mark-two-tone.svg (icons/src/, hand-copied from the design handoff) is
// styled for CSS contexts — `currentColor` / `var(--pv-acc, currentColor)` —
// which resolve to nothing useful in a standalone file with no surrounding
// stylesheet, so both are baked to concrete brand colors here. The wordmark
// reuses lib/wordmark.mjs's outliner (shared with generate-splash-
// wordmark.mjs) so the glyph shapes never drift between splash, lockup, and
// og-image.
//
// Run: node scripts/generate-lockup.mjs  (from apps/desktop/, wired as the
// `lockup:generate` package script)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FRAME, CONSTEL } from './lib/brand-mark.mjs';
import { wordmarkPaths } from './lib/wordmark.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const twoToneSvgPath = join(__dirname, '..', 'src-tauri', 'icons', 'src', 'pv-mark-two-tone.svg');
const outDir = join(__dirname, '..', 'public', 'brand');

const MARK_SIZE = 96;
const GROUP_GAP = 20;
// Same 34px/43.38px splash ratio, scaled to read at lockup size.
const WORDMARK_FONT_SIZE = 56;

function markInner(svgSource) {
  const inner = svgSource.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  if (!inner) throw new Error('unrecognized pv-mark-two-tone.svg structure');
  return inner[1]
    .replaceAll('var(--pv-acc, currentColor)', CONSTEL)
    .replaceAll('currentColor', FRAME);
}

function lockupSvg(mark, wordmark) {
  const height = Math.max(MARK_SIZE, wordmark.height);
  const width = MARK_SIZE + GROUP_GAP + wordmark.width;
  const markScaleFactor = MARK_SIZE / 64;
  const markY = (height - MARK_SIZE) / 2;
  const wordX = MARK_SIZE + GROUP_GAP;
  const wordY = (height - wordmark.height) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(2)}" height="${height.toFixed(2)}" viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}" role="img" aria-label="PlateVault">
<g transform="translate(0 ${markY}) scale(${markScaleFactor})">
${mark}
</g>
<g transform="translate(${wordX} ${wordY})">
<path d="${wordmark.plateD}" fill="${FRAME}"></path>
<path d="${wordmark.vaultD}" fill="${CONSTEL}"></path>
</g>
</svg>
`;
}

function main() {
  mkdirSync(outDir, { recursive: true });

  const mark = markInner(readFileSync(twoToneSvgPath, 'utf8'));
  const wordmark = wordmarkPaths({ fontSize: WORDMARK_FONT_SIZE });
  const svg = lockupSvg(mark, wordmark);

  const outPath = join(outDir, 'lockup.svg');
  writeFileSync(outPath, svg);

  // eslint-disable-next-line no-console
  console.log(`lockup.svg  sha256:${createHash('sha256').update(svg).digest('hex')}`);
}

main();
