# Task Dependency Diagram: UI Audit & Revision

## Phase Dependencies (DAG)

```mermaid
graph TD
    P1[Phase 1: Setup<br/>T001-T009<br/>Migrations & deps]
    P2[Phase 2: Foundational<br/>T010-T029<br/>Shared components + backend]
    P3[Phase 3: US1 Wizard<br/>T030-T038<br/>4-step setup]
    P4[Phase 4: US2 Inbox<br/>T039-T050<br/>Session review]
    P5[Phase 5: US3 Projects<br/>T051-T061<br/>Lifecycle workflow]
    P6[Phase 6: US4 Navigation<br/>T062-T074<br/>Shell + layout]
    P7[Phase 7: US5 Settings<br/>T075-T089<br/>11 panes]
    P8[Phase 8: US6 Status Bar<br/>T090-T094<br/>Operational status]
    P9[Phase 9: Polish<br/>T095-T103<br/>Cleanup & verify]

    P1 --> P2
    P2 --> P3
    P2 --> P4
    P2 --> P5
    P2 --> P6
    P2 --> P7
    P2 --> P8
    P3 --> P9
    P4 --> P9
    P5 --> P9
    P6 --> P9
    P7 --> P9
    P8 --> P9

    style P1 fill:#e8e8e8
    style P2 fill:#ffd700
    style P3 fill:#90ee90
    style P4 fill:#90ee90
    style P5 fill:#87ceeb
    style P6 fill:#87ceeb
    style P7 fill:#dda0dd
    style P8 fill:#dda0dd
    style P9 fill:#e8e8e8
```

## Parallel Tracks (after Phase 2)

```mermaid
gantt
    title Implementation Timeline
    dateFormat X
    axisFormat %s

    section Foundation
    Phase 1 Setup           :p1, 0, 1
    Phase 2 Foundational    :p2, 1, 3

    section Track A - Core Ingestion
    US1 Wizard              :p3, 3, 5
    US2 Inbox               :p4, 3, 6

    section Track B - Layout Overhaul
    US3 Projects            :p5, 3, 6
    US4 Navigation          :p6, 3, 6

    section Track C - Config & Status
    US5 Settings            :p7, 3, 6
    US6 Status Bar          :p8, 3, 5

    section Finalize
    Phase 9 Polish          :p9, 6, 7
```

## Foundational Phase Internal Dependencies

```mermaid
graph LR
    subgraph "UI Components (parallel)"
        T010[T010 ListSidebar]
        T011[T011 FilterBar]
        T012[T012 TopActionBar]
        T013[T013 PropertyTable]
        T014[T014 ConfirmOverlay]
    end

    subgraph "Backend Equipment (sequential)"
        T015[T015 DTOs]
        T016[T016 Repository]
        T017[T017 Use cases]
        T018[T018 Tauri commands]
        T015 --> T016 --> T017 --> T018
    end

    subgraph "Backend Settings (parallel)"
        T019[T019 Cleanup]
        T020[T020 CalTolerance]
        T021[T021 Ingestion]
        T022[T022 StatusSummary]
    end

    subgraph "Backend Commands (parallel after repos)"
        T023[T023 status.summary]
        T024[T024 cleanup.*]
        T025[T025 calibration.tolerances.*]
        T026[T026 ingestion.*]
        T028[T028 tools.*]
    end

    T022 --> T023
    T019 --> T024
    T020 --> T025
    T021 --> T026

    T018 --> T029[T029 Regenerate bindings]
    T023 --> T029
    T024 --> T029
    T025 --> T029
    T026 --> T029
    T028 --> T029
```

## Critical Path

```
P1 (Setup) → P2 (Foundational) → P4 (US2 Inbox) → P9 (Polish)
```

The critical path runs through Inbox (US2) because it's the most complex
user story (12 tasks) and the core ingestion workflow. Wizard (US1) is
simpler (9 tasks) and finishes sooner.

## Risk: Phase 6 ↔ Phase 5 Coordination

US4 (Navigation) rewrites the app shell (`Shell.tsx`, `router.tsx`,
`Sidebar.tsx`) which US3 (Projects) renders within. If worked in parallel:
- US4 shell changes should land first OR
- US3 should use the existing shell and be rebased after US4

Recommendation: Start US4 slightly before US3, or have US4's shell tasks
(T062-T064) complete before US3 begins.
