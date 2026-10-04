# PlateVault product flow and user journeys

Date: 2026-10-03
Status: draft interaction specification based on the functionality interview
Delivery: documentation only; no product implementation or new wireframes
Baseline comparison: local commit `94a3dc958c13e297baf501aa2721efa2c2628622`

## Scope and status

This document specifies the proposed application. It does not describe shipped behavior. The functionality follows the user's interview answers. Button names, field arrangements, and interaction details are proposed for review.

Each journey names what the user sees, enters, clicks, and observes. Trust conditions name what must remain unchanged. Open decisions remain listed at the end; they are not accepted ambiguities.

The audited application is preserved at baseline commit `94a3dc958c13e297baf501aa2721efa2c2628622`. Earlier engineering reviews and concept exploration remain in the retained `review/application-local-20261002` branch/worktree and are not published artifacts of this contract. This flow supersedes their conflicting workflow recommendations. Baseline [product journeys](../journeys/INDEX.md) and their run history remain recoverable; J19 through J30 describe the rebuild.

## Product vocabulary

| Name | Meaning in this flow |
|---|---|
| Library | Indexed files, locations, metadata, quality decisions, and relationships. Indexing leaves originals where they are. |
| Session | A metadata-homogeneous acquisition group. Separate Ha and OIII data are separate sessions. A night can contain multiple sessions. |
| Target | A sky subject or region. It anchors accumulated coverage, planned observing windows, linked Projects, and results. |
| Project | An optional named goal. It can span Targets, mosaic panels, equipment, and capture sites. |
| View | A named, reviewed input selection for an application. It can stand alone or belong to a Project. |
| Prepared View | A materialized input layout plus configuration, output location, and manifest. It stays fixed until explicitly refreshed. |
| Direct-source View | The same reviewed selection, using original subs through supported application configuration or file lists, without staging or links. |
| Result | A manually accepted final image or reusable processing product associated with a View. |
| Complete | The user has finished this processing attempt. It does not imply success, acceptance, or file removal. |

The interface need not expose a separate Run entity. View history can record preparation revisions without making repeated processing attempts a mandatory workflow.

## Application surfaces

Targets is the default home. The main navigation provides Targets, Sessions, Projects, Calibration, and Storage. Sessions can group their display by night; Night is not a replacement for the session identity model.

Activity and Settings are secondary utilities. Running operations, refusals, and recoverable failures remain visible without making audit administration the product's main task.

| Surface | What the user sees | Main actions |
|---|---|---|
| Targets | Search, captured/usable coverage, Project goals, results, and planning | Open Target, New Project, Create View, Plan |
| Sessions | Session table, metadata, counts, locations, and optional sky coverage | Select sessions, Create View, Inspect, optional File into library |
| Projects | Named goals and capture checklists; linked sessions; Views and accepted products | Edit checklist, Create View, open View |
| Calibration | Masters and raw calibration sets; compatibility; missing evidence; adoption suggestions | Inspect, choose inputs, Adopt master |
| Storage | Locations, availability, View footprints, duplicate candidates, archive transfers | Clean up View, Archive, locate/remap |
| View review | One persistent selection, image review, measurements, calibration, and preparation controls | Exclude, Mark usable, Prepare, Refresh, Open in |
| Results | Discovered outputs and attached files; kinds; acceptance and lineage | Attach Result, Accept, use in another View |

## Worked example

All names, paths, counts, and sizes in the following journeys are illustrative. They are not measurements from a real library.

The user has:

- Capture locations `Astro-T7/Captures` and `Cold-1/Captures`. Cold-1 is offline.
- Calibration location `Astro-T7/Calibration`.
- A confirmed RedCat 51 / ASI2600MM optical train.
- A default observing site named Backyard.
- Target NGC 7000 and Project `NGC 7000 HOO`.

The Project's example light selection contains five separate sessions:

| Session | Channel | Exposure | Frames included | Integration |
|---|---|---|---|---|
| 18 Sep, RedCat | Ha | 300 s | 55 | 4h 35m |
| 28 Sep, RedCat | Ha | 300 s | 56 | 4h 40m |
| 24 Sep, RedCat | OIII | 300 s | 20 | 1h 40m |
| 26 Sep, RedCat | OIII | 300 s | 35 | 2h 55m |
| 30 Sep, RedCat | OIII | 300 s | 42 of 48 | 3h 30m |

The View selects 208 lights: Ha 111 / 9h 15m and OIII 97 / 8h 05m. Total selected integration is 17h 20m. The six excluded OIII lights remain on disk.

These totals describe the user's confirmed membership after frame review, not a proposed default for Unreviewed frames. A separate 12 Sep OIII session on offline Cold-1 is visible but is not part of this selection.

