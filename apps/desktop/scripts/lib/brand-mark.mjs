// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only
//
// Shared pv-mark ingredients for every generated brand-tile surface (app
// icons, og-image) so the frame/constellation split, brand colors, and warm
// vignette gradient never drift between surfaces. Extracted from
// generate-app-icons.mjs once a second consumer (generate-og-image.mjs)
// needed the identical treatment — see that script's doc comment for the
// gradient/color rationale.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// mark ~65% of tile per brand-assets-spec.txt §04 demo proportions
// (98/150, 80/120, 32/48 all land near 0.65-0.67).
export const FRAME = '#f4efe6';
export const CONSTEL = '#e0913f';

/**
 * pv-mark.svg / pv-mark-favicon.svg both follow the fixed shape emitted by
 * the design tool: a single `<g transform="rotate(-9 32 32)">` wrapping the
 * frame `<path>`, then the constellation `<path>` + `<g fill=...>` star/dot
 * cluster. Splitting frame vs. constellation lets us recolor them
 * independently per brand-assets-spec.txt (frame and constellation are two
 * different colors on every tile treatment).
 */
export function splitMark(svgSource) {
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

export function recolor(svgFragment, color) {
  return svgFragment.replace(/currentColor/g, color);
}

/** Loads and splits both source marks from icons/src/ (srcDir). */
export function loadMarks(srcDir) {
  const mainMark = splitMark(readFileSync(join(srcDir, 'pv-mark.svg'), 'utf8'));
  const minMark = splitMark(readFileSync(join(srcDir, 'pv-mark-favicon.svg'), 'utf8'));
  return { mainMark, minMark };
}

// Warm tile background — brand-assets-spec.txt §04:
//   radial-gradient(130% 120% at 50% 0%, #2c2620, #17140f)
// SVG radialGradient only has a single radius; approximate the 130%/120%
// ellipse by stretching a circular gradient horizontally around the same
// focal point (ratio 130/120 ~= 1.083). Close enough for a soft vignette —
// not pixel-identical to the CSS ellipse, and that's an acceptable
// approximation for a background glow. Parameterized by width/height so
// non-square canvases (og-image) get the same formula, not a re-derived one.
export function warmGradientDefs(gradientId, width, height) {
  const r = Math.max(width, height) * 0.6;
  const cx = width / 2;
  const cy = 0;
  return `<defs>
<radialGradient id="${gradientId}" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse" gradientTransform="translate(${cx} ${cy}) scale(1.083 1) translate(${-cx} ${-cy})">
<stop offset="0%" stop-color="#2c2620"/>
<stop offset="100%" stop-color="#17140f"/>
</radialGradient>
</defs>`;
}
