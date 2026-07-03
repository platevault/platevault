// Static mock fixture data for Settings
// Updated to match design V3 mock data — all settings panes.

// ─── Data Sources ────────────────────────────────────────────────────────────

export interface DataSourceRoot {
  id: number;
  path: string;
  type: 'Raw' | 'Calibration' | 'Projects' | 'Inbox' | 'Archive';
  online: boolean;
  files: number | string;
  size: string;
  lastScan: string;
}

export const DATA_SOURCES: DataSourceRoot[] = [
  { id: 1, path: 'D:\\Astrophotography\\Raw', type: 'Raw', online: true, files: 84231, size: '1.8 TB', lastScan: '2h ago' },
  { id: 2, path: 'D:\\Astrophotography\\Calibration', type: 'Calibration', online: true, files: 12044, size: '312 GB', lastScan: '2h ago' },
  { id: 3, path: 'D:\\Astrophotography\\Projects', type: 'Projects', online: true, files: 38112, size: '920 GB', lastScan: '2h ago' },
  { id: 4, path: 'D:\\Astrophotography\\Inbox', type: 'Inbox', online: true, files: 1842, size: '44 GB', lastScan: '2h ago' },
  { id: 5, path: '\\\\NAS-2025\\astro\\archive', type: 'Archive', online: false, files: '?', size: '?', lastScan: 'never' },
  { id: 6, path: 'E:\\AstroOverflow', type: 'Raw', online: true, files: 7931, size: '180 GB', lastScan: '2h ago' },
];

// ─── Processing Tools ─────────────────────────────────────────────────────────

export interface ProcessingToolFixture {
  id: number;
  name: string;
  version: string | null;
  path: string | null;
  enabled: boolean;
  detected: boolean;
}

export const PROCESSING_TOOLS: ProcessingToolFixture[] = [
  { id: 1, name: 'PixInsight', version: '1.8.9-2', path: '/Applications/PixInsight/PixInsight.app', enabled: true, detected: true },
  { id: 2, name: 'WBPP Script', version: '2.7.0', path: null, enabled: true, detected: true },
  { id: 3, name: 'Siril', version: null, path: null, enabled: false, detected: false },
  { id: 4, name: 'AutoStakkert!', version: null, path: null, enabled: false, detected: false },
];

// ─── Calibration Matching Criteria ───────────────────────────────────────────

export interface CalibrationCriterion {
  id: number;
  field: string;
  required: boolean;
  tolerance: string | null;
  notes: string;
}

export const CALIBRATION_CRITERIA: CalibrationCriterion[] = [
  { id: 1, field: 'Camera', required: true, tolerance: null, notes: 'Must match exactly' },
  { id: 2, field: 'Binning', required: true, tolerance: null, notes: 'Must match exactly' },
  { id: 3, field: 'Gain', required: true, tolerance: null, notes: 'Must match exactly' },
  { id: 4, field: 'Sensor temperature', required: false, tolerance: '±2 °C', notes: 'Soft mismatch warning outside tolerance' },
  { id: 5, field: 'Exposure (darks)', required: true, tolerance: null, notes: 'Must match light exposure' },
  { id: 6, field: 'Filter (flats)', required: true, tolerance: null, notes: 'Must match session filter' },
  { id: 7, field: 'Flat age', required: false, tolerance: '90 days', notes: 'Warn if older than threshold' },
  { id: 8, field: 'Dark age', required: false, tolerance: '90 days', notes: 'Warn if older than threshold' },
];

// ─── Target Catalogs ─────────────────────────────────────────────────────────

export interface TargetCatalogFixture {
  id: number;
  name: string;
  objects: number;
  enabled: boolean;
  lastUpdated: string;
}

export const TARGET_CATALOGS: TargetCatalogFixture[] = [
  { id: 1, name: 'Messier', objects: 110, enabled: true, lastUpdated: '2025-01-01' },
  { id: 2, name: 'NGC', objects: 7840, enabled: true, lastUpdated: '2025-01-01' },
  { id: 3, name: 'IC', objects: 5386, enabled: true, lastUpdated: '2025-01-01' },
  { id: 4, name: 'Caldwell', objects: 109, enabled: true, lastUpdated: '2025-01-01' },
  { id: 5, name: 'Sharpless', objects: 313, enabled: false, lastUpdated: '2024-06-01' },
  { id: 6, name: 'Barnard', objects: 369, enabled: false, lastUpdated: '2024-06-01' },
];

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

