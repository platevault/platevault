# Feature Specification: Onboarding Redesign — Three-Layer Onboarding

**Feature Branch**: `spec/056-onboarding-redesign`

**Created**: 2026-07-18

**Status**: Draft

**Input**: User description: "Replace the spec 010 guided sequential coach with a
three-layer onboarding system: a one-time modal orientation walk after first-run
setup, per-page Getting Started checklists in a shared sidebar accordion with
backend-authoritative auto-ticking from real domain events, and per-item
find/magnify spotlights on the real controls. No demo data ever. Old guided-flow
machinery is deleted."

**Supersedes**: [Spec 010 — Guided First Project Flow](../010-guided-first-project-flow/spec.md).
This feature replaces the sequential in-app coach wholesale. The old guided
state machine, its commands, its overlay, and its stored state are removed, not
adapted. This is a greenfield replacement: no upgrade or migration path is
provided for previously stored guided-coach progress beyond deleting it.

## Product Intent

New users finish the first-run setup wizard knowing *that* the app organizes an
astrophotography library, but not *where* anything happens or *what to do
first*. Spec 010 answered this with a single sequential coach that walked one
scripted path (confirm → project → tool). In practice a real library workflow is
not a single path: users arrive with different libraries, skip stages, and
return days later mid-flow. The redesign separates three distinct needs:

1. **Orientation** ("what is where") — a one-time, deliberately modal walk
   across the real pages immediately after setup, before the user has any
   context to lose. This is a documented exception to the product's non-modal
   norm: for the 60 seconds after setup completes there is nothing else the
   user could productively be doing, and undivided attention is the point.
2. **Direction** ("what should I do next, per page") — persistent, glanceable
   per-page Getting Started checklists that tick themselves off as the user
   does real work, in any order, over any number of sessions.
3. **Location** ("show me the exact control") — an on-demand spotlight per
   checklist item that highlights the real control on the real page,
   non-modally, without taking over the workflow.

Progress is earned by real domain activity, never simulated. The checklist
reflects what actually happened in the library — a completed item means the
underlying work truly exists on disk and in the database. No demo or sample
data is ever created (carried forward from spec 010 FR-009).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - First-Run Orientation Walk (Priority: P1)

Immediately after the first-run setup wizard finishes, the app launches a
guided orientation walk: a modal, page-by-page tour that navigates the real
application pages in workflow order, spotlights each whole page, and shows one
or two sentences of "this is where X happens" copy per stop. The user can move
Next/Back on every stop, Skip at any time, or press Escape to end the walk.
Finishing or skipping marks orientation done forever; it never auto-runs a
second time. It can be replayed on demand from Settings → Advanced.

**Why this priority**: Orientation is the first thing a brand-new user
experiences and the cheapest way to remove "where does anything happen"
confusion. It is self-contained and delivers value even if no other layer
ships.

**Independent Test**: Complete the first-run wizard in a fresh profile; the
walk starts, visits each primary page in sequence with visible spotlight and
copy, responds to Next/Back/Skip/Escape, and never reappears after finish or
skip across app restarts. Replay works from Settings → Advanced.

**Acceptance Scenarios**:

1. **Given** a fresh install where the first-run setup wizard just completed,
   **When** the main window appears, **Then** the orientation walk starts
   automatically in modal mode on the first stop.
2. **Given** the walk is on any stop, **When** the user activates Next or Back,
   **Then** the walk navigates to the real neighboring page and spotlights it
   with its orientation copy.
3. **Given** the walk is on any stop, **When** the user activates Skip or
   presses Escape, **Then** the walk closes immediately and orientation is
   marked done forever.
4. **Given** orientation was finished or skipped, **When** the app restarts,
   **Then** the walk does not auto-run.
5. **Given** orientation is done, **When** the user activates the replay
   control in Settings → Advanced, **Then** the walk runs again from the first
   stop, and finishing or skipping it again leaves orientation marked done.

---

### User Story 2 - Per-Page Getting Started Checklists (Priority: P2)

