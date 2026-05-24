// Static mock fixture data for SettingsData
// Types mirror @/api/types — inline definitions used until that module is created

interface CleanupPolicyCell {
  action: 'keep' | 'trash' | 'delete' | 'review';
}

interface CleanupPolicyMatrix {
  // rows: data type; columns: processing tool
  calibrated_lights: {
    pixinsight: CleanupPolicyCell;
    siril: CleanupPolicyCell;
    planetary: CleanupPolicyCell;
  };
  registered_lights: {
    pixinsight: CleanupPolicyCell;
    siril: CleanupPolicyCell;
    planetary: CleanupPolicyCell;
  };
  stacked_outputs: {
    pixinsight: CleanupPolicyCell;
    siril: CleanupPolicyCell;
    planetary: CleanupPolicyCell;
  };
  drizzle_outputs: {
    pixinsight: CleanupPolicyCell;
    siril: CleanupPolicyCell;
    planetary: CleanupPolicyCell;
  };
  weight_maps: {
    pixinsight: CleanupPolicyCell;
    siril: CleanupPolicyCell;
    planetary: CleanupPolicyCell;
  };
  rejection_maps: {
    pixinsight: CleanupPolicyCell;
    siril: CleanupPolicyCell;
    planetary: CleanupPolicyCell;
  };
  logs: {
    pixinsight: CleanupPolicyCell;
    siril: CleanupPolicyCell;
    planetary: CleanupPolicyCell;
  };
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
  id: 'symlinks' | 'junctions' | 'hardlinks' | 'copy';
  label: string;
  platform_availability: string[];
}

interface SettingsData {
  naming_structure: NamingStructureConfig;
  source_view_strategy: SourceViewStrategy['id'];
  processing_directory: string;
  output_directory: string;
  cleanup_policy: CleanupPolicyMatrix;
  protection_rules: ProtectionRule[];
  workflow_tools: WorkflowToolConfig[];
  log_level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  log_retention_days: number;
  catalog_sync_enabled: boolean;
  catalog_last_synced_at?: string;
}

export const settingsData: SettingsData = {
  naming_structure: {
    tokens: [
      { token: '{target}', label: 'Target', example: 'NGC7000' },
      { token: '{filter}', label: 'Filter', example: 'Ha' },
      { token: '{date}', label: 'Date', example: '2026-04-15' },
      { token: '{exposure}s', label: 'Exposure', example: '600s' },
    ],
    separator: '_',
    overrides: {
      darks: [
        { token: '{kind}', label: 'Kind', example: 'dark' },
        { token: '{exposure}s', label: 'Exposure', example: '600s' },
        { token: '{temp}C', label: 'Temperature', example: '-15C' },
        { token: '{gain}g', label: 'Gain', example: '100g' },
      ],
      flats: [
        { token: '{kind}', label: 'Kind', example: 'flat' },
        { token: '{filter}', label: 'Filter', example: 'Ha' },
        { token: '{date}', label: 'Date', example: '2026-04-15' },
      ],
    },
  },

  source_view_strategy: 'symlinks',

  processing_directory: 'processing/',
  output_directory: 'outputs/',

  cleanup_policy: {
    calibrated_lights: {
      pixinsight: { action: 'trash' },
      siril: { action: 'trash' },
      planetary: { action: 'keep' },
    },
    registered_lights: {
      pixinsight: { action: 'trash' },
      siril: { action: 'trash' },
      planetary: { action: 'keep' },
    },
    stacked_outputs: {
      pixinsight: { action: 'keep' },
      siril: { action: 'keep' },
      planetary: { action: 'keep' },
    },
    drizzle_outputs: {
      pixinsight: { action: 'keep' },
      siril: { action: 'review' },
      planetary: { action: 'keep' },
    },
    weight_maps: {
      pixinsight: { action: 'trash' },
      siril: { action: 'trash' },
      planetary: { action: 'delete' },
    },
    rejection_maps: {
      pixinsight: { action: 'trash' },
      siril: { action: 'delete' },
      planetary: { action: 'delete' },
    },
    logs: {
      pixinsight: { action: 'keep' },
      siril: { action: 'keep' },
      planetary: { action: 'keep' },
    },
  },

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
