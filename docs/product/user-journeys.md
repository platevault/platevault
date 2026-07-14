# PlateVault user journeys

This document is the **index** to the complete set of user journeys through
PlateVault (formerly Astro Library Manager) at product level — for product
review, manual testers, and onboarding. Each journey's full baseline narrative
now lives in its own directory under `docs/product/journeys/JNN-slug/journey.md`,
alongside per-task **behavior deltas** in `journeys/JNN-slug/deltas/`. This split
lets a change to product behavior be tracked next to the exact journey stages it
affects, so the team can rerun only the impacted stages after an implementation
lands. See `docs/product/journeys/INDEX.md` (per-journey rerun state) and
`docs/product/journeys/wave0-task-index.md` (per-task campaign view).

Ground truth for the baselines is the five `verify-plans-*` scenario branches
(PRs #416–#420) plus `PRODUCT.md`,
`docs/development/orchestrator-handover-2026-07-03.md`, and the merged code on
`redesign-ui-platevault`. The J-numbering and each journey's internal stage
numbering are canonical — cite journey stages by their number and label as they
appear in `journeys/JNN-slug/journey.md`; do not renumber.

## How to read a journey

Each `journey.md` lists:

- **Goal** — what the user is trying to accomplish.
- **Preconditions** — what state the app/library needs to be in.
- **Narrative flow** — numbered, UI-surface-level stages (not click-by-click).
- **Touch & validate** — the journey's coverage contract: every control the
  journey must exercise and every assertion a run must make. A journey run that
  skips a Touch & validate item is incomplete, even if the narrative "worked".
- **Safety & trust notes** — where the constitution's reviewable-plan and
  no-silent-overwrite guarantees show up in this journey.
- **Scenario files** — the executable, click-by-click version(s).
- **Known gaps** — what's stubbed, deferred, or not yet wired.

Two product rules run through almost every journey and are stated once here
instead of being repeated in each:

- **Reviewable filesystem mutation.** Every move, copy, archive, or delete is
  proposed as a plan first. Confirming an inbox item, generating a cleanup
  plan, or requesting an archive never moves a file by itself — only approving
  and applying a plan does, and every applied action gets an audit record.
- **Custody, not conversion.** Cataloguing a source "in place" (an
  already-organized folder) never moves or rewrites files; it only teaches the
  database about them.
- **Every action answers back.** Each mutating step names its success signal
  (toast, navigation, visible state change) and its failure signal (refusal
  reason, per-item error). Journey validation treats "the only evidence was a
  badge changing somewhere else" as a failed step.

## Journey index

| # | Journey | Summary | Baseline |
|---|---------|---------|----------|
| 1 | First-run setup → data sources | Empty DB → registered source folders (lights/calibration/projects/inbox) via the 5-step wizard, then ongoing rescan/remap/disable/delete. | [journey.md](journeys/J01-first-run-setup-data-sources/journey.md) |
| 2 | Ingest → review/reclassify → confirm (move) | Unorganized inbox files → single-type items → needs-review gate → bulk reclassify → confirm → plan apply into the library. | [journey.md](journeys/J02-ingest-review-reclassify-confirm-move/journey.md) |
| 3 | Ingest → confirm (catalogue-in-place) | Teach the DB about an already-organized root — zero moves, byte-identical, decided by the root's organization state. | [journey.md](journeys/J03-ingest-confirm-catalogue-in-place/journey.md) |
| 4 | Sessions review (derived) | Read-only, always-current acquisition-session view derived from confirmed inventory — no review/lifecycle controls. | [journey.md](journeys/J04-sessions-review-derived/journey.md) |
| 5 | Project lifecycle create → artifacts | Create project → attach confirmed sources → manifests/notes → tool launch → artifact observation. | [journey.md](journeys/J05-project-lifecycle/journey.md) |
| 6 | Cleanup: scan → review → apply | Read-only cleanup preview → generate plan (Archive/Trash) → protected-item ack → apply. | [journey.md](journeys/J06-cleanup-scan-review-apply/journey.md) |
| 7 | Archive → delete from archive | Plan-gated archive of a completed project, then trash / literal-DELETE permanent removal. | [journey.md](journeys/J07-archive-delete/journey.md) |
| 8 | Calibration: ingest → masters → matching | Ingest master cal frames as individual items → per-master fingerprint columns → advisory session matching + tolerances. | [journey.md](journeys/J08-calibration-ingest-masters-matching/journey.md) |
| 9 | Targets & planning (real vs. stub) | Browse/search catalog, SIMBAD resolve-on-demand, identity/aliases/notes — with disclosed planner-column stubs. | [journey.md](journeys/J09-targets-planning/journey.md) |
| 10 | Settings, appearance, and i18n | 11-pane settings, auto-save, themes, log panel, full i18n coverage. | [journey.md](journeys/J10-settings-appearance-i18n/journey.md) |
| 11 | Mistake recovery | Undo a wrong classification, reset-to-detected, discard a plan, un-assign a master — index-only, files untouched. | [journey.md](journeys/J11-mistake-recovery/journey.md) |
| 12 | Failure & refusal handling | Refusals/failures explained in-context (lifecycle, empty plan, partial apply, stale plan) with audit parity. | [journey.md](journeys/J12-failure-refusal-handling/journey.md) |
| 13 | Audit & activity investigation | Activity panel (now) + Audit Log (done) reconstruct what PlateVault did/refused. | [journey.md](journeys/J13-audit-activity-investigation/journey.md) |
| 14 | Target-first project start | From a Targets planner row, launch project create with the target association carried through. | [journey.md](journeys/J14-target-first-project-start/journey.md) |
| 15 | Equipment & observing-site setup | Register cameras/telescopes/trains/filters and observing site(s); aliases join FITS strings to friendly names. | [journey.md](journeys/J15-equipment-observing-site-setup/journey.md) |
| 16 | Keyboard-first navigation & windows | Command palette, keyboard row traversal, focus management, new-window pop-out. | [journey.md](journeys/J16-keyboard-first-navigation/journey.md) |
| 17 | Software update & install | Passive update check → signature-verified download → explicit restart. | [journey.md](journeys/J17-software-update-install/journey.md) |

## Cross-journey index

| # | Journey | Canonical scenario |
|---|---|---|
| 1 | First-run setup → data sources | `003-first-run-source-setup/wizard-fresh-db-journey` |
| 2 | Ingest → review/reclassify → confirm (move) | `journeys/grand-inbox-journey` |
| 3 | Ingest → confirm (catalogue-in-place) | `journeys/grand-inbox-journey` |
| 4 | Sessions review (derived) | `041-inbox-plan-surface/sessions-derived-inventory` |
| 5 | Project lifecycle create→artifacts | `journeys/full-project-lifecycle` |
| 6 | Cleanup: scan→review→apply | `017-cleanup-archive-review-plans/cleanup-scan-review-apply` |
| 7 | Archive → delete from archive | `017-cleanup-archive-review-plans/archive-lifecycle` |
| 8 | Calibration: ingest→masters→matching | `journeys/calibration-journey-ingest-to-match` |
| 9 | Targets & planning (real vs. stub) | `044-planner-stubs/planner-columns-visibly-stubs` |
| 10 | Settings/appearance/i18n | `018-settings-configuration-model/panes-and-persistence` |
| 11 | Mistake recovery | *(to be authored)* `journeys/mistake-recovery` |
| 12 | Failure & refusal handling | *(to be authored)* `journeys/failure-refusal-handling` |
| 13 | Audit & activity investigation | *(to be authored)* `journeys/audit-investigation` |
| 14 | Target-first project start | *(to be authored)* `journeys/target-first-project` |
| 15 | Equipment & observing-site setup | *(to be authored)* `journeys/equipment-site-setup` |
| 16 | Keyboard-first navigation & windows | *(to be authored)* `journeys/keyboard-first-navigation` |
| 17 | Software update & install | *(to be authored)* `journeys/software-update` |

For execution order, PR-gating, and shared test-data continuity across all of
the above, see `e2e-agentic-test/MASTER-PLAN.md`.
