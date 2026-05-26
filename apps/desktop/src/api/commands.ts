import type {
  AcquisitionSession,
  CalibrationMaster,
  Target,
  Project,
  FilesystemPlan,
  AuditEntry,
  SearchResult,
  ReviewItem,
  AppPreferences,
  OperationHandle,
  SessionDetail,
  MasterDetail,
  TargetDetail,
  ProjectDetail,
  PlanDetail,
  CalendarData,
  LibraryRoot,
  Equipment,
  SettingsData,
  RemapVerification,
  MatchCandidate,
} from '@/bindings/types';

// Conditionally import mocks or real Tauri invoke
const useMocks = import.meta.env.VITE_USE_MOCKS === 'true';

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (useMocks) {
    const { mockInvoke } = await import('./mocks');
    return mockInvoke<T>(cmd, args);
  }
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

// ---------- Query Commands ----------

export async function listSessions(args?: {
  filters?: Record<string, unknown>;
  sort?: string;
  group_by?: string;
}): Promise<AcquisitionSession[]> {
  return invoke<AcquisitionSession[]>('sessions.list', args);
}

export async function getSession(args: { id: string }): Promise<SessionDetail> {
  return invoke<SessionDetail>('sessions.get', args);
}

export async function getSessionsCalendar(args: {
  start_month: string;
  end_month: string;
}): Promise<CalendarData> {
  return invoke<CalendarData>('sessions.calendar', args);
}

export async function listCalibrationMasters(args?: {
  group_by?: string;
  filters?: Record<string, unknown>;
}): Promise<CalibrationMaster[]> {
  return invoke<CalibrationMaster[]>('calibration.masters.list', args);
}

export async function getCalibrationMaster(args: { id: string }): Promise<MasterDetail> {
  return invoke<MasterDetail>('calibration.masters.get', args);
}

export async function getCalibrationMatches(args: {
  session_id: string;
}): Promise<MatchCandidate[]> {
  return invoke<MatchCandidate[]>('calibration.matches', args);
}

export async function listTargets(args?: { search?: string }): Promise<Target[]> {
  return invoke<Target[]>('targets.list', args);
}

export async function getTarget(args: { id: string }): Promise<TargetDetail> {
  return invoke<TargetDetail>('targets.get', args);
}

export async function listProjects(args?: {
  filters?: Record<string, unknown>;
}): Promise<Project[]> {
  return invoke<Project[]>('projects.list', args);
}

export async function getProject(args: { id: string }): Promise<ProjectDetail> {
  return invoke<ProjectDetail>('projects.get', args);
}

export async function listPlans(args?: {
  filters?: Record<string, unknown>;
}): Promise<FilesystemPlan[]> {
  return invoke<FilesystemPlan[]>('plans.list', args);
}

export async function getPlan(args: { id: string }): Promise<PlanDetail> {
  return invoke<PlanDetail>('plans.get', args);
}

export async function listAuditEntries(args?: {
  filters?: Record<string, unknown>;
  pagination?: { offset: number; limit: number };
}): Promise<{ entries: AuditEntry[]; total: number }> {
  return invoke<{ entries: AuditEntry[]; total: number }>('audit.list', args);
}

export async function exportAudit(args?: {
  filters?: Record<string, unknown>;
}): Promise<string> {
  return invoke<string>('audit.export', args);
}

export async function getSettings(args: { scope: string }): Promise<SettingsData> {
  return invoke<SettingsData>('settings.get', args);
}

export async function listRoots(): Promise<LibraryRoot[]> {
  return invoke<LibraryRoot[]>('roots.list');
}

export async function listEquipment(): Promise<Equipment[]> {
  return invoke<Equipment[]>('equipment.list');
}

export async function getReviewQueue(args?: {
  filter?: string;
}): Promise<ReviewItem[]> {
  return invoke<ReviewItem[]>('review.queue', args);
}

export async function getPreferences(): Promise<AppPreferences> {
  return invoke<AppPreferences>('preferences.get');
}