The sidebar carries one shared "Getting started" accordion section, placed
above the pinned Settings entry. It shows an overall progress line and one
group per workflow page — Inbox, Sessions, Calibration, Targets, Projects —
matching the sidebar's workflow-stage order (no groups for Archive, Settings,
or setup). Each group holds 2–4 items with 3–5 word labels; hovering or
focusing an item reveals a one-sentence fuller description in a tooltip. The
group for the currently visited page is auto-expanded; other groups collapse to
one line with a completed/total count. Items that depend on an upstream
milestone (for example "Create your first project" needs at least one confirmed
inventory item) show a prerequisite state with a reason and a jump link to the
page where the prerequisite is met. When the sidebar is icon-collapsed, a
progress-ring icon represents the section and opens the checklist as a
non-modal popover. The section is expanded by default from first visit; a
user's collapse choice is persisted.

**Why this priority**: The checklists are the persistent core of the redesign —
they guide real multi-session workflows long after the one-shot walk ends.

**Independent Test**: With onboarding active, visit each workflow page and
verify its group auto-expands with 2–4 items; verify overall progress line,
per-group counts, tooltips, prerequisite reasons and jump links, popover
behavior in icon-collapsed mode, and persistence of expand/collapse across
restarts.

**Acceptance Scenarios**:

1. **Given** onboarding is active, **When** the user opens any workflow page,
   **Then** that page's checklist group is expanded in the sidebar accordion
   and all other groups show as one line with a completed/total count.
2. **Given** an item whose prerequisite milestone is missing, **When** the user
   views or focuses the item, **Then** it presents a prerequisite state with a
   human-readable reason and a jump link that navigates to the upstream page.
3. **Given** the sidebar is icon-collapsed, **When** the user activates the
   progress-ring icon, **Then** the checklist opens as a non-modal popover with
   the same content, and the rest of the app stays interactive.
4. **Given** the user collapses the Getting started section, **When** the app
   restarts, **Then** the section stays collapsed until the user expands it.

---

### User Story 3 - Automatic Completion from Real Work (Priority: P3)

Checklist items that correspond to observable domain milestones tick themselves
automatically when the real event happens — confirming inventory, creating a
project, launching a processing tool, and other real recorded milestones. All
other items are manually checked off or dismissed by the user. When an item
completes (automatically or manually) it never simply disappears: the row shows
a check animation and brief emphasis in place, then moves to a completed
(greyed, checked) area at the bottom of its page group. Automatic ticks
additionally pulse the section progress line (or the progress ring when
collapsed) so a side-effect tick is witnessed even if the user is looking
elsewhere. Under reduced motion, the state change happens without animation.
Completion state is authoritative and durable: it reflects what actually
happened in the library, survives restarts, and is never triggered by restoring
or replaying past records.

**Why this priority**: Auto-ticking is what makes the checklist trustworthy —
it proves the app observed real work rather than asking users to bookkeep.

**Independent Test**: Perform a real inventory confirm, project create, and
tool launch; verify the matching items tick automatically with the completion
choreography and progress pulse, survive restart, and that restoring or
replaying historical records never produces a tick.

**Acceptance Scenarios**:

1. **Given** an unchecked auto item for confirming inventory, **When** the user
   confirms an inbox item for real, **Then** the checklist item ticks
   automatically, plays the completion choreography, and the section progress
   pulses.
2. **Given** a manual item, **When** the user checks it off or dismisses it,
   **Then** it plays the same completion choreography (without the auto-tick
   progress pulse) and moves to the completed area of its group.
3. **Given** any completed item, **When** the app restarts, **Then** the item
   remains completed.
4. **Given** stored history is restored or replayed by the system, **When**
   restore-sourced records are processed, **Then** no checklist item ticks as
   a result.
5. **Given** the user has reduced motion enabled, **When** any item completes,
   **Then** the state change is applied without animation or pulse.

---

### User Story 4 - Find-It Spotlight on the Real Control (Priority: P4)

Every checklist item carries a find/magnify affordance. Activating it renders a
non-modal spotlight over the real control on the real page that the item is
about. The spotlight pulses for the first few seconds, then settles to a static
outline; under reduced motion it never pulses. It is dismissed by clicking the
spotlighted control, clicking anywhere else, pressing Escape, toggling the find
affordance again, or navigating to another page — and it is never dismissed on
a timer. The spotlight overlay may span and dim the sidebar.

