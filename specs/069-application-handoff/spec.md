# Feature Specification: Application preparation: profiles, input modes, locations, prepare and open

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `069-application-handoff`

**Created**: 2026-10-03

**Amended**: 2026-10-06, to the settled workflow decisions D-W1 to D-W71, and on 2026-10-07 to the answers D-W72 and D-W73.

**Status**: Draft; product defaults and all human-approval gate waivers follow the root autonomous objective. Requirements analysis, implementation and verification remain required.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - Application preparation: profiles, input modes, locations, prepare and open (Priority: P1)

This feature owns the Prepare step of a processing run (View), which always belongs to a Project. It turns a run's reviewed membership into a verified Linked, Direct-source, Copy, or Clone handoff for a maintained profile or a generic Open in..., with the run's Results folder beside its prepared folder. A mosaic run group prepares every panel run under one group folder, and each panel run has its own Results folder. After the run is Complete, Clean up removes only what preparation created. The app never runs processing.

**Why this priority**: This feature owns the workflow steps listed below without imposing unrelated product features.

**Independent Test**: Exercise the acceptance scenarios through the running product with isolated inputs. Existing baseline code does not prove the redesigned behavior.

**Acceptance Scenarios**:

- **PREP-AC-01**: Given a reviewed 208-light selection in Project NGC 7000 HOO, a Siril profile with recorded read-only input capability evidence, Linked View mode, and parent Work/Processing. When Review preparation opens, then it shows Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril/ and its sibling Results folder NGC7000-HOO-Siril Results/. It also shows 208 entries, the link type and its limits, the footprint, and free space. (D-W51)
- **PREP-AC-02**: Given the suggested run folder already exists with unrelated content, then preparation asks for another name or location and the existing folder is unchanged. (D-W3)
- **PREP-AC-03**: Given a qualified read-only profile and linking unsupported at the destination, when alternatives are reviewed, then only supported Clone, Copy or exact Direct-source modes are offered with footprints. Nothing is applied until the user chooses; no silent copy occurs.
- **PREP-AC-04**: Given a qualified read-only profile consumes a whole folder containing six excluded frames, when Direct-source handoff is reviewed, then the folder handoff is refused and supported isolated alternatives are offered.
- **PREP-AC-05**: Given the reviewed 56-light `28 Sep Ha copy check` run and three inputs become unreadable during Prepare, then the outcome is Partial, listing 53 prepared and 3 blocked; verified Open is not offered; the sources are untouched. (D-W3)
- **PREP-AC-06**: Given a catalog filter correction that differs from the header, when isolated patched Copy or supported Clone is chosen, then only the isolated entries carry the patched value and original hashes remain identical. Linked symlinks/hardlinks and Direct-source originals are never patched; review names the effective source value. A Direct-source run changes mode only after approval. (D-W3)
- **PREP-AC-07**: Given an unsupported profile configuration, when review opens, then the unsupported capability is named; generic Open in does not claim verified-profile support.
- **PREP-AC-08**: Given a requested symlink cannot be created but hardlinks are eligible, when alternatives are reviewed, then hardlink use requires explicit approval and verifies volume, permissions and filesystem. A failed eligibility check leaves the item blocked rather than copying silently.
- **PREP-AC-09**: Given the last selected parent is unavailable, when a run location is reviewed, then another parent must be chosen explicitly and no different drive is substituted. (D-W3)
- **PREP-AC-10**: Given a verified preparation and a missing or failing executable, when Open is attempted, then Choose application or Reveal run folder is offered and all decisions persist. Closing an external application never marks the run Complete or claims processing success. (D-W3)
- **PREP-AC-11**: Given a profile has unknown or write-prone input behavior, when Linked or Direct-source mode is reviewed, then the input-write risk is named, those modes are refused, and isolated Copy or supported Clone is offered without changing mode automatically.
- **PREP-AC-12**: Given an accepted refresh saved as a new reviewed membership revision while an external app uses an existing preparation, when reprepare is reviewed, then a new preparation revision is proposed. Old prepared entries remain unchanged unless their separate STO cleanup is approved.
- **PREP-AC-13**: Given a draft selection with default inclusions, explicit exclusions and unresolved sources, when Review preparation opens, then exact identities and membership need confirmation; unresolved sources remain blocked and quality decisions are not changed.
- **PREP-AC-14**: Given a confirmed Copy preparation, when one source's bytes change after its snapshot is hashed and before terminal success, with size and mtime preserved, then that item is blocked with source drift named. The outcome is Partial, no verified Open is offered and PlateVault does not write to the changed source. After the reviewed bytes are restored, Retry prepares the item only when its source matches a fresh snapshot and its copy re-reads to match.
- **PREP-AC-15**: Given a prepared Linked View run whose hardlinked input is overwritten in place with its size and mtime preserved, when Open is clicked, then the application is not launched. The changed entry is named against its preparation snapshot. After the snapshot bytes return, Open re-verifies every entry and launches. (D-W3)
- **PREP-AC-16**: Given run group NGC 7000 Mosaic in Project Cygnus 2026 with three panel runs, a WBPP profile and parent Work/Processing. When Prepare all opens its review, then it lists Work/Processing/Cygnus 2026/NGC 7000 Mosaic/Panel 1/ to Panel 3/. It also lists each panel run's Results folder, NGC 7000 Mosaic/Panel 1 Results/ to Panel 3 Results/, and the group Results folder Work/Processing/Cygnus 2026/NGC 7000 Mosaic Results/. Each panel shows its entry count and its own calibration choices, and a panel whose calibration needs review is named. The review shows the shared profile, input mode and calibration policy once, with one total footprint and free space. (D-W38, D-W41, D-W51, D-W73)
- **PREP-AC-17**: Given that Prepare all runs and two Panel 2 inputs become unreadable, then Panels 1 and 3 read Prepared, Panel 2 reads Partial with the two items blocked, and the group reads Partial. Open on the group's parent folder is not offered; Open on Panel 1 or Panel 3 is. The sources are untouched. (D-W38)
- **PREP-AC-18**: Given a run group whose panel folders already exist under NGC 7000 Mosaic/. When the user reprepares a new Panel 2 membership revision, then PlateVault leaves the existing NGC 7000 Mosaic/ folder and its Panel N folders as they are. Review proposes a new group folder, NGC 7000 Mosaic (rev 2)/, with a Panel N/ folder inside it for every panel. The previous group folder stays until the user approves its STO cleanup. (D-W38, D-W51, D-W67)
- **PREP-AC-19**: Given a Complete run prepared as Linked View with symlinks and hardlinks, and a Complete run prepared as Copy. When Clean up opens on either, then it lists only that run's prepared links, clones and copies. Original sources, Direct-source paths, library frames and accepted Results are absent. Clean up offers no way to move rejected frames to Trash. (D-W26, D-W43)
- **PREP-AC-20**: Given a Complete run prepared in Direct-source mode, when Clean up opens, then it shows that preparation created no entries and offers nothing to remove. (D-W26)
- **PREP-AC-21**: Given run NGC7000-HOO-Siril already prepared under Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril/. When the user reprepares a new membership revision, then review proposes Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril (rev 2)/, and the first folder is unchanged. Both revisions send their Results to the one folder NGC7000-HOO-Siril Results/. (D-W51, D-W67)

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

