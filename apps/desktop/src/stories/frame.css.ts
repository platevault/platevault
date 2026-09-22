// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Layout for the component workbench only. Every value comes from the shared
 * token scale, so a story frame repaints with the rest of the product when the
 * appearance changes and never introduces a second visual convention.
 */

import { style } from '@vanilla-extract/css';
import { uvars, vars } from '@/styles/themes.css';

export const stage = style({
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100vh',
  background: vars.bg,
  color: vars.text,
  fontFamily: uvars.fontSans,
  fontSize: uvars.textSm,
});

export const pad = style({
  padding: uvars.sp5,
  background: vars.bg,
  color: vars.text,
  fontFamily: uvars.fontSans,
  fontSize: uvars.textSm,
});

export const stack = style({
  display: 'flex',
  flexDirection: 'column',
  gap: uvars.sp3,
  alignItems: 'flex-start',
});

export const row = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: uvars.sp2,
  alignItems: 'center',
});

export const panel = style({
  border: `1px solid ${vars.border}`,
  borderRadius: uvars.radiusMd,
  background: vars.surface,
  padding: uvars.sp3,
  minWidth: 0,
});

export const caption = style({
  fontSize: uvars.textXs,
  letterSpacing: uvars.trackingNormal,
  textTransform: 'uppercase',
  color: vars.textMuted,
  fontWeight: uvars.weightSemibold,
});

export const note = style({
  fontSize: uvars.textXs,
  lineHeight: uvars.leadingRelaxed,
  color: vars.textSecondary,
  maxWidth: '68ch',
});

export const matrix = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(9rem, max-content) 1fr',
  gap: `${uvars.sp3} ${uvars.sp4}`,
  alignItems: 'center',
  width: '100%',
});

export const matrixLabel = style({
  fontSize: uvars.textXs,
  color: vars.textMuted,
  fontFamily: uvars.fontSans,
  justifySelf: 'end',
  textAlign: 'right',
});

export const scrollBox = style({
  overflow: 'auto',
  minHeight: 0,
  flex: 1,
});