## Journey A: first use and indexing

**Goal:** add a capture location and inspect sessions without organizing files or configuring a processing application first.

### A1. Choose locations

**See:** a short onboarding flow with a Locations step. Captures is required. Calibration and Results are optional roles. View locations are chosen during preparation.

**Do:** click **Add capture location**. Use the native folder picker to choose `Astro-T7/Captures`. Enter the display name `Astro-T7 captures` if the suggested name is unsuitable.

**Observe:** a location row shows the path, role, access state, and whether it is online. **Add another location** permits another folder for the same role.

**Trust:** selecting a folder registers access and indexing intent. It does not copy, rename, move, or delete its contents.

### A2. Configure optional locations

**See:** **Add calibration location**, **Add results location**, and **Set up later**.

**Do:** choose `Astro-T7/Calibration`, or leave it unset. Leave Results unset if processing output locations will be chosen per View.

**Observe:** onboarding can continue with one capture location. Optional omissions are named, not represented as failed setup.

### A3. Start indexing

**Do:** click **Start indexing**.

**See:** progress with files discovered, metadata read, unsupported items, unreadable items, and completed scope. Results appear progressively.

**Observe:** separate sessions emerge from the existing metadata grouping rules. Ha and OIII remain separate. An absent OBJECT label leaves Target association unresolved when other evidence is insufficient.

**See:** Target and equipment associations with the evidence used. Agreeing evidence permits automatic association. Unknown or conflicting evidence shows **Needs review**.

**Do:** open **Inspect session**, review the association evidence, and choose **Confirm Target** or **Confirm equipment** when needed. Correct a wrong association in the catalog without patching source headers.

**Trust:** an incomplete or unreadable scan does not label unobserved files Missing. An offline location retains its last-observed metadata and quality decisions.

### A4. Enter the library

**Do:** click **Open library**, then open Sessions or a detected Target.

**See:** totals state which indexed locations they cover. A scan still running makes its scope provisional. Data elsewhere is not implied to have been indexed.

**Observe:** the user can inspect already-read sessions before indexing finishes. Quality measurements have not automatically marked frames usable.

**Failure branch:** when access is denied, the location row names the failure and offers **Choose folder again** or **Retry**. Other readable locations can continue.

## Journey B: Target and optional Project

**Goal:** organize an image goal and its capture checklist without making Projects prerequisites for library inspection.

### B1. Open a Target

**Do:** use Target search and open NGC 7000.

**See:** captured integration, library-wide usable integration, and Unreviewed data by channel. Availability is a separate state. Offline contributions show their last observation and are not promised as available processing inputs.

**Observe:** rejecting a frame only inside one View does not reduce the Target's library-wide usable total. A library-wide quality decision does.

### B2. Create a Project

**Do:** click **New Project**. Enter `NGC 7000 HOO` and optional notes. Confirm the prefilled Target or add other Targets/panels.

**See:** equipment selection and an optional capture checklist.

**Enter:** RedCat 51 / ASI2600MM as the equipment used for initial preselection. Add checklist items such as Ha 10h, OIII 10h, 300-second exposure preference, desired frame count, or missing flats.

**Observe:** the Project stores the goal and displays progress. An unmet checklist does not prevent creating a View. Reaching it does not automatically close the Project.

**Trust:** creating a Project creates catalog goals and associations only. It does not move captures, generate a View, or change frame usability.

### B3. Work across sites

**See:** sessions retain their capture sites. The Project is not assigned one capture site.

**Do:** choose Backyard or another saved site in the planning site selector.

**Observe:** visibility calculations change for the chosen planning site. Project membership and historical session locations stay unchanged. Notifications initially use the default site only.

### B4. Start a View

**Do:** click **Create View** from the Project.

**Observe:** the review workspace opens with the Project context and equipment. Alternatively, click **Create View** from a Target or selected Sessions without creating a Project.

## Journey C: select sessions for a View

**Goal:** select one or multiple sessions using metadata and sky coverage, including data with missing or differently named OBJECT labels.

### C1. Open the review workspace

**See:** a session table, selection summary, frame-review area, and calibration area within one persistent workspace. **Sky coverage** toggles a linked spatial view.

**Observe:** Sessions, Frames, Preview, and Calibration share one selection. Move among them without a forced Next/Back wizard. **Review preparation** gathers unresolved choices whenever the user requests handoff.

**Enter:** a View name such as `NGC7000 HOO - Siril`. Choose an optional Project association. Choose an application profile or leave it until preparation.

**Observe:** the draft selection belongs to this View. Target and Project associations provide optional context.

### C2. Inspect geometric suggestions