**Why this priority**: The spotlight closes the last gap — "I know what to do,
show me exactly where" — but is only useful once checklists exist.

**Independent Test**: For each checklist item, activate find, verify the
correct control is spotlighted non-modally, verify all five dismissal paths
work and no time-based dismissal occurs, and verify reduced-motion suppresses
the pulse.

**Acceptance Scenarios**:

1. **Given** a checklist item with a find affordance, **When** the user
   activates it, **Then** a spotlight highlights the item's real control while
   the rest of the app stays interactive.
2. **Given** an active spotlight, **When** the user clicks the target, clicks
   anywhere else, presses Escape, toggles the find affordance, or changes
   pages, **Then** the spotlight dismisses.
3. **Given** an active spotlight, **When** the user does nothing, **Then** the
   spotlight persists indefinitely (pulse settles to a static outline; it never
   auto-dismisses on a timer).

---

### User Story 5 - Removal, Restore, and Replay Controls (Priority: P5)

A small menu in the Getting started section header offers "Remove getting
started" with a one-line confirmation; confirming hides the section
permanently. Settings → Advanced carries the single restore/reset control for
onboarding (alongside the orientation replay). Restoring re-seeds automatic
items from the actual database state: if confirmed inventory, projects, or tool
launches already exist, the corresponding items come back pre-ticked.

**Why this priority**: Experienced users must be able to opt out cleanly, and
returning users must be able to bring the checklist back without it lying about
work already done.

**Independent Test**: Remove the section via the header menu and verify it
stays hidden across restarts; restore from Settings → Advanced in a library
that already has confirmed inventory and a project, and verify those items
return pre-ticked while unmet items return unchecked.

**Acceptance Scenarios**:

1. **Given** the Getting started section is visible, **When** the user chooses
   "Remove getting started" and confirms the one-line prompt, **Then** the
   section (and its collapsed progress-ring icon) disappears permanently,
   surviving restarts.
2. **Given** onboarding was removed, **When** the user activates restore in
   Settings → Advanced, **Then** the section returns and every automatic item
   whose milestone already exists in the library is pre-ticked.
3. **Given** onboarding was restored, **When** milestones that never happened
   are inspected, **Then** their items are unchecked (never falsely ticked).

---

### Edge Cases

- App closes mid-orientation-walk: the walk was neither finished nor skipped;
  on next launch it auto-runs again from the first stop (auto-run only stops
  after an explicit finish or skip).
- The real control an item points to is not currently rendered (empty state,
  hidden panel): the find affordance communicates why the control is
  unavailable instead of spotlighting nothing.
- Two candidate anchors exist for one item (historically the inbox confirm
  control was anchored in two places): exactly one target must be resolved so
  the spotlight is deterministic.
- A domain milestone happens while the orientation walk is running: the tick is
  recorded; the checklist reflects it after the walk closes.
- A domain milestone happens while its page group is not expanded or the
  sidebar is icon-collapsed: the progress line or progress ring pulses so the
  tick is witnessed.
- Prerequisite met while the dependent item is visible: the prerequisite state
  clears without requiring a page reload.
- User removes the section while a spotlight is active: the spotlight
  dismisses with the section.
- Restore is activated twice in a row: idempotent — same re-seeded result, no
  duplicate items.
- Automated end-to-end tests of unrelated features must be able to suppress
  onboarding surfaces deterministically (the old coach had such a suppression
  path; a replacement is required).
- Reduced motion is enabled mid-session: subsequent animations and pulses are
  suppressed without restart.

## Requirements *(mandatory)*

### Functional Requirements

#### Layer 1 — Orientation walk

- **FR-001**: The orientation walk MUST launch automatically exactly once,
  immediately after the first-run setup wizard completes.
