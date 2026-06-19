# Feature Specification: Cross-root Inbox (logical unacknowledged queue)

**Feature Branch**: `039-cross-root-inbox`

**Created**: 2026-06-19

**Status**: Draft

**Input**: Make the Inbox a logical queue of every unacknowledged detection across all registered roots, regardless of folder — not tied to a physical "inbox" folder. As a consequence, the inbox source folder becomes optional (only for users who use a staging/drop-folder workflow).

## Background

Verified during validation:
- The data model already supports this: a persistent `inbox_items` table (migration 0020) keyed by `root_id` with a durable `state` (`pending_classification` → … → confirmed).
- But the Inbox **view** does not use it that way: `apps/desktop/src/features/inbox/InboxPage.tsx` is hardcoded to a single demo root (`DEV_ROOT_ID` / `DEV_ROOT_PATH` ≈ `/astro/inbox`), and there is **no command that lists unacknowledged items across all roots** — the model is "scan one root on demand" (`inbox_scan`).
- Consequence: the spec-038 wizard scan persists inbox items for the user's real source folders, but the Inbox page never shows them → the "approval happens in the Inbox" handoff is effectively broken for real roots.
- `inbox` is currently a **required** source kind (`REQUIRED_KINDS = ['light_frames','project','inbox']`), forcing every user to configure a drop folder.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See everything pending, anywhere (Priority: P1)

A user opens the Inbox and sees every detected-but-unacknowledged ingestion group from **all** their registered roots, no matter which folder it lives in — not just a single "inbox" folder.

**Why this priority**: This is the core of the request and unblocks the whole ingest→approve workflow (incl. the 038 wizard handoff).

**Independent Test**: With detections persisted in ≥2 different roots, the Inbox lists items from both; confirming/acknowledging one removes it from the list.

**Acceptance Scenarios**:

1. **Given** unacknowledged `inbox_items` exist in multiple registered roots, **When** the user opens the Inbox, **Then** all of them are listed, grouped/labeled by root, regardless of folder.
2. **Given** an item is confirmed/acknowledged, **When** the list refreshes, **Then** that item no longer appears (only unacknowledged states are shown).
3. **Given** the spec-038 wizard scanned the user's sources, **When** the user lands in the Inbox, **Then** those scanned detections are present and actionable.

### User Story 2 - The inbox folder is optional (Priority: P1)

A user who does not use a dedicated drop/staging folder can complete first-run setup without configuring an `inbox` source, and still get a working Inbox (fed by their other roots).

**Why this priority**: Directly requested; removes a forced, workflow-specific requirement.

**Independent Test**: Complete the setup wizard with only light-frames + project sources (no inbox folder) → setup completes; the Inbox still surfaces unacknowledged items from the configured roots.

**Acceptance Scenarios**:

1. **Given** the setup wizard, **When** the user has not added an inbox folder, **Then** setup can still complete (inbox is not in the required-kinds gate).
2. **Given** a user who *does* use a drop folder, **When** they add an `inbox` source, **Then** it still works as a normal root that feeds the Inbox.

### User Story 3 - Pick up newly added files (Priority: P2)

Files added to a root after setup eventually appear in the Inbox.

**Why this priority**: Without a rescan trigger the cross-root view goes stale.

**Independent Test**: Add a file to a root, trigger a rescan (manual button and/or on-open), confirm it appears.

**Acceptance Scenarios**:

1. **Given** new files in a registered root, **When** the user triggers "Rescan" (and/or reopens the app), **Then** the new detections appear in the Inbox.

### Edge Cases

- A root whose path is currently offline/inaccessible: its previously-detected items still show (from the DB); rescan skips it gracefully without dropping them.
- Large libraries: the cross-root list must paginate or virtualize / be bounded, not load unbounded.
- De-dup: the same file must not appear twice (the `inbox_items` unique key on root + relative path already enforces this per root).

## Requirements *(mandatory)*

- **FR-001**: Provide a command that returns all `inbox_items` in an **unacknowledged** state across **all** registered roots (not a single hardcoded root).
- **FR-002**: `InboxPage` MUST use that aggregate list (remove the hardcoded `DEV_ROOT_ID`/`DEV_ROOT_PATH`); items are labeled/grouped by their root.
- **FR-003**: Acknowledged/confirmed items MUST drop out of the Inbox list.
- **FR-004**: `inbox` MUST be removed from the wizard's required source kinds; it remains a supported optional kind.
- **FR-005**: Provide a rescan trigger (manual at minimum) that repopulates `inbox_items` for all roots; new detections appear, already-confirmed items are not resurrected.
- **FR-006**: The list MUST be bounded/virtualized for large libraries (no unbounded load).
- **FR-007**: Mock mode MUST drive the cross-root list against mock data.

## Success Criteria *(mandatory)*

- **SC-001**: With unacknowledged items in ≥2 roots, the Inbox shows items from all of them.
- **SC-002**: Completing setup without an inbox folder succeeds, and the Inbox still shows items from the other roots.
- **SC-003**: Confirming an item removes it from the Inbox; a rescan does not bring confirmed items back.
- **SC-004**: 038 wizard-scanned detections are visible in the Inbox after setup.
- **SC-005**: Full vitest suite green.

## Scope

**In scope**: cross-root unacknowledged listing command + Inbox page rewire; making inbox an optional source kind; a (manual) rescan trigger; bounded list.

**Out of scope**: background/automatic continuous watching of roots (a manual/on-open rescan is enough for v1); changes to classification rules; the confirm/plan pipeline itself (already works).

## Assumptions

- `inbox_items.state` distinguishes unacknowledged (e.g. pending/classified) from acknowledged/confirmed; the listing filters on that.
- The registered-roots list (spec fix-library-roots) provides the set of roots to aggregate over.
- Greenfield: no migration of existing inbox rows required.
