// Static mock fixture data for Project and ProjectDetail
// Types mirror @/api/types — inline definitions used until that module is created

type ProjectState =
  | 'setup_incomplete'
  | 'ready'
  | 'prepared'
  | 'processing'
  | 'completed'
  | 'archived'
  | 'blocked';

interface SourceMap {
  light_session_ids: string[];
  dark_master_ids: string[];
  flat_master_ids: string[];
  bias_master_ids: string[];
}

interface Project {
  id: string;
  name: string;
  workflow_profile_id: string;
  root_path: string;
  state: ProjectState;
  blocked_reason?: string;
  verification_state: 'unreviewed' | 'has_accepted' | 'all_rejected';
  cleanup_state: { reclaimable_bytes: number };
  target_ids: string[];
  source_map: SourceMap;
  source_view_ids: string[];
  output_ids: string[];
  processing_directory: string;
  output_directory: string;
  updated_at: string;
}

interface ProjectOutput {
  id: string;
  filename: string;
  kind: 'final' | 'intermediate' | 'log';
  size_bytes: number;
  created_at: string;
  verification_state: 'unreviewed' | 'accepted' | 'rejected';
  is_protected: boolean;
  protection_reason?: string;
}

interface ProjectArtifact {
  id: string;
  filename: string;
  kind:
    | 'registered'
    | 'calibrated'
    | 'drizzle'
    | 'log'
    | 'weight_map'
    | 'rejection_map';
  size_bytes: number;
  created_at: string;
}

interface ProjectDetail extends Project {
  outputs: ProjectOutput[];
  artifacts: ProjectArtifact[];
  notes?: string;
}

export const projects: Project[] = [
  // Project 1: Ready to process — NGC 7000 narrowband
  {
    id: '550e8400-e29b-41d4-a716-446655440301',
    name: 'NGC 7000 — HOO Narrowband',
    workflow_profile_id: 'pixinsight',
    root_path: '/media/Astrophoto/Projects/NGC7000_HOO_2026',
    state: 'ready',
    verification_state: 'unreviewed',
    cleanup_state: { reclaimable_bytes: 0 },
    target_ids: ['550e8400-e29b-41d4-a716-446655440201'],
    source_map: {
      light_session_ids: [
        '550e8400-e29b-41d4-a716-446655440001',
        '550e8400-e29b-41d4-a716-446655440005',
        '550e8400-e29b-41d4-a716-446655440006',
      ],
      dark_master_ids: ['550e8400-e29b-41d4-a716-446655440401'],
      flat_master_ids: [
        '550e8400-e29b-41d4-a716-446655440403',
        '550e8400-e29b-41d4-a716-446655440404',
      ],
      bias_master_ids: ['550e8400-e29b-41d4-a716-446655440407'],
    },
    source_view_ids: ['550e8400-e29b-41d4-a716-446655440601'],
    output_ids: [],
    processing_directory: 'processing/',
    output_directory: 'outputs/',
    updated_at: '2026-04-19T10:30:00Z',
  },

  // Project 2: Processing in progress — M31 LRGB
  {
    id: '550e8400-e29b-41d4-a716-446655440302',
    name: 'M31 — LRGB Wide Field',
    workflow_profile_id: 'pixinsight',
    root_path: '/media/Astrophoto/Projects/M31_LRGB_2026',
    state: 'processing',
    verification_state: 'unreviewed',
    cleanup_state: { reclaimable_bytes: 1_073_741_824 },
    target_ids: ['550e8400-e29b-41d4-a716-446655440202'],
    source_map: {
      light_session_ids: [
        '550e8400-e29b-41d4-a716-446655440003',
        '550e8400-e29b-41d4-a716-446655440007',
      ],
      dark_master_ids: ['550e8400-e29b-41d4-a716-446655440406'],
      flat_master_ids: ['550e8400-e29b-41d4-a716-446655440405'],
      bias_master_ids: ['550e8400-e29b-41d4-a716-446655440408'],
    },
    source_view_ids: ['550e8400-e29b-41d4-a716-446655440602'],
    output_ids: ['550e8400-e29b-41d4-a716-446655440701'],
    processing_directory: 'processing/',
    output_directory: 'outputs/',
    updated_at: '2026-04-20T14:15:00Z',
  },

  // Project 3: Completed — older Rosette project, with cleanup opportunity
  {
    id: '550e8400-e29b-41d4-a716-446655440303',
    name: 'NGC 2244 — Rosette Ha Narrowband',
    workflow_profile_id: 'pixinsight',
    root_path: '/media/Astrophoto/Projects/NGC2244_Ha_2026',
    state: 'completed',
    verification_state: 'has_accepted',
    cleanup_state: { reclaimable_bytes: 3_221_225_472 },
    target_ids: ['550e8400-e29b-41d4-a716-446655440205'],
    source_map: {
      light_session_ids: ['550e8400-e29b-41d4-a716-446655440008'],
      dark_master_ids: ['550e8400-e29b-41d4-a716-446655440402'],
      flat_master_ids: ['550e8400-e29b-41d4-a716-446655440404'],
      bias_master_ids: ['550e8400-e29b-41d4-a716-446655440407'],
    },
    source_view_ids: ['550e8400-e29b-41d4-a716-446655440603'],
    output_ids: [
      '550e8400-e29b-41d4-a716-446655440702',
      '550e8400-e29b-41d4-a716-446655440703',
    ],
    processing_directory: 'processing/',
    output_directory: 'outputs/',
    updated_at: '2026-03-15T08:00:00Z',
    blocked_reason: undefined,
  },
];

