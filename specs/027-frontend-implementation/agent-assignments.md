# Agent Assignments
# Feature: Desktop Frontend Implementation
# Generated: 2026-05-24
# Command: /speckit.agent-assign.assign
# Strategy: 6-way parallel frontend execution after Shell

agents_scanned:
  - name: "frontend-developer"
    source: "project"
    description: "Build React components, implement responsive layouts, and handle client-side state management. Masters React 19."
  - name: "coder"
    source: "project"
    description: "Implementation subagent for bounded code changes, tests, refactors, and migrations."
  - name: "typescript-pro"
    source: "project"
    description: "Master TypeScript with advanced types, generics, and strict type safety."
  - name: "design-system-architect"
    source: "project"
    description: "Expert design system architect specializing in design tokens, component libraries, theming infrastructure."
  - name: "performance-engineer"
    source: "project"
    description: "Expert performance engineer specializing in optimization, Core Web Vitals, and scalability."

# Execution strategy:
#   Sequential: Phase 1 (Setup) → Phase 2 (Foundational) → Track A (Shell + Sessions)
#   Parallel:   Tracks B, C, D, E, F launch simultaneously after Track A completes Shell (T037)
#   Sequential: Track G (Onboarding) after all tracks complete → Track H (Polish)
#
# Dependency graph:
#   Setup → Foundational → Shell(T033-T037) ─┬─→ Track B (Review)
#                                             ├─→ Track C (Plans → Projects)
#                                             ├─→ Track D (Targets)
#                                             ├─→ Track E (Settings)
#                                             ├─→ Track F (Calibration + Audit)
#                                             └─→ Sessions(T038-T042) ──┐
#                                                                       ├─→ Track G (Onboarding)
#                          All tracks complete ─────────────────────────┘
#                                             └─→ Track H (Polish)

parallel_tracks:
  track_a:
    name: "Shell + Sessions (sequential start)"
    agent: "frontend-developer"
    tasks: [T033, T034, T035, T036, T037, T038, T039, T040, T041, T042]
    depends_on: "foundational"
    notes: "Must complete Shell (T033-T037) before parallel tracks B-F can start"

  track_b:
    name: "Review Queue"
    agent: "frontend-developer"
    tasks: [T043, T044, T045, T046, T047]
    depends_on: "track_a.T037"
    notes: "US3 — independent after Shell"

  track_c:
    name: "Plans → Projects"
    agent: "frontend-developer"
    tasks: [T062, T063, T064, T065, T066, T067, T048, T049, T050, T051, T052, T053, T054, T055, T056, T057, T058, T059, T060, T061]
    depends_on: "track_a.T037"
    notes: "US5 Plans first (T062-T067), then US4 Projects (T048-T061) which needs ApprovalGate from T066"

  track_d:
    name: "Targets"
    agent: "frontend-developer"
    tasks: [T068, T069, T070, T071, T072]
    depends_on: "track_a.T037"
    notes: "US6 — independent after Shell"

  track_e:
    name: "Settings"
    agent: "frontend-developer"
    tasks: [T073, T074, T075, T076, T077, T078, T079, T080, T081, T082, T083, T084]
    depends_on: "track_a.T037"
    notes: "US7 — independent after Shell, largest P3 surface"

  track_f:
    name: "Calibration + Audit"
    agent: "frontend-developer"
    tasks: [T089, T090, T091, T092, T093, T094]
    depends_on: "track_a.T037"
    notes: "US9 + US10 — small independent pages, bundled for efficiency"

  track_g:
    name: "Onboarding + Tour"
    agent: "frontend-developer"
    tasks: [T085, T086, T087, T088]
    depends_on: "all_tracks"
    notes: "US8 — tour anchors to real UI elements from all pages"

  track_h:
    name: "Polish"
    agent: "frontend-developer"
    tasks: [T095, T096, T097, T099]
    depends_on: "track_g"
    notes: "Cross-cutting validation after all features exist"

