// Static mock fixture data for FilesystemPlan and PlanDetail
// Types mirror @/api/types — inline definitions used until that module is created

type PlanState =
  | 'draft'
  | 'ready_for_review'
  | 'approved'
  | 'applying'
  | 'applied'
  | 'partially_applied'
  | 'failed'
  | 'paused'
  | 'cancelled'
  | 'discarded';

type PlanKind =
  | 'project_structure'
  | 'source_view'
  | 'source_view_removal'
  | 'archive'
  | 'cleanup'
  | 'root_remap'
  | 'manifest';

type PlanItemAction =
  | 'mkdir'
  | 'move'
  | 'copy'
  | 'link'
  | 'junction'
  | 'write'
  | 'archive'
  | 'trash'
  | 'delete';

type PlanItemStatus = 'pending' | 'applied' | 'failed' | 'skipped' | 'protected';

type ProvenanceOrigin =
  | 'reviewed'
  | 'inferred'
  | 'observed'
  | 'generated'
  | 'planned'
  | 'applied';

interface PlanItem {
  action: PlanItemAction;
  source_path: string;
  dest_path: string;
  status: PlanItemStatus;
  dry_run_ok: boolean;
  protection_reason?: string;
  provenance: ProvenanceOrigin;
}

interface DryRunResult {
  passed: boolean;
  warnings: string[];
  failures: string[];
}

interface FilesystemPlan {
  id: string;
  kind: PlanKind;
  state: PlanState;
  items: PlanItem[];
  dry_run_result: DryRunResult;
  has_destructive: boolean;
  reclaim_bytes: number;
  created_at: string;
  approved_at?: string;
  applied_at?: string;
}

interface PlanSummary {
  total_items: number;
  mkdir_count: number;
  link_count: number;
  move_count: number;
  trash_count: number;
  delete_count: number;
  protected_count: number;
  applied_count: number;
  failed_count: number;
  reclaim_bytes: number;
}

interface PlanDetail extends FilesystemPlan {
  summary: PlanSummary;
}

// --- Plan 1: Non-destructive project structure (mkdir + link only) ---
const plan1Items: PlanItem[] = [
  {
    action: 'mkdir',
    source_path: '',
    dest_path: '/media/Astrophoto/Projects/NGC7000_HOO_2026/lights/Ha',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'mkdir',
    source_path: '',
    dest_path: '/media/Astrophoto/Projects/NGC7000_HOO_2026/lights/OIII',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'mkdir',
    source_path: '',
    dest_path: '/media/Astrophoto/Projects/NGC7000_HOO_2026/lights/SII',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'mkdir',
    source_path: '',
    dest_path: '/media/Astrophoto/Projects/NGC7000_HOO_2026/calibration/darks',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'mkdir',
    source_path: '',
    dest_path: '/media/Astrophoto/Projects/NGC7000_HOO_2026/calibration/flats/Ha',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'mkdir',
    source_path: '',
    dest_path: '/media/Astrophoto/Projects/NGC7000_HOO_2026/calibration/flats/OIII',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'link',
    source_path:
      '/media/Astrophoto/Inbox/2026-04-15/NGC7000_OIII_600s_001.fit',
    dest_path:
      '/media/Astrophoto/Projects/NGC7000_HOO_2026/lights/OIII/NGC7000_OIII_600s_001.fit',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'planned',
  },
  {
    action: 'link',
    source_path:
      '/media/Astrophoto/Inbox/2026-04-18/NGC7000_SII_600s_001.fit',
    dest_path:
      '/media/Astrophoto/Projects/NGC7000_HOO_2026/lights/SII/NGC7000_SII_600s_001.fit',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'planned',
  },
];

// --- Plan 2: Cleanup with trash (requires confirmation dialog) ---
const plan2Items: PlanItem[] = [
  {
    action: 'trash',
    source_path:
      '/media/Astrophoto/Projects/M31_LRGB_2026/processing/M31_2026-03-28_L_frame_0001_calibrated.xisf',
    dest_path: '',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'trash',
    source_path:
      '/media/Astrophoto/Projects/M31_LRGB_2026/processing/M31_2026-03-28_L_frame_0002_calibrated.xisf',
    dest_path: '',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'trash',
    source_path:
      '/media/Astrophoto/Projects/M31_LRGB_2026/processing/M31_registered_stack_L.xisf',
    dest_path: '',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'trash',
    source_path:
      '/media/Astrophoto/Projects/M31_LRGB_2026/processing/M31_drizzle_L.xisf',
    dest_path: '',
    status: 'pending',
    dry_run_ok: false, // dry-run found file is protected by output dependency
    protection_reason: 'referenced by accepted output M31_LRGB_integration_L_v1.xisf',
    provenance: 'generated',
  },
];

