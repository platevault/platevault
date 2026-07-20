#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only
//
// Regenerates every rasterized app icon from the canonical pv-mark master
// SVGs in icons/src/ (never hand-edited — copied verbatim from the design
// handoff). Composes the warm app-tile treatment per brand-assets-spec.txt
// §04 and rasterizes with sharp; the .ico is assembled from those same
// buffers with png-to-ico so the 16px slot can use the dedicated favicon-
// reduction mark (pv-mark-favicon.svg) while 32px+ keep the full
// constellation, per handoff/assets/README.md. The .icns (macOS bundle icon)
// is built from the same 1024px raster with png2icons — Tauri's bundler
// targets "all" platforms but had no .icns source until this addition.
//
// Run: node scripts/generate-app-icons.mjs  (from apps/desktop/)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import png2icons from 'png2icons';
import { FRAME, CONSTEL, loadMarks, recolor, warmGradientDefs } from './lib/brand-mark.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'src-tauri', 'icons');
const srcDir = join(iconsDir, 'src');

const { mainMark, minMark } = loadMarks(srcDir);

function warmTileSvg(size, mark, { markScale, frameColor, constelColor }) {
  const markSize = size * markScale;
  const offset = (size - markSize) / 2;
  // mark source viewBox is 0 0 64 64 (pv-mark.svg) — scale from that space
  // into markSize px, not `markScale` directly.
  const markScaleFactor = markSize / 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
${warmGradientDefs('tile', size, size)}
<rect width="${size}" height="${size}" fill="url(#tile)"/>
<g transform="translate(${offset} ${offset}) scale(${markScaleFactor})">
${recolor(mark.frame, frameColor)}
${recolor(mark.constellation, constelColor)}
</g>
</svg>`;
}

async function rasterize(size, { mark, markScale }) {
  const svg = warmTileSvg(size, mark, { markScale, frameColor: FRAME, constelColor: CONSTEL });
  return sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
}

async function main() {
  mkdirSync(iconsDir, { recursive: true });

  const png32 = await rasterize(32, { mark: mainMark, markScale: 0.65 });
  const png128 = await rasterize(128, { mark: mainMark, markScale: 0.65 });
  const png256 = await rasterize(256, { mark: mainMark, markScale: 0.65 });
  const png512 = await rasterize(512, { mark: mainMark, markScale: 0.65 });
  // favicon-min mark fills the 16px tile with no inset, matching the
  // "16 * tile" demo proportion in brand-assets-spec.txt §04.
  const png16 = await rasterize(16, { mark: minMark, markScale: 1 });
  const png24 = await rasterize(24, { mark: mainMark, markScale: 0.65 });
  const png48 = await rasterize(48, { mark: mainMark, markScale: 0.65 });
  // 1024px source is png2icons' recommended ICNS input size (its own docs
  // note anything smaller downscales the largest macOS slots).
  const png1024 = await rasterize(1024, { mark: mainMark, markScale: 0.65 });

  const outputs = {
    '32x32.png': png32,
    '128x128.png': png128,
    '128x128@2x.png': png256,
    'icon.png': png512,
  };
  for (const [name, buf] of Object.entries(outputs)) {
    writeFileSync(join(iconsDir, name), buf);
  }

  const icoBuffer = await pngToIco([png16, png24, png32, png48, png256]);
  writeFileSync(join(iconsDir, 'icon.ico'), icoBuffer);

  const icnsBuffer = png2icons.createICNS(png1024, png2icons.BILINEAR, 0);
  if (!icnsBuffer) throw new Error('png2icons failed to produce an ICNS buffer');
  writeFileSync(join(iconsDir, 'icon.icns'), icnsBuffer);

  const checksums = Object.entries({ ...outputs, 'icon.ico': icoBuffer, 'icon.icns': icnsBuffer }).map(
    ([name, buf]) => `${name}  sha256:${createHash('sha256').update(buf).digest('hex')}`,
  );
  // eslint-disable-next-line no-console
  console.log(checksums.join('\n'));
}

await main();
