# Round 9: answers to the user's behaviour questions (bead astro-plan-fssxd)

Base: `ui-harness-v5` @ 44adaf33. Paths are relative to `apps/prototype/`. Copy keys are in `messages/en-GB.json`.
All evidence comes from reading the code and seed. No browser session was run: no browser tool was available to this agent, so the on-screen numbers in Q7/Q8 are derived from the seed and marked [INFERENCE].

---

## 1. The ★ in My targets: what it does, and why rows appear with and without it

**Answer.** ★ toggles `Target.favourite`. **My targets** is the union of ★ favourites and every subject of an *open* Project. A target that is a subject of an open Project is therefore listed whether or not it is starred. Unstarring it does nothing visible: the row stays, and only its Project badge remains. On a catalogue/SIMBAD row with no library Target, ★ first adds the entry to the library, starred.

**Evidence**
- Membership rule: `src/domain/derive.ts:1508-1522` (`myTargets`). Favourites are added at 1510, open-Project subjects at 1511-1519.
- Row flag `mine` and the My targets filter: `src/features/v5/e-targets-plan-settings/targets-model.ts:61-62,108-118`.
- ★ column, always the first non-planned column: `targets.tsx:470-490`. `toggleStar`: `targets.tsx:357-361` (adds to the library when `row.target` is null).
- Action: `src/store/actions/library.ts:240-252` (`setFavourite`). Its comment reads "open-Project subjects stay listed either way."
- Decision: D-W60 (`design/HARNESS-V5-IA.md:33,56`).
- Copy: `targets_star_named`, `targets_unstar_named`, `targets_add_named`, `store_label_add_to_my_targets`, `target_project_badge`.

**Classification.** Design choice (D-W60). The UX is confusing: in the My targets view, ★ is a second membership mechanism that shows no visible effect on Project subjects.

**Suggested fix.** Make ★ mean "in My targets" and nothing else. Two options:
- (a) Drop the ★ column from the My targets view. Use a row menu with *Remove from My targets*, disabled with a terse reason ("In Project M 31 LRGB") for open-Project subjects. Keep ★ / *Add to My targets* only in Browse and search.
- (b) Adding a target to a Project stars it, so ★ is always truthful.

Either way, the Project badge stays as the second signal.

---

## 2. Good tonight: are lunar distance and lunar phase both used?

**Answer.** Yes, as two independent hard limits per filter, applied only while the Moon is above the horizon. A sample counts as clear only when *both* hold: separation ≥ the band's `minSeparationDeg` **and** illumination ≤ `maxIlluminationPct`. Illumination stands in for phase; the phase name (crescent, gibbous…) is display only.

A band's grade:
- **good**: its longest clear stretch is at least the minimum duration (60 min) and at least 75 % of the dark time.
- **marginal**: the stretch is long enough but shorter than 75 % of the dark time.
- **poor**: no stretch is long enough.

The "Good tonight for {band}" preset filters to good or marginal and sorts by that band's clear minutes.

Defaults:

| Bands | Min separation | Max illumination |
|---|---|---|
| L, R, G, B | 90° | 30 % |
| Ha | 30° | 100 % |
| SII | 40° | 100 % |
| OIII | 60° | 80 % |

Because the limits are independent, a 31 %-lit Moon 150° away fails L, and so does a thin crescent 80° away.

Separate inconsistency: the **Lunar** column shows only the separation at the target's highest dark sample. **Img time** ignores the Moon entirely, because the default criteria set both Moon limits to `null`. So a row can show 7 h Img time while every broadband chip is poor.