- A run that is not Complete offers no Clean up; replaced preparation entries before then follow STO-FR-10. (D-W26)

## Requirements

### Functional Requirements

- **PREP-FR-01**: The required profile targets are PixInsight/WBPP, Siril, and SETI Astro Suite Pro. Decision D04 requires verified input, layout, configuration, product-input capabilities and recognized output evidence before any verified-profile claim. The user configures or locates the executable. Unsupported configuration is named. No profile invents an API or claims that renaming files overrides headers.
- **PREP-FR-02**: Generic Open in... takes a configured executable and launch arguments, without claiming a verified profile.
- **PREP-FR-03**: Corrected metadata: the review shows the catalog value next to the value the application will read. Options: supported application configuration, isolated patched copies or clones, accepting the source value, or excluding the input. A Direct-source run changes mode only with approval. Originals and links are never patched. A correction is never claimed as delivered while the tool still reads the original value. (D-W3)
- **PREP-FR-04**: Input modes: Linked View is suggested for verified read-only profiles; Direct source, Copy, and supported Clone are alternatives. Review shows each mode's semantics, concrete link type, limits and storage. Changing symlink to hardlink needs an explicit choice. Hardlink eligibility checks volume, permissions and filesystem. Unknown or write-prone input behavior refuses Linked/Direct-source use and offers isolated Copy or Clone under root decision D04.
- **PREP-FR-05**: Direct source passes exact original paths through supported configuration or input lists and creates no links or copies. A folder handoff is allowed only when the application consumes exactly the reviewed membership; otherwise it is refused with alternatives.
- **PREP-FR-06**: Run location: a single run prepares to `<output>/<Project>/<Run>/`, where `<output>` is the last chosen parent folder; on first use there is no assumed root. Each later prepared revision goes to `<Run> (rev 2)/` and so on beside it. A run group uses the layout in PREP-FR-12. An existing directory is never reused or cleared; when the proposed folder already exists, preparation asks for another name or location. An unavailable parent prompts a new choice and is never silently replaced by another drive. (D-W3, D-W38, D-W51, D-W67)
- **PREP-FR-07**: Results go to the sibling folder `<output>/<Project>/<Run> Results/`, outside every prepared folder, so the application never reads its own output as input. In a run group, each panel run's Results go to its own folder `<output>/<Project>/<Mosaic>/Panel N Results/`, beside the panel's prepared `Panel N/` folder and outside it, so a Result's panel is known from where it was written. The group Result, the assembled mosaic, goes to `<output>/<Project>/<Mosaic> Results/`. One Results folder serves every prepared revision of the run or panel run; a later group revision `<Mosaic> (rev 2)/` gets no Results folder of its own. An override parent replaces `<output>` for the Results folders only and keeps the Project level: `<override>/<Project>/<Run> Results/`, `<override>/<Project>/<Mosaic>/Panel N Results/` and `<override>/<Project>/<Mosaic> Results/`. The location is recorded for Result discovery. (D-W3, D-W38, D-W51, D-W67, D-W73)
- **PREP-FR-08**: Review preparation shows the run's Project and subject, the immutable selection, profile, source references, calibration choices, exceptions, excluded count, paths, mode, operation count, footprint, and free space. Saved criteria are shown apart from browsing filters and confirmed. Source presence, collisions, and permissions are checked. Any subset that cannot use the mode is listed with paths and footprint, and per-item mode changes need approval. Unknown or omitted inputs never count as prepared. (D-W1, D-W9)
- **PREP-FR-09**: Prepare run shows Running and progress, cancel or pause where safe, and per-item failures. It ends in exactly one of Prepared, Partial, Failed, Canceled, or Paused. Success requires the prepared entries to match the recorded selection and each source's SHA-256 snapshot taken during Prepare. Copy and Clone destinations are durably written and re-read against that snapshot; an isolated patched entry may differ only by its reviewed header change. Linked and Direct-source entries must resolve to the snapshotted source identity. Immediately before terminal success, each source's current identity and digest must still match its snapshot. Drift, a destination mismatch or an unreadable source blocks the item. So does an observation fingerprint differing from the confirmed membership. So does a snapshot differing from any D19 basis recorded for the input, such as its quality decision, logical-capture proof, acceptance, adoption or calibration assignment digest. Automatic calibration assignments are re-verified exactly like accepted ones (CAL-FR-08). A blocked item never counts as prepared. Partial lists succeeded and blocked items. Sources are untouched. (D-W3, D-W5)
- **PREP-FR-10**: After verified success, the user gets Open in the chosen app, Reveal run folder, and preparation details. Immediately before each launch, Open re-verifies under D19 the bytes the application will read: Copy, Clone and hardlink entries, symlink targets and Direct-source paths, each against its preparation snapshot. Drift refuses the launch and names the changed items, and the run reads unverified until those bytes return or a reviewed repreparation replaces them. Launching is not processing completion, and closing the application never marks the run Complete. A missing executable offers Choose application or Reveal run folder. A launch failure keeps the run and its decisions. (D-W3)
- **PREP-FR-11**: A revised selection needs a new review. Each new preparation revision is materialized in a new reviewed run folder, `<Run> (rev 2)/` and so on beside the earlier ones, and never replaces, reuses or clears an existing preparation in place (D09). A previous preparation can be kept for comparison. Removing replaced entries follows STO cleanup rules. (D-W3, D-W51, D-W67)
- **PREP-FR-12**: Prepare all on a run group opens one review covering every panel run and prepares each one under `<output>/<Project>/<Mosaic>/Panel N/`, so an application such as WBPP can load the group folder. The group's shared profile, input mode and calibration policy apply to every panel run, and per-item mode exceptions still follow D04. Calibration choices are shown and matched per panel run, and the review names each panel run whose calibration needs review (CAL-FR-11). Each panel run ends in its own outcome under PREP-FR-09, and the group lists each panel's outcome. The group reads Prepared when every panel run is Prepared, Failed when every panel run Failed, Canceled or Paused when the user cancels or pauses Prepare all, and Partial otherwise. One panel's blocked items never block another panel's items. (D-W38, D-W41, D-W51, D-W55)
- **PREP-FR-13**: Open on a run group's folder appears only when every panel run is verified, and it re-verifies every panel's entries under PREP-FR-10 before launch. Open on a single verified panel run stays available. Each group preparation revision gets a new group folder, `<Mosaic> (rev 2)/` and so on, with a `Panel N/` folder inside it for every panel run. When the user reprepares a panel run whose Panel N folder already exists, review proposes that new group folder. The previous group folder stays until the user approves its STO cleanup, and its `Panel N Results/` folders stay with it. The user assembles the mosaic in the application and saves it to `<Mosaic> Results/`, where it comes back as the group Result (RES). A run group never has a whole-mosaic run. (D-W38, D-W51, D-W67, D-W73)
- **PREP-FR-14**: Once a run is Complete (RES), Clean up lists only the entries its preparation revisions created: prepared links, clones and copies. Original sources, Direct-source paths, library frames and Results are never listed. Clean up never moves rejected frames to Trash; that belongs to the Project's Done / Archive sheet. Delete run (RES-FR-10) moves the run's prepared folders to the OS Trash, and its Results folder only when the user ticks it. Removal follows STO custody rules, including retained-original proof and OS Trash handling (STO-FR-17). (D-W26, D-W43, D-W72)

