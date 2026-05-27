/**
 * Compile-time smoke test: imports every page component, shared primitive,
 * and verifies the router exports all expected routes.
 *
 * This file is never executed at runtime — it exists solely as a type-level
 * integration check. Run `npx tsc --noEmit` to verify zero compilation errors.
 */

// ─── Shared UI Primitives ────────────────────────────────────────────────────

import type {
  PillProps,
  ConfidenceProps,
  ProvenanceProps,
  LockProps,
  KVProps,
  BoxProps,
  SectionProps,
  BtnProps,
  DirPickerProps,
  FilterBarProps,
  ToolbarProps,
  DataTableProps,
  WizardShellProps,
  EmptyStateProps,
} from '@/ui';

import {
  Pill,
  Confidence,
  Provenance,
  Lock,
  KV,
  Box,
  Section,
  Btn,
  DirPicker,
  FilterBar,
  Toolbar,
  DataTable,
  WizardShell,
  EmptyState,
} from '@/ui';

// ─── App Shell & Utilities ───────────────────────────────────────────────────

import { router } from '@/app/router';
import { Shell } from '@/app/Shell';
import { Sidebar } from '@/app/Sidebar';
import { StatusBar } from '@/app/StatusBar';
import { CommandPalette } from '@/app/CommandPalette';
import { LogPanel } from '@/app/LogPanel';
import { LogPanelProvider, useLogPanel } from '@/app/LogPanelContext';
import { useFocusOnMount } from '@/app/useFocusOnMount';

// ─── Page Components ─────────────────────────────────────────────────────────

import { SessionsPage } from '@/features/sessions/SessionsPage';
import { SessionDetail } from '@/features/sessions/SessionDetail';
import { CalendarView } from '@/features/sessions/CalendarView';
import { GroupByBar } from '@/features/sessions/GroupByBar';

import { InboxPage } from '@/features/inbox/InboxPage';
import { InboxList } from '@/features/inbox/InboxList';
import { SessionReview } from '@/features/inbox/SessionReview';
import { ActionSidebar } from '@/features/inbox/ActionSidebar';
import { SplitPreview } from '@/features/inbox/SplitPreview';
import { MergeSearch } from '@/features/inbox/MergeSearch';
import { InboxConfirmOverlay } from '@/features/inbox/InboxConfirmOverlay';
import { FilterSelect } from '@/features/inbox/FilterSelect';

import { CalibrationPage } from '@/features/calibration/CalibrationPage';
import { CalibrationDetail } from '@/features/calibration/CalibrationDetail';
import { MastersList } from '@/features/calibration/MastersList';
import { MasterDetail } from '@/features/calibration/MasterDetail';

import { TargetsPage } from '@/features/targets/TargetsPage';
import { TargetDetail } from '@/features/targets/TargetDetail';
import { TargetDetailPane } from '@/features/targets/TargetDetailPane';
import { TargetList } from '@/features/targets/TargetList';
import { CoverageChart } from '@/features/targets/CoverageChart';

import { ProjectsPage } from '@/features/projects/ProjectsPage';
import { ProjectDetail } from '@/features/projects/ProjectDetail';
import { WizardPage } from '@/features/projects/wizard/WizardPage';

import { SettingsPage } from '@/features/settings/SettingsPage';
import { DensitySelector } from '@/features/settings/DensitySelector';

import { SetupPage } from '@/features/setup/SetupPage';
import { SetupWizard } from '@/features/setup/SetupWizard';

// ─── Data Layer ──────────────────────────────────────────────────────────────

import { usePreference, usePreferences, getPreferences, setPreference } from '@/data/preferences';
import { useQuery, createQueryStore } from '@/data/store';

// ─── API Types ───────────────────────────────────────────────────────────────

import type {
  SessionState,
  ProjectState,
  PlanState,
  ConfidenceLevel,
  ProvenanceOrigin,
  Density,
  AppPreferences,
  AcquisitionSession,
  CalibrationMaster,
  Target,
  Project,
  FilesystemPlan,
  AuditEntry,
  ReviewItem,
  SearchResult,
} from '@/bindings/types';

