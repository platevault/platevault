// Static mock fixture data for FilesystemPlan and PlanDetail (spec 017).
// Updated to match the new contract types from crates/contracts/core/src/plans.rs.
// Matches wireframe: canvas-wireframes-2026-05-24/project/wireframes/plan-review.jsx

import type { FilesystemPlan, PlanDetail, PlanItem } from '@/bindings/types';

// ---------------------------------------------------------------------------
// Plan items for the cleanup plan (matches wireframe table + diff views)
// ---------------------------------------------------------------------------
// Note: the old fixture used `trash` and `mkdir` actions which map to
// `delete` (with archive destination) and `write` in the new schema.

const cleanupItems: PlanItem[] = [
  {
    id: 'item-001',
    index: 1,
    name: 'Ha_300s_r_0001.xisf',
    action: 'delete',
    from: 'processing/pixinsight/registered/Ha_300s_r_0001.xisf',
    to: '.astro-plan-archive/plan-23/registered/Ha_300s_r_0001.xisf',
    reason: 'Registered intermediate; final stack complete',
    protection: 'normal',
    state: 'pending',
    provenance: [{ label: 'source', value: 'generated' }],
  },
  {
    id: 'item-002',
    index: 2,
    name: 'Ha_300s_r_0002.xisf',
    action: 'delete',
    from: 'processing/pixinsight/registered/Ha_300s_r_0002.xisf',
    to: '.astro-plan-archive/plan-23/registered/Ha_300s_r_0002.xisf',
    reason: 'Registered intermediate; final stack complete',
    protection: 'normal',
    state: 'pending',
    provenance: [{ label: 'source', value: 'generated' }],
  },
  {
    id: 'item-003',
    index: 3,
    name: 'Ha_300s_c_0001.xisf',
    action: 'delete',
    from: 'processing/pixinsight/calibrated/Ha_300s_c_0001.xisf',
    to: '.astro-plan-archive/plan-23/calibrated/Ha_300s_c_0001.xisf',
    reason: 'Calibrated intermediate; final stack complete',
    protection: 'normal',
    state: 'pending',
    provenance: [{ label: 'source', value: 'generated' }],
  },
  {
    id: 'item-004',
    index: 4,
    name: '*.drizzle',
    action: 'delete',
    from: 'processing/pixinsight/drizzle/*.drizzle',
    to: '.astro-plan-archive/plan-23/drizzle/',
    reason: 'Drizzle work files; drizzle integration complete',
    protection: 'normal',
    state: 'pending',
    provenance: [{ label: 'source', value: 'generated' }],
  },
  {
    id: 'item-005',
    index: 5,
    name: '_a3f7.tmp',
    action: 'delete',
    from: 'processing/pixinsight/temp/_a3f7.tmp',
    to: '',
    reason: 'Temporary file from interrupted run',
    protection: 'normal',
    state: 'pending',
    provenance: [{ label: 'source', value: 'generated' }],
  },
  {
    id: 'item-006',
    index: 6,
    name: '_b21c.tmp',
    action: 'delete',
    from: 'processing/pixinsight/temp/_b21c.tmp',
    to: '',
    reason: 'Temporary file from interrupted run',
    protection: 'normal',
    state: 'pending',
    provenance: [{ label: 'source', value: 'generated' }],
  },
  {
    id: 'item-007',
    index: 7,
    name: 'wbpp_2025-02-14.log',
    action: 'archive',
    from: 'processing/pixinsight/logs/wbpp_2025-02-14.log',
    to: '.astro-plan-archive/plan-23/logs/wbpp_2025-02-14.log',
    reason: 'Processing log — archivable after verification',
    protection: 'normal',
    state: 'pending',
    provenance: [{ label: 'source', value: 'generated' }],
  },
  {
    id: 'item-008',
    index: 8,
    name: 'wbpp_2025-02-15.log',
    action: 'archive',
    from: 'processing/pixinsight/logs/wbpp_2025-02-15.log',
    to: '.astro-plan-archive/plan-23/logs/wbpp_2025-02-15.log',
    reason: 'Processing log — archivable after verification',
    protection: 'normal',
    state: 'pending',
    provenance: [{ label: 'source', value: 'generated' }],
  },
  {
    id: 'item-009',
    index: 9,
    name: 'wbpp_input_old/',
    action: 'delete',
    from: 'sources/views/wbpp_input_old/',
    to: '.astro-plan-archive/plan-23/views/wbpp_input_old/',
    reason: 'Superseded source view folder',
    protection: 'normal',
    state: 'pending',
    provenance: [{ label: 'source', value: 'generated' }],
  },
  {
    id: 'item-010',
    index: 10,
    name: 'NGC7000_final_v3.tif',
    action: 'delete',
    from: 'outputs/final/NGC7000_final_v3.tif',
    to: '',
    reason: 'Final output — candidate for archive',
    protection: 'protected',
    state: 'pending',
    provenance: [{ label: 'source', value: 'reviewed' }],
  },
  {
    id: 'item-011',
    index: 11,
    name: 'manifest.json',
    action: 'delete',
    from: 'sources/manifests/manifest.json',
    to: '',
    reason: 'Manifest file',
    protection: 'protected',
    state: 'pending',
    provenance: [{ label: 'source', value: 'reviewed' }],
  },
];