export async function searchGlobal(args: { query: string }): Promise<SearchResult[]> {
  return invoke<SearchResult[]>('search.global', args);
}

// ---------- Mutation Commands ----------

export async function transitionSession(args: {
  id: string;
  action: string;
  metadata?: Record<string, unknown>;
}): Promise<AcquisitionSession> {
  return invoke<AcquisitionSession>('sessions.transition', args);
}

export async function splitSession(args: {
  id: string;
  split_at_index: number;
}): Promise<{ original: AcquisitionSession; new: AcquisitionSession }> {
  return invoke<{ original: AcquisitionSession; new: AcquisitionSession }>(
    'sessions.split',
    args,
  );
}

export async function mergeSessions(args: {
  ids: string[];
}): Promise<AcquisitionSession> {
  return invoke<AcquisitionSession>('sessions.merge', args);
}

export async function createProjectPlan(args: {
  wizard_state: Record<string, unknown>;
}): Promise<FilesystemPlan> {
  return invoke<FilesystemPlan>('projects.create_plan', args);
}

export async function approvePlan(args: {
  id: string;
  delete_acknowledged?: boolean;
}): Promise<FilesystemPlan> {
  return invoke<FilesystemPlan>('plans.approve', args);
}

export async function applyPlan(args: { id: string }): Promise<OperationHandle> {
  return invoke<OperationHandle>('plans.apply', args);
}

export async function discardPlan(args: { id: string }): Promise<void> {
  return invoke<void>('plans.discard', args);
}

export async function updateSettings(args: {
  scope: string;
  values: Record<string, unknown>;
}): Promise<void> {
  return invoke<void>('settings.update', args);
}

export async function registerRoot(args: {
  path: string;
  category: string;
  scan_settings: Record<string, unknown>;
}): Promise<LibraryRoot> {
  return invoke<LibraryRoot>('roots.register', args);
}

export async function remapRoot(args: {
  root_id: string;
  new_path: string;
}): Promise<RemapVerification> {
  return invoke<RemapVerification>('roots.remap', args);
}

export async function applyRootRemap(args: {
  root_id: string;
  verified: boolean;
}): Promise<void> {
  return invoke<void>('roots.remap.apply', args);
}

export async function startScan(args?: {
  root_ids?: string[];
}): Promise<OperationHandle> {
  return invoke<OperationHandle>('scan.start', args);
}

export async function setPreference(args: {
  key: string;
  value: unknown;
}): Promise<void> {
  return invoke<void>('preferences.set', args);
}

export async function completeTourStep(args: { step: string }): Promise<void> {
  return invoke<void>('tour.complete_step', args);
}

// ---------- First-Run / Batch Commands ----------

export interface BatchSourceEntry {
  kind: string;
  path: string;
  scan_depth?: string;
}

export interface BatchRegisterResult {
  results: Array<{
    kind: string;
    path: string;
    success: boolean;
    root?: LibraryRoot;
    error?: string;
  }>;
}

export interface FirstRunState {
  completed: boolean;
  completed_at?: string;
}

export interface FirstRunCompleteResult {
  success: boolean;
  missing?: string[];
}

export interface FirstRunRestartResult {
  success: boolean;
  prefilled_sources?: Array<{ kind: string; path: string }>;
}

export async function registerRootBatch(args: {
  sources: BatchSourceEntry[];
}): Promise<BatchRegisterResult> {
  return invoke<BatchRegisterResult>('roots.register.batch', args);
}

export async function completeFirstRun(): Promise<FirstRunCompleteResult> {
  return invoke<FirstRunCompleteResult>('firstrun.complete');
}

export async function restartFirstRun(): Promise<FirstRunRestartResult> {
  return invoke<FirstRunRestartResult>('firstrun.restart');
}

export async function getFirstRunState(): Promise<FirstRunState> {
  return invoke<FirstRunState>('firstrun.state');
}
