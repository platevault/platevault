// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only
//
// Shared "PlateVault" wordmark outliner. Extracted from
// generate-splash-wordmark.mjs once a second consumer (generate-lockup.mjs)
// needed the identical glyph shapes at a different size — every call site
// must render the same shapes with no font dependency (docs repo's
// src/assets/brand/README.md: "Wordmark is always outlined paths, never
// live text").
//
// fontkit, not opentype.js: opentype.js 2.x corrupts a later glyph's curve
// data when outlining "Vault" after a prior glyph lookup in the same
// process for this exact font+string (reproducible truncation, discovered
// building the docs repo generator). fontkit (the pdfkit/foliojs shaping
// engine) outlines the same file correctly.

import { fileURLToPath } from 'node:url';
import * as fontkitNs from 'fontkit';

// fontkit's CJS export shape isn't reliably synthesized as a default export
// under Node's ESM loader — grab the namespace and unwrap.
const fontkit = fontkitNs.default ?? fontkitNs;

export const FRAME_COLOR = '#f0ebe2';
export const ACCENT_COLOR = '#e8a86a';

const PLATE_GLYPH_COUNT = 'Plate'.length;

/**
 * Outlines "Plate" and "Vault" as two path `d` strings sharing one
 * continuous shaped run (so kerning across the "e"/"V" boundary matches a
 * single "PlateVault" render). Paths are pre-translated so the baseline
 * sits at y=ascender, i.e. they drop directly into a `viewBox="0 0 width
 * height"` with no further offset needed at the call site.
 */
export function wordmarkPaths({ fontSize, letterSpacingEm = -0.02 }) {
  const woffUrl = import.meta.resolve(
    '@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff',
  );
  const font = fontkit.openSync(fileURLToPath(woffUrl));
  const scale = fontSize / font.unitsPerEm;
  const ascender = (font.ascent / font.unitsPerEm) * fontSize;
  const descender = (font.descent / font.unitsPerEm) * fontSize;
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
    x += run.positions[i].xAdvance * scale + letterSpacingEm * fontSize;
  }
  // letterSpacing was added after the *last* glyph too — that's the width of
  // the shaped run for advance purposes but not the visual ink extent.
  const width = x - letterSpacingEm * fontSize;

  return { plateD, vaultD, width, height: ascender - descender };
}
