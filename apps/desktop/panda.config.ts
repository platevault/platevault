// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { defineConfig } from '@pandacss/dev';
import { conditions, foundationTokens, semanticTokens } from './panda-tokens.gen.mjs';

export default defineConfig({
  // Output directory for generated CSS utilities.
  outdir: 'styled-system',

  // Only scan the LogPanel files for this pilot.
  include: ['./src/app/LogPanel.tsx', './src/app/LogEntryRow.tsx'],

  // Prefix mirrors the existing --pv-* CSS custom properties.
  prefix: 'pv',

  // Theme conditions from the generated DTCG config.
  conditions,

  theme: {
    extend: {
      tokens: {
        // Foundation tokens (type scale, spacing, radii, weights).
        sizes: foundationTokens,
      },
      semanticTokens: {
        colors: semanticTokens,
      },
    },
  },
});
