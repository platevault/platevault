// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { style } from '@vanilla-extract/css';
import { vars } from '@/styles/themes.css';

export const fixtureShell = style({
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: 32,
});

export const fixtureStart = style({
  width: 1,
  height: 1,
  padding: 0,
  border: 0,
});

export const sharedFocusRing = style({
  position: 'fixed',
  left: -10000,
  boxShadow: vars.focusRing,
});