### Owned interaction steps

- E3
- E4
- F1
- F2
- F3
- F4
- F5
- F6
- Cross-flow: Unsupported input mode
- Cross-flow: Direct-source exclusion unsupported by tool
- Cross-flow: Partial preparation
- Run group: Prepare all and the panel folder layout
- The prepared-entry record that a Complete run's Clean up lists (PV-STO runs Clean up, steps I2 to I5)

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision.

- **Run folder**: the reviewed folder a preparation revision of one run is materialized in, `<output>/<Project>/<Run>/` for the first revision and `<Run> (rev N)/` for later ones. (D-W3, D-W51, D-W67)
- **Group folder**: `<output>/<Project>/<Mosaic>/`, or `<Mosaic> (rev N)/` for a later group revision, holding one `Panel N/` folder per panel run of a run group for one group preparation revision. The first group folder also holds each panel run's `Panel N Results/` folder. (D-W38, D-W51, D-W67, D-W73)
- **Results folder**: the sibling `<Run> Results/` folder that receives a run's outputs from every prepared revision, outside every prepared folder. In a run group, each panel run has its own `<Mosaic>/Panel N Results/` folder, and the group Result goes to `<Mosaic> Results/`. Under an override parent each keeps the `<Project>/` level (PREP-FR-07). (D-W51, D-W67, D-W73)
- **Prepared entry**: a link, clone or copy created by a preparation revision. Prepared entries are the only files Clean up of a run lists. (D-W26)