// ─── Audit Log Events ─────────────────────────────────────────────────────────

export interface AuditEventFixture {
  id: number;
  timestamp: string;
  event: string;
  entity: string;
  outcome: 'ok' | 'warn' | 'error';
  actor: 'user' | 'system';
  detail: string;
}

export const AUDIT_EVENTS: AuditEventFixture[] = [
  { id: 1, timestamp: '2026-04-18T21:42:00Z', event: 'session.confirmed', entity: 'NGC 7000 · SII · 2026-04-18', outcome: 'ok', actor: 'user', detail: 'Session confirmed via review queue' },
  { id: 2, timestamp: '2026-04-18T21:40:00Z', event: 'session.discovered', entity: 'NGC 7000 · SII · 2026-04-18', outcome: 'ok', actor: 'system', detail: 'Inbox scan found 14 new FITS files' },
  { id: 3, timestamp: '2026-04-16T09:12:00Z', event: 'session.confirmed', entity: 'NGC 7000 · OIII · 2026-04-15', outcome: 'ok', actor: 'user', detail: 'Session confirmed via review queue' },
  { id: 4, timestamp: '2026-04-15T21:06:00Z', event: 'session.candidate', entity: 'NGC 7000 · OIII · 2026-04-15', outcome: 'ok', actor: 'system', detail: 'Metadata extraction completed; target and filter resolved' },
  { id: 5, timestamp: '2026-04-12T08:30:00Z', event: 'project.source_added', entity: 'NGC 7000 · SHO mosaic', outcome: 'ok', actor: 'user', detail: 'Session NGC 7000 · Ha · 2026-04-12 added as source' },
  { id: 6, timestamp: '2026-04-10T14:05:00Z', event: 'calibration.master_imported', entity: 'MasterDark_300s_-10C_g100', outcome: 'ok', actor: 'system', detail: 'Master dark imported from scan #14' },
  { id: 7, timestamp: '2026-03-30T22:18:00Z', event: 'session.confirmed', entity: 'M31 · R · 2026-03-30', outcome: 'ok', actor: 'user', detail: 'Session confirmed via review queue' },
  { id: 8, timestamp: '2026-03-28T20:00:00Z', event: 'session.discovered', entity: 'M31 · L · 2026-03-28', outcome: 'warn', actor: 'system', detail: 'Filter origin is inferred — needs review' },
];

// ─── Legacy / existing settings shape (retained) ──────────────────────────────

interface CleanupPolicyCell {
  action: 'keep' | 'trash' | 'delete' | 'archive' | 'rm_link';
}

interface CleanupPolicyRow {
  label: string;
  pixinsight: CleanupPolicyCell;
  siril: CleanupPolicyCell;
  planetary: CleanupPolicyCell;
  trigger: string;
  destructive?: boolean;
}

interface ProtectionRule {
  category: string;
  file_patterns: string[];
  min_age_days?: number;
  reason: string;
}

interface NamingToken {
  token: string;
  label: string;
  example: string;
}

interface NamingStructureConfig {
  tokens: NamingToken[];
  separator: string;
  overrides: {
    darks?: NamingToken[];
    flats?: NamingToken[];
    bias?: NamingToken[];
  };
}

interface WorkflowToolConfig {
  id: string;
  label: string;
  executable_path?: string;
  enabled: boolean;
}

interface SourceViewStrategy {
  id: 'manifest' | 'symlinks' | 'junctions' | 'hardlinks' | 'copy' | 'hybrid';
  label: string;
  platform_availability: string[];
}

interface LibraryRoot {
  path: string;
  category: 'Raw' | 'Calibration' | 'Projects' | 'Inbox';
  state: 'online' | 'offline';
  files: number | string;
  last_scan: string;
  warn?: boolean;
}

interface SettingsData {
  roots: LibraryRoot[];
  naming_structure: NamingStructureConfig;
  source_view_strategy: SourceViewStrategy['id'];
  processing_directory: string;
  output_directory: string;
  cleanup_policy: CleanupPolicyRow[];
  protection_rules: ProtectionRule[];
  workflow_tools: WorkflowToolConfig[];
  log_level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  log_retention_days: number;
  catalog_sync_enabled: boolean;
  catalog_last_synced_at?: string;
}