- **FR-002**: The walk MUST be modal (a documented, deliberate exception to the
  product's non-modal norm), MUST navigate the real pages in workflow
  sequence, and MUST present a whole-page spotlight with short "this is where X
  happens" copy on every stop.
- **FR-003**: Every stop MUST offer Next, Back, and Skip controls, and Escape
  MUST end the walk from any stop.
- **FR-004**: Finishing or skipping the walk MUST mark orientation done
  forever; the walk MUST never auto-run twice. Closing the app mid-walk without
  finishing or skipping MUST NOT mark it done.
- **FR-005**: The walk MUST be replayable on demand from Settings → Advanced;
  replay MUST NOT alter the done-forever auto-run rule.

#### Layer 2 — Getting started checklists

- **FR-006**: The system MUST provide per-page Getting Started checklists for
  Inbox, Sessions, Calibration, Targets, and Projects — 2 to 4 items per page —
  and MUST NOT provide checklists for Archive, Settings, or setup surfaces.
- **FR-007**: All checklists MUST be presented as one shared sidebar accordion
  section placed above the pinned Settings entry, with an overall progress
  line, per-page groups matching the sidebar's workflow stages, the current
  page's group auto-expanded, and other groups rendered as one line with a
  completed/total count.
- **FR-008**: Item labels MUST be 3–5 words, with a fuller one-sentence
  description available in a tooltip on hover and on keyboard focus.
- **FR-009**: The system MUST NOT create demo, sample, or placeholder library
  data for any onboarding purpose (carried forward verbatim from spec 010
  FR-009).
- **FR-010**: Items whose upstream milestone is missing MUST present a
  prerequisite state with a human-readable reason and a jump link to the page
  where the prerequisite is satisfied (e.g. "Create your first project"
  requires at least one confirmed inventory item).
- **FR-011**: When the sidebar is icon-collapsed, the section MUST be
  represented by a progress-ring icon that opens the checklist as a non-modal
  popover.
- **FR-012**: The section MUST be expanded by default from first visit; the
  user's collapse choice MUST be persisted across restarts.
- **FR-013**: A small menu in the section header MUST offer "Remove getting
  started" behind a one-line confirmation; confirming MUST hide the section
  permanently (across restarts) until explicitly restored.
- **FR-014**: Settings → Advanced MUST carry the single restore/reset control.
  Restore MUST re-seed automatic items from the actual recorded library state:
  milestones that already exist (confirmed inventory, projects, tool launches)
  come back pre-ticked; milestones that never happened come back unchecked.
  Restore MUST be idempotent.

#### Completion semantics

- **FR-015**: Automatic ticks MUST derive only from real recorded domain
  milestones — confirming inventory, creating a project, launching a
  processing tool with a successful spawn, and any additional real milestones
  the design phase verifies are already observable. The v1 scope MUST NOT
  invent new milestone signals; milestones that are not yet observable are
  recorded as follow-ups and their items are manual.
- **FR-016**: Records processed during a restore or replay of history MUST
  never produce a tick.
- **FR-017**: Every item that is not auto-ticked MUST be manually checkable and
  dismissable by the user.
- **FR-018**: On completion (auto or manual) an item MUST NOT simply disappear:
  it MUST play a check animation with brief row emphasis in place, then move to
  a completed (greyed, checked) area at the bottom of its page group.
- **FR-019**: Automatic ticks MUST additionally pulse the section progress line
  (or the progress ring when icon-collapsed) so side-effect ticks are
  witnessed.
- **FR-020**: Under reduced motion, all completion choreography MUST degrade to
  an immediate state change without animation or pulse.
- **FR-021**: All onboarding progress and flags (orientation done, item states,
  section removed, applicable collapse state) MUST persist across app restarts
  and MUST reflect authoritative recorded state — identical regardless of which
  screen was open when the milestone happened.

#### Layer 3 — Find-it spotlight

- **FR-022**: Every checklist item MUST offer a find/magnify affordance that
  renders a non-modal spotlight on the item's real control on the real page.
- **FR-023**: The spotlight MUST dismiss on: clicking the spotlighted target,
  clicking anywhere else, pressing Escape, toggling the find affordance, or a
  page/route change. It MUST NOT be dismissed on a timer.
- **FR-024**: The spotlight MUST pulse for the first few seconds then settle to
  a static outline; under reduced motion it MUST NOT pulse.
- **FR-025**: The spotlight overlay MAY span and dim the sidebar.
- **FR-026**: Each item MUST resolve to exactly one spotlight target; ambiguous
  or duplicate anchor targets MUST be resolved to a single deterministic
  target.

#### Cross-cutting

- **FR-027**: The old guided coach MUST be fully removed: no sequential coach
  UI, no legacy guided commands or stored guided state are honored. No
  migration of legacy guided progress is performed beyond its deletion
  (greenfield).
- **FR-028**: All user-facing onboarding text MUST be localizable through the
  application's translation catalog; no hardcoded user-facing strings.
- **FR-029**: All onboarding surfaces MUST be fully keyboard operable, MUST
  announce state changes (walk stops, ticks, spotlight open/close) to
  assistive technology, MUST manage focus correctly on open/close, and MUST
  meet WCAG 2.2 AA.
- **FR-030**: Automated tests of unrelated features MUST have a deterministic
  way to suppress all onboarding surfaces.

### Key Entities

- **Onboarding item**: One checklist entry, identified stably, belonging to
  exactly one workflow page group; has a label, tooltip description, optional
  prerequisite (reason + jump destination), an optional automatic milestone,
  and a find target.
- **Item state**: Per-item lifecycle — unchecked, automatically checked,
  manually checked, or dismissed — with when and from what source the state was
  set.
- **Orientation state**: Whether the one-time walk has been finished or
  skipped (done forever) and replay availability.
- **Section flags**: Whether the Getting started section has been permanently
  removed, and the persisted collapse state.
- **Domain milestone**: A real recorded library event (inventory confirmed,
  project created, tool launched, and other verified observable milestones)
  that can complete an item automatically and that seeds restore.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user reaches the end of the orientation walk (or
  skips it) in under 2 minutes, and the walk never auto-appears again across
  any number of restarts.
- **SC-002**: When a user performs a real milestone action (inventory confirm,
  project create, tool launch), the matching checklist item visibly completes
  within 2 seconds, without any page reload.
- **SC-003**: 100% of automatic ticks are backed by a real recorded domain
  milestone; restoring or replaying history produces zero ticks; zero demo or
  sample data exists anywhere in the product.
- **SC-004**: After remove + restore in a library with prior real work, every
  already-met milestone item is pre-ticked and every unmet item is unchecked —
  no false positives or negatives.
- **SC-005**: All onboarding flows are completable keyboard-only, and under
  reduced motion no onboarding animation or pulse plays.
- **SC-006**: A user can locate the control for any checklist item via the
  find spotlight in under 10 seconds, and every one of the five dismissal
  paths works; no spotlight ever auto-dismisses on a timer.

### Validation Contract

- **VC-001**: Journey **J18** (authored separately in `docs/journeys/`) is the
  behavioral contract for this feature; the feature is done when J18 validates
  against the running product.
- **VC-002**: The Playwright mock suite validates UI semantics: the orientation
  walk including the skip path, the accordion behavior, the spotlight dismissal
  matrix, persistence flags, and accessibility. Known limit (documented): in
  mock mode the real event path is a no-op, so auto-ticking is NOT validated
  there.
- **VC-003**: Layer-1 (real-backend integration) tests assert that the three
  core milestone events actually publish from the real use cases, that the
  backend subscriber records the corresponding ticks, and that restore-sourced
  events are inert.
- **VC-004**: One Layer-2 end-to-end journey (real UI → real IPC → real
  backend) walks orientation, performs a real inventory confirm, and asserts
  the live auto-tick appears.
- **VC-005**: The feature's coverage row is present in
  `specs/037-e2e-integration-testing/contracts/coverage-matrix.md` (row added
  by the validation lane; referenced here as part of done).

## Assumptions

- Greenfield replacement: the only handling of legacy guided-coach state is
  deletion; no user-visible migration is required.
- The first-run setup wizard (spec 003/038) remains the trigger boundary: the
  orientation walk starts only after the wizard reports completion.
- The set of workflow pages (Inbox, Sessions, Calibration, Targets, Projects)
  is stable for v1; adding a page later means adding a checklist group, not
  redesigning the section.
- Single-user, single-instance desktop app: no concurrent-writer conflicts on
  onboarding state.
- The existing suppression mechanism used by automated tests for the old coach
  is retired with it; a replacement suppression path ships with this feature
  (FR-030).
- Checklist item copy (labels, tooltips, orientation stop copy) is authored at
  design time in the translation catalog; final wording may be tuned without
  re-specification.
