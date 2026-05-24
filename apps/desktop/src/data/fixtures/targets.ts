// Static mock fixture data for Target and TargetDetail
// Types mirror @/api/types — inline definitions used until that module is created

type TargetKind = 'deep_sky' | 'planetary' | 'lunar' | 'solar' | 'landscape';

interface Target {
  id: string;
  name: string;
  aliases: string[];
  catalog_ids: {
    ngc?: number;
    ic?: number;
    messier?: number;
  };
  kind: TargetKind;
  coordinates: {
    ra?: number; // decimal hours
    dec?: number; // decimal degrees
  };
  session_count: number;
  project_count: number;
  total_integration_hours: number;
  coverage: Record<string, number>; // filter → hours
  recommended_hours: Record<string, number>; // filter → target hours
}

interface LinkedSession {
  session_id: string;
  night: string;
  filter: string;
  integration_hours: number;
  state: string;
  confidence: string;
}

interface LinkedProject {
  project_id: string;
  name: string;
  state: string;
}

interface TargetDetail extends Target {
  linked_sessions: LinkedSession[];
  linked_projects: LinkedProject[];
  notes?: string;
}

export const targets: Target[] = [
  // NGC 7000 — North America Nebula — good narrowband coverage
  {
    id: '550e8400-e29b-41d4-a716-446655440201',
    name: 'NGC 7000',
    aliases: ['North America Nebula', 'NGC7000', 'C20'],
    catalog_ids: { ngc: 7000 },
    kind: 'deep_sky',
    coordinates: { ra: 20.97, dec: 44.53 },
    session_count: 3,
    project_count: 1,
    total_integration_hours: 7.5,
    coverage: {
      Ha: 3.0,
      OIII: 2.5,
      SII: 2.0,
    },
    recommended_hours: {
      Ha: 4.0,
      OIII: 4.0,
      SII: 4.0,
    },
    // Ha, OIII, SII all below recommended — will trigger warnings
  },

  // M31 — Andromeda Galaxy — missing G and B channels
  {
    id: '550e8400-e29b-41d4-a716-446655440202',
    name: 'M31',
    aliases: ['Andromeda Galaxy', 'NGC 224', 'NGC224'],
    catalog_ids: { messier: 31, ngc: 224 },
    kind: 'deep_sky',
    coordinates: { ra: 0.712, dec: 41.27 },
    session_count: 3,
    project_count: 1,
    total_integration_hours: 4.58,
    coverage: {
      L: 1.5,
      R: 1.125,
      G: 0,  // missing — will trigger warning
      B: 0,  // missing — will trigger warning
    },
    recommended_hours: {
      L: 3.0,
      R: 2.0,
      G: 2.0,
      B: 2.0,
    },
  },

  // IC 1396 — Elephant Trunk Nebula — low SII only
  {
    id: '550e8400-e29b-41d4-a716-446655440203',
    name: 'IC 1396',
    aliases: ['Elephant Trunk Nebula', 'IC1396'],
    catalog_ids: { ic: 1396 },
    kind: 'deep_sky',
    coordinates: { ra: 21.62, dec: 57.5 },
    session_count: 1,
    project_count: 0,
    total_integration_hours: 2.0,
    coverage: {
      SII: 2.0,
      Ha: 0,   // missing — will trigger warning
      OIII: 0, // missing — will trigger warning
    },
    recommended_hours: {
      Ha: 4.0,
      OIII: 4.0,
      SII: 4.0,
    },
  },

  // M42 — Orion Nebula — partial (Ha only, rejected OIII)
  {
    id: '550e8400-e29b-41d4-a716-446655440204',
    name: 'M42',
    aliases: ['Orion Nebula', 'Great Orion Nebula', 'NGC 1976', 'NGC1976'],
    catalog_ids: { messier: 42, ngc: 1976 },
    kind: 'deep_sky',
    coordinates: { ra: 5.588, dec: -5.39 },
    session_count: 2,
    project_count: 0,
    total_integration_hours: 5.0,
    coverage: {
      Ha: 5.0,
      OIII: 0,  // session rejected — will trigger warning
    },
    recommended_hours: {
      Ha: 3.0,
      OIII: 3.0,
    },
  },

  // NGC 2244 — Rosette Nebula core — only Ha, good coverage
  {
    id: '550e8400-e29b-41d4-a716-446655440205',
    name: 'NGC 2244',
    aliases: ['Rosette Nebula', 'Caldwell 50', 'NGC2244'],
    catalog_ids: { ngc: 2244 },
    kind: 'deep_sky',
    coordinates: { ra: 6.532, dec: 4.95 },
    session_count: 1,
    project_count: 0,
    total_integration_hours: 3.33,
    coverage: {
      Ha: 3.33,
      OIII: 0,  // not yet started — will trigger warning
      SII: 0,   // not yet started — will trigger warning
    },
    recommended_hours: {
      Ha: 4.0,
      OIII: 3.0,
      SII: 3.0,
    },
  },
];

export const targetDetail: TargetDetail = {
  ...targets[0], // NGC 7000
  linked_sessions: [
    {
      session_id: '550e8400-e29b-41d4-a716-446655440001',
      night: '2026-04-12',
      filter: 'Ha',
      integration_hours: 3.0,
      state: 'discovered',
      confidence: 'unknown',
    },
    {
      session_id: '550e8400-e29b-41d4-a716-446655440005',
      night: '2026-04-15',
      filter: 'OIII',
      integration_hours: 2.5,
      state: 'confirmed',
      confidence: 'confirmed',
    },
    {
      session_id: '550e8400-e29b-41d4-a716-446655440006',
      night: '2026-04-18',
      filter: 'SII',
      integration_hours: 2.33,
      state: 'confirmed',
      confidence: 'high',
    },
  ],
  linked_projects: [
    {
      project_id: '550e8400-e29b-41d4-a716-446655440301',
      name: 'NGC 7000 — HOO Narrowband',
      state: 'ready',
    },
  ],
  notes: 'Primary narrowband target for autumn. Target SHO palette with minimum 4h per channel.',
};
