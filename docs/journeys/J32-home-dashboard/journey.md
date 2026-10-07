---
id: J32
title: Work from the Home dashboard and follow each Project's Next action
version: 1
status: draft
last_reviewed: 2026-10-06
actors: [primary-user]
surfaces: [home, projects, sessions, frame-review, planning, view-review, activity]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 067-frame-review, 072-observing-plans, D-W14, D-W27, D-W33, D-W35, D-W36, D-W37, D-W39, D-W40, D-W48, D-W59, D-W60, D-W63, D-W64, D-W66, D-W71, specs/063-clean-rebuild-contract/spec.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/067-frame-review/spec.md, specs/072-observing-plans/spec.md]
---

## Goal

The user opens PlateVault and decides what to do next from Home, the Projects
dashboard. Home shows every open Project with its goals, stage and one Next
action, the sessions that need work, tonight's windows, unmet goals and running
work. Done means:

- Home shows its six sections in order, and its top line counts the sessions that need a Target and those in no Project.
- Each Project's Next action is the first PRJ-FR-18 rule that applies, and following it opens the named place. An Abandoned run reads Abandoned and never becomes Next.
- Reviewing the new frames moves that Project's Next to its blocked run.
- Done Projects appear only behind **Show done**.
- Reading Home changes no file, run or quality state.

## Preconditions

- P1: A development catalog seeded to the state in P2 to P4 at 2026-10-06 18:00 local time (G2). It reuses the NGC 7000 worked example and the `Veil Mosaic HOO` Project of J33. The rigs are `RedCat` (RedCat 51 + ASI2600MM) and `Esprit` (Esprit 100 + ASI533MC), as J15 creates them. Backyard is the default site. The Targets Plan area at Backyard shows a window tonight for NGC 7000, the Veil Mosaic centre, M 31, IC 1396 and M 33.
- P2: Four open Projects and one Done Project:

  | Project | Subject | Rig | Goals | Progress | Runs |
  | --- | --- | --- | --- | --- | --- |
  | `NGC 7000 HOO` | NGC 7000 | `RedCat` | Ha 10h, OIII 10h | Ha 6h10 in project · 9h15 captured; OIII 4h00 in project · 14h35 captured | `NGC7000-HOO-Siril` waits at Calibrate with calibration needing review |
  | `Veil Mosaic HOO` | mosaic `Veil Mosaic`, Panels 1 to 4 | `RedCat` | Ha 10h and OIII 10h per panel | 0h00 in project for every panel | none |
  | `M 31 OSC` | M 31 | `Esprit` | OSC broadband 10h | 3h00 in project · 4h30 captured | `M31-OSC-Siril` at Prepare with a failed preparation |
  | `IC 1396 Ha` | IC 1396 | `RedCat` | Ha 5h | 5h20 in project · 6h40 captured | `IC1396-Ha-Siril` Complete; `IC1396-Ha-test` marked Abandoned at Prepare after a failed preparation, holding only sessions that `IC1396-Ha-Siril` also holds |
  | `Pleiades 2025` (Done) | M 45 | `Esprit` | LRGB | any | all Complete |

- P3: Sessions needing work:
  - `2 Oct OIII`: 48 frames, all Unreviewed. It is a member of `NGC7000-HOO-Siril`.
  - `12 Sep`, `24 Sep`, `26 Sep` and `30 Sep`, the worked example's OIII sessions: 127 frames, reviewed, candidates of `NGC 7000 HOO`, and members of none of its runs.
  - `1 Oct Ha`: reviewed, a candidate of `IC 1396 Ha`, and a member of none of its runs.
  - `4 Oct M 33`: reviewed, with confirmed Target M 33 on rig `RedCat`, a candidate of no Project and a member of no run.
  - `3 Oct` (OBJECT `Cygnus field`, conflicting pointing) and `5 Oct` (no OBJECT, no pointing): no confirmed Target.

  `NGC7000-HOO-Siril` holds the worked example's Ha sessions `18 Sep` and `28 Sep` (111 frames) and `2 Oct OIII`. Its saved membership includes 74 of those Ha frames and all 48 `2 Oct OIII` frames. Every other candidate of an open Project is a member of one of that Project's runs, and every other frame in the catalog is reviewed.
- P4: My targets holds ★ M 33. M 45 is not ★.
- P5: A manifest (relative path, size, SHA-256) of every file under the registered locations, recorded outside PlateVault before S1.

## Steps

### S1 — Open Home {#S1}

- **Do:** Launch PlateVault.
- **Expect:** Home is the first surface shown. Its top line reads `2 sessions need a Target · 1 not in any Project`. Its six sections appear in this order:
  1. Actions: **Import**, **New Project** and **Plan tonight**.
  2. Projects.
  3. New sessions needing work.
  4. Tonight.
  5. Target status.
  6. Running work, which is empty.