## Success Criteria

### Measurable Outcomes

- **PV-PREP-SC-01**: Every acceptance scenario produces its stated outcome and refusal behavior.
- **PV-PREP-SC-02**: Every owned interaction step has a requirement and independently observable acceptance evidence.
- **PV-PREP-SC-03**: Original inputs remain unchanged except through separately reviewed and approved filesystem operations.
- **PV-PREP-SC-04**: In the run Clean up fixtures, zero original sources, Direct-source paths or library frames are listed, and zero files go to Trash outside the run's prepared entries. (D-W26, D-W43)

## Assumptions

- [Product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the confirmed interactions and illustrative worked example.
- This feature is independently specified; dependencies on other feature contracts are resolved in planning.
- Conservative defaults and all human-approval gate waivers follow the root autonomous objective and decision register. Tests, requirements analysis, independent review and delivery evidence remain mandatory.
- The user interface says "processing run" where this contract's root vocabulary says View. The input mode keeps its name, Linked View.

## Decisions before feature approval

- Root decisions D02, D04, D09, D13 and D15 govern exact inclusion confirmation, profile qualification, input-write refusal, reviewed calibration/preparation revisions and isolated header corrections. No unsupported tool capability is claimed without evidence.
- Root decision D19 binds Prepare and Open to re-verified source and entry content.
- Workflow decisions D-W1, D-W3, D-W5, D-W9, D-W26, D-W38, D-W41, D-W43, D-W51, D-W55 and D-W67 (settled 2026-10-06) and D-W72 and D-W73 (answered 2026-10-07) place preparation inside a Project's run and add run group preparation under one group folder. They set the `<output>/<Project>/<Run>/` layout with a new folder per prepared revision and one shared sibling Results folder, and one Results folder per panel run. They limit Clean up of a Complete run to its prepared entries, and Delete run sends a deleted run's prepared folders to the OS Trash.