// Blocked project is not in the main list but useful for review fixtures —
// represented as a separate export for components that need to show the ⚠ blocked state
export const blockedProject: Project = {
  id: '550e8400-e29b-41d4-a716-446655440304',
  name: 'IC 1396 — SHO Tri-Narrowband (Incomplete)',
  workflow_profile_id: 'pixinsight',
  root_path: '/media/Astrophoto/Projects/IC1396_SHO_2026',
  state: 'blocked',
  blocked_reason: 'Ha and OIII sessions not yet confirmed — need at least 2 sessions per channel',
  verification_state: 'unreviewed',
  cleanup_state: { reclaimable_bytes: 0 },
  target_ids: ['550e8400-e29b-41d4-a716-446655440203'],
  source_map: {
    light_session_ids: ['550e8400-e29b-41d4-a716-446655440002'],
    dark_master_ids: ['550e8400-e29b-41d4-a716-446655440401'],
    flat_master_ids: [],
    bias_master_ids: ['550e8400-e29b-41d4-a716-446655440407'],
  },
  source_view_ids: [],
  output_ids: [],
  processing_directory: 'processing/',
  output_directory: 'outputs/',
  updated_at: '2026-04-16T11:00:00Z',
};

export const projectDetail: ProjectDetail = {
  ...projects[1], // M31 LRGB — processing state
  outputs: [
    {
      id: '550e8400-e29b-41d4-a716-446655440701',
      filename: 'M31_LRGB_integration_L_v1.xisf',
      kind: 'intermediate',
      size_bytes: 524_288_000,
      created_at: '2026-04-20T13:00:00Z',
      verification_state: 'unreviewed',
      is_protected: false,
    },
  ],
  artifacts: [
    {
      id: '550e8400-e29b-41d4-a716-446655440801',
      filename: 'M31_2026-03-28_L_frame_0001_calibrated.xisf',
      kind: 'calibrated',
      size_bytes: 35_651_584,
      created_at: '2026-04-20T12:00:00Z',
    },
    {
      id: '550e8400-e29b-41d4-a716-446655440802',
      filename: 'M31_2026-03-28_L_frame_0002_calibrated.xisf',
      kind: 'calibrated',
      size_bytes: 35_651_584,
      created_at: '2026-04-20T12:01:00Z',
    },
    {
      id: '550e8400-e29b-41d4-a716-446655440803',
      filename: 'M31_registered_stack_L.xisf',
      kind: 'registered',
      size_bytes: 104_857_600,
      created_at: '2026-04-20T12:45:00Z',
    },
    {
      id: '550e8400-e29b-41d4-a716-446655440804',
      filename: 'PixInsight_ProcessLog_2026-04-20.txt',
      kind: 'log',
      size_bytes: 4_096,
      created_at: '2026-04-20T14:15:00Z',
    },
  ],
  notes: 'First LRGB attempt of M31. L data complete; waiting on G and B channel acquisitions.',
};
