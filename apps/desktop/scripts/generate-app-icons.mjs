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
// constellation, per handoff/assets/README.md.
//
// Run: node scripts/generate-app-icons.mjs  (from apps/desktop/)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'src-tauri', 'icons');
const srcDir = join(iconsDir, 'src');

/**
 * pv-mark.svg / pv-mark-favicon.svg both follow the fixed shape emitted by
 * the design tool: a single `<g transform="rotate(-9 32 32)">` wrapping the
 * frame `<path>`, then the constellation `<path>` + `<g fill=...>` star/dot
 * cluster. Splitting frame vs. constellation lets us recolor them
 * independently per brand-assets-spec.txt (frame and constellation are two
 * different colors on every tile treatment).
 */
function splitMark(svgSource) {
  const inner = svgSource.match(/<g transform="rotate\(-9 32 32\)">([\s\S]*)<\/g>\s*<\/svg>/);
  if (!inner) throw new Error('unrecognized mark SVG structure');
  const body = inner[1];
  const dotsGroupIndex = body.indexOf('<g fill="currentColor">');
  if (dotsGroupIndex === -1) throw new Error('unexpected mark SVG structure: no dots group');
  const directChildren = body.slice(0, dotsGroupIndex);
  const dotsGroup = body.slice(dotsGroupIndex);
  const paths = [...directChildren.matchAll(/<path[^>]*><\/path>/g)].map((m) => m[0]);
  if (paths.length !== 2) throw new Error('unexpected mark SVG child count');
  const [framePath, constelLinePath] = paths;
  return {
    frame: framePath,
    // constellation = the connecting lines + the star/dot cluster
    constellation: constelLinePath + dotsGroup,
  };
}

function recolor(svgFragment, color) {
  return svgFragment.replace(/currentColor/g, color);
}

const mainMark = splitMark(readFileSync(join(srcDir, 'pv-mark.svg'), 'utf8'));
const minMark = splitMark(readFileSync(join(srcDir, 'pv-mark-favicon.svg'), 'utf8'));

// Warm tile background — brand-assets-spec.txt §04:
//   radial-gradient(130% 120% at 50% 0%, #2c2620, #17140f)
// SVG radialGradient only has a single radius; approximate the 130%/120%
// ellipse by stretching a circular gradient horizontally around the same
// focal point (ratio 130/120 ~= 1.083). Close enough for a soft vignette —
// not pixel-identical to the CSS ellipse, and that's an acceptable
// approximation for a background glow.
function warmTileSvg(size, mark, { markScale, frameColor, constelColor }) {
  const r = size * 0.6;
  const cx = size * 0.5;
  const cy = 0;
  const markSize = size * markScale;
  const offset = (size - markSize) / 2;
  // mark source viewBox is 0 0 64 64 (pv-mark.svg) — scale from that space
  // into markSize px, not `markScale` directly.
  const markScaleFactor = markSize / 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<defs>
<radialGradient id="tile" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse" gradientTransform="translate(${cx} ${cy}) scale(1.083 1) translate(${-cx} ${-cy})">
<stop offset="0%" stop-color="#2c2620"/>
<stop offset="100%" stop-color="#17140f"/>
</radialGradient>
</defs>
<rect width="${size}" height="${size}" fill="url(#tile)"/>
<g transform="translate(${offset} ${offset}) scale(${markScaleFactor})">
${recolor(mark.frame, frameColor)}
${recolor(mark.constellation, constelColor)}
</g>
</svg>`;
}

// mark ~65% of tile per brand-assets-spec.txt §04 demo proportions
// (98/150, 80/120, 32/48 all land near 0.65-0.67); the 16px favicon-min mark
// fills the tile with no inset, matching the "16 * tile" demo.
const FRAME = '#f4efe6';
const CONSTEL = '#e0913f';

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
  const png16 = await rasterize(16, { mark: minMark, markScale: 1 });
  const png24 = await rasterize(24, { mark: mainMark, markScale: 0.65 });
  const png48 = await rasterize(48, { mark: mainMark, markScale: 0.65 });

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

  const checksums = Object.entries({ ...outputs, 'icon.ico': icoBuffer }).map(
    ([name, buf]) => `${name}  sha256:${createHash('sha256').update(buf).digest('hex')}`,
  );
  // eslint-disable-next-line no-console
  console.log(checksums.join('\n'));
}

await main();