**Evidence**
- Per-sample gate: `src/domain/planning.ts:376` (`clearStretches`, doc at 358-363).
- Per-band verdict: `planning.ts:407-433` (`filterSuitability`).
- Grades and the 0.75 share: `src/features/v5/e-targets-plan-settings/good-tonight.ts:5-11,25,85-86`.
- Defaults: `src/domain/labels.ts:94-102`.
- The preset filter is `bandOk` (`good-tonight.ts:101-103`) via `targets-model.ts:439-444` and `targets.tsx:367`.
- Img time without the Moon: `planning.ts:71-78` (`maxMoonIlluminationPct: null`, `minMoonSeparationDeg: null`) and `planning.ts:215-218`.
- Lunar column: `targets.tsx:424`, `targets-model.ts:262`. Phase name only: `planning.ts:248-254`.
- Copy: `targets_good_for`, `targets_good_for_menu`, `targets_good_for_heading`, `tonight_limit` ("Moon ≥ {separation}° · ≤ {illumination}%"), `targets_filters_help`, `tonight_lunar` ("Lunar").

**Classification.** Design choice for the two-limit model. It is crude, and the user finds it confusing. The Img time vs filter-chip disagreement is a bug-level inconsistency.

**Suggested fix.**
- Replace the two limits with one Moon-avoidance model per filter: the required separation scales with illumination, as in the Lorentzian Moon avoidance used by ACP and N.I.N.A. [INFERENCE: external convention, not checked against a source in this pass]. That leaves one parameter set per band and a single "Moon" reading.
- Make Img time and the chips use the same rule, or label Img time "Dark time".
- Rename "Good tonight for" (for example *Best filter tonight*) and allow several bands, as the user asked.

---

## 3. What "candidate" means on Projects

**Answer.** On Projects, a *candidate* is a library light session whose confirmed Target is one of the Project's subjects and whose rig is one of the Project's rigs. Trashed and superseded sessions are excluded. Candidates feed Start run (all preselected), the goal "captured" figure, and Wrap up's rejected-frames offer. The Projects list's Next button tooltip uses the word, for example "Candidates have Unreviewed frames."

The same word means two other things elsewhere:
- an unaccepted Result (`acceptance: "candidate"`);
- a master found in a run's Results but not adopted (`state: "candidate"`).

**Evidence**
- Rule: `src/domain/derive.ts:332-346` (`candidateSubject`) and 354-364 (`projectCandidates`).
- Projects list tooltip: `src/features/v5/b-projects/projects.tsx:125` together with `derive.ts:1340-1342` (`domain_reason_candidates_unreviewed`).
- Project page section: `project-sections.tsx:400-555`.
- Other meanings: `derive.ts:810-813` with `src/features/v5/c-runs/actions.ts:497-500` (Results) and `src/domain/types.ts:815-816` (masters). The status badge serves both: `src/components/app/status.tsx:170,188`.
- Copy: `status_candidate`, `project_candidates`, `project_candidate_frames`, `domain_reason_candidates_unreviewed`, `rungroup_candidates_count`, `session_becomes_candidate`, `session_why_candidate`.

**Classification.** The concept is sound, but one word carries three meanings. That overload is slop to remove; the Projects list tooltip also falls under the user's "remove the mouseover" item.

**Suggested fix.**
- Use a plain name for each meaning: *Matching sessions* for Project candidates, *Not accepted* / *New* for Results, *Found* for masters.
- Drop the Next tooltip and show the reason inline only where it is needed.

---

## 4. Prepare › Corrected metadata

**Answer.**

*What it does.* When a member session has a catalogue correction that differs from the frame header (for example `OBJECT "NGC 104" → "M 42"`, made in PlateVault), Prepare lists one decision per session and field. The decision is how the corrected value reaches the processing application. There are four choices:
- **Patched copy**: the frame is copied into the run folder with the corrected header.
- **Accept the source value**: the application sees the header as is.
- **Exclude these inputs**: the session's frames are left out.
- **Application configuration**: the application would read the value through its own settings.

Prepare is blocked until every row is decided.

*"Patched copy".* A temporary copy written into the run folder with the corrected keyword. It requires the Copies run view, because in Symlinks mode the run folder only holds links to the originals.

