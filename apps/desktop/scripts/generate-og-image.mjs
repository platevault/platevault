#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only
//
// Generates the Open Graph / Twitter share image referenced by index.html's
// og:image meta tag. Composes the same warm-tile pv-mark treatment as
// generate-app-icons.mjs (shared via lib/brand-mark.mjs) plus the outlined
// "PlateVault" wordmark (shared via lib/wordmark.mjs) at the 1200x630 size
// the major share-preview surfaces (Facebook/LinkedIn/Slack/Discord,
// Twitter's summary_large_image) all expect — deliberately not a new visual
// style, just those same ingredients at share-image proportions.
//
// Run: node scripts/generate-og-image.mjs  (from apps/desktop/, wired as
// the `og:generate` package script)

import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { FRAME, CONSTEL, loadMarks, recolor, warmGradientDefs } from './lib/brand-mark.mjs';
import { wordmarkPaths } from './lib/wordmark.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsSrcDir = join(__dirname, '..', 'src-tauri', 'icons', 'src');
const outDir = join(__dirname, '..', 'public', 'brand');

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
// Mark ~48% of canvas height — the icon tile uses ~65% of a square tile;
// widescreen has room for the wordmark alongside instead, so the mark reads
// smaller relative to the whole canvas.
const MARK_SIZE = 300;
const GROUP_GAP = 56;
// Wordmark FONT_SIZE chosen so its outlined height reads at a similar visual
// weight to MARK_SIZE (same 34px/43.38px ratio as splash.html, scaled up).
const WORDMARK_FONT_SIZE = 104;

function ogSvg(mark, wordmark) {
  const markScaleFactor = MARK_SIZE / 64;
  const totalWidth = MARK_SIZE + GROUP_GAP + wordmark.width;
  const groupX = (OG_WIDTH - totalWidth) / 2;
  const markY = (OG_HEIGHT - MARK_SIZE) / 2;
  const wordX = groupX + MARK_SIZE + GROUP_GAP;
  const wordY = (OG_HEIGHT - wordmark.height) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
${warmGradientDefs('og-tile', OG_WIDTH, OG_HEIGHT)}
<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#og-tile)"/>
<g transform="translate(${groupX} ${markY}) scale(${markScaleFactor})">
${recolor(mark.frame, FRAME)}
${recolor(mark.constellation, CONSTEL)}
</g>
<g transform="translate(${wordX} ${wordY})">
<path d="${wordmark.plateD}" fill="${FRAME}"></path>
<path d="${wordmark.vaultD}" fill="${CONSTEL}"></path>
</g>
</svg>`;
}

async function main() {
  mkdirSync(outDir, { recursive: true });

  const { mainMark } = loadMarks(iconsSrcDir);
  const wordmark = wordmarkPaths({ fontSize: WORDMARK_FONT_SIZE });
  const svg = ogSvg(mainMark, wordmark);
  const png = await sharp(Buffer.from(svg)).resize(OG_WIDTH, OG_HEIGHT).png().toBuffer();

  const outPath = join(outDir, 'og-image.png');
  writeFileSync(outPath, png);

  // eslint-disable-next-line no-console
  console.log(`og-image.png  sha256:${createHash('sha256').update(png).digest('hex')}`);
}

await main();
