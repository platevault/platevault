// Static mock fixture data for Settings

// ─── Cleanup Per-type Actions ─────────────────────────────────────────────────

/** Process-stage grouping for the per-type cleanup table. */
export type CleanupStage =
  | 'Source frames'
  | 'Calibration masters'
  | 'Processing intermediates'
  | 'Outputs'
  | 'Project metadata';

/** Stage render order for the per-type cleanup table. */
export const CLEANUP_STAGE_ORDER: CleanupStage[] = [
  'Source frames',
  'Calibration masters',
  'Processing intermediates',
  'Outputs',
  'Project metadata',
];

export interface CleanupTypeFixture {
  id: number;
  type: string;
  action: 'Keep' | 'Archive' | 'Delete';
  stage: CleanupStage;
  /**
   * High-value / irreplaceable category. Editable like any other row, but
   * changing its action away from Keep surfaces an impact warning. Replaces
   * the old hard `locked` flag (categories are no longer locked).
   */
  warnOnChange?: boolean;
}

export const CLEANUP_TYPES: CleanupTypeFixture[] = [
  // Source frames — raw captures. Lights are irreplaceable (Keep + warn);
  // raw calibration captures are bulky and re-derivable into masters (Archive).
  { id: 1, type: 'Raw light frames', action: 'Keep', stage: 'Source frames', warnOnChange: true },
  { id: 2, type: 'Raw dark frames', action: 'Archive', stage: 'Source frames' },
  { id: 3, type: 'Raw flat frames', action: 'Archive', stage: 'Source frames' },
  { id: 4, type: 'Raw bias frames', action: 'Archive', stage: 'Source frames' },
  // Calibration masters — the distilled, reused product. Keep + warn.
  { id: 5, type: 'Master dark', action: 'Keep', stage: 'Calibration masters', warnOnChange: true },
  { id: 6, type: 'Master flat', action: 'Keep', stage: 'Calibration masters', warnOnChange: true },
  { id: 7, type: 'Master bias', action: 'Keep', stage: 'Calibration masters', warnOnChange: true },
  // Processing intermediates — regenerable by re-running the pipeline.
  { id: 8, type: 'Registered frames', action: 'Delete', stage: 'Processing intermediates' },
  { id: 9, type: 'Calibrated frames', action: 'Delete', stage: 'Processing intermediates' },
  { id: 10, type: 'Debayered frames', action: 'Delete', stage: 'Processing intermediates' },
  { id: 11, type: 'Local normalized', action: 'Delete', stage: 'Processing intermediates' },
  { id: 12, type: 'Drizzle data', action: 'Delete', stage: 'Processing intermediates' },
  { id: 13, type: 'Integration cache', action: 'Delete', stage: 'Processing intermediates' },
  { id: 14, type: 'Stack output (intermediate)', action: 'Archive', stage: 'Processing intermediates' },
  { id: 15, type: 'Temporary files', action: 'Delete', stage: 'Processing intermediates' },
  // Outputs — the finished, accepted result. Keep + warn.
  { id: 16, type: 'Accepted outputs', action: 'Keep', stage: 'Outputs', warnOnChange: true },
  // Project metadata & misc.
  { id: 17, type: 'Processing logs', action: 'Archive', stage: 'Project metadata' },
  { id: 18, type: 'Process icons / tool config', action: 'Keep', stage: 'Project metadata' },
  { id: 19, type: 'Manual notes', action: 'Keep', stage: 'Project metadata' },
  { id: 20, type: 'Unknown files', action: 'Keep', stage: 'Project metadata' },
];
