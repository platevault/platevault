// Static mock fixture data for Settings
// Wireframe-aligned data matching canvas-wireframes-2026-05-24/project/wireframes/settings.jsx

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
