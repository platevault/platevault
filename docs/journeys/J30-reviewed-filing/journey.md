---
id: J30
title: File selected sessions into a managed library location after review (retired; see J31 Import)
version: 2
status: deprecated
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [filing, sessions, storage]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 071-storage-custody, D-W11, specs/071-storage-custody/spec.md]
---

## Goal

Retired. Reviewed filing of indexed sessions into a managed library location
("File into library", product-flow step L) is not part of PlateVault. New
captures reach library storage through Import (J31): the user picks a source,
reviews each file's templated destination in Captures or Calibration storage and
chooses Copy or Move. Organized folders are registered in place with **Add
existing library folder** (J19, J28/S13). This journey has no current expected
behavior and is not validated.

## Preconditions

- None. The journey is retired.

## Steps

All steps (S1 to S6, S4a, S4b) are retired with the journey; their ids are not
reused.

## Success criteria

- SC1: No step is validated; a validator that selects J30 skips it and validates J31 instead.

## Known gaps

- G1: Retired, not a gap. The custody rules J30 exercised carry into Import: collisions never overwrite (STO-IMP-FR-05, STO-IMP-AC-06), drift blocks an item (STO-AC-14, STO-AC-15), and a Move source is kept until its destination verifies (STO-IMP-FR-04). J31 owns those checks.

## Delta log

- **Δ2** 2026-10-06 · all steps retired · behavior-change
  "File into library" is dropped and Import replaces reviewed filing. The journey is deprecated with J31 as its successor.
  Evidence: D-W11 (workflow decisions, settled 2026-10-06); 071 STO-IMP-FR-01, STO-IMP-AC-01 and the withdrawn filing requirements; 063 FR-011 at e4476231 · by: agent (intent-gated, user instruction)
