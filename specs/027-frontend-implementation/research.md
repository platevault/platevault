# Research: Desktop Frontend Implementation

All technical decisions for this spec are pre-resolved from inherited infrastructure (spec 022), the canvas design session, and grill-me decisions. This document records the decisions and their sources for traceability.

## 1. Component Library

**Question**: Which component library for dense desktop UI with full visual control?

**Decision**: Base UI (`@base-ui-components/react`) — headless primitives

**Rationale**: Inherited from spec 022 (previously Mantine, then migrated to Base UI). Headless approach gives full control over the DESIGN.md visual system (grayscale, specific spacing scale, density modes) without fighting an opinionated library.

**Source**: Spec 022 research, canvas DESIGN.md §0 ("Base UI primitives")

---

## 2. Visual Design System

**Question**: What visual tokens, typography, and density system?

**Decision**: Canvas DESIGN.md §3 is authoritative. Grayscale-first palette, Inter 11.5-22px, JetBrains Mono for paths, 4/6/8/10/12/14/16/18px spacing, three density modes (24/32/40px rows).

**Rationale**: The canvas wireframes were iterated extensively in the design session. They supersede all prior visual token definitions from spec 022.

**Alternatives Considered**: Spec 022's prior tokens (11-24px font range, 4-64px spacing, Mantine-era colors) — superseded by canvas.

**Source**: Canvas DESIGN.md §3, grill-me decision #11

---

## 3. Navigation Pattern

**Question**: How do sidebar, three-pane, and centered layouts coexist?

**Decision**: Single collapsible sidebar (user-persisted state). Three-pane pages work alongside either expanded or collapsed sidebar. Centered layout for wizards (first-run, root recovery).

**Rationale**: Grill-me decision #14 — user's collapse preference persists globally. Both states work with three-pane pages.

**Source**: DESIGN.md §5, grill-me decision #14

---

## 4. Review Queue Visibility

**Question**: Is the Review queue nav item conditional or always visible?

**Decision**: Always visible. Badge count when items exist, no badge when empty.

**Rationale**: Grill-me decision #2 — conditional hiding confuses users who need to re-open confirmed sessions for re-review.

**Source**: Grill-me decision #2

---

## 5. Project Creation Pattern

**Question**: Single dialog (spec 008) or 6-step wizard (canvas)?

**Decision**: 6-step wizard from canvas wireframes.

**Rationale**: Grill-me decision #3 — project creation involves enough decisions (source mapping, per-filter calibration, source view strategy, plan review) that a single dialog would be overwhelming.

**Source**: DESIGN.md §6.9, grill-me decision #3

---

## 6. DirPicker Interaction

**Question**: How complex should the directory picker be?

**Decision**: Native OS picker only. Folder icon + read-only path display + "Choose folder…" button. No paste, dropdown, or drag-drop.

**Rationale**: Grill-me decision #12 — simplicity and safety. The "never a text input for paths" rule is a hard-no in DESIGN.md §10.

**Source**: DESIGN.md §4.3, §10, grill-me decision #12

---

## 7. Tour Library

**Question**: Which library for guided onboarding overlay hints?

**Decision**: react-joyride v3

**Rationale**: Research from spec 010 disqualified Shepherd (AGPL-or-commercial relicense as of 2026-05-23). react-joyride v3 provides non-blocking overlay hints anchored to DOM elements with MIT license.

**Source**: Spec 010 research, memory file `spec-010-tour-library.md`

---

## 8. Mock Data Strategy

**Question**: How to develop frontend without completed Rust backend?

**Decision**: Typed Tauri command mocks in `src/api/mocks.ts` backed by static fixture data in `src/data/fixtures/`. Commands return the same response shapes as real backend. A `USE_MOCKS` flag switches between mock and real at build time.

**Rationale**: Allows frontend milestone delivery independent of backend crate progress. Mock shapes match the language-neutral contracts from specs 002-026.

**Source**: Architecture decision for this spec

---

## 9. Density Implementation

**Question**: How to implement three density modes technically?

**Decision**: CSS custom property `--alm-density: compact | comfortable | spacious` on the root element. All density-sensitive components read row heights and padding from corresponding token variables (`--alm-row-height`, `--alm-cell-padding`). Single global preference stored in `src/data/preferences.ts` (localStorage).

**Rationale**: Grill-me decision #9 — single global setting, no per-page override. CSS custom properties allow the entire UI to respond without React re-renders.

**Source**: DESIGN.md §3, grill-me decision #9

---

## 10. Cleanup Policy Resolution

**Question**: When a project uses a specific workflow profile, how does cleanup policy apply?

**Decision**: The project's selected workflow profile (PixInsight/Siril/planetary) determines which column of the settings cleanup matrix applies at plan-generation time.

**Rationale**: Grill-me decision #8 — one project = one tool = one policy column. Simple and unambiguous.

**Source**: Grill-me decision #8
