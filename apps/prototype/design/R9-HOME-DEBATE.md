# Home / dashboard debate (bead astro-plan-g39cm)

Round 9, 2026-10-12. Prototype `apps/prototype` on `ui-harness-v5` @ 44adaf33; all paths are relative to `apps/prototype/src` unless marked. Read-only research. The evidence comes from code; no browser pass was run because this agent had no browser tool. Anything about rendered layout is marked [INFERENCE].

## 0. The user's asks
- "home reproduces a *lot* of information from pages that we already have … what a homepage/dashboard should ideally show/could show that adds value."
- "location is not selectable in 'tonight'… more vertical space and move towards the next month or so with selectable options, basically a mini version of plan, showing tonight's state, this months windows, etc."
- "The 'tonight' has no option to selct location or options to change date. Maybe change its name from tonight to planning."
- "Reminders will likely need more flexible reminder windows instead of just dropdowns, 30 mins is way too short."
- "getting started/achievements donut + goals in the menu above acitivyty/settings, can we put that back?"

## 1. Current inventory and duplication map

Home is `features/v5/a-home/home.tsx` (`HomePage` :100-140). The previous product (`apps/desktop`) had no Home dashboard. Its sidebar ran Inbox, Sessions, Calibration, Targets, Projects, Archive, then Settings (`apps/desktop/src/app/Sidebar.tsx:66-126`). Home is a v5 invention (`design/HARNESS-V5-IA.md:31,47`, D-W39).

| # | Home item | Code | Already shown at | Verdict |
|---|---|---|---|---|
| H0 | Header buttons: Plan tonight, New Project, Import | home.tsx:107-123 (`target_plan_tonight`, `newproject_open`, `import_open`) | The toolbar Import button (app/shell.tsx:595-598). New Project in the Projects header (b-projects/projects.tsx, PageHeader actions). Planned view toggle in Targets (e-targets-plan-settings/targets.tsx:689-697) | Duplicate |
| H1 | Getting started checklist | home.tsx:126 → app/onboarding.tsx:231-294 | Shown nowhere else in v5. The previous product used a progress-ring flyout in the sidebar above Settings (apps/desktop/src/app/Sidebar.tsx:239-250; features/onboarding/ChecklistPopover.tsx:5-22) | Misplaced, not a duplicate |
| H2 | Projects box: open Projects, goal lines per channel, Stage, Next, Show done, row menu | home.tsx:270-376 | The Projects list shows the same rows with GoalSummary, Stage, Next, Show done and a fuller row menu (b-projects/projects.tsx). Show done is stored twice, in `slices.a.showDone` (home.tsx:274,279) and `slices.b.showDone` | Near-total duplicate |
| H3 | Sessions box: Needs a Target, Not in a Project, Unreviewed, Ready to add (4 rows each, one action each) | home.tsx:414-573; derive `sessionsNeedingWork` domain/derive.ts:1289-1312 | Needs a Target and Not in a Project: the Issues hub (domain/issues.ts:84-90), the status-bar counters, the Sessions badge (app/shell.tsx:262-265) and the Sessions filters (a-home/sessions.tsx:46). Unreviewed: Project Next rule 1 (derive.ts `projectNext`) and the Review column in Sessions (sessions.tsx:165-195). Ready to add: Project Candidates (b-projects/project-sections.tsx:375,840) and the run's Select step (c-runs/select-step.tsx:84) | Partly duplicate. Two groups are in the Issues hub. Unreviewed and Ready to add are **not** gathered anywhere else (issues.ts has no such kind). One-click actions exist only here: "Confirm {suggestion}" (home.tsx:484) and "Add to run" / Start run (home.tsx:530-571) |
| H4 | Tonight box: site time zone, darkness, Moon, windows for favourites and open-Project subjects | home.tsx:576-697 | Targets has a night picker with ‹ › (targets.tsx:204-212), a site select (:708-712), DarkLine/MoonLine (parts.tsx:69-101) and the My targets view (favourites plus open-Project subjects, with a window per row; targets.tsx:10-11). Home re-implements the Moon and darkness rendering instead of reusing parts.tsx | Duplicate of Targets › My targets for tonight, with fewer features: no site control, no date control, and it never shows the night's actual Plan (`nightPlan`, domain/planning.ts:140) |
| H5 | Goals box: unmet goals per subject and channel (in project, captured, goal, needs) | home.tsx:699-790; `targetStatus` derive.ts:1481-1491 | H2 on the same page (GoalLines), Projects list GoalSummary, Project goals (project-sections.tsx:594), Target page goal lines (target.tsx:6) | Duplicate per Project. Only the cross-Project "Needs" column is partly new |
| H6 | Work box: unsettled operations with pause, resume, cancel and progress | home.tsx:792-873; `runningWork` derive.ts:1494 | Activity › In progress, all unsettled operations (activity.tsx:195-233). Status bar shows running and paused only (app/status-bar.tsx:138-140). Interrupted and failed work also appears in the Issues hub (issues.ts:106-111) | Duplicate (Activity is the full destination) |

