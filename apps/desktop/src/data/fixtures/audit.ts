// Static mock fixture data for AuditEntry (20 entries)
// Types mirror @/api/types — inline definitions used until that module is created

type AuditOutcome = 'applied' | 'ok' | 'refused' | 'failed' | 'paused';

interface AuditEntry {
  id: string;
  timestamp: string; // ISO date-time with milliseconds
  event_type: string; // dot-notation: entity.action
  entity_type: string;
  entity_id: string;
  from_state?: string;
  to_state?: string;
  actor: 'user' | 'system';
  outcome: AuditOutcome;
  detail: string;
}

export const auditEntries: AuditEntry[] = [
  // 1. Session discovered by system scan
  {
    id: '550e8400-e29b-41d4-a716-446655450001',
    timestamp: '2026-04-12T21:05:03.412Z',
    event_type: 'session.discovered',
    entity_type: 'acquisition_session',
    entity_id: '550e8400-e29b-41d4-a716-446655440001',
    to_state: 'discovered',
    actor: 'system',
    outcome: 'ok',
    detail: 'Inbox scan found 18 FITS files matching NGC7000/Ha/2026-04-12 pattern',
  },

  // 2. Session moved to candidate
  {
    id: '550e8400-e29b-41d4-a716-446655450002',
    timestamp: '2026-04-12T21:05:04.001Z',
    event_type: 'session.candidate',
    entity_type: 'acquisition_session',
    entity_id: '550e8400-e29b-41d4-a716-446655440001',
    from_state: 'discovered',
    to_state: 'candidate',
    actor: 'system',
    outcome: 'ok',
    detail: 'Metadata extraction succeeded; target=NGC7000, filter=Ha, confidence=medium',
  },

  // 3. Refused transition: attempted confirm while still discovered
  {
    id: '550e8400-e29b-41d4-a716-446655450003',
    timestamp: '2026-04-12T21:15:00.000Z',
    event_type: 'session.confirm.refused',
    entity_type: 'acquisition_session',
    entity_id: '550e8400-e29b-41d4-a716-446655440001',
    from_state: 'discovered',
    actor: 'user',
    outcome: 'refused',
    detail: 'transition.refused: session must pass needs_review before confirm',
  },

  // 4. Plan approved — non-destructive
  {
    id: '550e8400-e29b-41d4-a716-446655450004',
    timestamp: '2026-04-16T08:05:00.000Z',
    event_type: 'plan.approved',
    entity_type: 'filesystem_plan',
    entity_id: '550e8400-e29b-41d4-a716-446655440504',
    from_state: 'ready_for_review',
    to_state: 'approved',
    actor: 'user',
    outcome: 'ok',
    detail: 'source_view plan approved; 3 items (mkdir + link)',
  },

  // 5. Plan applied
  {
    id: '550e8400-e29b-41d4-a716-446655450005',
    timestamp: '2026-04-16T08:06:02.145Z',
    event_type: 'plan.applied',
    entity_type: 'filesystem_plan',
    entity_id: '550e8400-e29b-41d4-a716-446655440504',
    from_state: 'approved',
    to_state: 'applied',
    actor: 'system',
    outcome: 'applied',
    detail: 'All 3 items applied successfully in 2.1s',
  },

  // 6. Session confirmed by user
  {
    id: '550e8400-e29b-41d4-a716-446655450006',
    timestamp: '2026-04-16T09:12:34.000Z',
    event_type: 'session.confirmed',
    entity_type: 'acquisition_session',
    entity_id: '550e8400-e29b-41d4-a716-446655440005',
    from_state: 'needs_review',
    to_state: 'confirmed',
    actor: 'user',
    outcome: 'applied',
    detail: 'Reviewed and confirmed via Review queue; confidence=confirmed',
  },

  // 7. Session confirmed (SII)
  {
    id: '550e8400-e29b-41d4-a716-446655450007',
    timestamp: '2026-04-19T07:45:00.000Z',
    event_type: 'session.confirmed',
    entity_type: 'acquisition_session',
    entity_id: '550e8400-e29b-41d4-a716-446655440006',
    from_state: 'needs_review',
    to_state: 'confirmed',
    actor: 'user',
    outcome: 'applied',
    detail: 'Reviewed and confirmed via Review queue; confidence=high',
  },

  // 8. Plan refused: tried to approve with dry-run failures
  {
    id: '550e8400-e29b-41d4-a716-446655450008',
    timestamp: '2026-04-19T10:05:00.000Z',
    event_type: 'plan.approve.refused',
    entity_type: 'filesystem_plan',
    entity_id: '550e8400-e29b-41d4-a716-446655440501',
    from_state: 'ready_for_review',
    actor: 'user',
    outcome: 'refused',
    detail: 'plan.refused: destination path /media/Astrophoto/Projects/NGC7000_HOO_2026/lights/Ha already exists',
  },

  // 9. Session rejected
  {
    id: '550e8400-e29b-41d4-a716-446655450009',
    timestamp: '2026-04-19T11:00:00.000Z',
    event_type: 'session.rejected',
    entity_type: 'acquisition_session',
    entity_id: '550e8400-e29b-41d4-a716-446655440009',
    from_state: 'needs_review',
    to_state: 'rejected',
    actor: 'user',
    outcome: 'applied',
    detail: 'Rejected: high cloud cover and poor seeing (FWHM > 6 arcsec)',
  },

  // 10. Scan started
  {
    id: '550e8400-e29b-41d4-a716-446655450010',
    timestamp: '2026-04-20T06:00:00.000Z',
    event_type: 'scan.started',
    entity_type: 'data_source',
    entity_id: '550e8400-e29b-41d4-a716-446655440901',
    actor: 'user',
    outcome: 'ok',
    detail: 'Full library scan initiated; 2 roots queued',
  },

  // 11. Scan completed
  {
    id: '550e8400-e29b-41d4-a716-446655450011',
    timestamp: '2026-04-20T06:14:33.229Z',
    event_type: 'scan.completed',
    entity_type: 'data_source',
    entity_id: '550e8400-e29b-41d4-a716-446655440901',
    actor: 'system',
    outcome: 'ok',
    detail: 'Scan completed in 873s; 12,450 files indexed, 3 new sessions detected',
  },

  // 12. Session re-opened (confirmed → needs_review)
  {
    id: '550e8400-e29b-41d4-a716-446655450012',
    timestamp: '2026-04-20T08:30:00.000Z',
    event_type: 'session.reopened',
    entity_type: 'acquisition_session',
    entity_id: '550e8400-e29b-41d4-a716-446655440007',
    from_state: 'confirmed',
    to_state: 'needs_review',
    actor: 'user',
    outcome: 'applied',
    detail: 'Re-opened for review: filter origin required re-verification',
  },

  // 13. Session re-confirmed
  {
    id: '550e8400-e29b-41d4-a716-446655450013',
    timestamp: '2026-04-20T08:32:00.000Z',
    event_type: 'session.confirmed',
    entity_type: 'acquisition_session',
    entity_id: '550e8400-e29b-41d4-a716-446655440007',
    from_state: 'needs_review',
    to_state: 'confirmed',
    actor: 'user',
    outcome: 'applied',
    detail: 'Re-confirmed after filter verification; origin updated to reviewed',
  },

  // 14. Plan approved — cleanup with trash
  {
    id: '550e8400-e29b-41d4-a716-446655450014',
    timestamp: '2026-04-20T09:00:00.000Z',
    event_type: 'plan.approved',
    entity_type: 'filesystem_plan',
    entity_id: '550e8400-e29b-41d4-a716-446655440502',
    from_state: 'ready_for_review',
    to_state: 'approved',
    actor: 'user',
    outcome: 'ok',
    detail: 'cleanup plan approved; 3 items to trash, 1 protected item skipped',
  },

  // 15. Project state transition: ready → processing
  {
    id: '550e8400-e29b-41d4-a716-446655450015',
    timestamp: '2026-04-20T14:00:00.000Z',
    event_type: 'project.processing',
    entity_type: 'project',
    entity_id: '550e8400-e29b-41d4-a716-446655440302',
    from_state: 'ready',
    to_state: 'processing',
    actor: 'user',
    outcome: 'applied',
    detail: 'PixInsight launched with source view path as working folder',
  },

  // 16. Refused plan approval: has_destructive flag without acknowledgement
  {
    id: '550e8400-e29b-41d4-a716-446655450016',
    timestamp: '2026-04-21T10:00:00.000Z',
    event_type: 'plan.approve.refused',
    entity_type: 'filesystem_plan',
    entity_id: '550e8400-e29b-41d4-a716-446655440503',
    from_state: 'ready_for_review',
    actor: 'user',
    outcome: 'refused',
    detail: 'plan.refused: destructive plan requires delete_acknowledged=true in request',
  },

  // 17. Cleanup plan applied (partially)
  {
    id: '550e8400-e29b-41d4-a716-446655450017',
    timestamp: '2026-04-21T10:30:00.000Z',
    event_type: 'plan.applied',
    entity_type: 'filesystem_plan',
    entity_id: '550e8400-e29b-41d4-a716-446655440502',
    from_state: 'applying',
    to_state: 'applied',
    actor: 'system',
    outcome: 'applied',
    detail: '3 items trashed, 1 skipped (protected). Reclaimed 1.0 GiB',
  },

  // 18. Session ignored
  {
    id: '550e8400-e29b-41d4-a716-446655450018',
    timestamp: '2026-04-21T11:00:00.000Z',
    event_type: 'session.ignored',
    entity_type: 'acquisition_session',
    entity_id: '550e8400-e29b-41d4-a716-446655440010',
    from_state: 'discovered',
    to_state: 'ignored',
    actor: 'user',
    outcome: 'applied',
    detail: 'Marked ignored: aborted session, fewer than 10 frames',
  },

  // 19. Failed plan application (disk full)
  {
    id: '550e8400-e29b-41d4-a716-446655450019',
    timestamp: '2026-04-22T08:00:00.000Z',
    event_type: 'plan.failed',
    entity_type: 'filesystem_plan',
    entity_id: '550e8400-e29b-41d4-a716-446655440501',
    from_state: 'applying',
    to_state: 'failed',
    actor: 'system',
    outcome: 'failed',
    detail: 'plan.failed: OS error 28 — no space left on device at item 5/8',
  },

  // 20. Plan refused: unreviewed provenance blocking confirmation
  {
    id: '550e8400-e29b-41d4-a716-446655450020',
    timestamp: '2026-04-22T09:00:00.000Z',
    event_type: 'session.confirm.refused',
    entity_type: 'acquisition_session',
    entity_id: '550e8400-e29b-41d4-a716-446655440003',
    from_state: 'needs_review',
    actor: 'user',
    outcome: 'refused',
    detail: 'provenance.unreviewed: field "filter" origin is inferred — must be reviewed before confirm',
  },
];