assignments:
  # Phase 1: Setup — sequential
  T001:
    agent: "coder"
    track: "setup"
    reason: "Directory structure creation"
  T002:
    agent: "coder"
    track: "setup"
    reason: "Package.json initialization"
  T003:
    agent: "coder"
    track: "setup"
    reason: "Vite config"
  T004:
    agent: "coder"
    track: "setup"
    reason: "TypeScript config"
  T005:
    agent: "coder"
    track: "setup"
    reason: "Vitest config"
  T006:
    agent: "coder"
    track: "setup"
    reason: "HTML entry point"

  # Phase 2: Foundational — sequential (tokens → primitives)
  T007:
    agent: "design-system-architect"
    track: "foundational"
    reason: "CSS reset"
  T008:
    agent: "design-system-architect"
    track: "foundational"
    reason: "Design tokens from DESIGN.md §3"
  T009:
    agent: "design-system-architect"
    track: "foundational"
    reason: "Component CSS utilities"
  T010:
    agent: "typescript-pro"
    track: "foundational"
    reason: "All DTO types + enumerations"
  T011:
    agent: "frontend-developer"
    track: "foundational"
    reason: "Tauri invoke wrappers"
  T012:
    agent: "frontend-developer"
    track: "foundational"
    reason: "Mock implementations"
  T013:
    agent: "frontend-developer"
    track: "foundational"
    reason: "useSyncExternalStore pub/sub"
  T014:
    agent: "frontend-developer"
    track: "foundational"
    reason: "localStorage preferences"
  T015:
    agent: "coder"
    track: "foundational"
    reason: "Static fixture data"
  T016:
    agent: "frontend-developer"
    track: "foundational"
    reason: "TanStack Router config"
  T017:
    agent: "frontend-developer"
    track: "foundational"
    reason: "App entry point"
  T018:
    agent: "design-system-architect"
    track: "foundational"
    reason: "Pill primitive"
  T019:
    agent: "design-system-architect"
    track: "foundational"
    reason: "Confidence primitive"
  T020:
    agent: "design-system-architect"
    track: "foundational"
    reason: "Provenance primitive"
  T021:
    agent: "design-system-architect"
    track: "foundational"
    reason: "Lock primitive"
  T022:
    agent: "design-system-architect"
    track: "foundational"
    reason: "KV row primitive"
  T023:
    agent: "design-system-architect"
    track: "foundational"
    reason: "Box primitive"
  T024:
    agent: "design-system-architect"
    track: "foundational"
    reason: "Section primitive"
  T025:
    agent: "design-system-architect"
    track: "foundational"
    reason: "Button primitive"
  T026:
    agent: "design-system-architect"
    track: "foundational"
    reason: "DirPicker primitive"
  T027:
    agent: "design-system-architect"
    track: "foundational"
    reason: "FilterBar primitive"
  T028:
    agent: "design-system-architect"
    track: "foundational"
    reason: "Toolbar primitive"
  T029:
    agent: "design-system-architect"
    track: "foundational"
    reason: "DataTable wrapper"
  T030:
    agent: "design-system-architect"
    track: "foundational"
    reason: "ThreePane layout"
  T031:
    agent: "design-system-architect"
    track: "foundational"
    reason: "WizardShell layout"
  T032:
    agent: "design-system-architect"
    track: "foundational"
    reason: "Barrel export"

  # Track A: Shell + Sessions — sequential start
  T033:
    agent: "frontend-developer"
    track: "track_a"
    reason: "App Shell layout"
  T034:
    agent: "frontend-developer"
    track: "track_a"
    reason: "Sidebar navigation"
  T035:
    agent: "frontend-developer"
    track: "track_a"
    reason: "StatusBar"
  T036:
    agent: "frontend-developer"
    track: "track_a"
    reason: "LogPanel"
  T037:
    agent: "frontend-developer"
    track: "track_a"
    reason: "CommandPalette — GATE: parallel tracks start after this"
  T038:
    agent: "frontend-developer"
    track: "track_a"
    reason: "SessionsPage"
  T039:
    agent: "frontend-developer"
    track: "track_a"
    reason: "GroupByBar"
  T040:
    agent: "frontend-developer"
    track: "track_a"
    reason: "CalendarView"
  T041:
    agent: "frontend-developer"
    track: "track_a"
    reason: "SessionDetail"
  T042:
    agent: "frontend-developer"
    track: "track_a"
    reason: "Sessions route wiring"

  # Track B: Review Queue — parallel after Shell
  T043:
    agent: "frontend-developer"
    track: "track_b"
    reason: "ReviewPage three-pane + keyboard"
  T044:
    agent: "frontend-developer"
    track: "track_b"
    reason: "ReviewQueue list"
  T045:
    agent: "frontend-developer"
    track: "track_b"
    reason: "EvidencePane"
  T046:
    agent: "frontend-developer"
    track: "track_b"
    reason: "DecisionPanel"
  T047:
    agent: "frontend-developer"
    track: "track_b"
    reason: "Review route wiring"

  # Track C: Plans → Projects — parallel after Shell
  T062:
    agent: "frontend-developer"
    track: "track_c"
    reason: "PlansPage"
  T063:
    agent: "frontend-developer"
    track: "track_c"
    reason: "PlanReview"
  T064:
    agent: "frontend-developer"
    track: "track_c"
    reason: "PlanTable"
  T065:
    agent: "frontend-developer"
    track: "track_c"
    reason: "PlanDiff"
  T066:
    agent: "frontend-developer"
    track: "track_c"
    reason: "ApprovalGate — Projects depend on this"
  T067:
    agent: "frontend-developer"
    track: "track_c"
    reason: "Plans route wiring"
  T048:
    agent: "frontend-developer"
    track: "track_c"
    reason: "ProjectsPage"
  T049:
    agent: "frontend-developer"
    track: "track_c"
    reason: "ProjectDetail"
  T050:
    agent: "frontend-developer"
    track: "track_c"
    reason: "CommandCenter"
  T051:
    agent: "frontend-developer"
    track: "track_c"
    reason: "PipelineView"
  T052:
    agent: "frontend-developer"
    track: "track_c"
    reason: "CombinedView"
  T053:
    agent: "frontend-developer"
    track: "track_c"
    reason: "WizardPage orchestrator"
  T054:
    agent: "frontend-developer"
    track: "track_c"
    reason: "StepName"
  T055:
    agent: "frontend-developer"
    track: "track_c"
    reason: "StepSources"
  T056:
    agent: "frontend-developer"
    track: "track_c"
    reason: "StepCalibration"
  T057:
    agent: "frontend-developer"
    track: "track_c"
    reason: "StepViews"
  T058:
    agent: "frontend-developer"
    track: "track_c"
    reason: "StepLayout"
  T059:
    agent: "frontend-developer"
    track: "track_c"
    reason: "StepReview"
  T060:
    agent: "frontend-developer"
    track: "track_c"
    reason: "ArtifactsPage"
  T061:
    agent: "frontend-developer"
    track: "track_c"
    reason: "Projects route wiring"

  # Track D: Targets — parallel after Shell
  T068:
    agent: "frontend-developer"
    track: "track_d"
    reason: "TargetsPage"
  T069:
    agent: "frontend-developer"
    track: "track_d"
    reason: "TargetList"
  T070:
    agent: "frontend-developer"
    track: "track_d"
    reason: "TargetDetail"
  T071:
    agent: "frontend-developer"
    track: "track_d"
    reason: "CoverageChart"
  T072:
    agent: "frontend-developer"
    track: "track_d"
    reason: "Targets route wiring"

  # Track E: Settings — parallel after Shell
  T073:
    agent: "frontend-developer"
    track: "track_e"
    reason: "SettingsPage"
  T074:
    agent: "frontend-developer"
    track: "track_e"
    reason: "DataSources"
  T075:
    agent: "frontend-developer"
    track: "track_e"
    reason: "NamingStructure"
  T076:
    agent: "frontend-developer"
    track: "track_e"
    reason: "SourceViewStrategy"
  T077:
    agent: "frontend-developer"
    track: "track_e"
    reason: "CleanupPolicy"
  T078:
    agent: "frontend-developer"
    track: "track_e"
    reason: "RootRecovery"
  T079:
    agent: "frontend-developer"
    track: "track_e"
    reason: "Equipment"
  T080:
    agent: "frontend-developer"
    track: "track_e"
    reason: "Tools"
  T081:
    agent: "frontend-developer"
    track: "track_e"
    reason: "LogSettings"
  T082:
    agent: "frontend-developer"
    track: "track_e"
    reason: "Catalogs"
  T083:
    agent: "frontend-developer"
    track: "track_e"
    reason: "Protection"
  T084:
    agent: "frontend-developer"
    track: "track_e"
    reason: "Settings route wiring"

  # Track F: Calibration + Audit — parallel after Shell
  T089:
    agent: "frontend-developer"
    track: "track_f"
    reason: "CalibrationPage"
  T090:
    agent: "frontend-developer"
    track: "track_f"
    reason: "MastersList"
  T091:
    agent: "frontend-developer"
    track: "track_f"
    reason: "MasterDetail"
  T092:
    agent: "frontend-developer"
    track: "track_f"
    reason: "Calibration route wiring"
  T093:
    agent: "frontend-developer"
    track: "track_f"
    reason: "AuditPage"
  T094:
    agent: "frontend-developer"
    track: "track_f"
    reason: "Audit route wiring"

  # Track G: Onboarding — after ALL tracks complete
  T085:
    agent: "frontend-developer"
    track: "track_g"
    reason: "SetupWizard"
  T086:
    agent: "frontend-developer"
    track: "track_g"
    reason: "Setup step components"
  T087:
    agent: "frontend-developer"
    track: "track_g"
    reason: "TourProvider"
  T088:
    agent: "frontend-developer"
    track: "track_g"
    reason: "Setup/tour routing"

  # Track H: Polish — after Track G
  T095:
    agent: "frontend-developer"
    track: "track_h"
    reason: "Density integration test"
  T096:
    agent: "frontend-developer"
    track: "track_h"
    reason: "Keyboard accessibility pass"
  T097:
    agent: "frontend-developer"
    track: "track_h"
    reason: "Empty state components"
  T098:
    agent: "performance-engineer"
    track: "track_h"
    reason: "Performance validation"
  T099:
    agent: "frontend-developer"
    track: "track_h"
    reason: "Quickstart milestone validation"