*Why "Application configuration" shows when no app supports it.* The option list is hard-coded with all four choices. "Application configuration" is disabled with a "{name}: not supported" pill when the profile lacks the capability, and every seeded profile (PixInsight, Siril, Seti Astro, generic) has `correctedMetadata: "none"`.

*Why the original can't be patched.* Corrections are catalogue-only by design: "Source headers are never changed." A frame's identity is its SHA-256 (duplicate detection, verification, drift); editing the original would change it. Run views never write to originals (P-PREP3).

[INFERENCE] For WBPP and Siril, a corrected `OBJECT` does not change grouping or stacking. Only filter or exposure corrections matter to them, so most target corrections need no decision at all.

**Evidence**
- Decision type: `src/domain/types.ts:954-965`. Catalogue-only corrections: `types.ts:347`. Identity: `types.ts:171`.
- Diffs and plan: `src/features/v5/c-runs/model.ts:221-240` (`metadataDiffs`) and `model.ts:392-402`.
- Checks: `model.ts:505-527`. Patched copy needs Copies at 506; configuration unsupported at 507.
- UI: `prepare-step.tsx:316-356`. Hard-coded options at 341, disabled at 342-349.
- The header patch is written only into copies: `operations.ts:63-83`.
- Capabilities: `src/domain/seed.ts:393,409,425,441`.
- Decision P-PREP3: `design/HARNESS-V5-FEEDBACK-R1.md:284-286`.
- Copy: `run_check_metadata`, `run_metadata_choice_configuration`, `run_metadata_choice_patched_copy`, `run_metadata_choice_accept_source`, `run_metadata_choice_excluded`, `run_metadata_not_supported`, `run_metadata_needs_isolated`, `run_metadata_hint_*`, `run_check_patched_needs_isolated`, `run_mode_semantics_copy`.

**Classification.**
- Not patching originals: design choice (non-destructive library).
- "Application configuration" offered when no profile supports it: slop to remove.
- Radio cards per diff: slop. The user wants a table.

**Suggested fix.**
- Show the corrections as one table: Session · Field · Header → Catalogue · Action (a dropdown).
- Offer only choices the chosen profile supports. Hide Configuration unless `capability.correctedMetadata === "configuration"`.
- Label Patched copy simply *Write corrected copy*. When the run view is Symlinks, switch that session to Copies or explain it in a terse disabled reason.
- Only ask for fields the application reads. Skip `target` for WBPP and Siril [INFERENCE].
- Also consider the user's point: correct at import/review time, so Prepare rarely asks.

---

## 5. What Accept does in Results

**Answer.** Accept marks a discovered Result as a real product, bound to the bytes it holds now (SHA-256). It is refused when:
- the file is an intermediate;
- the file is unreadable;
- the file is still being written;
- the bytes changed since inspection;
- the Result has no kind.

