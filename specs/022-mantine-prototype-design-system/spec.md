# Feature Specification: Mantine Prototype Design System

**Feature Branch**: `022-mantine-prototype-design-system`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify that the prototype is Mantine-first, uses standard Mantine components and TanStack Table/Router, writes DESIGN.md, and avoids custom CSS or raw primitives unless necessary."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Use A Consistent Component System (Priority: P1)

As a contributor, I want the prototype to be built from Mantine standard components so that the UI is consistent and not a collection of custom layouts.

**Why this priority**: The user explicitly chose Mantine and asked to stop rolling custom primitive layouts.

**Independent Test**: Inspect prototype source and confirm primary pages use Mantine layout, typography, form, menu, modal, table presentation, and feedback components rather than raw layout tags and custom CSS.

**Acceptance Scenarios**:

1. **Given** a page uses headings or body text, **When** source is inspected, **Then** it uses Mantine `Title` and `Text` unless there is a clear semantic reason not to.
2. **Given** a page uses layout wrappers, **When** source is inspected, **Then** it uses Mantine `Stack`, `Group`, `Box`, `Paper`, `AppShell`, `Modal`, `Tabs`, `Accordion`, or equivalent.
3. **Given** a custom CSS selector exists, **When** it is reviewed, **Then** it is justified as global theming, integration glue, or a layout case Mantine cannot express cleanly.

---

### User Story 2 - Preserve Table And Routing Architecture (Priority: P1)

As a contributor, I want tables and routes to use the selected specialist libraries so that table logic and navigation remain maintainable.

**Why this priority**: The settled stack is Mantine for UI, TanStack Table for table logic, and TanStack Router for routing.

**Independent Test**: Inspect Inventory, Inbox, and Projects tables for TanStack Table usage; inspect app navigation for TanStack Router usage.

**Acceptance Scenarios**:

1. **Given** a data ledger is implemented, **When** table source is inspected, **Then** TanStack Table owns row/filter/selection logic.
2. **Given** navigation is implemented, **When** source is inspected, **Then** TanStack Router owns routes and links.
3. **Given** a Mantine table is used, **When** table behavior changes, **Then** behavior is controlled through TanStack Table state rather than ad hoc DOM state.

---

### User Story 3 - Maintain DESIGN.md (Priority: P2)

As a future contributor, I want a DESIGN.md that documents the prototype design system so that future UI work follows the settled decisions.

**Why this priority**: The user requested DESIGN.md as part of the prototype.

**Independent Test**: Open DESIGN.md and confirm it documents register, component policy, layout, typography, color/theming, actions, table behavior, details panels, settings, onboarding, logs, and accessibility.

**Acceptance Scenarios**:

1. **Given** a contributor starts UI work, **When** they read DESIGN.md, **Then** they can identify Mantine/TanStack usage rules.
2. **Given** a page needs a new component, **When** DESIGN.md is followed, **Then** the contributor first checks Mantine standard components before custom building.
3. **Given** custom CSS is proposed, **When** DESIGN.md is followed, **Then** the contributor documents why it is necessary.

### Edge Cases

- Mantine lacks a required native desktop affordance.
- Tauri native controls require small integration wrappers.
- A semantic HTML element is required for accessibility.
- A layout is not practical with Mantine props alone.
- A component would become less accessible if forced through a generic primitive.

### Domain Questions To Resolve

- Which local wrapper components should be extracted after the prototype stabilizes.
- Whether Mantine theme tokens should live in code, DESIGN.md, or both.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The prototype MUST use Mantine as the primary UI component system.
- **FR-002**: The prototype MUST use TanStack Table for ledger/table behavior.
- **FR-003**: The prototype MUST use TanStack Router for routing.
- **FR-004**: The prototype MUST avoid custom CSS for layout and widgets unless necessary.
- **FR-005**: The prototype MUST avoid raw `<p>`, `<h1>`, `<h2>`, `<h3>`, and generic layout primitives where Mantine equivalents are practical.
- **FR-006**: Any remaining raw semantic element or custom CSS MUST be justified as accessibility, Tauri integration, global theming, or a Mantine limitation.
- **FR-007**: DESIGN.md MUST exist and document the design system decisions.
- **FR-008**: Prototype pages MUST use standard component affordances for buttons, menus, settings rows, modals, tabs, details, tables, filters, and onboarding.
- **FR-009**: UI copy MUST use functional product language and avoid AI-flavored labels.

### Key Entities

- **Design System Rule**: Documented decision that constrains UI implementation.
- **Mantine Component Usage**: Standard component selected for layout, text, forms, menus, modals, and feedback.
- **Custom CSS Exception**: Documented reason for a non-Mantine style.
- **Prototype Route**: User-facing route implemented under the selected stack.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Source grep finds no avoidable raw heading/body text primitives in primary prototype pages.
- **SC-002**: Source grep finds no non-Mantine UI framework imports in the prototype.
- **SC-003**: Typecheck passes after Mantine/TanStack migration.
- **SC-004**: DESIGN.md explains enough for another agent to continue UI work without re-litigating the stack.

## Assumptions

- Mantine components can be styled through props/theme for most prototype needs.
- Minimal global CSS remains acceptable for app-level theme variables and Tauri/browser integration glue.

## Out of Scope

- Building a full reusable component library.
- Replacing Mantine internals.
- Pixel-perfect final production visual design.
