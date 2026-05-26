# Issue Map: Spec 030 — UI Audit & Revision

| Task | Issue | Phase | Title |
|------|-------|-------|-------|
| T001 | [#140](https://github.com/nightwatch-astro/alm/issues/140) | s030-phase-1 | Create components/ directory |
| T002 | [#141](https://github.com/nightwatch-astro/alm/issues/141) | s030-phase-1 | Add @uiw/react-md-editor dependency |
| T003 | [#142](https://github.com/nightwatch-astro/alm/issues/142) | s030-phase-1 | Add @tanstack/react-virtual dependency |
| T004 | [#143](https://github.com/nightwatch-astro/alm/issues/143) | s030-phase-1 | Migration: equipment tables (Camera, Telescope, OpticalTrain, Filter) |
| T005 | [#144](https://github.com/nightwatch-astro/alm/issues/144) | s030-phase-1 | Migration: cleanup_policy and calibration_tolerances tables |
| T006 | [#145](https://github.com/nightwatch-astro/alm/issues/145) | s030-phase-1 | Migration: ingestion_settings table |
| T007 | [#146](https://github.com/nightwatch-astro/alm/issues/146) | s030-phase-1 | Migration: expand source_folder_type to 6 types |
| T008 | [#147](https://github.com/nightwatch-astro/alm/issues/147) | s030-phase-1 | Migration: remove prepared lifecycle state |
| T009 | [#148](https://github.com/nightwatch-astro/alm/issues/148) | s030-phase-1 | Migration: simplify source_view_strategy enum |
| T010 | [#149](https://github.com/nightwatch-astro/alm/issues/149) | s030-phase-2 | Create ListSidebar shared component |
| T011 | [#150](https://github.com/nightwatch-astro/alm/issues/150) | s030-phase-2 | Create FilterBar component |
| T012 | [#151](https://github.com/nightwatch-astro/alm/issues/151) | s030-phase-2 | Create TopActionBar component |
| T013 | [#152](https://github.com/nightwatch-astro/alm/issues/152) | s030-phase-2 | Create PropertyTable component |
| T014 | [#153](https://github.com/nightwatch-astro/alm/issues/153) | s030-phase-2 | Create ConfirmOverlay component |
| T015 | [#154](https://github.com/nightwatch-astro/alm/issues/154) | s030-phase-2 | Equipment DTOs (Camera, Telescope, OpticalTrain, Filter) |
| T016 | [#155](https://github.com/nightwatch-astro/alm/issues/155) | s030-phase-2 | Equipment repository (CRUD) |
| T017 | [#156](https://github.com/nightwatch-astro/alm/issues/156) | s030-phase-2 | Equipment use cases |
| T018 | [#157](https://github.com/nightwatch-astro/alm/issues/157) | s030-phase-2 | Equipment Tauri commands |
| T019 | [#158](https://github.com/nightwatch-astro/alm/issues/158) | s030-phase-2 | Cleanup policy DTOs and repository |
| T020 | [#159](https://github.com/nightwatch-astro/alm/issues/159) | s030-phase-2 | Calibration tolerances DTOs and repository |
| T021 | [#160](https://github.com/nightwatch-astro/alm/issues/160) | s030-phase-2 | Ingestion settings DTOs and repository |
| T022 | [#161](https://github.com/nightwatch-astro/alm/issues/161) | s030-phase-2 | StatusSummary DTO and aggregation query |
| T023 | [#162](https://github.com/nightwatch-astro/alm/issues/162) | s030-phase-2 | status.summary Tauri command |
| T024 | [#163](https://github.com/nightwatch-astro/alm/issues/163) | s030-phase-2 | cleanup.policy.get/update Tauri commands |
| T025 | [#164](https://github.com/nightwatch-astro/alm/issues/164) | s030-phase-2 | calibration.tolerances.get/update Tauri commands |
| T026 | [#165](https://github.com/nightwatch-astro/alm/issues/165) | s030-phase-2 | ingestion.settings.get/update Tauri commands |
| T027 | [#166](https://github.com/nightwatch-astro/alm/issues/166) | s030-phase-2 | Expand roots.register type enum to 6 types |
| T028 | [#167](https://github.com/nightwatch-astro/alm/issues/167) | s030-phase-2 | tools.list/update/validate_path Tauri commands |
| T029 | [#168](https://github.com/nightwatch-astro/alm/issues/168) | s030-phase-2 | Filesystem watcher service (notify crate, inbox-only) |
| T030 | [#169](https://github.com/nightwatch-astro/alm/issues/169) | s030-phase-2 | inbox.scan Tauri command |
| T031 | [#170](https://github.com/nightwatch-astro/alm/issues/170) | s030-phase-2 | session.split Tauri command |
| T032 | [#171](https://github.com/nightwatch-astro/alm/issues/171) | s030-phase-2 | session.merge Tauri command |
| T033 | [#172](https://github.com/nightwatch-astro/alm/issues/172) | s030-phase-2 | Project notes disk-sync service (DB → disk one-way) |
| T034 | [#173](https://github.com/nightwatch-astro/alm/issues/173) | s030-phase-2 | cleanup.scan Tauri command |
| T035 | [#174](https://github.com/nightwatch-astro/alm/issues/174) | s030-phase-2 | Regenerate TypeScript bindings |
| T036 | [#175](https://github.com/nightwatch-astro/alm/issues/175) | s030-phase-3 | Delete old wizard step components |
| T037 | [#176](https://github.com/nightwatch-astro/alm/issues/176) | s030-phase-3 | Rewrite SetupWizard.tsx for 4-step flow |
| T038 | [#177](https://github.com/nightwatch-astro/alm/issues/177) | s030-phase-3 | Step 1 — Source Folders component |
| T039 | [#178](https://github.com/nightwatch-astro/alm/issues/178) | s030-phase-3 | Rewrite sources-store.ts for 6 source types |
| T040 | [#179](https://github.com/nightwatch-astro/alm/issues/179) | s030-phase-3 | Step 2 — Processing Tools component |
| T041 | [#180](https://github.com/nightwatch-astro/alm/issues/180) | s030-phase-3 | Step 3 — Catalogs component |
| T042 | [#181](https://github.com/nightwatch-astro/alm/issues/181) | s030-phase-3 | Step 4 — Confirm component |
| T043 | [#182](https://github.com/nightwatch-astro/alm/issues/182) | s030-phase-3 | Update SetupPage.tsx |
| T044 | [#183](https://github.com/nightwatch-astro/alm/issues/183) | s030-phase-3 | Update wizard Vitest tests for 4-step flow |
| T045 | [#184](https://github.com/nightwatch-astro/alm/issues/184) | s030-phase-4 | Rename features/review/ to features/inbox/ |
| T046 | [#185](https://github.com/nightwatch-astro/alm/issues/185) | s030-phase-4 | Create InboxPage.tsx |
| T047 | [#186](https://github.com/nightwatch-astro/alm/issues/186) | s030-phase-4 | Create InboxList.tsx with ListSidebar |
| T048 | [#187](https://github.com/nightwatch-astro/alm/issues/187) | s030-phase-4 | Create SessionReview.tsx with PropertyTable |
| T049 | [#188](https://github.com/nightwatch-astro/alm/issues/188) | s030-phase-4 | Create inbox ActionSidebar.tsx |
| T050 | [#189](https://github.com/nightwatch-astro/alm/issues/189) | s030-phase-4 | Implement inbox conflict detection logic |
| T051 | [#190](https://github.com/nightwatch-astro/alm/issues/190) | s030-phase-4 | Create SplitPreview.tsx |
| T052 | [#191](https://github.com/nightwatch-astro/alm/issues/191) | s030-phase-4 | Create MergeSearch.tsx |
| T053 | [#192](https://github.com/nightwatch-astro/alm/issues/192) | s030-phase-4 | Create inbox ConfirmOverlay.tsx |
| T054 | [#193](https://github.com/nightwatch-astro/alm/issues/193) | s030-phase-4 | Implement FilterSelect.tsx with predefined categories |
| T055 | [#194](https://github.com/nightwatch-astro/alm/issues/194) | s030-phase-4 | Implement session naming rules |
| T056 | [#195](https://github.com/nightwatch-astro/alm/issues/195) | s030-phase-4 | Delete old review components |
| T057 | [#196](https://github.com/nightwatch-astro/alm/issues/196) | s030-phase-5 | Delete old project tab components |
| T058 | [#197](https://github.com/nightwatch-astro/alm/issues/197) | s030-phase-5 | Rewrite ProjectDetail.tsx as single consolidated view |
| T059 | [#198](https://github.com/nightwatch-astro/alm/issues/198) | s030-phase-5 | Create LifecycleSidebar.tsx |
| T060 | [#199](https://github.com/nightwatch-astro/alm/issues/199) | s030-phase-5 | Update LifecycleStrip.tsx to 5 phases |
| T061 | [#200](https://github.com/nightwatch-astro/alm/issues/200) | s030-phase-5 | Create PipelineStatsBar.tsx |
| T062 | [#201](https://github.com/nightwatch-astro/alm/issues/201) | s030-phase-5 | Refactor SourceMap.tsx with lifecycle-gated actions |
| T063 | [#202](https://github.com/nightwatch-astro/alm/issues/202) | s030-phase-5 | Create SourceViewStatus.tsx |
| T064 | [#203](https://github.com/nightwatch-astro/alm/issues/203) | s030-phase-5 | Create ProjectNotes.tsx with markdown editor |
| T065 | [#204](https://github.com/nightwatch-astro/alm/issues/204) | s030-phase-5 | Create CleanupPlan.tsx |
| T066 | [#205](https://github.com/nightwatch-astro/alm/issues/205) | s030-phase-5 | Update ProjectsList.tsx with ListSidebar |
| T067 | [#206](https://github.com/nightwatch-astro/alm/issues/206) | s030-phase-5 | Delete old project inspector components |
| T068 | [#207](https://github.com/nightwatch-astro/alm/issues/207) | s030-phase-6 | Rewrite Sidebar.tsx with 7 nav items + footer |
| T069 | [#208](https://github.com/nightwatch-astro/alm/issues/208) | s030-phase-6 | Update router.tsx routes |
| T070 | [#209](https://github.com/nightwatch-astro/alm/issues/209) | s030-phase-6 | Update Shell.tsx for hybrid layout |
| T071 | [#210](https://github.com/nightwatch-astro/alm/issues/210) | s030-phase-6 | Refactor SessionsPage.tsx with ListSidebar + TopActionBar |
| T072 | [#211](https://github.com/nightwatch-astro/alm/issues/211) | s030-phase-6 | Rewrite SessionDetail.tsx as unified read-only PropertyTable |
| T073 | [#212](https://github.com/nightwatch-astro/alm/issues/212) | s030-phase-6 | Create CalendarScroll.tsx vertical timeline |
| T074 | [#213](https://github.com/nightwatch-astro/alm/issues/213) | s030-phase-6 | Update CalendarView.tsx with session badges |
| T075 | [#214](https://github.com/nightwatch-astro/alm/issues/214) | s030-phase-6 | Refactor CalibrationPage.tsx with ListSidebar + TopActionBar |
| T076 | [#215](https://github.com/nightwatch-astro/alm/issues/215) | s030-phase-6 | Rewrite CalibrationDetail.tsx with matching fingerprint |
| T077 | [#216](https://github.com/nightwatch-astro/alm/issues/216) | s030-phase-6 | Refactor TargetsPage.tsx with ListSidebar + TopActionBar |
| T078 | [#217](https://github.com/nightwatch-astro/alm/issues/217) | s030-phase-6 | Update TargetDetail.tsx |
| T079 | [#218](https://github.com/nightwatch-astro/alm/issues/218) | s030-phase-6 | Create ArchivePage.tsx |
| T080 | [#219](https://github.com/nightwatch-astro/alm/issues/219) | s030-phase-6 | Create ArchiveList.tsx |
| T081 | [#220](https://github.com/nightwatch-astro/alm/issues/220) | s030-phase-7 | Rewrite SettingsPage.tsx with 11 panes |
| T082 | [#221](https://github.com/nightwatch-astro/alm/issues/221) | s030-phase-7 | Rewrite DataSources.tsx settings pane |
| T083 | [#222](https://github.com/nightwatch-astro/alm/issues/222) | s030-phase-7 | Rewrite Equipment.tsx settings pane |
| T084 | [#223](https://github.com/nightwatch-astro/alm/issues/223) | s030-phase-7 | Create Ingestion.tsx settings pane |
| T085 | [#224](https://github.com/nightwatch-astro/alm/issues/224) | s030-phase-7 | Rewrite NamingStructure.tsx settings pane |
| T086 | [#225](https://github.com/nightwatch-astro/alm/issues/225) | s030-phase-7 | Rewrite SourceViewStrategy.tsx settings pane |
| T087 | [#226](https://github.com/nightwatch-astro/alm/issues/226) | s030-phase-7 | Create ProcessingTools.tsx settings pane |
| T088 | [#227](https://github.com/nightwatch-astro/alm/issues/227) | s030-phase-7 | Create CalibrationMatching.tsx settings pane |
| T089 | [#228](https://github.com/nightwatch-astro/alm/issues/228) | s030-phase-7 | Rewrite Catalogs.tsx settings pane |
| T090 | [#229](https://github.com/nightwatch-astro/alm/issues/229) | s030-phase-7 | Create Cleanup.tsx settings pane |
| T091 | [#230](https://github.com/nightwatch-astro/alm/issues/230) | s030-phase-7 | Create General.tsx settings pane |
| T092 | [#231](https://github.com/nightwatch-astro/alm/issues/231) | s030-phase-7 | Create Advanced.tsx settings pane |
| T093 | [#232](https://github.com/nightwatch-astro/alm/issues/232) | s030-phase-7 | Move audit to settings AuditLog.tsx |
| T094 | [#233](https://github.com/nightwatch-astro/alm/issues/233) | s030-phase-7 | Delete obsolete settings files |
| T095 | [#234](https://github.com/nightwatch-astro/alm/issues/234) | s030-phase-7 | Delete obsolete feature directories |
| T096 | [#235](https://github.com/nightwatch-astro/alm/issues/235) | s030-phase-8 | Rewrite StatusBar.tsx |
| T097 | [#236](https://github.com/nightwatch-astro/alm/issues/236) | s030-phase-8 | Create useStatusSummary hook |
| T098 | [#237](https://github.com/nightwatch-astro/alm/issues/237) | s030-phase-8 | Add sidebar footer root health indicator |
| T099 | [#238](https://github.com/nightwatch-astro/alm/issues/238) | s030-phase-8 | Remove obsolete status bar content |
| T100 | [#239](https://github.com/nightwatch-astro/alm/issues/239) | s030-phase-8 | Add storage health warning threshold to settings |
| T101 | [#240](https://github.com/nightwatch-astro/alm/issues/240) | s030-phase-9 | Delete .playwright-mcp/ screenshot artifacts |
| T102 | [#241](https://github.com/nightwatch-astro/alm/issues/241) | s030-phase-9 | Update mock data providers |
| T103 | [#242](https://github.com/nightwatch-astro/alm/issues/242) | s030-phase-9 | Run just lint and fix warnings |
| T104 | [#243](https://github.com/nightwatch-astro/alm/issues/243) | s030-phase-9 | Run just typecheck and fix errors |
| T105 | [#244](https://github.com/nightwatch-astro/alm/issues/244) | s030-phase-9 | Run just test and fix broken tests |
| T106 | [#245](https://github.com/nightwatch-astro/alm/issues/245) | s030-phase-9 | Update Playwright E2E scripts for new routes |
| T107 | [#246](https://github.com/nightwatch-astro/alm/issues/246) | s030-phase-9 | Update preferences.ts with new preference keys |
| T108 | [#247](https://github.com/nightwatch-astro/alm/issues/247) | s030-phase-9 | Verify hotkeys on all action buttons |
| T109 | [#248](https://github.com/nightwatch-astro/alm/issues/248) | s030-phase-9 | Verify Reveal in Explorer on all file-backed views |
