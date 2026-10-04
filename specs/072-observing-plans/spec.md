# Feature Specification: Observing plans, reminders, calendar export

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `072-observing-plans`

**Created**: 2026-10-03

**Status**: Draft; product defaults recorded in D01 through D18 under the user-authorized specification-gate waiver. Requirements analysis, implementation and verification remain pending.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - Observing plans, reminders, calendar export (Priority: P1)

Astronomical windows for a Target from a chosen planning site, opt-in reminders limited to the default site, and a one-time ICS snapshot.

**Why this priority**: This feature owns the workflow steps listed below without imposing unrelated product features.

**Independent Test**: Exercise the acceptance scenarios through the running product with isolated inputs. Existing baseline code does not prove the redesigned behavior.

**Acceptance Scenarios**:

- **PLAN-AC-01**: Given Backyard as default and a second saved site, when the planning site is switched, then windows recalculate for that site and time zone, while Project membership and session capture sites are unchanged.
- **PLAN-AC-02**: Given reminders enabled at Backyard, when the user plans at another site, then no reminder is scheduled for that site and every reminder names Backyard.
- **PLAN-AC-03**: Given selected windows, when the calendar is exported, then the .ics holds exactly the confirmed windows with the displayed site and time zone; later criteria changes leave the saved file unchanged.
- **PLAN-AC-04**: Given no default site, when Enable notifications is chosen, then the user is directed to set one and no reminder is scheduled without a named site.
- **PLAN-AC-05**: Given reminders were never enabled, then no background reminder activity occurs; enabling reminders starts no indexing.
- **PLAN-AC-06**: Given notifications are disabled, when enabling is requested without explicit criteria or lead time, then no reminder starts. The confirmed site, criteria and lead time are shown before activation.
- **PLAN-AC-07**: Given notifications were enabled and the app resumes, when upcoming windows are recomputed, then already-delivered target/site/window identities do not repeat. No app-closed delivery capability is claimed without an installed, tested scheduler.
- **PLAN-AC-08**: Given OS notification permission is denied, when activation is requested, then denial remains visible with Settings and Retry, and no delivery success is claimed.

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

## Requirements

### Functional Requirements

- **PLAN-FR-01**: Saved sites and a default site set in Settings. The planning-site selector is independent of Projects and capture sites; changing it never alters Project membership or session sites.
- **PLAN-FR-02**: The Plan area sets altitude, darkness, Moon, and minimum-duration criteria. Windows show their site and time-zone basis, the active planning site is shown, and Project checklist gaps appear beside coverage.
- **PLAN-FR-03**: Mark Planned and Enable notifications are explicit opt-ins. Reminders use the displayed default site, and every reminder names it. Planning elsewhere never enables reminders there. Enabling reminders starts no indexing or image processing.
- **PLAN-FR-04**: Export calendar confirms site, date range, time zone, and selected windows, then saves an .ics file through the native save dialog as a one-time snapshot.
- **PLAN-FR-05**: Suitability is astronomical only: no weather, equipment, or processing-readiness claims, and no provider account or authorization.
- **PLAN-FR-06**: Notifications require explicit criteria and lead time plus the default site, all named before activation. Resume recomputes upcoming windows and suppresses repeats by target/site/window identity. App-closed delivery needs an installed, tested scheduler; otherwise that capability is explicitly unavailable.
- **PLAN-FR-07**: Permission denial remains visible and offers Settings and Retry. No scheduler acknowledgment is represented as actual notification delivery.
- **PLAN-FR-08**: Rust computes astronomical planning windows through qualified shared skymath contracts; the frontend presents windows and controls without reimplementing scientific calculations.

### Owned interaction steps

- B3
- K

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision.

## Success Criteria

### Measurable Outcomes

- **PV-PLAN-SC-01**: Every acceptance scenario produces its stated outcome and refusal behavior.
- **PV-PLAN-SC-02**: Every owned interaction step has a requirement and independently observable acceptance evidence.
- **PV-PLAN-SC-03**: Original inputs remain unchanged except through separately reviewed and approved filesystem operations.

## Assumptions

- [Product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the confirmed interactions and illustrative worked example.
- This feature is independently specified; dependencies on other feature contracts are resolved in planning.
- Conservative product defaults and human specification-gate waivers are authorized for this run. The root decision register applies; tests, requirements analysis, independent review and delivery checks remain mandatory.

## Decisions before feature approval

- Root decisions D07 and D18 define opt-in reminders, explicit site/criteria/lead time, repeat suppression, permission recovery, honest scheduler capability and shared scientific calculations. Scheduler delivery claims require real platform evidence.
