// Static mock fixture data for FilesystemPlan and PlanDetail
// Matches wireframe: canvas-wireframes-2026-05-24/project/wireframes/plan-review.jsx

import type {
  FilesystemPlan,
  PlanDetail,
  PlanItem,
  PlanItemAction,
  PlanItemStatus,
  PlanState,
  PlanKind,
  ProvenanceOrigin,
} from '@/api/types';

// ---------------------------------------------------------------------------
// Plan items for the cleanup plan (matches wireframe table + diff views)
// ---------------------------------------------------------------------------

const cleanupItems: PlanItem[] = [
  {
    action: 'trash',
    source_path: 'processing/pixinsight/registered/Ha_300s_r_0001.xisf',
    dest_path: '~/.Trash/alm/plan-23/',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'trash',
    source_path: 'processing/pixinsight/registered/Ha_300s_r_0002.xisf',
    dest_path: '~/.Trash/alm/plan-23/',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'trash',
    source_path: 'processing/pixinsight/calibrated/Ha_300s_c_0001.xisf',
    dest_path: '~/.Trash/alm/plan-23/',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'trash',
    source_path: 'processing/pixinsight/drizzle/*.drizzle',
    dest_path: '~/.Trash/alm/plan-23/',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'delete',
    source_path: 'processing/pixinsight/temp/_a3f7.tmp',
    dest_path: '',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'delete',
    source_path: 'processing/pixinsight/temp/_b21c.tmp',
    dest_path: '',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'archive',
    source_path: 'processing/pixinsight/logs/wbpp_2025-02-14.log',
    dest_path: 'archive/logs/',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'archive',
    source_path: 'processing/pixinsight/logs/wbpp_2025-02-15.log',
    dest_path: 'archive/logs/',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'trash',
    source_path: 'sources/views/wbpp_input_old/',
    dest_path: '',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'generated',
  },
  {
    action: 'trash',
    source_path: 'outputs/final/NGC7000_final_v3.tif',
    dest_path: '',
    status: 'protected',
    dry_run_ok: true,
    protection_reason: 'Protected — accepted output',
    provenance: 'reviewed',
  },
  {
    action: 'trash',
    source_path: 'sources/manifests/manifest.json',
    dest_path: '',
    status: 'protected',
    dry_run_ok: true,
    protection_reason: 'Protected — manifest',
    provenance: 'reviewed',
  },
];

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
    action: 'link',
    source_path: '/media/Astrophoto/Inbox/2026-04-15/NGC7000_OIII_600s_001.fit',
    dest_path: '/media/Astrophoto/Projects/NGC7000_HOO_2026/lights/OIII/NGC7000_OIII_600s_001.fit',
    status: 'pending',
    dry_run_ok: true,
    provenance: 'planned',
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
    source_path: '/media/Astrophoto/Inbox/2026-04-15/NGC7000_OIII_600s_001.fit',
    dest_path: '/media/Astrophoto/Projects/NGC7000_HOO_2026/source-view/NGC7000_OIII_600s_001.fit',
    status: 'applied',
    dry_run_ok: true,
    provenance: 'planned',
  },
];

// ---------------------------------------------------------------------------
// Plan list
// ---------------------------------------------------------------------------

export const plans: FilesystemPlan[] = [
  // Plan 1: Non-destructive — mkdir + link only, ready for review
  {
    id: '550e8400-e29b-41d4-a716-446655440501',
    kind: 'project_structure',
    state: 'ready_for_review',
    items: plan1Items,
    dry_run_result: { passed: 1, warnings: 0, failures: 0 },
    has_destructive: false,
    reclaim_bytes: 0,
    created_at: '2026-04-19T10:00:00Z',
  },

  // Plan 2: Cleanup plan — matches wireframe (plan-#23)
  {
    id: 'plan-23',
    kind: 'cleanup',
    state: 'ready_for_review',
    items: cleanupItems,
    dry_run_result: { passed: 1, warnings: 0, failures: 0 },
    has_destructive: true,
    reclaim_bytes: 2_202_009_600, // 2.1 GB
    created_at: new Date(Date.now() - 12 * 60_000).toISOString(),
  },

  // Plan 3: Already applied source view plan
  {
    id: '550e8400-e29b-41d4-a716-446655440504',
    kind: 'source_view',
    state: 'applied',
    items: plan4Items,
    dry_run_result: { passed: 1, warnings: 0, failures: 0 },
    has_destructive: false,
    reclaim_bytes: 0,
    created_at: '2026-04-16T08:00:00Z',
    approved_at: '2026-04-16T08:05:00Z',
    applied_at: '2026-04-16T08:06:00Z',
  },
];

// ---------------------------------------------------------------------------
// Plan detail — the cleanup plan from wireframe
// ---------------------------------------------------------------------------

export const planDetail: PlanDetail = {
  ...plans[1],
  summary: {
    item_count: 148,
    reclaim_bytes: 2_202_009_600,
    trash_count: 142,
    archive_count: 2,
    delete_count: 4,
    protected_count: 11,
  },
};
