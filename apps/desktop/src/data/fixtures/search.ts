// Static mock fixture data for SearchResult (command palette)
// Types mirror @/api/types — inline definitions used until that module is created

type SearchResultKind = 'session' | 'target' | 'project' | 'page' | 'action';

interface SearchResult {
  id: string;
  kind: SearchResultKind;
  label: string;
  sublabel?: string;
  route: string;
  score: number;
}

export const searchResults: SearchResult[] = [
  // --- session results (3) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440005',
    kind: 'session',
    label: 'NGC 7000 — OIII',
    sublabel: '2026-04-15 · 15 frames · 2h 30m · confirmed',
    route: '#/sessions/550e8400-e29b-41d4-a716-446655440005',
    score: 0.95,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440006',
    kind: 'session',
    label: 'NGC 7000 — SII',
    sublabel: '2026-04-18 · 14 frames · 2h 20m · confirmed',
    route: '#/sessions/550e8400-e29b-41d4-a716-446655440006',
    score: 0.92,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440003',
    kind: 'session',
    label: 'M31 — L (Luminance)',
    sublabel: '2026-03-28 · 60 frames · 1h 30m · needs review',
    route: '#/sessions/550e8400-e29b-41d4-a716-446655440003',
    score: 0.78,
  },

  // --- target results (2) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440201',
    kind: 'target',
    label: 'NGC 7000',
    sublabel: 'North America Nebula · deep_sky · 7.5h total',
    route: '#/targets/550e8400-e29b-41d4-a716-446655440201',
    score: 0.98,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440202',
    kind: 'target',
    label: 'M31',
    sublabel: 'Andromeda Galaxy · deep_sky · 4.6h total',
    route: '#/targets/550e8400-e29b-41d4-a716-446655440202',
    score: 0.87,
  },

  // --- project results (2) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440301',
    kind: 'project',
    label: 'NGC 7000 — HOO Narrowband',
    sublabel: 'ready · PixInsight',
    route: '#/projects/550e8400-e29b-41d4-a716-446655440301',
    score: 0.91,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440302',
    kind: 'project',
    label: 'M31 — LRGB Wide Field',
    sublabel: 'processing · PixInsight',
    route: '#/projects/550e8400-e29b-41d4-a716-446655440302',
    score: 0.82,
  },

  // --- page navigation results (2) ---
  {
    id: 'page-sessions',
    kind: 'page',
    label: 'Sessions',
    sublabel: 'Browse and review acquisition sessions',
    route: '#/sessions',
    score: 0.6,
  },
  {
    id: 'page-review',
    kind: 'page',
    label: 'Review Queue',
    sublabel: 'Confirm or reject sessions and unclassified files',
    route: '#/review',
    score: 0.55,
  },

  // --- action results (1) ---
  {
    id: 'action-new-project',
    kind: 'action',
    label: 'New Project…',
    sublabel: 'Open the project creation wizard',
    route: '#/projects/new',
    score: 0.7,
  },
];