export const settingsData: SettingsData = {
  roots: [
    { path: 'D:\\Astrophotography\\Raw', category: 'Raw', state: 'online', files: 84231, last_scan: '2h ago' },
    { path: 'D:\\Astrophotography\\Calibration', category: 'Calibration', state: 'online', files: 12044, last_scan: '2h ago' },
    { path: 'D:\\Astrophotography\\Projects', category: 'Projects', state: 'online', files: 38112, last_scan: '2h ago' },
    { path: 'D:\\Astrophotography\\Inbox', category: 'Inbox', state: 'online', files: 1842, last_scan: '2h ago' },
    { path: '\\\\NAS-2025\\astro\\archive', category: 'Inbox', state: 'offline', files: '?', last_scan: 'never', warn: true },
    { path: 'E:\\AstroOverflow', category: 'Raw', state: 'online', files: 7931, last_scan: '2h ago' },
  ],

  naming_structure: {
    tokens: [
      { token: '{target}', label: 'Target', example: 'NGC7000' },
      { token: '{filter}', label: 'Filter', example: 'Ha' },
      { token: '{date}', label: 'Date', example: '2026-04-15' },
      { token: '{frame_type}', label: 'Frame type', example: 'lights' },
    ],
    separator: '/',
    overrides: {},
  },

  source_view_strategy: 'junctions',

  processing_directory: 'processing/',
  output_directory: 'outputs/',

  cleanup_policy: [
    { label: 'Registered frames', pixinsight: { action: 'trash' }, siril: { action: 'trash' }, planetary: { action: 'keep' }, trigger: 'after output verified' },
    { label: 'Calibrated frames', pixinsight: { action: 'trash' }, siril: { action: 'trash' }, planetary: { action: 'keep' }, trigger: 'after output verified' },
    { label: 'Debayered frames', pixinsight: { action: 'trash' }, siril: { action: 'trash' }, planetary: { action: 'keep' }, trigger: 'after output verified' },
    { label: 'Local normalized', pixinsight: { action: 'trash' }, siril: { action: 'keep' }, planetary: { action: 'keep' }, trigger: 'after output verified' },
    { label: 'Drizzle data', pixinsight: { action: 'trash' }, siril: { action: 'trash' }, planetary: { action: 'keep' }, trigger: 'after output verified' },
    { label: 'Integration cache', pixinsight: { action: 'trash' }, siril: { action: 'trash' }, planetary: { action: 'trash' }, trigger: 'after output verified' },
    { label: 'Stack output (intermediate)', pixinsight: { action: 'keep' }, siril: { action: 'keep' }, planetary: { action: 'keep' }, trigger: '—' },
    { label: 'Temporary files', pixinsight: { action: 'delete' }, siril: { action: 'delete' }, planetary: { action: 'delete' }, trigger: 'always', destructive: true },
    { label: 'Processing logs', pixinsight: { action: 'archive' }, siril: { action: 'archive' }, planetary: { action: 'archive' }, trigger: 'on completion' },
    { label: 'Process icons / tool config', pixinsight: { action: 'keep' }, siril: { action: 'keep' }, planetary: { action: 'keep' }, trigger: '—' },
  ],

  protection_rules: [
    {
      category: 'raw_lights',
      file_patterns: ['*.fit', '*.fits', '*.fts'],
      reason: 'Raw light frames are user-owned source material — never delete automatically',
    },
    {
      category: 'masters',
      file_patterns: ['*master*.xisf', '*master*.fits', '*master*.fit'],
      reason: 'Calibration masters are expensive to recreate',
    },
    {
      category: 'accepted_outputs',
      file_patterns: ['*.xisf', '*.tif', '*.tiff'],
      min_age_days: 0,
      reason: 'Accepted outputs must be protected until explicitly released',
    },
  ],

  workflow_tools: [
    {
      id: 'pixinsight',
      label: 'PixInsight',
      executable_path: '/Applications/PixInsight/PixInsight.app',
      enabled: true,
    },
    {
      id: 'siril',
      label: 'Siril',
      executable_path: undefined,
      enabled: false,
    },
    {
      id: 'planetary',
      label: 'AutoStakkert! / Registax',
      executable_path: undefined,
      enabled: false,
    },
  ],

  log_level: 'info',
  log_retention_days: 30,

  catalog_sync_enabled: true,
  catalog_last_synced_at: '2026-04-01T00:00:00Z',
};