**See:** sessions suggested from the Target/Project framing or mosaic panels. Known footprints and configured overlap criteria govern relevance; angular separation helps ordering.

**Observe:** matching sessions from the Project's chosen equipment are preselected. Other nearby equipment groups are visible for deliberate inclusion. Missing or different OBJECT labels do not veto a geometric match.

**See per candidate:** session, date/time, channel, exposure, camera/optical train, frame count, integration, availability, distance, and footprint evidence where available.

**Trust:** candidate preselection does not merge sessions, rewrite their headers, or change their Target assignments.

### C3. Recover missing geometry

**See:** **FOV from confirmed equipment** when header optics are missing but the session has a confirmed equipment association.

**Observe:** the calculation uses image dimensions, effective focal length, pixel scale, and applicable binning. A footprint also needs pointing and orientation evidence.

**See:** **FOV unknown** or **Position unknown** when evidence is insufficient. Pointing-only candidates can be shown by radius but are not automatically preselected. Sessions without position remain selectable manually.

**Do:** inspect the evidence, confirm equipment when appropriate, or include the session manually.

**Trust:** OBJECT labels are not substituted for missing coordinates, and unknown geometry is not represented as zero distance.

### C4. Filter and sort

**Do:** open **Filters**. Set a date/time range, observing night, channel, exposure range, equipment, quality state, location, or availability. Use OBJECT as an optional text filter, including a **Missing OBJECT** option.

**See:** Target, camera, gain, offset, binning, and temperature filters in the expanded metadata controls. Quality state means recorded Unreviewed, Usable, or Unusable decisions. Session rows show counts by state; measurement columns distinguish measured values from **Not measured**.

**See:** active filter chips and the matching-session count. Sort table columns by their named values. Sky-distance and overlap sorting are available when evidence exists.

**Observe:** filters alter the candidate list, not the selected session IDs. They do not change session definitions.

**Trust:** quality-state filters browse sessions with matching frames. Selecting a session still requires frame-level membership review. Filtering does not mark frames usable or start native measurement.

### C5. Select sessions

**Do:** use row checkboxes or **Select matching**. Add multiple sessions across nights and locations. Use the sky view to inspect their footprints.

**Observe:** checking a row adds that metadata-homogeneous session to the draft. Frame membership and exclusions are confirmed in the review area. The summary reports the intended included frames and integration by channel, with unresolved membership named.

**See:** geometry suggestions and manual inclusion reasons. Unreviewed and library-Unusable counts stay visible. D02 sets initial membership: available Unreviewed/Usable frames are included, library-Unusable frames start visibly excluded, and unavailable members remain unresolved. Review preparation confirms exact membership.

**See:** **Selected outside current filters: N** after changing filters. **Show selected** reveals all chosen sessions. **Clear selection** removes the draft selection explicitly.

**Observe:** sorting, paging, and toggling sky coverage preserve selection. Clicking a footprint highlights its session, and clicking a row highlights its footprint.

### C6. Handle unavailable sources

**See:** offline, missing, or unreadable states beside affected inputs. Last-observed counts do not become verified preparation counts.

**Do:** reconnect a location, locate a known copy, or explicitly remove affected inputs from the draft.

**Trust:** preparation never silently omits selected sources. A read error is not an empty session or successful zero-frame preparation.

## Journey D: inspect frames and quality

**Goal:** review images while creating the View, exclude unsuitable inputs locally, and explicitly update library usability where intended.

### D1. Measure selected sessions

**Do:** open **Review frames** within the same workspace.

**See:** cached measurements immediately where valid; pending/failed/unavailable states elsewhere. PlateVault computes missing native measurements during this review, prioritizing the selected work.

**Observe:** progress is visible. Frame inspection stays available while other measurements run. Cancel stops further measurement work without discarding the draft selection.

### D2. Select a frame

**Do:** click a frame row or its measurement-plot point.

**See:** the same frame highlighted in the list, plot, and preview. Header metadata and measurement source/units are available on disclosure.

**Do:** zoom, pan, compare fixed center/corner regions, or move to the next/previous frame. Display stretch changes the preview only.

**Trust:** preview controls never alter source pixels. Star measurements use linear image data, not a stretched thumbnail.

### D3. Inspect star/PSF diagnostics

**Do:** enable **Stars** in the preview and select a detected star.

**See:** its location, measurement state, PSF model where fitted, shape/width values, saturation/fit warnings, and observed/fitted/residual cutouts when available.

**Observe:** a failed fit is named as a failed fit, not assigned a plausible FWHM. HFR and FWHM retain distinct labels. Imported and native measurements retain their methods and units.

**Scope:** the requested diagnostics are part of the proposed product. Library choice, float-capable fitting, and implementation fidelity remain engineering work; no existing header parser supplies this surface.

