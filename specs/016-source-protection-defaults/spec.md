# Feature Specification: Source Protection Defaults

**Feature Branch**: `016-source-protection-defaults`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify protection settings as per-source behavior with global defaults rather than only a global protection setting."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Set Source-Level Protection (Priority: P1)

As a user, I want each configured source to define its own protection behavior so that capture folders, calibration stores, and project folders can have different mutation rules.

**Why this priority**: Cleanup/archive safety depends on the specific source and ownership model.

**Independent Test**: Configure different protection behavior for Inbox, Inventory, calibration, and project sources and confirm cleanup/archive plans respect each source setting.

**Acceptance Scenarios**:

1. **Given** a source is protected, **When** a cleanup plan includes files from it, **Then** the plan marks them as blocked or requires explicit override.
2. **Given** a source inherits defaults, **When** the global default changes, **Then** inherited source behavior updates while overridden sources remain unchanged.
3. **Given** a source is externally owned, **When** mutation is requested, **Then** the app warns and requires review before any destructive action.

---

### User Story 2 - Apply Defaults To New Sources (Priority: P2)

As a user, I want global protection defaults for newly added sources so that common safety policy does not need to be repeated.

**Why this priority**: Per-source protection should not make setup tedious.

**Independent Test**: Change the default protection policy, add a new source, and confirm it inherits the default while remaining editable.

**Acceptance Scenarios**:

1. **Given** a default protection policy exists, **When** a source is added, **Then** the new source starts with inherited protection.
2. **Given** a source-level override exists, **When** a cleanup plan is generated, **Then** the override takes precedence over the default.

### Edge Cases

- Source root is moved or missing.
- Same physical path is configured under two source names.
- Project-generated folders exist under an externally owned source root.
- User attempts permanent delete from a protected source.

### Domain Questions To Resolve

- Which source categories should default to protected.
- Whether source protection applies to archive moves, deletes, or both.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Protection behavior MUST be configurable per source.
- **FR-002**: Settings MUST provide global defaults used by newly added or inherited sources.
- **FR-003**: Source-level overrides MUST be visible in the source detail/settings row.
- **FR-004**: Cleanup/archive plans MUST evaluate protection at source level.
- **FR-005**: Destructive actions against protected sources MUST require explicit warning and confirmation.
- **FR-006**: Protection settings MUST be auditable.

### Key Entities

- **Source Protection Policy**: Rules controlling archive, delete, move, or modification operations for a source.
- **Protection Default**: Global policy inherited by sources without overrides.
- **Protection Override**: Source-specific policy.
- **Protected Plan Item**: Cleanup/archive plan entry affected by source protection.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can see whether a source inherits or overrides protection.
- **SC-002**: Protected-source items cannot be permanently deleted without explicit confirmation.
- **SC-003**: Cleanup/archive review explains why protected items are blocked or require approval.

## Assumptions

- Protection does not prevent read-only scanning.
- Permanent delete remains an advanced reviewed operation.

## Out of Scope

- OS-level filesystem permissions.
- Remote storage retention policies.

## Implementation Status

**Mockup-done (apps/desktop):**

- Source Protection settings section (`SettingsPage.tsx::SourceProtectionSection`)
  exposes three-level default protection (`protected` / `normal` / `unprotected`),
  a `Block permanent delete` switch, and a `Protected categories` text input
  (`lights, masters, finals` by default).
- Settings store (`src/data/settings.ts`) persists `defaultProtection`,
  `blockPermanentDelete`, and `protectedCategories` keys.
- Per-source override surfaces (Sources detail / row) are scoped to future
  implementation; mockup demonstrates inheritance language only.

**Pending implementation:**

- Per-source protection override storage and resolver (override → global default).
- Protection evaluation hook inside plan generation (spec 017 cleanup, spec 025
  archive) producing blocked / requires-acknowledgement plan items.
- Protected categories enforcement (frame-type / role membership check).
- Audit events for protection changes and protected-plan acknowledgements.