Gaps that no page fills today:
- **No page shows more than one night at a time.** `computeWindows` accepts N nights (planning.ts:174; `PLAN_NIGHTS` = 14 at :18). Its only multi-night caller is `plannedWindows` (:159), which scans only nights that already have a plan and feeds reminders and export.
- **Home never shows the night's Plan.**
- **Unmet goals are never combined with upcoming windows.**

Other facts used below:
- Reminder lead times are fixed at [15, 30, 60, 120] min, default 30 (store/actions/planning.ts:58-59), and can only be edited in the Planned header (planned-tools.tsx:62-117).
- `HomePage` subscribes to the whole store, `useStore((s) => s)` (home.tsx:101).

## 2. Alternatives (Phase 3)
- **A0 Do nothing.** Keep the six boxes. For: everything at a glance, and the derives are already shared. Against: the user named this as the problem. Two goal renderings, two Moon renderings and two Show-done states drift apart. Tonight still lacks site and date controls and still shows no plan.
- **A1 Simplest viable.** Tonight becomes Planning, with the shared site and night controls and the night's Plan. Delete Work, Sessions and Goals and the header buttons. Getting started moves to the menu. The Projects box shrinks to an Up next list.
- **A2 A1 plus a 30-night matrix** (nights × subjects, cells showing dark minutes, a Moon row).
- **A3 No Home.** Start on Targets › Planned, or make the start page a setting. Against: the user asked for a mini Plan on Home, and setup ends on Home (features/t1/setup/setup-pages.tsx:357).
- **A4 Configurable widgets.** Rejected as overengineering.
- **A5 Home as an Inbox (triage only).** Mostly a copy of the Issues hub.

Overengineering check:
1. Would doing nothing work? No; the user rejected it.
2. Simplest thing that works? A1.
3. Problems we don't have yet: matrix cell semantics, per-filter grading in cells, row-source selectors, editing reminders on Home, widgets.
4. 48-hour cut: the matrix and the reminder line.
5. Undo cost: low. Home composes derives and owns only `slices.a.showDone`.

Reversibility: a two-way door.