### D4. Exclude from this View

**Do:** select six suspect frames in the 30 Sep OIII session. Click **Exclude from View**.

**Observe:** 42 of its 48 frames remain included. OIII selected integration becomes 8h 05m across the three selected OIII sessions. The View totals 208 lights and 17h 20m.

**See:** excluded rows can be shown or restored. Their files remain on disk. Other Views and library-wide quality states remain unchanged.

**Trust:** the default exclusion does not silently become a Project-wide rule or library-wide rejection.

### D5. Mark library usability explicitly

**Do:** select reviewed included frames. Click **Mark included frames usable** and inspect the named scope before confirming.

**Observe:** library quality state changes for those frames. Target usable coverage updates without confusing it with View membership.

**Alternative:** choose **Reject for Project** for a Project-owned View, or **Mark unusable in library** for the broader library decision. Each confirmation names the affected scope. Project-progress and existing-View propagation rules remain open.

**Trust:** preparing the View alone does not mark every included frame usable. Excluded frames stay View-specific unless the user chooses a broader decision.

### D6. Import existing measurements

**Do:** click **Import measurements** and select a supported export such as a PixInsight SubframeSelector CSV.

**See:** matched files, rows with no corresponding file, ambiguous rows, units, and source/method information. Confirm the import mapping.

**Observe:** external measurements appear with their provenance. They do not silently replace native values or import frame-rejection decisions.

**Failure branch:** missing units or ambiguous file identity requires review. Unsupported measurement columns remain unavailable rather than being relabeled as equivalent metrics.

## Journey E: choose calibration and application preparation

**Goal:** resolve calibration and prepare the reviewed selection for a supported application without controlling processing execution.

### E1. Review calibration

**See:** compatible masters or raw calibration sets preselected for the chosen light sessions. Inputs stay grouped by camera/settings/channel and relevant geometry.

**Do:** inspect a suggestion's criteria or choose another input. Open **Why this match** to inspect compatible, incompatible, and unknown criteria.

**Observe:** accepted assignments are distinct from suggestions. Raw flats can be handed to an external application that builds its own masters.

### E2. Resolve exceptions

**See:** the 24 Sep OIII session lacks confirmed flat compatibility. Its candidate 26 Sep flat set has unknown optical-train state.

**Do:** choose another candidate, exclude the affected session, defer preparation, or record an explicit scoped exception with a reason.

**Observe:** the review retains the mismatched/unknown criterion and the reason. An exception does not rewrite the master's evidence or make it universally compatible.

### E3. Select an application

**Do:** choose PixInsight/WBPP, Siril, or SETI Astro Suite Pro.

**See:** the maintained profile's supported input/layout/configuration capabilities. Configure or locate the executable when required.

**Observe:** PlateVault prepares supported configuration and opens the application. The user starts and manages processing there.

**Alternative:** **Open in...** allows a configured executable and launch arguments for another application without claiming a verified preparation profile.

**Trust:** unsupported configuration is named. A profile does not invent an application API or claim that changing filenames overrides headers.

### E4. Resolve corrected metadata

**See:** any catalog grouping value that differs from what the application will read in the source file.

**Do:** use supported application configuration to convey the correction. If that is unavailable, choose isolated derived copies/clones with patched headers, accept the source-header value for this handoff, or exclude the inputs.

**Direct-source branch:** when a correction requires patched files, choose Copy or supported Clone before preparation, or keep original values explicitly. Direct source remains unchanged until the user approves that mode change.

**Observe:** the review names the effective handoff values and materialization mode.

**Trust:** header patches never write through symlinks/hardlinks or alter originals. A correction cannot be claimed as delivered when the tool still reads an incompatible original value.

## Journey F: prepare and open the View

**Goal:** create one reviewed application input layout and its per-View output location, or prepare a direct-source handoff.

### F1. Choose input mode

**See:** **Linked View** as the normal suggestion; **Direct source**, **Copy**, and supported **Clone** alternatives.

**Do:** keep Linked View or select an alternative.

**Observe:** the selected mode identifies actual semantics and required storage. Symlinks/hardlinks are references, not isolated backups. Hardlinks need an eligible same-volume arrangement; permission and filesystem support are checked.

**See:** the concrete link type and its limitations. A change from symlink to hardlink requires an explicit reviewed choice. An application that writes into linked input files can alter the source; choose Copy or an isolated Clone for that workflow.

**Direct-source branch:** the profile supplies exact original file paths through supported configuration/input lists. It creates no input links or copies. A folder handoff is valid only when the application consumes precisely the reviewed membership. If it also consumes nonmembers or cannot honor exclusions, choose a supported alternative before handoff.