// --- Plan 3: Permanent delete plan (has_destructive=true, requires checkbox acknowledgement) ---
const plan3Items: PlanItem[] = [
  {
    action: 'delete',
    source_path:
      '/media/Astrophoto/Projects/NGC2244_Ha_2026/processing/NGC2244_calibrated_001.xisf',
    dest_path: '',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'delete',
    source_path:
      '/media/Astrophoto/Projects/NGC2244_Ha_2026/processing/NGC2244_calibrated_002.xisf',
    dest_path: '',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'delete',
    source_path:
      '/media/Astrophoto/Projects/NGC2244_Ha_2026/processing/NGC2244_registered_stack.xisf',
    dest_path: '',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'delete',
    source_path:
      '/media/Astrophoto/Projects/NGC2244_Ha_2026/processing/NGC2244_drizzle_2x.xisf',
    dest_path: '',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'delete',
    source_path:
      '/media/Astrophoto/Projects/NGC2244_Ha_2026/processing/NGC2244_weight_map.xisf',
    dest_path: '',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
];

// --- Plan 4: Already applied source view plan ---
const plan4Items: PlanItem[] = [
  {
    action: 'mkdir',
    source_path: '',
    dest_path: '/media/Astrophoto/Projects/NGC7000_HOO_2026/source-view',
    status: 'applied',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'link',
    source_path:
      '/media/Astrophoto/Inbox/2026-04-15/NGC7000_OIII_600s_001.fit',
    dest_path:
      '/media/Astrophoto/Projects/NGC7000_HOO_2026/source-view/NGC7000_OIII_600s_001.fit',
    status: 'applied',
    dry_run_ok: true,
    provenance: 'planned',
  },
  {
    action: 'link',
    source_path:
      '/media/Astrophoto/Inbox/2026-04-15/NGC7000_OIII_600s_002.fit',
    dest_path:
      '/media/Astrophoto/Projects/NGC7000_HOO_2026/source-view/NGC7000_OIII_600s_002.fit',
    status: 'applied',
    dry_run_ok: true,
    provenance: 'planned',
  },
];

export const plans: FilesystemPlan[] = [
  // Plan 1: Non-destructive — mkdir + link only, ready for review
  {
    id: '550e8400-e29b-41d4-a716-446655440501',
    kind: 'project_structure',
    state: 'ready_for_review',
    items: plan1Items,
    dry_run_result: {
      passed: true,
      warnings: [],
      failures: [],
    },
    has_destructive: false,
    reclaim_bytes: 0,
    created_at: '2026-04-19T10:00:00Z',
  },

  // Plan 2: Trash plan — ready for review, one protected item
  {
    id: '550e8400-e29b-41d4-a716-446655440502',
    kind: 'cleanup',
    state: 'ready_for_review',
    items: plan2Items,
    dry_run_result: {
      passed: false,
      warnings: ['1 item is protected and will be skipped'],
      failures: [],
    },
    has_destructive: false, // trash is recoverable, not classed as destructive
    reclaim_bytes: 1_048_576_000,
    created_at: '2026-04-20T09:00:00Z',
  },

  // Plan 3: Permanent delete — has_destructive=true, requires checkbox
  {
    id: '550e8400-e29b-41d4-a716-446655440503',
    kind: 'cleanup',
    state: 'ready_for_review',
    items: plan3Items,
    dry_run_result: {
      passed: true,
      warnings: [],
      failures: [],
    },
    has_destructive: true,
    reclaim_bytes: 3_221_225_472,
    created_at: '2026-03-16T09:00:00Z',
  },

  // Plan 4: Already applied source view plan
  {
    id: '550e8400-e29b-41d4-a716-446655440504',
    kind: 'source_view',
    state: 'applied',
    items: plan4Items,
    dry_run_result: {
      passed: true,
      warnings: [],
      failures: [],
    },
    has_destructive: false,
    reclaim_bytes: 0,
    created_at: '2026-04-16T08:00:00Z',
    approved_at: '2026-04-16T08:05:00Z',
    applied_at: '2026-04-16T08:06:00Z',
  },
];

export const planDetail: PlanDetail = {
  ...plans[1], // Cleanup plan with trash + one protected item
  summary: {
    total_items: 4,
    mkdir_count: 0,
    link_count: 0,
    move_count: 0,
    trash_count: 3,
    delete_count: 0,
    protected_count: 1,
    applied_count: 0,
    failed_count: 0,
    reclaim_bytes: 1_048_576_000,
  },
};
