// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Vanilla-extract styles for SortHeader — replaces .pv-sorth* in tables-lists.css.
 * Single consumer: src/components/SortHeader.tsx.
 */

import { style } from '@vanilla-extract/css';
import { uvars, vars } from '@/styles/themes.css';

export const root = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: uvars.sp1,
  // The button is an atomic box, so the `overflow: hidden; text-overflow:
  // ellipsis` on `.pv-table th` could only chop it mid-glyph — a header read as
  // "BINNIN(". Bounding it to the column and letting the label shrink moves the
  // truncation onto text, where an ellipsis and a tooltip mean something.
  maxWidth: '100%',
  minWidth: 0,
  background: 'none',
  border: 'none',
  padding: 0,
  margin: 0,
  font: 'inherit',
  color: 'inherit',
  textTransform: 'inherit',
  letterSpacing: 'inherit',
  cursor: 'pointer',
  selectors: { '&:hover': { color: vars.text } },
});

export const active = style({
  color: vars.text,
});

/** The shrinking part: the column name ellipsizes, the sort arrow never does. */
export const label = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const arrow = style({
  fontSize: uvars.textXs,
  color: vars.textMuted,
  flexShrink: 0,
});