### F2. Choose the View location

**See:** a suggested unique View subfolder under the last parent folder the user selected. On first use, there is no assumed workspace root.

**Do:** click **Choose location...** and select a suitable parent, for example `Work/Processing`. Confirm or enter the new folder name `NGC7000-HOO-Siril`.

**Observe:** the review shows `Work/Processing/NGC7000-HOO-Siril`. It never reuses or clears an unrelated existing directory.

**Failure branch:** an unavailable last-used parent prompts another choice. The application does not silently select a different drive.

### F3. Choose the output location

**See:** `View/output/` as the default.

**Do:** keep it, or click **Change output location...** and choose another parent folder.

**Observe:** an override creates a View-specific output subfolder under that parent. It does not use a shared output directory directly. The View records this location for result discovery and cleanup.

### F4. Review preparation

**Do:** click **Review preparation**.

**See:** the immutable selection, application profile, source references, calibration choices, exceptions, excluded count, paths, input mode, operation count, expected footprint, and available space.

**See:** saved selection criteria separately from table filters used only for browsing. Review and confirm the criteria to retain with the prepared membership.

**Observe:** source presence, destination collisions, and applicable permissions are checked. If linking is unavailable, PlateVault offers supported clone/copy/direct-source alternatives with their consequences before applying anything.

**See:** any subset that cannot use the chosen mode, with item paths and footprint. Per-item mode changes need approval; mixed-mode support remains an explicit preparation contract.

**Trust:** a low-footprint linked plan does not silently become a full copy. Unknown or omitted inputs are not counted as prepared.

### F5. Prepare

**Do:** click **Prepare View**.

**See:** Running, progress, cancel/pause where safe, and explicit item failures. The final state distinguishes Prepared, Partial, Failed, Canceled, or Paused.

**Observe:** success appears only after the prepared entries and recorded selection agree. Partial preparation lists what succeeded and what remains blocked.

**Trust:** a start acknowledgment is not success. No processing application is opened with a falsely verified incomplete selection.

**Failure branch:** inspect succeeded and blocked entries, then choose **Review preparation again** or keep the partial View unchanged. Retry/resume behavior for those entries needs the lifecycle contract below. Sources remain untouched; removing prepared entries follows Journey I, including retained-copy proof and Trash.

### F6. Open the application

**See:** **Open in Siril**, **Reveal View**, and preparation details after successful verification.

**Do:** click **Open in Siril**. Review the prepared inputs/configuration inside Siril. Start processing there.

**Observe:** PlateVault distinguishes application launch from processing completion. Closing the application does not automatically mark the View complete.

**Failure branch:** a missing executable offers **Choose application** or **Reveal View**. Tool launch failure preserves the prepared View and draft decisions.

## Journey G: refresh an existing View

**Goal:** add newly matching sessions or change selection without altering prepared inputs underneath an external application.

**Do:** reopen the View and click **Refresh selection**.

**See:** saved criteria and an added/removed-session/frame comparison against the reviewed selection. Rows show change reasons, including manually included inputs outside those criteria. Explicit exclusions remain recorded.

**See:** offline or unreadable members as **Unavailable**, never as removed solely because they cannot be observed. Cold-1's 12 Sep session remains in the library even when its folder cannot be scanned.

**Do:** accept selected changes, decline others, or keep the existing View unchanged. Revisit image and calibration review for changed inputs.

**Observe:** preparing the revised selection requires a new review. Keep the previous preparation when a comparison is wanted. New arrivals do not silently change an already prepared View.

**Trust:** no changed membership or preparation revision takes effect without approval. Whether repeated refresh keeps manual inclusions pinned, and whether revisions use new folders or reviewed replacement, need explicit lifecycle rules.

**Trust:** replacing a preparation does not bypass cleanup. Entries being removed need the same reviewed scope, retained-original evidence, and Trash handling as Journey I.

**Trust:** refreshing selection is different from repairing paths after an archive transfer. Path repair preserves the same selected asset identities.

## Journey H: results and generated masters

**Goal:** discover or attach valuable products and accept them independently of completion.

### H1. Discover outputs

**See:** candidate files in the View's recorded output location, with type, path, availability, and processing state where known. Files still being written remain pending.

**Do:** open Results for the View.

**Observe:** recognized intermediates remain separate from result candidates. A file appearing in the folder is not automatically accepted or proven to originate from the complete reviewed selection.

### H2. Attach an external output

**Do:** click **Attach Result** or drop a file saved elsewhere. Choose its kind and View association.

**See:** Final image, Linear integration, Channel product, Mosaic panel, or another explicit reusable kind.

**Observe:** manual association records User-linked lineage unless stronger tool evidence exists. Unknown lineage stays Unknown.

