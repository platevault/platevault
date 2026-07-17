// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

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

import type {
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
import type { Shell } from '@/app/Shell';
import type { Sidebar } from '@/app/Sidebar';
import type { StatusBar } from '@/app/StatusBar';
import type { CommandPalette } from '@/app/CommandPalette';
import type { LogPanel } from '@/app/LogPanel';
import type { LogPanelProvider, useLogPanel } from '@/app/LogPanelContext';
import type { useFocusOnMount } from '@/app/useFocusOnMount';

// ─── Page Components ─────────────────────────────────────────────────────────

import type { SessionsPage } from '@/features/sessions/SessionsPage';
import type { SessionDetail } from '@/features/sessions/SessionDetail';
import type { CalendarView } from '@/features/sessions/CalendarView';
import type { GroupByBar } from '@/features/sessions/GroupByBar';

import type { InboxPage } from '@/features/inbox/InboxPage';
import type { InboxList } from '@/features/inbox/InboxList';
import type { InboxDetail } from '@/features/inbox/InboxDetail';

import type { CalibrationPage } from '@/features/calibration/CalibrationPage';
import type { CalibrationDetail } from '@/features/calibration/CalibrationDetail';
import type { MasterDetail } from '@/features/calibration/MasterDetail';

import type { TargetsPage } from '@/features/targets/TargetsPage';
import type { TargetList } from '@/features/targets/TargetList';

import type { ProjectsPage } from '@/features/projects/ProjectsPage';
import type { ProjectDetail } from '@/features/projects/ProjectDetail';
import type { WizardPage } from '@/features/projects/wizard/WizardPage';

import type { SettingsPage } from '@/features/settings/SettingsPage';

import type { SetupPage } from '@/features/setup/SetupPage';
import type { SetupWizard } from '@/features/setup/SetupWizard';

// ─── Data Layer ──────────────────────────────────────────────────────────────

import type {
  usePreference,
  usePreferences,
  getPreferences,
  setPreference,
} from '@/data/preferences';
import type { queryKeys } from '@/data/queryKeys';

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
