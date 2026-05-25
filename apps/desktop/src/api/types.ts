// ─── Enumerations ────────────────────────────────────────────────────────────

export type SessionState =
  | 'discovered'
  | 'candidate'
  | 'needs_review'
  | 'confirmed'
  | 'rejected'
  | 'ignored';

export type ProjectState =
  | 'setup_incomplete'
  | 'ready'
  | 'prepared'
  | 'processing'
  | 'completed'
  | 'archived'
  | 'blocked';

export type PlanState =
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

export type ConfidenceLevel =
  | 'unknown'
  | 'low'
  | 'medium'
  | 'high'
  | 'confirmed'
  | 'rejected';

export type ProvenanceOrigin =
  | 'reviewed'
  | 'inferred'
  | 'observed'
  | 'generated'
  | 'planned'
  | 'applied';

export type ViewMode = 'center' | 'pipeline' | 'combined';

export type PlanKind =
  | 'project_structure'
  | 'source_view'
  | 'source_view_removal'
  | 'archive'
  | 'cleanup'
  | 'root_remap'
  | 'manifest';

export type Density = 'compact' | 'comfortable' | 'spacious';

export type CalibrationKind =
  | 'dark'
  | 'flat'
  | 'bias'
  | 'dark_flat'
  | 'bad_pixel_map';

export type PlanItemAction =
  | 'mkdir'
  | 'move'
  | 'copy'
  | 'link'
  | 'junction'
  | 'write'
  | 'archive'
  | 'trash'
  | 'delete';

export type PlanItemStatus =
  | 'pending'
  | 'applied'
  | 'failed'
  | 'skipped'
  | 'protected';

export type AuditOutcome =
  | 'applied'
  | 'ok'
  | 'refused'
  | 'failed'
  | 'paused';

export type ReviewItemKind = 'session' | 'unclassified_file';

export type SearchResultKind =
  | 'session'
  | 'target'
  | 'project'
  | 'page'
  | 'action';

export type TargetKind =
  | 'deep_sky'
  | 'planetary'
  | 'lunar'
  | 'solar'
  | 'landscape';

// ─── Shared Interfaces ───────────────────────────────────────────────────────

export interface MetaValue {
  value: unknown;
  raw?: string;
  origin: ProvenanceOrigin;
  confidence: ConfidenceLevel;
  evidence_ref?: string;
}

export interface AppPreferences {
  sidebarCollapsed: boolean;
  density: Density;
  projectViewModes: Record<string, ViewMode>;
  defaultProjectView: ViewMode;
  sessionsGroupBy: 'none' | 'target' | 'month' | 'filter' | 'train';
  sessionsView: 'list' | 'calendar';
  tourCompleted: { step1: boolean; step2: boolean; step3: boolean };
  setupCompleted: boolean;
}

export interface SourceMap {
  lights: string[];
  darks: string[];
  flats: string[];
  bias: string[];
  dark_flats: string[];
}

export interface OperationHandle {
  operation_id: string;
  kind: string;
}

export interface ProgressEvent {
  operation_id: string;
  discovered: number;
  total: number;
  current_item: string;
  elapsed_ms: number;
  warnings: string[];
  completion_state?: 'completed' | 'failed' | 'paused';
}

export interface SettingsData {
  [key: string]: unknown;
}

// ─── Entity Interfaces ───────────────────────────────────────────────────────

export interface AcquisitionSession {
  id: string;
  session_key: {
    target: string;
    filter: string;
    binning: string;
    gain: string;
    night: string;
  };
  state: SessionState;
  confidence: ConfidenceLevel;
  optical_train_id: string;
  frame_count: number;
  total_integration_seconds: number;
  total_size_bytes: number;
  metadata: Record<string, MetaValue>;
  target_ids: string[];
  project_ids: string[];
  warnings: string[];
}

export interface CalibrationMaster {
  id: string;
  kind: CalibrationKind;
  fingerprint: {
    camera: string;
    sensor_mode?: string;
    exposure_s: number;
    temp_c?: number;
    gain: number;
    binning: string;
    filter?: string;
  };
  source_session_id: string;
  created_at: string;
  age_days: number;
  size_bytes: number;
  used_by_session_ids: string[];
  used_by_project_ids: string[];
}

export interface Target {
  id: string;
  name: string;
  aliases: string[];
  catalog_ids: { ngc?: string; ic?: string; messier?: string };
  kind: TargetKind;
  coordinates?: { ra?: number; dec?: number };
  session_count: number;
  project_count: number;
  total_integration_hours: number;
  coverage: Record<string, number>;
  recommended_hours: Record<string, number>;
}