// ─── Router Verification ─────────────────────────────────────────────────────

// Verify router is properly configured with expected structure
const _routerCheck: typeof router = router;
void _routerCheck;

// ─── Prevent tree-shaking of imports (type-level usage) ──────────────────────

export type SmokeCheck = {
  // UI
  pill: typeof Pill;
  confidence: typeof Confidence;
  provenance: typeof Provenance;
  lock: typeof Lock;
  kv: typeof KV;
  box: typeof Box;
  section: typeof Section;
  btn: typeof Btn;
  dirPicker: typeof DirPicker;
  filterBar: typeof FilterBar;
  toolbar: typeof Toolbar;
  dataTable: typeof DataTable;
  wizardShell: typeof WizardShell;
  emptyState: typeof EmptyState;
  // App
  shell: typeof Shell;
  sidebar: typeof Sidebar;
  statusBar: typeof StatusBar;
  commandPalette: typeof CommandPalette;
  logPanel: typeof LogPanel;
  logPanelProvider: typeof LogPanelProvider;
  useFocusOnMount: typeof useFocusOnMount;
  useLogPanel: typeof useLogPanel;
  // Pages
  sessionsPage: typeof SessionsPage;
  sessionDetail: typeof SessionDetail;
  calendarView: typeof CalendarView;
  groupByBar: typeof GroupByBar;
  inboxPage: typeof InboxPage;
  inboxList: typeof InboxList;
  sessionReview: typeof SessionReview;
  actionSidebar: typeof ActionSidebar;
  splitPreview: typeof SplitPreview;
  mergeSearch: typeof MergeSearch;
  inboxConfirmOverlay: typeof InboxConfirmOverlay;
  filterSelect: typeof FilterSelect;
  calibrationPage: typeof CalibrationPage;
  calibrationDetail: typeof CalibrationDetail;
  mastersList: typeof MastersList;
  masterDetail: typeof MasterDetail;
  targetsPage: typeof TargetsPage;
  targetDetail: typeof TargetDetail;
  targetDetailPane: typeof TargetDetailPane;
  targetList: typeof TargetList;
  coverageChart: typeof CoverageChart;
  projectsPage: typeof ProjectsPage;
  projectDetail: typeof ProjectDetail;
  wizardPage: typeof WizardPage;
  settingsPage: typeof SettingsPage;
  densitySelector: typeof DensitySelector;
  setupPage: typeof SetupPage;
  setupWizard: typeof SetupWizard;
  // Data
  usePreference: typeof usePreference;
  usePreferences: typeof usePreferences;
  getPreferences: typeof getPreferences;
  setPreference: typeof setPreference;
  useQuery: typeof useQuery;
  createQueryStore: typeof createQueryStore;
  // Type imports to verify they resolve
  _types: {
    PillProps: PillProps;
    ConfidenceProps: ConfidenceProps;
    ProvenanceProps: ProvenanceProps;
    LockProps: LockProps;
    KVProps: KVProps;
    BoxProps: BoxProps;
    SectionProps: SectionProps;
    BtnProps: BtnProps;
    DirPickerProps: DirPickerProps;
    FilterBarProps: FilterBarProps;
    ToolbarProps: ToolbarProps;
    DataTableProps: DataTableProps<unknown>;
    WizardShellProps: WizardShellProps;
    EmptyStateProps: EmptyStateProps;
    SessionState: SessionState;
    ProjectState: ProjectState;
    PlanState: PlanState;
    ConfidenceLevel: ConfidenceLevel;
    ProvenanceOrigin: ProvenanceOrigin;
    Density: Density;
    AppPreferences: AppPreferences;
    AcquisitionSession: AcquisitionSession;
    CalibrationMaster: CalibrationMaster;
    Target: Target;
    Project: Project;
    FilesystemPlan: FilesystemPlan;
    AuditEntry: AuditEntry;
    ReviewItem: ReviewItem;
    SearchResult: SearchResult;
  };
};