### H3. Accept products

**Do:** inspect the image and its association. Select one or multiple valuable outputs and click **Accept Result**.

**Observe:** accepted products appear on the View and linked Project/Target. They default to Keep during cleanup and can be selected as inputs to another View.

**Trust:** acceptance expresses the user's choice. It does not fabricate tool provenance or claim that processing used every planned frame.

### H3a. Use accepted products in another View

**Do:** select accepted linear/channel/panel products and click **Create View from results**. Enter a name such as `NGC7000 HOO combine`. Alternatively, use **Add accepted results** in an existing View's review workspace.

**See:** a result picker grouped by originating View, with kind, path, availability, and recorded lineage. Select the Ha and OIII products deliberately.

**Observe:** the new View records those product identities and their originating Views. Show product inputs separately from raw light sessions; session integration is not added a second time.

**Do:** choose a profile capable of handing those products to the external application. Review paths and membership. Prepare the View. Open the external application as in Journey F.

**Trust:** PlateVault does not combine channels or stitch panels itself. Raw-frame calibration controls do not imply recalibration of processed products. Mixed raw/product inputs need profile support; otherwise prepare separate Views. Reference drift requires review rather than silently replacing an accepted product.

### H4. Adopt generated calibration masters

**See:** detected candidate masters with an **Add to calibration library** action. Candidate and adopted masters are protected by default during cleanup.

**Do:** inspect type, camera/settings, channel, source evidence, and origin. Confirm adoption explicitly.

**Observe:** the master becomes a reusable calibration candidate with its actual provenance. Detection alone does not authorize automatic future reuse.

## Journey I: completion and selectable cleanup

**Goal:** finish the attempt and remove chosen prepared inputs or processing products without removing retained originals or valuable outputs.

### I1. Mark the attempt complete

**Do:** click **Mark processing complete**.

**Observe:** Complete records the finished attempt even if no Result was accepted. A separate **Clean up View** action is offered.

**Trust:** marking complete removes nothing. It does not infer that an external processing job has stopped or succeeded.

### I2. Open cleanup

**Do:** click **Clean up View**.

**See:** groups with counts, sizes, proposed action, and **Inspect files**. Recognized regenerable groups are preselected:

- Calibrated intermediates.
- Registered/aligned intermediates.
- Other recognized processing intermediates, including applicable stacking/calibration XISF files.
- Temporary files and caches.

**See unselected:** prepared input links/copies/clones, verified duplicate candidates, logs, manifest, and unknown files.

**See protected:** accepted results and candidate/reusable masters in a separate **Keep** group. Bulk intermediate selection leaves them protected. Any removal requires a separate explicit selection with the affected products and dependent Views named in the cleanup review.

**Observe:** users can select/deselect a group or individual files. Defaults do not become permission to delete an entire directory.

### I3. Inspect and choose files

**Do:** expand **Registered intermediates** to inspect its recorded files. Deselect any needed for further work. Optionally select **Prepared inputs** or byte-verified duplicates.

**See:** affected path, role, other View/Project references, retained original/copy evidence, and estimated bytes. Link sizes are not treated as guaranteed reclaimed bytes.

**Trust:** original captures outside the View stay protected. Direct-source original subs are never cleanup candidates in any group. In direct-source mode, only processing outputs attributed to this View are eligible. Unknown files remain unselected.

### I4. Review cleanup

**Do:** click **Review cleanup**.

**See:** the exact selected entries and retained files. Default action is **Send to OS Trash**. Prepared-copy and hardlink-entry removal need verified retained originals; duplicate removal names the retained copy.

**See:** Trash support per location, including item counts that can move and counts that are blocked. An OS action that would delete immediately counts as unsupported Trash.

**Observe:** stale identities, insufficient retained-copy proof, unavailable sources, or ambiguous ownership stop the affected action.

**Trust:** send the selected link entry to Trash without following its target. A hardlink can hold the last remaining bytes, so retained-copy proof applies. Shared references, reusable products, and original sources are not silently deleted.

### I5. Send selected entries to Trash

**Do:** confirm **Send selected files to Trash**.

**See:** progress and per-item outcomes, followed by an exact completed or partial summary. The View records the remaining and removed prepared inputs/products.

**Observe:** unsupported Trash refuses the affected files. Choose **Keep files** or **Reveal location**; neither removes them. A permanent-delete fallback is unavailable.

**Recovery:** use the OS Trash/Recycle Bin to restore files when supported. PlateVault cannot guarantee restoration after external emptying of Trash.

## Journey J: verified archive transfer

**Goal:** move retained data to archive storage and rebuild affected View references in one reviewed transfer.

