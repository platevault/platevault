// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const checklistCss = readFileSync(
  join(process.cwd(), 'src/features/onboarding/checklist.css'),
  'utf8',
);
const tokensCss = readFileSync(
  join(process.cwd(), 'src/styles/tokens.css'),
  'utf8',
);

describe('onboarding checklist animation tokens', () => {
  it.each([
    ['tick', 'animation: pv-onb-tick-pop var(--pv-onb-motion-tick);'],
    [
      'progress pulse',
      'animation: pv-onb-progress-pulse var(--pv-onb-motion-progress-pulse) 2;',
    ],
    [
      'spotlight pulse',
      'animation: pv-onb-spotlight-pulse var(--pv-onb-motion-spotlight-pulse) infinite;',
    ],
  ])('%s animation composes one duration/easing token', (_name, declaration) => {
    expect(checklistCss).toContain(declaration);
  });

  it('keeps raw animation durations out of the checklist stylesheet', () => {
    expect(checklistCss).not.toMatch(/animation:[^;]*\b\d+(?:\.\d+)?m?s\b/);
  });

  it.each([
    '--pv-onb-motion-tick: 150ms ease-out;',
    '--pv-onb-motion-progress-pulse: 600ms ease-in-out;',
    '--pv-onb-motion-spotlight-pulse: 1000ms ease-in-out;',
  ])('generates %s', (declaration) => {
    expect(tokensCss).toContain(declaration);
  });
});