## 3. Phase 4: independent challenge
An `adversarial-challenger` agent type was refused at spawn ("Allowed: scout"). The critique was run by an independent read-only scout given the finished Phase 3 analysis (agent://R9HomeDebate.HomeChallenger). Its findings and how this report treats them:

- **Accepted: being the only multi-night view does not prove the matrix is useful.** "This months windows" does not say matrix. A 30-column grid would be a new, bespoke component. It is hard to square with the user's rule "NO CUSTOM COMPONENTS ANYWHERE". DataTable has no matrix or night-column behaviour (components/app/data-table.tsx). The compute cost is not measured. The matrix is therefore **deferred**; a horizon expressed as standard table columns takes its place (§4.1).
- **Accepted: the Sessions box is not fully covered by the Issues hub.** Unreviewed and Ready to add have no gathered route elsewhere. They must be carried somewhere before the box is deleted (§4.2).
- **Accepted: a citation correction.** The status bar shows running and paused work only (status-bar.tsx:138-140). Activity is the full destination for H6.
- **Accepted: "above Activity/Settings" is a new placement.** v5 has no checklist in the sidebar, and the utility items live in app/navigation.ts. This is not a restore. The walk's "next" anchor falls back to `#home-projects` (app/onboarding.tsx:49) and must be re-pointed.
- **Accepted: the shared planning site has a cross-page effect.** Picking a site on Home changes Targets, because both use `settings.planningSiteId` (targets.tsx:254-255,369-370). This is kept on purpose (one planning context) and must be stated in the brief.
- **Partly deflected: removing header shortcuts costs some navigation.** Import sits one toolbar row above (shell.tsx:595). Plan tonight is replaced by the Planning section's own link. New Project moves to Up next's empty state and the Projects page. The extra click is small; the duplication it removes is not.
- **Partly deflected: Up next is a subset of the Projects list.** This is true for content. But the Projects list sorts by name (projects.tsx, `localeCompare`), while Up next orders by urgency and shows only the one action. It is kept on that condition (§5).

## 4. Recommended Home (A1+, two columns)

### 4.1 Planning (main column, most of the height). Replaces Tonight (H4) and Goals (H5)
- **Header: "Planning", site select, night picker (‹ date › and Today), "Open in Targets".**
  - Value: answers the explicit site and date ask.
  - Why not a duplicate: the controls are **the same component and the same setting** as Targets. Extract them once from targets.tsx:204-212 and :708-712; never build a second implementation. The chosen night is carried to Targets as `?night=`.
- **Night strip: Dark window and Moon (phase, illumination, rise and set).** Reuse `DarkLine` and `MoonLine` from parts.tsx:69-101, and delete Home's own copy (home.tsx ~600-640).
- **Plan table: the chosen night's `nightPlan`,** with best window and Moon separation, in the user's order. Empty state: "Nothing planned" plus "Add targets", which opens Targets for that night.
  - Value: "tonight's state" is what the user planned, and today Home omits it.
  - Overlap: it is a smaller version of Targets › Planned (the user's "mini version of plan"). It is read-only here; ordering and removal stay in Planned.
- **Needs table: open-Project subjects with unmet goals.** One standard DataTable with these columns: Subject, Project, Needs (remaining in-project time or frames from `goalProgress`), Window on the chosen night, Next good night, and Good nights (the count in the next 30 nights). Row menu: Add to plan (chosen night), Open Target, Open Project.
  - Value: **the only place that joins unmet goals with upcoming windows** ("what still needs data, and when can I get it"). It covers "this month's windows" with standard columns instead of a matrix.
  - Why not a duplicate: Targets shows one night for every target. Project pages show goals without windows. Favourites are left out on purpose, because they are Targets › My targets.
  - Risk: the 30-night columns call `computeWindows(…, 30)` once per row. Measure this before shipping and memoise per (catalogue, site, night); the cost is [INFERENCE].
- **Reminder line, only when reminders are on:** "Next reminder {time} · {target}", linking to Planned.
  - Value: tells you whether you will be woken.
  - Why not a duplicate: editing stays in Planned. Flexible lead times ("30 mins is way too short") are a separate Plan change to `LEAD_TIMES_MIN` (store/actions/planning.ts:58) and the Select in planned-tools.tsx:84-96. They are not Home work.

### 4.2 Up next (narrow rail). Replaces the Projects box (H2) and the Sessions box (H3)
- **One line per open Project:** name plus its single `projectNext` button. The rail is ordered by urgency: blocked first, then "Review N new frames", wrap up, plan, start run. Up to 5 rows, then "All Projects". Empty state: one line plus "New Project". No goals, no stage, no Show done.
- **Value:** the start page's one entry point into work, ordered by what is waiting. The Projects list sorts by name.
  - It **absorbs Unreviewed**, because `projectNext` rule 1 is "Review N new frames" and opens the Project's candidate review.
  - It **absorbs Ready to add**, because candidates not yet in a run lead to rule 5, Start run.
  - That keeps the triage the challenger said would be lost, without the Sessions box.
- **Walk:** the walk's `next` step anchors here (`data-next`, app/onboarding.tsx:49).

### 4.3 Getting started → sidebar
- **Placement:** a progress ring with "Getting started {done}/{total}" in the utility group above Activity and Settings (app/navigation.ts). It opens a non-modal popover containing the existing checklist rows (`GettingStarted` / `checklist`, onboarding.tsx:212-294). It disappears when every step is done or the user dismisses it. Its source pattern is the previous product's sidebar flyout.
- **"Achievements … + goals" is ambiguous.** [INFERENCE] The previous checklist grouped items per page (`OnboardingPage`, apps/desktop/src/bindings/index.ts:7110-7111). "Goals" there probably means checklist items, not Project goals. Confirm with the user.

### 4.4 What to remove
- **H0 header buttons.** Import is already on the toolbar. Plan tonight is superseded by the Planning header. New Project moves to Up next's empty state and the Projects page.
- **H1 box on Home** (it moves, §4.3).
- **H2 Projects box** (→ Up next) and its dead state, `slices.a.showDone`.
- **H3 Sessions box, plus Home's in-place ReviewSheet** (home.tsx:82-98, 142-170). Sessions keeps a Review action (sessions.tsx:165-195). Needs a Target and Not in a Project stay in the Issues hub and the Sessions filters.
- **H4 Tonight box** (→ Planning).
- **H5 Goals box** (→ the Needs table).
- **H6 Work box** (→ Activity, the status bar and Issues).
- **Copy that goes with them:**
  - `home_suggested` ("Suggested by the evidence")
  - `home_captured_covers` ("Captured covers it: add candidates to a run"): explanatory sentences that break the copy rules
  - `home_window_detail`, `home_no_subjects_or_favourites`, `home_tonight`: replaced by a new `home_planning` ("Planning")
  - matching pt-BR keys
- **Performance:** narrow `useStore((s) => s)` (home.tsx:101) to the slices that Planning and Up next read.

## 5. Conditional verdict (Phase 5)
**Recommendation: A1+ as described in §4.** Planning gets shared site and night controls, the night's Plan, and a Needs table that carries the 30-night horizon as columns. Up next replaces the Projects and Sessions boxes. Getting started moves to the sidebar. Work, Goals and the header buttons are removed. **The A2 matrix is deferred.**

**Confidence: medium, about 70%.**
- High that H0, H2, H4, H5 and H6 should go. The code map shows each is a direct duplicate.
- Medium on the Needs table's horizon columns and on Up next.

This makes sense **IF**:
- Home's job is "what to shoot next and what is waiting on me", meaning the cross-page synthesis no single page holds.
- The site and night controls are one shared component with Targets.
- The Needs table's 30-night columns compute in acceptable time at realistic row counts.
- `projectNext` stays the single source for Up next.

It does **NOT** make sense **IF**:
- The user wants Home to be a full at-a-glance mirror (A0).
- The user wants the start page to be Targets › Planned (A3).
- "This month's windows" means a calendar matrix. In that case build A2, but only on a standard primitive, after the user defines what a cell shows (saved plan or astronomical opportunity) and what a click does.
- Unreviewed triage turns out to need session-level rows rather than one per Project. In that case keep a slim Unreviewed group in Up next.

## 6. Dependencies (the dispatcher owns the graph)
- **blocks:** extracting the shared site and night control from Targets must come before Home Planning. Give it one owner unit (FO-2). Coordinate with any Targets bead adding "reset to today" or week stepping (also round-9 feedback).
- **related:** flexible reminder lead times (Plan bead). The orientation walk rewrite (its anchors `next` and `#home-projects` change).
- **discovered-from:**
  - Carry the one-click "Confirm {suggestion}" (home.tsx:484) to Sessions › Needs a Target rows. Today it is the only one-click confirm of a pre-selected suggestion; parts.tsx:205-220 needs a manual pick.
  - Delete `slices.a.showDone`.

## 7. Uncertainty
- No rendered check of Home or the proposed layout was made (no browser tool).
- The meaning of "achievements … + goals" needs the user.
- The compute cost of 30-night windows per row is unmeasured.