Accepted Results have three effects:
- they can be used as inputs to another run (`Use as input…`, Select's product inputs);
- they are kept out of Wrap up's intermediates Trash;
- they show *Drifted* if the bytes change later.

Accept never blocks Complete: the "Results accepted" gate is advisory. However, the Results step stays **Needs review**, and Next keeps saying *Accept results*, while any discovered product is unaccepted. There is no Reject, so the step never settles unless everything is accepted.

**Evidence**
- `src/features/v5/c-runs/actions.ts:616-633` (`acceptResult`).
- Consumers: `actions.ts:650` (use as input), `select-step.tsx:343-344`, `src/features/v5/b-projects/model.ts:241`.
- Step state: `src/domain/derive.ts:1016-1035` (state at 1022, advisory gate at 1027-1028, Next at 1034).
- No reject or unaccept action exists (no match for `rejectResult` / `acceptance: "rejected"` in `src`).
- Copy: `run_results_accept_named`, `run_results_accept_blocked`, `store_reason_still_being_written`, `store_reason_changed_since_inspection`, `store_reason_no_kind`, `domain_status_accepted_of`, `domain_next_accept_results`.

**Classification.** Accept is a design choice (RES-FR-04). Having no Reject, so the step stays in review forever, is a bug.

**Suggested fix.**
- Add *Reject* (a standard row-menu action plus multiselect). The step is done when every product is Accepted or Rejected.
- Rename Accept to *Keep*, and say what it does in the menu label only.
- Show refusals per the previous product's error pattern, not "Accept blocked · 1 blocker".

---

## 6. Goal templates: time AND frames; what "usable" means

**Answer.**
- **Both set means both are required.** `met` is true only if integration ≥ the hours goal **and** frames ≥ the frames goal.
- **Display.** The progress line and "to go" use only time when time is set. Home's goal table and the Target page's "copies goals" line do the same. So a goal can show "6h00 in project · goal 6h00 and 20 frames" with no frame progress, or read complete in hours but not be Met. Template validation only requires "Hours or frames".
- **"Usable"** is the library-wide quality mark set in Review with P (bound to the file's bytes). The quality bar choices are:
  - *Usable*: count only frames marked Usable;
  - *FWHM limit*: count frames whose measured FWHM is at or under the limit;
  - *Usable + FWHM*: both.

  **Unreviewed frames count as zero** under a Usable bar. Frames with no applicable FWHM measurement are "unmeasured" and also do not count. The built-in templates default to *Usable*, so a new Project's goals start at 0 until frames are reviewed.

**Evidence**
- `src/domain/derive.ts:576-587` (`met` at 583; time-only amount at 587; `remainingS` at 597).
- `admitsQuality`: `derive.ts:519-528`.
- Usable is set in `src/store/actions/library.ts:25-46` (`markFrames`). Quality type: `src/domain/types.ts:260,314-315,515-519`.
- Templates default to `USABLE`: `src/domain/templates.ts:12-16,26-45`.
- Editors: `src/features/v5/b-projects/goals.tsx:23-30,40-104`.
- Other displays: `src/features/v5/a-home/home.tsx:181-186,706-707`, `e-targets-plan-settings/target.tsx:579`, `settings-goal-templates.tsx:87-89`.
- Copy: `domain_goal_target_both` ("{hours} and {frames}"), `domain_goal_amounts`, `goal_bar_any`, `status_usable`, `goal_bar_fwhm`, `goal_bar_usable_fwhm`, `template_hours_or_frames`, `goal_to_go`.

**Classification.** AND semantics: design choice. Time-only progress when both are set: bug. A Usable default that silently ignores Unreviewed frames: a design choice that surprises users, and the label "Usable" never says so.

**Suggested fix.**
- Pick one: either a goal is time *or* frames (a unit dropdown, as the user suggests), or show both progress figures.
- Rename the bar options to *Any frame* / *Reviewed Usable only* / *FWHM ≤ x″* / *Usable and FWHM ≤ x″*.
- Show the count of frames not counted ("37 unreviewed not counted") as data, not a tooltip.

---

## 7. M 31 says done while Calibrate shows 4 unresolved

**Answer.** The run "M 31 LRGB FRA400" is seeded as **Complete**, and the Project's Wrap up Clean up is **done**. The run never recorded any calibration choices (`calibration: []`). The Calibrate step does not show what was handed off; it re-matches against today's library on every render.

The four M 31 sessions (L, R, G, B) shot 120 s lights. The only ASI2600MM master dark in the library is 300 s. The exact-match 120 s dark found in M 31's Results was dismissed and was never adopted, so it is never matched. That leaves 4 dark rows with no compatible dark, which the step shows as "4 unresolved" (advisory, because the run is Complete). Bias and the FRA400 L/R/G/B flats match [INFERENCE from seed values; not rendered].

Complete is refused only by running operations, so a run can be completed with unresolved calibration.

**Evidence**
- Run seed: `src/domain/seed.ts:956-967`. Default `calibration: []`: `seed.ts:634`.
- Project: `seed.ts:834-852` (state open, wrapUp cleanup done).
- 120 s lights: `seed.ts:303-306`. Only dark for this camera: `seed.ts:316`. Same camera on both rigs: `seed.ts:142-143`.
- Dismissed 120 s candidate dark: `seed.ts:1025-1034`. It is never reusable: `src/domain/calibration.ts:162-172`.
- Live re-evaluation: `src/domain/derive.ts:918-949` (`calibrationPlan(...)` at 918; "N unresolved" for Complete at 935-942). Plan: `calibration.ts:395-460`.
- Complete gate: `derive.ts:1158-1161`.
- Copy: `domain_status_unresolved`, `domain_status_need_review`, `domain_status_cleaned_up`.

**Classification.** Bug: inconsistent seed fixture, plus a Complete run that keeps re-judging inputs it no longer uses.

**Suggested fix.**
- Freeze calibration at Complete: show what was handed off (or "No calibration" / "Not recorded") and don't re-match.
- Fix the seed: record the darks the M 31 run used (or an explicit *No dark* decision), or adopt the 120 s dark.
- Decide whether Complete should warn about unresolved calibration.

---

## 8. An L goal shows "Exposure mismatch" about 60 s lights without a dark

**Answer.** The warning is not about the goal. `projectWarnings` checks calibration coverage for every candidate session, per rig, subject, channel and exposure. When there is no compatible dark but darks of other exposures exist for the same camera, it emits *exposure-mismatch*. The only place these warnings render is the goal rows, filtered by subject and channel, so every L-channel coverage gap lands on the L goal.

The 60 s lights are the M 42 NAS session (90 × 60 s L on the FRA400). The only ASI2600MM dark is 300 s. The pill reads "Exposure mismatch", and its title holds "Askar FRA400 / ASI2600MM: L 60s lights have no matching dark (darks at 5m)" [INFERENCE: exact formatting of `formatExposure` not rendered].

Coverage gaps for channels without a goal, and for mosaic panels, are never shown at all.

**Evidence**
- `src/domain/derive.ts:619-674` (`projectWarnings`; exposure-mismatch at 643-652). Doc: "They are not goals and never block a run" (620-625).
- Only consumer: `src/features/v5/b-projects/project-sections.tsx:595,666,683-685`.
- M 42 session: `src/domain/seed.ts:328-331`. 300 s dark: `seed.ts:316`.
- Copy: `goal_warning_exposure` ("Exposure mismatch"), `goal_warning_calibration`, `warning_exposure_mismatch`, `warning_missing_dark`, `warning_missing_flat`.

**Classification.** The data is correct (there really is no 60 s dark). Showing it on goal rows as an opaque pill with a tooltip is slop.

**Suggested fix.**
- Move calibration coverage out of Goals into the Project's calibration readiness (or alerts), as a table: Rig · Channel · Exposure · Dark / Flat / Bias status.
- Use plain words ("No 60 s dark") and include channels without goals.
- Optionally link to Calibration to import or stack a dark.

---

## 9. Why a run can start before frames are reviewed

**Answer.** By design, quality is advisory: "measurements inform, never decide."
- Start run puts every matching session in the draft.
- A session's Unreviewed and Usable frames are included; only library-Unusable frames start excluded.
- The Review step's gate is `advisory`, and Prepare's gates are only saved membership, calibration and profile.

So the flow allows Start run → Prepare with nothing reviewed.

**Evidence**
- `src/store/actions/runs.ts:94-121` (`startRun`: every candidate selected).
- Initial membership: `src/domain/membership.ts:79-96` (`initialMembers`).
- Review gate: `src/domain/derive.ts:897-912` (advisory at 908). Prepare gates: `derive.ts:958-966`.
- Every candidate preselected: `start-run.tsx:4-5` (D-W49).
- Copy: `domain_gate_frames_reviewed`, `domain_gate_frames_decided`, `session_review_frames`.

**Classification.** Design choice. It conflicts with the user's expected flow and with "Review frames" and "Start run" sitting in different places.

**Suggested fix.** User decision. Options:
- (a) Order the Project actions as Review frames → Start run in one standard menu.
- (b) Keep Review advisory but show "N unreviewed frames included" as a Prepare check.
- (c) A setting that makes Review a hard gate.

---

## 10. Why `/Volumes/Astro-T7/Processing/test/M 42 Askar FRA400 Results/` is the Results folder, versus WBPP's own layout

**Answer.** PlateVault proposes its own layout:
- prepared run folder: `<output parent>/<Project>/<Run>/` (later preparations `<Run> (rev N)/`);
- Results folder: one sibling `<Run> Results/`, shared by every revision (D-W51/D-W67).

In this path:
- the output parent is the last-used one (`/Volumes/Astro-T7/Processing`);
- `test` is the Project name;
- `M 42 Askar FRA400` is the auto-generated run name (subject + rig short name).

WBPP's own output is whatever *Output directory* the user sets. Under it, WBPP writes `master/`, `calibrated/`, `registered/`, `logs/`, `measured/`, `fastIntegration/`, `cosmetized/` and similar. PlateVault's recogniser expects exactly those subfolders inside `<Run> Results/`.

Nothing passes that folder to WBPP. Profiles have empty `launchArgs`, and there is no `outputDirectory=`. So the user would have to point WBPP at `… Results` by hand, or Results discovery finds nothing. [INFERENCE: no code path writes the Results path into the launch or handoff file.]

**Evidence**
- `src/features/v5/c-runs/model.ts:154-190` (`runLayout`; `projectDir` at 162; resultsPath at 187).
- Parent: `model.ts:82-89` (`outputParentFor`). Seed parent: `src/domain/seed.ts:1201`. Run name: `src/store/actions/runs.ts:117-121`.
- Recogniser: `model.ts:658-681` (`INTERMEDIATE_DIRS`, `MASTER_CAL`, `masterLight`).
- Launch args empty: `seed.ts:387,403,419,435`. The handoff file holds only a list: `operations.ts:18,137-140`.
- WBPP layout research: `design/INPUT-MODES-RESEARCH.md:35,156,162-163`.
- Copy: `run_layout_results_folder`, `run_layout_results_every_revision`.

**Classification.** Design choice (D-W51) that is only half wired. The Results path never reaches the application: a gap/bug.

**Suggested fix.** Pass the folder to the application: WBPP automation `outputDirectory=` per `INPUT-MODES-RESEARCH.md:35,162`, and a Siril script `cd`/output. Or adopt WBPP's convention: one run folder with inputs under `lights/` and `calibration/`, and the app's output directory set to `<Run>/output/`. Watch that folder in the background, as the user asked, instead of manual "Look for results". The project/run naming should use the naming template.

---

## 11. Why masters are listed among a run's products

**Answer.** There are two different things.

1. WBPP names its integrated stacks `master/masterLight_…FILTER-L….xisf`. PlateVault's recogniser classifies any `masterLight` file as a *Linear integration* product. These are the run's real outputs (the per-channel stacks), just named "master" by WBPP.
2. Calibration masters (`masterDark` / `masterFlat` / `masterBias`) that WBPP writes into the same folder are recognised separately as *masters*. They are offered on the run as "Masters found", and that offer box (`MasterOffers`) is rendered on the **Results** step as well as on Calibrate. The prototype's "Simulate application output" also writes a `masterDark_…300.00s` into Results, so the box appears after every simulated run.

**Evidence**
- `src/features/v5/c-runs/model.ts:658-681` (`masterLight` → linear-integration at 678; `MASTER_CAL` → master at 668-671).
- `actions.ts:510-538` (found masters become candidate masters plus offers).
- `results-step.tsx:33,110` (`MasterOffers` on Results). `calibrate-step.tsx:117,412-440`.
- Simulation: `actions.ts:744-770` (dark at 768). Seed: `seed.ts:989,998,1012`.
- Copy: `run_cal_masters_found`, `run_cal_masters_count`, `domain_products_*`.

**Classification.** (1) is correct but poorly labelled. (2) on the Results step is slop to remove: the user does not care about calibration masters while processing.

**Suggested fix.**
- Results lists products only, labelled by channel ("L stack"), with Kind as a standard dropdown.
- Drop `MasterOffers` from the Results step. Send found calibration masters to the Calibration library's import flow (or a setting: import automatically / ignore).

---

## 12. Why masters are "Dismissed" rather than removed

**Answer.** By decision P-CAL2, "dismiss is reversible." Two actions use the word:
- (a) *Dismiss* on a master **offer** found in a run's Results. The master is never adopted; the offer is marked dismissed and listed under Calibration › Dismissed with *Restore offer*.
- (b) *Dismiss master* on a **library** master. It sets `dismissedAt`, so the master leaves the list and is never matched. The file is untouched, and *Restore* brings it back. This is refused while a run uses or offers it.

There is no Remove or Trash action for masters at all, and nothing ever deletes the file.

**Evidence**
- `design/HARNESS-V5-FEEDBACK-R1.md:54` (P-CAL2).
- `src/features/v5/c-runs/actions.ts:218-225` (`dismissMasterOffer`).
- `src/store/actions/calibration.ts:403-437` (`restoreMasterOffer`, `dismissMaster`, `restoreMaster`). Exported actions: no remove or trash.
- `src/domain/types.ts:825-826`, `src/domain/calibration.ts:166`.
- UI: `e-targets-plan-settings/calibration.tsx:451,650-658,767-769,784-788`.
- Copy: `verb_dismiss`, `calibration_dismiss_master`, `calibration_dismissed`, `calibration_cant_dismiss`, `calibration_restore_master`, `run_cal_dismiss_blocked`.

**Classification.** Reversibility is a design choice (P-CAL2). The word "Dismiss" and the missing Remove/Trash are slop and inconsistent with Sessions' Trash.

**Suggested fix.** Use the product's standard verbs:
- *Remove from library* (record hidden, file kept, restorable from a *Removed* filter);
- *Move to Trash* (file to the OS Trash through the Trash engine, like sessions);
- *Ignore* for a found-in-Results offer.

Add *Replace master* (the user's request) as a standard menu action.

---

## 13. Select › "Selected only"

**Answer.** It is a checkbox that hides candidate rows not in the run's selection, leaving only member sessions. Start run preselects every candidate, so in the normal case it changes nothing. It only matters after the user deselects some sessions or when Refresh brings in new unselected candidates. A separate "N selected hidden · Show" line already covers selections hidden by the other filters.

**Evidence**
- `src/features/v5/c-runs/select-step.tsx:71,112-114,259-262`. Hidden-selected line: `select-step.tsx:265-271`.
- Preselection: `src/store/actions/runs.ts:94-97,117`.
- Copy: `run_select_selected_only`, `run_select_hidden_selected`.

**Classification.** Slop to remove.

**Suggested fix.** Remove the checkbox. If needed, add *Not selected* as a value of a standard Show/Filter dropdown, next to the channel/night/exposure/rig/quality filters (which should themselves become one filter menu).

---

## Dependency classification for the dispatcher
- Q7 (freeze calibration at Complete, fix the seed) and Q10 (pass the Results path to the application) are `discovered-from` follow-ups for the runs area.
- Q4, Q11, Q12 and Q13 are `related` to the standard-components / microcopy beads under astro-plan-0drm0.
- Q2, Q6 and Q9 need user decisions: Moon model, goal unit, Review gate. They `block` their implementation beads only once those beads exist.