// --- Plan 1: Non-destructive project structure (link only) ---
const plan1Items: PlanItem[] = [
  {
    id: 'p1-item-001',
    index: 1,
    name: 'lights/Ha',
    action: 'write',
    from: '',
    to: '/media/Astrophoto/Projects/NGC7000_HOO_2026/lights/Ha',
    reason: 'Create project folder',
    protection: 'normal',
    state: 'pending',
    provenance: [{ label: 'source', value: 'generated' }],
  },
  {
    id: 'p1-item-002',
    index: 2,
    name: 'lights/OIII',
    action: 'write',
    from: '',
    to: '/media/Astrophoto/Projects/NGC7000_HOO_2026/lights/OIII',
    reason: 'Create project folder',
    protection: 'normal',
    state: 'pending',
    provenance: [{ label: 'source', value: 'generated' }],
  },
  {
    id: 'p1-item-003',
    index: 3,
    name: 'NGC7000_OIII_600s_001.fit',
    action: 'link',
    from: '/media/Astrophoto/Inbox/2026-04-15/NGC7000_OIII_600s_001.fit',
    to: '/media/Astrophoto/Projects/NGC7000_HOO_2026/lights/OIII/NGC7000_OIII_600s_001.fit',
    reason: 'Link acquisition frame into project source view',
    protection: 'normal',
    state: 'pending',
    provenance: [{ label: 'source', value: 'planned' }],
  },
];

// --- Plan 4: Already applied source view plan ---
const plan4Items: PlanItem[] = [
  {
    id: 'p4-item-001',
    index: 1,
    name: 'source-view',
    action: 'write',
    from: '',
    to: '/media/Astrophoto/Projects/NGC7000_HOO_2026/source-view',
    reason: 'Create source view folder',
    protection: 'normal',
    state: 'succeeded',
    provenance: [{ label: 'source', value: 'generated' }],
  },
  {
    id: 'p4-item-002',
    index: 2,
    name: 'NGC7000_OIII_600s_001.fit',
    action: 'link',
    from: '/media/Astrophoto/Inbox/2026-04-15/NGC7000_OIII_600s_001.fit',
    to: '/media/Astrophoto/Projects/NGC7000_HOO_2026/source-view/NGC7000_OIII_600s_001.fit',
    reason: 'Link acquisition frame into source view',
    protection: 'normal',
    state: 'succeeded',
    provenance: [{ label: 'source', value: 'planned' }],
  },
];

// ---------------------------------------------------------------------------
// Plan list
// ---------------------------------------------------------------------------

export const plans: FilesystemPlan[] = [
  // Plan 1: Non-destructive — link only, ready for review
  {
    id: '550e8400-e29b-41d4-a716-446655440501',
    number: 1,
    title: 'Create NGC 7000 HOO 2026 project structure',
    origin: 'project',
    state: 'ready_for_review',
    planType: 'source_map',
    destructiveDestination: 'archive',
    items_total: plan1Items.length,
    items_applied: 0,
    items_failed: 0,
    items_skipped: 0,
    items_cancelled: 0,
    items_pending: plan1Items.length,
    total_bytes_required: 0,
    created_at: '2026-04-19T10:00:00Z',
  },

  // Plan 2: Cleanup plan — matches wireframe (plan-#23)
  {
    id: 'plan-23',
    number: 23,
    title: 'NGC 7000 HOO 2026 — post-stack cleanup',
    origin: 'cleanup',
    state: 'ready_for_review',
    planType: 'cleanup',
    destructiveDestination: 'archive',
    items_total: cleanupItems.length,
    items_applied: 0,
    items_failed: 0,
    items_skipped: 0,
    items_cancelled: 0,
    items_pending: cleanupItems.length,
    total_bytes_required: 2_202_009_600, // 2.1 GB
    created_at: new Date(Date.now() - 12 * 60_000).toISOString(),
  },

  // Plan 3: Already applied source view plan
  {
    id: '550e8400-e29b-41d4-a716-446655440504',
    number: 4,
    title: 'NGC 7000 OIII source view',
    origin: 'project',
    state: 'applied',
    planType: 'source_map',
    destructiveDestination: 'archive',
    items_total: plan4Items.length,
    items_applied: plan4Items.length,
    items_failed: 0,
    items_skipped: 0,
    items_cancelled: 0,
    items_pending: 0,
    total_bytes_required: 0,
    created_at: '2026-04-16T08:00:00Z',
    approved_at: '2026-04-16T08:05:00Z',
  },
];

// ---------------------------------------------------------------------------
// Plan detail — the cleanup plan from wireframe
// ---------------------------------------------------------------------------

export const planDetail: PlanDetail = {
  ...plans[1],
  approved_at: undefined,
  items: cleanupItems,
};
