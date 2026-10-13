// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { SearchResult } from '@/bindings/types';

export const mockSearchResults: SearchResult[] = [
  {
    id: 'ses-001',
    kind: 'session',
    label: 'M31 L 2026-05-18',
    sublabel: '120 frames',
    route: '/sessions/ses-001',
    score: 0.95,
  },
  {
    id: 'target-001',
    kind: 'target',
    label: 'M31 - Andromeda Galaxy',
    sublabel: '5 sessions',
    route: '/targets/target-001',
    score: 0.9,
  },
  {
    id: 'proj-001',
    kind: 'project',
    label: 'M31 LRGB',
    sublabel: 'Processing',
    route: '/projects/proj-001',
    score: 0.85,
  },
  {
    id: 'nav-sessions',
    kind: 'page',
    label: 'Sessions',
    sublabel: 'Browse all sessions',
    route: '/sessions',
    score: 0.5,
  },
];