- **Expect (negative):** The Targets list is not the first surface, and no Inbox exists.
- **Trace:** Home dashboard · root FR-020 · PRJ-FR-17, PRJ-FR-19 · PRJ-AC-18, PRJ-AC-20 · LIB-AC-09 · D-W39

### S2 — Read the Projects section {#S2}

- **Do:** Read each Project row.
- **Expect:** Exactly four Projects are listed, each with its goals, its runs' stages and one Next action.
  - `NGC 7000 HOO` reads `Ha 6h10 in project · 9h15 captured · goal 10h` and `OIII 4h00 in project · 14h35 captured · goal 10h`. Its stage shows `NGC7000-HOO-Siril` at Calibrate, and Next reads **Review 48 new frames**.
  - `Veil Mosaic HOO` shows Ha and OIII goals for each of Panels 1 to 4, each at 0h00 in project. Next reads **Plan tonight**.
  - `M 31 OSC` reads `3h00 in project · 4h30 captured · goal 10h`. Next names the run `M31-OSC-Siril` at Prepare.
  - `IC 1396 Ha` reads `5h20 in project · 6h40 captured · goal 5h` with "Goal met". Its stage shows `IC1396-Ha-Siril` Complete and `IC1396-Ha-test` Abandoned, and Next reads **Start a processing run**.
- **Expect (negative):** `Pleiades 2025` is not listed. `NGC 7000 HOO` does not show its blocked run as Next, because rule 1 comes first. `IC 1396 Ha`'s Next never names `IC1396-Ha-test`, although its preparation failed, because an Abandoned run is never blocked. No row says "not in a run", no goal shows "in project" above "captured", and no goal reads met from its "captured" value.
- **Trace:** Home dashboard · PRJ-FR-04, PRJ-FR-17, PRJ-FR-18, PRJ-FR-20, PRJ-FR-21 · PRJ-AC-03, PRJ-AC-19, PRJ-AC-22 · root FR-020, FR-022, FR-023 · D-W27, D-W35, D-W36, D-W48, D-W64, D-W66, D-W71

### S3 — Follow Review 48 new frames {#S3}

- **Do:** On `NGC 7000 HOO`, click **Review 48 new frames**.
- **Expect:** Frame review opens with the filter set to Unreviewed and lists exactly the 48 frames of `2 Oct OIII`.
- **Trace:** Home dashboard · PRJ-FR-18 · PRJ-AC-19 · PIX-FR-18 · D-W35

### S4 — Review the frames and watch Next move {#S4}

- **Do:** Switch frame review to the grid view with G. Select all 48 frames with ⌘A and press P. Return to Home and click `NGC 7000 HOO`'s Next action.
- **Expect:** All 48 frames read Usable. On Home, the Unreviewed group of New sessions needing work is empty. `NGC 7000 HOO`'s Next now names `NGC7000-HOO-Siril` at Calibrate. Clicking it opens that run at its Calibrate step, with its readiness line and **Review matches**.
- **Expect (negative):** Marking the frames changes no run's saved membership and no goal's "in project" value; OIII still reads 4h00 in project.
- **Trace:** Home dashboard · PRJ-FR-18 · PRJ-AC-23 · PIX-FR-18 · D-W14, D-W40, D-W48

### S5 — Follow the other Next actions {#S5}

- **Do:** Return to Home after each action. Click `M 31 OSC`'s Next, then `Veil Mosaic HOO`'s **Plan tonight**, then `IC 1396 Ha`'s **Start a processing run**. Cancel the run dialog.
- **Expect:** `M 31 OSC`'s Next opens `M31-OSC-Siril` at Prepare with its failed preparation named. **Plan tonight** opens planning for `Veil Mosaic` at Backyard, with tonight's window computed for the mosaic's centre. **Start a processing run** asks for one subject (IC 1396) and one rig (`RedCat`) of that Project.
- **Expect (negative):** Cancelling creates no run. `IC 1396 Ha` still lists exactly two runs, `IC1396-Ha-Siril` Complete and `IC1396-Ha-test` Abandoned.
- **Trace:** Home dashboard · PRJ-FR-10, PRJ-FR-18 · PRJ-AC-19 · PLAN-FR-11 · D-W35, D-W48, D-W63, D-W64

### S6 — Act on new sessions needing work {#S6}

- **Do:** Read New sessions needing work. On the `4 Oct M 33` row, click **Create Project**, name it `M 33`, keep the prefilled subject and rig, and save. Return to Home.
- **Expect:** Before the action, the section has four groups:
  - Needs a Target lists `3 Oct` and `5 Oct`.
  - Not in a Project lists `4 Oct M 33`, offering **Create Project** and **Add to Project**.
  - Unreviewed is empty after S4.
  - Ready to add to a run lists `12 Sep`, `24 Sep`, `26 Sep` and `30 Sep` under `NGC 7000 HOO`, and `1 Oct Ha` under `IC 1396 Ha`.

  Each row has a one-click action. The new Project opens prefilled with subject M 33 and rig `RedCat`. Back on Home, the top line reads `2 sessions need a Target · 0 not in any Project`. Projects lists `M 33` with Next **Start a processing run**, and `4 Oct M 33` moves to Ready to add to a run.
