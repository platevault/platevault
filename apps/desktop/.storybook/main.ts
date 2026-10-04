// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// PlateVault component workbench.
//
// The workbench always runs against the deterministic sample library so every
// story shows the same records, counts and states on every open. Setting the
// flag before the app config is read is what makes that guarantee hold.
process.env.VITE_USE_MOCKS = 'true';

import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)', '../src/**/*.mdx'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-vitest'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  core: { disableTelemetry: true },
  // Property documentation is read from components only. The type-driven
  // extractor also annotates plain exported objects, and a surface that reads
  // its own exported option map then trips over the annotations — a fault that
  // exists only while the workbench is watching, which is the worst kind.
  typescript: { reactDocgen: 'react-docgen' },
};

export default config;
