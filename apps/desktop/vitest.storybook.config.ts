// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Runs every workbench story as a check: a story that throws, or whose scripted
// walkthrough assertion fails, fails here. Kept in its own config so the
// existing unit run is untouched.

import { defineConfig } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import react from '@vitejs/plugin-react';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
  define: {
    'import.meta.env.VITE_USE_MOCKS': JSON.stringify('true'),
    'import.meta.env.VITE_DEV_TOOLS': JSON.stringify('false'),
  },
  test: {
    projects: [
      {
        extends: true,
        plugins: [
          vanillaExtractPlugin(),
          react(),
          storybookTest({ configDir: resolve(__dirname, '.storybook') }),
        ],
        test: {
          name: 'storybook',
          globalSetup: [resolve(__dirname, 'vitest.globalSetup.ts')],
          
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
