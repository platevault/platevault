# Issue Map: Desktop Frontend Implementation

**Repository**: nightwatch-astro/alm
**Created**: 2026-05-24
**Issues**: #3–#101 (99 issues)

## Phase 1: Setup

| Task | Issue | Title |
|------|-------|-------|
| T001 | [#3](https://github.com/nightwatch-astro/alm/issues/3) | Create directory structure |
| T002 | [#4](https://github.com/nightwatch-astro/alm/issues/4) | Initialize package.json |
| T003 | [#5](https://github.com/nightwatch-astro/alm/issues/5) | Configure vite.config.ts |
| T004 | [#6](https://github.com/nightwatch-astro/alm/issues/6) | Configure tsconfig.json |
| T005 | [#7](https://github.com/nightwatch-astro/alm/issues/7) | Configure vitest.config.ts |
| T006 | [#8](https://github.com/nightwatch-astro/alm/issues/8) | Create index.html |

## Phase 2: Foundational

| Task | Issue | Title |
|------|-------|-------|
| T007 | [#9](https://github.com/nightwatch-astro/alm/issues/9) | Create reset.css |
| T008 | [#10](https://github.com/nightwatch-astro/alm/issues/10) | Create tokens.css |
| T009 | [#11](https://github.com/nightwatch-astro/alm/issues/11) | Create components.css |
| T010 | [#12](https://github.com/nightwatch-astro/alm/issues/12) | Create api/types.ts |
| T011 | [#13](https://github.com/nightwatch-astro/alm/issues/13) | Create api/commands.ts |
| T012 | [#14](https://github.com/nightwatch-astro/alm/issues/14) | Create api/mocks.ts |
| T013 | [#15](https://github.com/nightwatch-astro/alm/issues/15) | Create data/store.ts |
| T014 | [#16](https://github.com/nightwatch-astro/alm/issues/16) | Create data/preferences.ts |
| T015 | [#17](https://github.com/nightwatch-astro/alm/issues/17) | Create data/fixtures/ |
| T016 | [#18](https://github.com/nightwatch-astro/alm/issues/18) | Create app/router.tsx |
| T017 | [#19](https://github.com/nightwatch-astro/alm/issues/19) | Create main.tsx |
| T018 | [#20](https://github.com/nightwatch-astro/alm/issues/20) | Create ui/Pill.tsx |
| T019 | [#21](https://github.com/nightwatch-astro/alm/issues/21) | Create ui/Confidence.tsx |
| T020 | [#22](https://github.com/nightwatch-astro/alm/issues/22) | Create ui/Provenance.tsx |
| T021 | [#23](https://github.com/nightwatch-astro/alm/issues/23) | Create ui/Lock.tsx |
| T022 | [#24](https://github.com/nightwatch-astro/alm/issues/24) | Create ui/KV.tsx |
| T023 | [#25](https://github.com/nightwatch-astro/alm/issues/25) | Create ui/Box.tsx |
| T024 | [#26](https://github.com/nightwatch-astro/alm/issues/26) | Create ui/Section.tsx |
| T025 | [#27](https://github.com/nightwatch-astro/alm/issues/27) | Create ui/Btn.tsx |
| T026 | [#28](https://github.com/nightwatch-astro/alm/issues/28) | Create ui/DirPicker.tsx |
| T027 | [#29](https://github.com/nightwatch-astro/alm/issues/29) | Create ui/FilterBar.tsx |
| T028 | [#30](https://github.com/nightwatch-astro/alm/issues/30) | Create ui/Toolbar.tsx |
| T029 | [#31](https://github.com/nightwatch-astro/alm/issues/31) | Create ui/DataTable.tsx |
| T030 | [#32](https://github.com/nightwatch-astro/alm/issues/32) | Create ui/ThreePane.tsx |
| T031 | [#33](https://github.com/nightwatch-astro/alm/issues/33) | Create ui/WizardShell.tsx |
| T032 | [#34](https://github.com/nightwatch-astro/alm/issues/34) | Create ui/index.ts |

## Phase 3: US2 — App Shell

| Task | Issue | Title |
|------|-------|-------|
| T033 | [#35](https://github.com/nightwatch-astro/alm/issues/35) | Create app/Shell.tsx |
| T034 | [#36](https://github.com/nightwatch-astro/alm/issues/36) | Create app/Sidebar.tsx |
| T035 | [#37](https://github.com/nightwatch-astro/alm/issues/37) | Create app/StatusBar.tsx |
| T036 | [#38](https://github.com/nightwatch-astro/alm/issues/38) | Create app/LogPanel.tsx |
| T037 | [#39](https://github.com/nightwatch-astro/alm/issues/39) | Create app/CommandPalette.tsx |

## Phase 4: US1 — Sessions

| Task | Issue | Title |
|------|-------|-------|
| T038 | [#40](https://github.com/nightwatch-astro/alm/issues/40) | Create SessionsPage.tsx |
| T039 | [#41](https://github.com/nightwatch-astro/alm/issues/41) | Create GroupByBar.tsx |
| T040 | [#42](https://github.com/nightwatch-astro/alm/issues/42) | Create CalendarView.tsx |
| T041 | [#43](https://github.com/nightwatch-astro/alm/issues/43) | Create SessionDetail.tsx |
| T042 | [#44](https://github.com/nightwatch-astro/alm/issues/44) | Wire sessions routes |

## Phase 5: US3 — Review Queue

| Task | Issue | Title |
|------|-------|-------|
| T043 | [#45](https://github.com/nightwatch-astro/alm/issues/45) | Create ReviewPage.tsx |
| T044 | [#46](https://github.com/nightwatch-astro/alm/issues/46) | Create ReviewQueue.tsx |
| T045 | [#47](https://github.com/nightwatch-astro/alm/issues/47) | Create EvidencePane.tsx |
| T046 | [#48](https://github.com/nightwatch-astro/alm/issues/48) | Create DecisionPanel.tsx |
| T047 | [#49](https://github.com/nightwatch-astro/alm/issues/49) | Wire review route |

## Phase 6: US4 — Projects

| Task | Issue | Title |
|------|-------|-------|
| T048 | [#50](https://github.com/nightwatch-astro/alm/issues/50) | Create ProjectsPage.tsx |
| T049 | [#51](https://github.com/nightwatch-astro/alm/issues/51) | Create ProjectDetail.tsx |
| T050 | [#52](https://github.com/nightwatch-astro/alm/issues/52) | Create CommandCenter.tsx |
| T051 | [#53](https://github.com/nightwatch-astro/alm/issues/53) | Create PipelineView.tsx |
| T052 | [#54](https://github.com/nightwatch-astro/alm/issues/54) | Create CombinedView.tsx |
| T053 | [#55](https://github.com/nightwatch-astro/alm/issues/55) | Create wizard/WizardPage.tsx |
| T054 | [#56](https://github.com/nightwatch-astro/alm/issues/56) | Create wizard/StepName.tsx |
| T055 | [#57](https://github.com/nightwatch-astro/alm/issues/57) | Create wizard/StepSources.tsx |
| T056 | [#58](https://github.com/nightwatch-astro/alm/issues/58) | Create wizard/StepCalibration.tsx |
| T057 | [#59](https://github.com/nightwatch-astro/alm/issues/59) | Create wizard/StepViews.tsx |
| T058 | [#60](https://github.com/nightwatch-astro/alm/issues/60) | Create wizard/StepLayout.tsx |
| T059 | [#61](https://github.com/nightwatch-astro/alm/issues/61) | Create wizard/StepReview.tsx |
| T060 | [#62](https://github.com/nightwatch-astro/alm/issues/62) | Create ArtifactsPage.tsx |
| T061 | [#63](https://github.com/nightwatch-astro/alm/issues/63) | Wire projects routes |

## Phase 7: US5 — Plan Review

| Task | Issue | Title |
|------|-------|-------|
| T062 | [#64](https://github.com/nightwatch-astro/alm/issues/64) | Create PlansPage.tsx |
| T063 | [#65](https://github.com/nightwatch-astro/alm/issues/65) | Create PlanReview.tsx |
| T064 | [#66](https://github.com/nightwatch-astro/alm/issues/66) | Create PlanTable.tsx |
| T065 | [#67](https://github.com/nightwatch-astro/alm/issues/67) | Create PlanDiff.tsx |
| T066 | [#68](https://github.com/nightwatch-astro/alm/issues/68) | Create ApprovalGate.tsx |
| T067 | [#69](https://github.com/nightwatch-astro/alm/issues/69) | Wire plans routes |

## Phase 8: US6 — Targets

| Task | Issue | Title |
|------|-------|-------|
| T068 | [#70](https://github.com/nightwatch-astro/alm/issues/70) | Create TargetsPage.tsx |
| T069 | [#71](https://github.com/nightwatch-astro/alm/issues/71) | Create TargetList.tsx |
| T070 | [#72](https://github.com/nightwatch-astro/alm/issues/72) | Create TargetDetail.tsx |
| T071 | [#73](https://github.com/nightwatch-astro/alm/issues/73) | Create CoverageChart.tsx |
| T072 | [#74](https://github.com/nightwatch-astro/alm/issues/74) | Wire targets routes |

## Phase 9: US7 — Settings

| Task | Issue | Title |
|------|-------|-------|
| T073 | [#75](https://github.com/nightwatch-astro/alm/issues/75) | Create SettingsPage.tsx |
| T074 | [#76](https://github.com/nightwatch-astro/alm/issues/76) | Create DataSources.tsx |
| T075 | [#77](https://github.com/nightwatch-astro/alm/issues/77) | Create NamingStructure.tsx |
| T076 | [#78](https://github.com/nightwatch-astro/alm/issues/78) | Create SourceViewStrategy.tsx |
| T077 | [#79](https://github.com/nightwatch-astro/alm/issues/79) | Create CleanupPolicy.tsx |
| T078 | [#80](https://github.com/nightwatch-astro/alm/issues/80) | Create RootRecovery.tsx |
| T079 | [#81](https://github.com/nightwatch-astro/alm/issues/81) | Create Equipment.tsx |
| T080 | [#82](https://github.com/nightwatch-astro/alm/issues/82) | Create Tools.tsx |
| T081 | [#83](https://github.com/nightwatch-astro/alm/issues/83) | Create LogSettings.tsx |
| T082 | [#84](https://github.com/nightwatch-astro/alm/issues/84) | Create Catalogs.tsx |
| T083 | [#85](https://github.com/nightwatch-astro/alm/issues/85) | Create Protection.tsx |
| T084 | [#86](https://github.com/nightwatch-astro/alm/issues/86) | Wire settings routes |

## Phase 10: US8 ��� Onboarding

| Task | Issue | Title |
|------|-------|-------|
| T085 | [#87](https://github.com/nightwatch-astro/alm/issues/87) | Create SetupWizard.tsx |
| T086 | [#88](https://github.com/nightwatch-astro/alm/issues/88) | Create setup/steps/ |
| T087 | [#89](https://github.com/nightwatch-astro/alm/issues/89) | Create TourProvider.tsx |
| T088 | [#90](https://github.com/nightwatch-astro/alm/issues/90) | Wire setup/tour routing |

## Phase 11: US9 — Calibration

| Task | Issue | Title |
|------|-------|-------|
| T089 | [#91](https://github.com/nightwatch-astro/alm/issues/91) | Create CalibrationPage.tsx |
| T090 | [#92](https://github.com/nightwatch-astro/alm/issues/92) | Create MastersList.tsx |
| T091 | [#93](https://github.com/nightwatch-astro/alm/issues/93) | Create MasterDetail.tsx |
| T092 | [#94](https://github.com/nightwatch-astro/alm/issues/94) | Wire calibration routes |

## Phase 12: US10 — Audit

| Task | Issue | Title |
|------|-------|-------|
| T093 | [#95](https://github.com/nightwatch-astro/alm/issues/95) | Create AuditPage.tsx |
| T094 | [#96](https://github.com/nightwatch-astro/alm/issues/96) | Wire audit route |

## Phase 13: Polish

| Task | Issue | Title |
|------|-------|-------|
| T095 | [#97](https://github.com/nightwatch-astro/alm/issues/97) | Density integration test |
| T096 | [#98](https://github.com/nightwatch-astro/alm/issues/98) | Keyboard accessibility pass |
| T097 | [#99](https://github.com/nightwatch-astro/alm/issues/99) | Empty state components |
| T098 | [#100](https://github.com/nightwatch-astro/alm/issues/100) | Performance validation |
| T099 | [#101](https://github.com/nightwatch-astro/alm/issues/101) | Quickstart milestone validation |
