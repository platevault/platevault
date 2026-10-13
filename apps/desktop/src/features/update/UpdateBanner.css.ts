// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { style } from '@vanilla-extract/css';
import { uvars } from '@/styles/themes.css';

export const banner = style({
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
});

export const text = style({
  display: 'flex',
  flexDirection: 'column',
  gap: uvars.sp1,
  minWidth: 0,
});

export const notes = style({
  margin: 0,
  maxHeight: '8rem',
  overflowY: 'auto',
  whiteSpace: 'pre-wrap',
});

export const actions = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: uvars.sp2,
});