**Do:** select sessions or retained data in Storage and click **Archive**. Choose an archive destination.

**See:** destination paths, bytes, source identities, affected Views, and proposed reference updates. Session membership and View exclusions remain fixed.

**See:** the intended destination volume identity, free space, and writability before transfer. A different mounted volume at the same path is a conflict.

**See:** each affected View's current and proposed reference mode. A cross-volume hardlink cannot be rebuilt as a hardlink. Choose a supported reference mode or retain that local copy with its unreclaimed bytes; never approve an implicit conversion.

**Do:** click **Review transfer**, inspect the source/destination and rebuilt-link effects, then approve the transfer.

**Observe:** PlateVault copies the data, durably writes it, then re-reads destination bytes to compare hashes with the source snapshot. Source retirement waits for destination and reference verification. Affected linked View entries are rebuilt within the approved transfer; each reference reports completed, blocked, or uncertain.

**See:** direct-source/configuration paths affected by the move and their update or blocked status. Source retirement cannot precede verified affected-reference handling. Destination verification proves equality with the source snapshot at transfer time, not that earlier external writes never changed it.

**Trust:** an unplugged archive or verification error never becomes permission to remove the source. Hardlink references may retain storage blocks, so expected and observed reclaim remain distinct.

**Observe:** unplugging the archive later preserves captured/usable totals and membership but shows archived inputs Offline. Preparing or opening a View that depends on them refuses unavailable inputs rather than omitting them. Reconnect the archive or review another verified location.

**Recovery branch:** after interruption, the user sees destination-verified, source-retained, reference-updated, and pending work. Retry resumes recorded work without guessing from filename presence alone.

**Open sequencing detail:** failure during reference rebuilding must not silently strand a View. The precise rollback versus pause/source-retention policy needs an implementation contract before this journey becomes executable.

## Journey K: observing plans and reminders

**Goal:** know when a planned Target has a suitable observing window at the default site.

**Do:** open a Target's Plan area. Choose a planning site to inspect windows. Set altitude, darkness, Moon, and minimum-duration criteria.

**See:** calculated windows with site and time-zone basis. Project checklist gaps remain visible beside relevant coverage.

**See:** the active planning site on the window list and the default reminder site beside **Enable notifications**. Every reminder names its site.

**Do:** mark the Target **Planned** and enable notifications explicitly. Configure the default site in Settings if absent.

**Observe:** initial notifications use the default site. Planning at another site does not automatically enable notifications there. The opt-in background reminder function is separate from bulk indexing or processing.

**Calendar:** click **Export calendar**. Confirm the displayed planning site, date range, time zone, and selected windows. Save the `.ics` file with the native save dialog. Export is a one-time snapshot; changed windows need another export.

**Trust:** suitability is astronomical. It does not promise clear weather, telescope availability, or processing readiness.

**Deferred:** automatic Google Calendar/Outlook event sync is a nice-to-have. No provider account, calendar authorization, or hosted subscription is required by this flow.

## Journey L: optional reviewed filing

**Goal:** organize selected indexed captures into a managed library location without making filing part of onboarding.

**Do:** select sessions in Sessions and click **File into library**. Choose a configured destination and inspect the proposed layout.

**See:** source and destination paths, file counts, collisions, transfer footprint, and affected View references. Files already indexed are named as such.

**Do:** click **Review filing**. Approve only the displayed file operations and reference changes. A colliding destination requires another path or a revised plan.

**Observe:** indexing alone has moved nothing. Filing reports item progress and final outcomes. Cross-volume moves use verified transfer; failed verification preserves the source. Changed references follow the reviewed rules in Journey J.

**Trust:** filing never overwrites unrelated files, merges metadata-homogeneous sessions, or changes View membership. Keep index-in-place when no physical organization is needed.


## Cross-flow state and safety contract

| Situation | Required observation and recovery |
|---|---|
| Unsaved catalog write fails | The edited value remains visibly unsaved/error; Retry is available; never show Saved |
| Location offline | Retain last-observed metadata; reconnect or choose another verified location |
| Partial scan | Name incomplete scope; do not infer missing files under unreadable paths |
| Missing OBJECT | Geometry matching and manual selection remain available |
| Missing geometry | Show Unknown; allow manual session selection without invented distance/overlap |
| Measurement pending/failed | Keep preview and selection state; display pending/error rather than a score |
| Selection hidden by filters | Show hidden selected count; preserve selection across sort and paging |
| Calibration mismatch | Explain criteria; choose another input, exclude, defer, or record an explicit scoped exception |
| Unsupported input mode | Offer supported alternatives and footprint before preparation |
| Destination collision | Preserve existing unrelated entries; choose another path or revise the reviewed action |
| Direct-source exclusion unsupported by tool | Refuse misleading handoff; offer a supported list/configuration or prepared mode |
| Partial preparation | Name prepared and blocked inputs; success/launch cannot imply complete verification |
| External changes | Show drift/conflict before overwriting app-written entries or using stale identity evidence |
| Completion with no Result | Record Complete; keep result acceptance and cleanup independent |
| Cleanup/Trash failure | Preserve refused files and report partial outcomes; never escalate to permanent deletion |
| Archive interruption | Keep verified destination/source/reference phases explicit; uncertain state does not justify source retirement |