- **Expect (negative):** Creating the Project assigns `4 Oct M 33` to no run.
- **Trace:** Home dashboard · PRJ-FR-17, PRJ-FR-18, PRJ-FR-19 · PRJ-AC-18, PRJ-AC-20 · LIB-FR-17 · D-W33, D-W35, D-W37, D-W39, D-W59

### S7 — Read Tonight {#S7}

- **Do:** Read the Tonight section. Open Targets with the same site and criteria and compare.
- **Expect:** Tonight lists the best window, with start, end and peak altitude, for NGC 7000, Veil Mosaic, M 31, IC 1396 and M 33. The Veil Mosaic window uses the mosaic's centre. The section shows the Moon's illumination, phase, rise and set, and tonight's darkness window. Every value names Backyard and its time zone. Each listed Target's window matches its Plan area for the same site, night and criteria.
- **Expect (negative):** M 45 is not listed, because its Project is Done and it is not ★. No window is listed for a Target without one tonight.
- **Trace:** Home dashboard · PLAN-FR-11 · PLAN-AC-11 · PV-PLAN-SC-04 · D-W39, D-W60, D-W63

### S8 — Read Target status {#S8}

- **Do:** Read the Target status section.
- **Expect:** It lists each unmet goal with what its channel still needs in project:
  - NGC 7000: Ha 3h50 and OIII 6h00.
  - Veil Mosaic: Ha 10h00 and OIII 10h00 for each of Panels 1 to 4.
  - M 31: 7h00.
- **Expect (negative):** IC 1396 is not listed, because its goal is met in project. No need is computed from "captured".
- **Trace:** Home dashboard · PRJ-FR-04, PRJ-FR-17 · D-W36, D-W39

### S9 — Show and hide Done Projects {#S9}

- **Do:** Turn on **Show done**, then turn it off.
- **Expect:** With Show done on, `Pleiades 2025` is listed and marked Done, next to the five open Projects. With it off, only the five open Projects are listed.
- **Expect (negative):** Toggling Show done changes no Project's state.
- **Trace:** Home dashboard · PRJ-FR-17 · PRJ-AC-22 · root FR-020 · D-W48

### S10 — Watch running work {#S10}

- **Do:** Start a rescan of `Astro-T7 captures`, then read Home until it finishes. Open Activity.
- **Expect:** While the rescan runs, Running work lists it with its progress. When it finishes, it leaves Running work, and Activity records its outcome.
- **Expect (negative):** Running work never reports the rescan finished before Activity records a durable outcome.
- **Trace:** Home dashboard · PRJ-FR-17 · LIB-FR-03, LIB-FR-10 · root FR-012 · G3

### S11 — Confirm Home changed nothing on disk {#S11}

- **Do:** Outside PlateVault, recompute the P5 manifest.
- **Expect:** Every path, size and SHA-256 matches P5.
- **Expect (negative):** Reading Home and following its actions wrote, moved or trashed no file. The only catalog changes are the S4 quality marks and the S6 Project.
- **Trace:** root SC-002 · PRJ-FR-05

## Success criteria

- SC1: At S1 the six sections appear in the PRJ-FR-17 order, and the top line reads exactly `2 sessions need a Target · 1 not in any Project`.
- SC2: At S2, 4 Projects are listed and each shows the Next of the first applicable rule: rules 1, 3, 2 and 4 for `NGC 7000 HOO`, `Veil Mosaic HOO`, `M 31 OSC` and `IC 1396 Ha`. 0 Next actions name the Abandoned `IC1396-Ha-test`.
- SC3: After S4, `NGC 7000 HOO`'s Next names `NGC7000-HOO-Siril` at Calibrate, and OIII still reads 4h00 in project.
- SC4: After S6, the top line reads `2 sessions need a Target · 0 not in any Project` and 0 runs have been created.
- SC5: Tonight lists exactly 5 Targets, and every value names Backyard (S7).
- SC6: `Pleiades 2025` is listed only while Show done is on (S2, S9).
- SC7: The S11 manifest equals P5 for 100% of files.

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Behavior follows specs 063, 065 and 072 at d45a22ad and the 2026-10-06 workflow decisions. No implementation has been validated against them.
- G2: Unresolved implementation qualification: P1 and P2 need a seeded catalog in a known state at a fixed local time. No fixture builder exists, and the windows depend on Backyard's coordinates. Blocks readiness.
- G3: Unresolved implementation qualification: the flow names no control for rescanning a registered location (S10, as in J19 G4). Blocks readiness.
- G4: Unresolved product question: the specs do not say where the Actions section's **Plan tonight** opens, or whether a session can appear in more than one New sessions group. This journey asserts neither. Blocks readiness until a human decides.

## Delta log

- No entries (initial draft, version 1).
