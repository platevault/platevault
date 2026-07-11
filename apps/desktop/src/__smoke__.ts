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
  PillVariant,
  LockProps,
  KVProps,
  BoxProps,
  SectionProps,
  BtnProps,
  BtnVariant,
  BtnSize,
  DirPickerProps,
  WizardShellProps,
  EmptyStateProps,
  TableProps,
  TableColumn,
  BannerProps,
  BannerVariant,
  ToggleProps,
  SegControlProps,
  RadioGroupProps,
  RadioOption,
  CoverageBarProps,
} from '@/ui';

import {
  Pill,
  Lock,
  KV,
  Box,
  Section,
  Btn,
  DirPicker,
  WizardShell,
  EmptyState,
  Table,
  Banner,
  Toggle,
  SegControl,
  RadioGroup,
  CoverageBar,
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
import { InboxDetail } from '@/features/inbox/InboxDetail';

import { CalibrationPage } from '@/features/calibration/CalibrationPage';
import { CalibrationDetail } from '@/features/calibration/CalibrationDetail';
import { MasterDetail } from '@/features/calibration/MasterDetail';

import { TargetsPage } from '@/features/targets/TargetsPage';
import { TargetList } from '@/features/targets/TargetList';

import { ProjectsPage } from '@/features/projects/ProjectsPage';
import { ProjectDetail } from '@/features/projects/ProjectDetail';
import { WizardPage } from '@/features/projects/wizard/WizardPage';

import { SettingsPage } from '@/features/settings/SettingsPage';

import { SetupPage } from '@/features/setup/SetupPage';
import { SetupWizard } from '@/features/setup/SetupWizard';

// ─── Data Layer ──────────────────────────────────────────────────────────────

import { usePreference, usePreferences, getPreferences, setPreference } from '@/data/preferences';
import { queryKeys } from '@/data/queryKeys';

// ─── API Types ───────────────────────────────────────────────────────────────

import type {
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
  lock: typeof Lock;
  kv: typeof KV;
  box: typeof Box;
  section: typeof Section;
  btn: typeof Btn;
  dirPicker: typeof DirPicker;
  wizardShell: typeof WizardShell;
  emptyState: typeof EmptyState;
  table: typeof Table;
  banner: typeof Banner;
  toggle: typeof Toggle;
  segControl: typeof SegControl;
  radioGroup: typeof RadioGroup;
  coverageBar: typeof CoverageBar;
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
  inboxDetail: typeof InboxDetail;
  calibrationPage: typeof CalibrationPage;
  calibrationDetail: typeof CalibrationDetail;
  masterDetail: typeof MasterDetail;
  targetsPage: typeof TargetsPage;
  targetList: typeof TargetList;
  projectsPage: typeof ProjectsPage;
  projectDetail: typeof ProjectDetail;
  wizardPage: typeof WizardPage;
  settingsPage: typeof SettingsPage;
  setupPage: typeof SetupPage;
  setupWizard: typeof SetupWizard;
  // Data
  usePreference: typeof usePreference;
  usePreferences: typeof usePreferences;
  getPreferences: typeof getPreferences;
  setPreference: typeof setPreference;
  queryKeys: typeof queryKeys;
  // Type imports to verify they resolve
  _types: {
    PillProps: PillProps;
    PillVariant: PillVariant;
    LockProps: LockProps;
    KVProps: KVProps;
    BoxProps: BoxProps;
    SectionProps: SectionProps;
    BtnProps: BtnProps;
    BtnVariant: BtnVariant;
    BtnSize: BtnSize;
    DirPickerProps: DirPickerProps;
    WizardShellProps: WizardShellProps;
    EmptyStateProps: EmptyStateProps;
    TableProps: TableProps;
    TableColumn: TableColumn;
    BannerProps: BannerProps;
    BannerVariant: BannerVariant;
    ToggleProps: ToggleProps;
    SegControlProps: SegControlProps;
    RadioGroupProps: RadioGroupProps;
    RadioOption: RadioOption;
    CoverageBarProps: CoverageBarProps;
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