## Feature comparison with the audited application

Baseline status records source traces. Full runtime verification remains incomplete. Detailed locations and limitations remain in the engineering review.

| Capability | Baseline status | Agreed flow |
|---|---|---|
| Indexing, location availability, classification | Implemented | Keep index-in-place; simplify first use; optional reviewed filing |
| Metadata-based sessions | Implemented | Keep session identity; expose multi-session filtering/sorting and selection |
| Target association and geometry helpers | Implemented | Use geometry/FOV and evidence; OBJECT stays a label/filter |
| Session proximity picker | Not established in production | Add geometry-based suggestions/preselection and linked sky coverage |
| Projects and source views | Implemented | Optional goals; standalone Views; saved criteria, explicit refresh, flexible paths |
| Pixel preview and star/PSF measurements | Not established in production | Add native review analysis and optional imports; keep header readers lightweight |
| Calibration matching and assignments | Implemented | Preselect compatible raw/master inputs; review exceptions; adopt outputs explicitly |
| External application launch/profiles | Implemented, with documented layout fallbacks | Verified preparation/configuration for named applications; generic Open in... |
| Accepted results | Placeholder/gap; artifact observation implemented | Accept final and reusable products; retain actual lineage |
| Cleanup/archive/restore | Implemented | Selectable View-scoped cleanup to OS Trash; verified transfer with View-reference repair |
| Planning | Implemented | Target-anchored checklist/context, site chooser, default-site opt-in reminders, calendar export |
| Third-party plugin integrations | Deferred proposal | Built-in profiles initially; plugin system is future work |

## Deferred capabilities

- Automatic blink-style playback/comparison.
- Video workflows and video-specific coverage.
- Automatic filing/destructive-operation grants or a general automation engine.
- Third-party executable integration plugins.
- AstroWizard-specific preparation integration.
- Direct Google Calendar/Outlook event sync and unresolved live-subscription hosting.
- Multiple active notification sites; initial reminders use the default site only.

## Open decisions and readiness

These proposed journeys specify user actions and refusal behavior. They have not been validated against a running implementation.

1. **Geometry and standalone defaults (product decision):** set overlap/coverage/radius defaults and unknown-orientation handling. Define equipment/framing preselection for Views without a Project or Target context.
2. **Unreviewed membership (settled by D02):** available Unreviewed/Usable frames enter the draft, library-Unusable frames start visibly excluded, and unavailable members remain unresolved. Bulk Usable is explicit; worked totals have confirmed membership. Implementation and runtime evidence remain required.
3. **Raw/CFA measurement support (engineering contract):** define channel/sample/model semantics and imported-metric identity matching before treating results as comparable.
4. **Profile and input-mode support (engineering contract):** verify each application's exact membership handoff and result-input capabilities. Define whether a View supports mixed per-item modes; every affected item and mode change must be reviewed.
5. **Generated master storage (product decision):** choose copy, transfer, or in-place registration when adopting a master. Adoption must not leave reusable data disposable with a processing folder.
6. **Archive failure sequencing (engineering contract):** define rollback versus pause/source-retention when reference updates fail. Preserve verified data and fixed membership; cross-volume mode conversion needs approval.
7. **Reminders (product defaults and engineering contract):** set window horizon, Moon conditions, lead time, and repeat suppression. Specify sleep/app-closed behavior and permission-denial recovery.
8. **Draft ownership (engineering contract):** define autosave or explicit Save draft, restart recovery, and concurrent edits for the review workspace.
9. **View lifecycle (product decision and engineering contract):** define manual-inclusion pins, revision folders, partial-preparation retry/resume, completion blockers, reopening, and editing after Complete. Existing entries are removed only under the cleanup rules.
10. **Quality scope (product decision):** define Project rejection's effect on progress, frame-state precedence, and aggregate filter thresholds. A changed quality decision must not silently alter fixed View membership.

Readiness check: user actions and expected outcomes are stated; negative assertions guard file changes and quality-scope changes. Existing product code and source verification do not establish that these redesigned flows run. Formal journey conversion and independent running-product validation follow implementation and intent approval.