export interface Project {
  id: string;
  name: string;
  workflow_profile_id: string;
  root_path: string;
  state: ProjectState;
  blocked_reason?: string;
  verification_state: 'unreviewed' | 'has_accepted' | 'all_rejected';
  cleanup_state: { reclaimable_bytes: number };
  integration_hours: number;
  target_ids: string[];
  source_map: SourceMap;
  source_view_ids: string[];
  output_ids: string[];
  processing_directory: string;
  output_directory: string;
  updated_at: string;
}

export interface PlanItem {
  action: PlanItemAction;
  source_path: string;
  dest_path: string;
  status: PlanItemStatus;
  dry_run_ok: boolean;
  protection_reason?: string;
  provenance: ProvenanceOrigin;
}

export interface FilesystemPlan {
  id: string;
  kind: PlanKind;
  state: PlanState;
  items: PlanItem[];
  dry_run_result: { passed: number; warnings: number; failures: number };
  has_destructive: boolean;
  reclaim_bytes: number;
  created_at: string;
  approved_at?: string;
  applied_at?: string;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  from_state?: string;
  to_state?: string;
  actor: 'user' | 'system';
  outcome: AuditOutcome;
  detail: string;
}

export interface ReviewItem {
  id: string;
  kind: ReviewItemKind;
  session_id?: string;
  file_path?: string;
  confidence: ConfidenceLevel;
  blocking_reasons: string[];
  evidence: Record<string, MetaValue>;
  suggested_target?: string;
  suggested_filter?: string;
}

export interface SearchResult {
  id: string;
  kind: SearchResultKind;
  label: string;
  sublabel?: string;
  route: string;
  score: number;
}

export interface LibraryRoot {
  id: string;
  path: string;
  category: 'raw' | 'calibration' | 'project' | 'inbox';
  online: boolean;
  file_count: number;
  last_scanned?: string;
}

export interface Equipment {
  id: string;
  name: string;
  kind: string;
  aliases: string[];
}

// ─── Extended Detail Types ───────────────────────────────────────────────────

export interface SessionDetail extends AcquisitionSession {
  framesets: Array<{
    filter: string;
    count: number;
    integration_s: number;
  }>;
  calibration_matches: Array<{
    master_id: string;
    kind: CalibrationKind;
    score: number;
    soft_mismatches: string[];
  }>;
  history: Array<{
    timestamp: string;
    event: string;
    actor: string;
  }>;
}

export interface MasterDetail extends CalibrationMaster {
  compatible_sessions: Array<{
    session_id: string;
    score: number;
    soft_mismatches: string[];
  }>;
  usage_stats: { session_count: number; project_count: number };
}

export interface TargetDetail extends Target {
  sessions: AcquisitionSession[];
  projects: Array<{ id: string; name: string; state: ProjectState }>;
}

export interface ProjectSource {
  role: 'light' | 'dark' | 'flat' | 'bias';
  name: string;
  frames: number;
  hours: string;
  selection: 'selected' | 'candidate';
  warning?: string;
}

export interface ProjectSourceView {
  name: string;
  strategy: 'junction' | 'symlink' | 'hardlink' | 'copy';
  link_count: number;
  plan_ref: string;
}

export interface ProjectOutput {
  id: string;
  filename: string;
  kind: string;
  size_bytes: number;
  date: string;
  verification: 'accepted' | 'unreviewed' | 'superseded';
  protected: boolean;
}

export interface ProjectArtifactGroup {
  type: string;
  count: number;
  total_size_bytes: number;
  cleanup_eligibility: 'eligible' | 'archive' | 'keep' | 'none';
  confidence: ConfidenceLevel;
  tool: string;
  protected: boolean;
  warning?: string;
}

export interface ProjectDetail extends Project {
  targets: string[];
  sources: ProjectSource[];
  source_views: ProjectSourceView[];
  outputs: ProjectOutput[];
  artifacts: ProjectArtifactGroup[];
  lifecycle_stage_index: number;
  audit_count: number;
  plan_count: number;
  cleanup_bytes: number;
  cleanup_label: string;
  total_integration_label: string;
  on_disk_label: string;
  notes_count: number;
  manifest_count: number;
}

export interface PlanDetail extends FilesystemPlan {
  summary: {
    item_count: number;
    reclaim_bytes: number;
    trash_count: number;
    archive_count: number;
    delete_count: number;
    protected_count: number;
  };
}

export interface CalendarData {
  months: Array<{
    year: number;
    month: number;
    days: Array<{
      day: number;
      sessions: Array<{ id: string; target: string; filter: string }>;
    }>;
  }>;
}

export interface RemapVerification {
  root_id: string;
  original_path: string;
  new_path: string;
  samples: Array<{ relative_path: string; found: boolean }>;
  all_verified: boolean;
}

export interface MatchCandidate {
  master_id: string;
  kind: CalibrationKind;
  score: number;
  filter?: string;
  soft_mismatches: string[];
}
