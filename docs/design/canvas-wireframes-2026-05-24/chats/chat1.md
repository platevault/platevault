# Astro Library Manager Wireframes

_Started 2026-05-24 07:49 UTC_

---

## User

we are creating a wireframe for each orf the appliication pages of a desktop application called "astro library manager", built using tauri on rust and base-ui on react.

The attachned design-prompt is a prompt from the agtent that wrote the initial specs

Keep in mind that the product should be data driven and provide for efficient workflows. It should be focused on imaging sessions and projects primarily, not on managing or editing individual fits files or images.

## Assistant

_[tool: read_file]_

_[tool: questions_v2]_

Reading the prompt now. Before I commit to a direction, a few quick questions to scope this right — the spec is dense and I want to make sure the wireframes land where you need them.

## User

Questions answered:
- coverage: Broad coverage + 2-3 variations of the highest-stakes pages (project detail, plan review)
- pages: First-run / setup (register roots), Library inventory / scan results, Review queue (classifications), Acquisition sessions list + detail, Calibration sessions + matching, Targets list + detail, Projects list + detail, Source view preparation, Filesystem plan review (the safety mechanism), Processing artifacts / outputs, Cleanup tree configuration, Audit log, Settings, Root recovery / reconnect
- nav_pattern: Explore a few different nav patterns across the wireframes
- density: give me a sample of all 3
- style: Mid-fi grayscale — real type, no decoration, but actual table rows + realistic data
- variations_focus: Information architecture (where things live), How filesystem plans are reviewed (table vs. diff vs. tree), How confidence/provenance is surfaced inline, How source mapping is presented in projects, List vs. board vs. timeline layouts for sessions
- tweaks: Toggle annotations on/off (designer notes on the wireframe), Toggle sketchy vs. clean rendering, Cycle nav pattern variants, Toggle density (compact / comfortable)

## Assistant

_[tool: update_todos]_

_[tool: copy_starter_component]_

_[tool: copy_starter_component]_

Got it. Plan locked in:

- Mid-fi grayscale, realistic data tables, no decoration
- 17 core wireframes covering everything you picked
- Variations on project detail (3), plan review (3), session list (list/board/timeline)
- Density study showing the same screen in 3 densities
- Tweaks: annotations, sketchy/clean, density, nav pattern cycle
- Different nav patterns demoed across different wireframes

Let me get the scaffolding in place.

_[tool: read_file]_

_[tool: write_file]_

Now let me build the foundation. I'll set up the index, shell, and a primitives file.

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

Now the wireframes. I'll batch the setup, library, and review queue first.Now sessions (3 variations: list/board/timeline) and session detail.

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

Now the highest-stakes one: project detail with 3 distinct variations.Now source view prep + plan review (3 variations) + remaining wireframes.

_[tool: write_file]_

_[tool: write_file]_

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Need to fix a scope issue — `PROJ` is referenced in source-view and plan-review but defined in project-detail (Babel scripts don't share scope).Now artifacts, cleanup tree, audit, settings, root recovery, density study.

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

Now the wire-up — app.jsx assembles the canvas with sections and tweaks.

_[tool: write_file]_

_[tool: grep]_

_[tool: read_file]_

_[tool: str_replace_edit]_

Let me load it and check for issues.

_[tool: show_html]_

_[tool: done]_

_[tool: fork_verifier_agent]_

_[tool: update_todos]_

Wireframes are up. Quick tour:

**① Onboarding & inventory** — first-run setup, library inventory (sidebar nav), review queue (three-pane focus mode)
**② Sessions** — list / board / timeline, plus session detail with provenance summary
**③ Calibration & targets** — match matrix + masters table; target view with coverage bars
**④ Projects** — list, then 3 distinct project-detail directions:
- **A · Tabbed workbench** — table source map with role × source × reason
- **B · Command center** — single-page kit grid (lights/darks/flats/bias columns)
- **C · Pipeline** — sources → views → processing → outputs as horizontal flow
**⑤ Safety** — source view prep + 3 plan-review variations (table / tree / diff)
**⑥ Lifecycle** — artifacts (grouped by type), cleanup tree (with override nodes + permanent-delete callouts), audit log (includes `refused` outcomes)
**⑦ Settings & recovery** — settings shell, root remap with sample verification
**⑧ Density study** — same sessions table at compact / comfortable / spacious

**Tweaks panel** (bottom-right): toggle annotations, sketchy rendering, nav pattern (cycles across all frames), and density.

**Notable design moves baked in:**
- Provenance + confidence are *separate* signals from review state, always shown side-by-side
- Protected items appear in cleanup views (greyed, 🔒) rather than being hidden — proves they're safe
- Plan permanent-delete requires a *separate* explicit checkbox below the approve button
- "Refused" transitions are first-class audit rows (e.g. blocked confirms because `observer_location` not reviewed)
- Mid-fi grayscale only, no decorative color — danger/warn use tinted backgrounds with text labels

**Caveats / good next steps:**
- A few wireframes still use placeholder counts in inspector panels — easy to populate with real numbers once the data shapes settle
- I didn't variant the mosaic / per-panel source mapping — happy to add if mosaics are central
- The "blocked" project state has a row in the projects list but no dedicated recovery flow yet

Tell me which of the project-detail and plan-review directions feel closest to right and I'll deepen those.

## User

Verifier agent check completed

## Assistant

_[tool: read_file]_

_[tool: write_file]_

_[tool: done]_

_[tool: fork_verifier_agent]_

Fixed — the `AB` wrapper was masking `DCArtboard` from the canvas's child filter. Inlined every artboard so they render properly. Canvas should now show all 22 frames across 8 sections.

## User

the library inventory is showing files when we don't really care about individual files, we purely care about sessions/masters that we can link to a project in the structure that pixinsight/siril expects it.

The review queue should also be based on imaging sessions, not individual files.

I like the timeline but right now it doesn't feel that useful compared to just sorting by date.

Board doesnt feel that useful.

Can we also add some mockups of the list view with options to group by month/year/filter/target/optical train?
The 3 pane nav is nice for the review queue. For the menu i want the sidebar but make it collapsible.

Targets 3 pane nav is great

Sessioons can be used in multiple projects

For the calibration masters the matrix is a bit confusing i think. we just want to be able to see the masters and details on them as well as associate them to a project.

The "targets" coverage at a glance is great.

Project list is great.

Project detail - i think i prefer the command senter, however we should be consisent and use the sidebar. especially if it's collapsible. maybe allow the user to switch between pipeline and command center? also give me a mockup of a command center that shows both the source maps and a project pipeline.

The source view preparation strategy is i think a configuration/setting, not preparing a project? I think the source views should also be part of setting up a new project. show me the end to end wizard for preparing a new project including ingesting sources, masters, artifacts, etc.

For plan review, i like both the table and diff. make it toggleable.

CLeanup tree should be something in settings, not per project.

I want to see more examples of all settings pages, including naming & structure, how we build a view, how we handle renaming/moving/restructuring files from inbox to raw sources.

## Assistant

_[tool: grep]_

Big feedback batch. Let me check what you edited first, then make a plan.

_[tool: list_files]_

_[tool: snip]_

_[tool: update_todos]_

Let me start with the collapsible sidebar in shell.jsx.

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: write_file]_

Now rewriting Library inventory to be session/master-focused, not file-focused.Now session-based review queue.

_[tool: write_file]_

_[tool: str_replace_edit]_

_[tool: delete_file]_

You're right — it overlaps. My take: drop Library entirely. Sessions becomes the landing surface (it's where you actually work). The useful bits from Library either already exist elsewhere or are status-bar material:

- Recent additions → Sessions sorted by discovered-date
- Coverage by target → Targets page (already has it per-target)
- Calibration health → Calibration page
- Roots health → Settings · Data sources + the status bar

I'll remove the Library nav entry and wireframe. Sessions can grow a small stats strip if needed, but I think the existing toolbar counts (247 sessions · 183 confirmed · 42 needs review) already covers it.

_[tool: write_file]_

Now sessions — drop board, add group-by variants, smarter timeline, show multi-project use.

_[tool: write_file]_

Now calibration — drop the matrix, focus on masters with details and project association.

_[tool: write_file]_

Now project detail — drop tabbed-workbench variant, use sidebar everywhere, add view-toggle, build the new "combined source-map + pipeline" variant.Now the new-project wizard — end-to-end multi-step flow.

_[tool: write_file]_

Now plan-review (combined table+diff toggle) and remove old source-view + cleanup wireframes.

_[tool: write_file]_

## Assistant

_[tool: write_file]_

_[tool: delete_file]_

_[tool: write_file]_

Now settings — multiple pages: data sources, naming & structure, source view strategy, cleanup tree (global), and inbox migration.Now wire everything together — update index.html and app.jsx.

_[tool: str_replace_edit]_

_[tool: write_file]_

_[tool: done]_

_[tool: fork_verifier_agent]_

_[tool: update_todos]_

Big restructure done. Quick summary of what changed:

**Removed**
- Library page (overlapped with Sessions — Sessions is the landing surface now)
- Sessions board view (didn't pull its weight)
- Plan-review tree variant (kept table + diff as toggleable in one page)
- Per-project cleanup tree, per-project source-view-prep (moved to settings)

**Reworked**
- **Sidebar** is now collapsible (« / ») with icon-only mode
- **Review queue** is session-centric — walk through sessions that need review, not individual files. Three-pane layout
- **Sessions** has 5 variants of one list view: flat date-sorted, grouped by target, by month, by optical train, and a calendar view. New "Projects (re-used)" column shows the same session linked to multiple projects
- **Calibration** drops the matrix — three-pane: masters on left, fingerprint + project linkage on the right. Mirrors "session → which masters" from the master's side
- **Project detail**: sidebar nav everywhere, new view-toggle in the header switches between Command center / Pipeline / **Combined** (source map + pipeline together, with a visible "feeds into" connector)

**New**
- **Project creation wizard** — 6 steps (name → lights → calibration → source views → naming → review plan & create). Three artboards covering the most important steps. Source view strategy is preset from settings with a per-project override.
- **Settings** is now 5 distinct pages: Data sources · Naming & structure (token templates + project skeleton) · Source view strategy · Cleanup & archive policy (global tree) · Inbox → raw migration (the move-stuff-out-of-inbox flow with destination preview + plan generation)

**Plan review** is now one page with a Table/Diff toggle in the header.

Caveats:
- Wizard steps 1, 2, 5 not drawn — happy to add if useful, but they're conventional (name + profile picker; session picker; naming overrides)
- A few settings pages (ingestion, calibration matching rules, tool workflows, target catalogs, source protection, app log, appearance) still placeholder in the nav but not drawn — let me know which to flesh out next

## User

i like the project list and combined details.

For new project wizard, not sure why the lights are still in the calibration step, but we should have a mapping of flats per light source (separate filters for separate flats/filters.

Project names don't have a template as projects are just user created, they don't have specific details available yet. We need an ingestion pattern for inbox → sessions/calibration though. Thisd should use draggable tokens and separators the user can add, see screenshot for an example.

For cleanup & archive policy we need to be able to select what policy we take for each data when cleaning up. This also needs to depend on the type of process (PI, Siril, etc) has been selected.

We also need to have the user set a directeory where in the project they'll store their pixinishgt/siril data/processing directory as that'll determine what to clean up. This should be a default setting, not per project.

## Assistant

_[tool: str_replace_edit]_

Got it — three changes. Let me knock them out:

1. Wizard step 3: drop lights, add per-light flat mapping by filter
2. Naming settings: drag-token UI for inbox→inventory pattern (no project names)
3. Cleanup: per-data-type policy by processing tool, plus the processing-dir settingNow rewrite Naming settings as a token/separator builder, and Cleanup as per-data-type policy by processing tool.

_[tool: str_replace_edit]_

Now rewrite cleanup as per-data-type policy with processing-tool tabs + processing-dir setting.

_[tool: str_replace_edit]_

_[tool: done]_

_[tool: fork_verifier_agent]_

All three done:

- **Wizard step 3**: lights row gone; flats now mapped per filter (each light source's filter gets its own master-flat picker), with darks/bias/dark-flats grouped as "shared calibration"
- **Naming settings**: drag-token + separator builder, global pattern with live preview (`M101/Ha/2026-04-12/lights/`), per-frame-type override rows with enable toggles. Project-name template is gone — projects are user-named
- **Cleanup settings**:
  - New **Processing directory** section at the top — set the relative path per tool (PI / Siril / planetary) and a default output directory. This is what the app treats as cleanup-eligible
  - **Policy matrix** below — rows are data types, columns are processing tools (PixInsight / Siril / Planetary). Each cell shows the default action (keep / archive / trash / DELETE) per tool, with `—` for types the tool doesn't produce (e.g. Siril has no "local normalized", planetary has no "calibrated"). Shared categories (sources, masters, outputs, notes) collapse to a single locked column

## User

all directory fields should be directory selectors, not text fields across all mockups. the default should just be processing i think.

Not sure what the inbox → raw migration is actually for?

After you've changed this, please liberally annotate every decision on every screenshot so that we can send this to claude code to build. Write a DESIGN.MD that claude code should adhere to.

## Assistant

_[tool: list_files]_

Let me re-read what changed first.

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Got it. Three real changes:

1. Directory pickers everywhere (not text inputs)
2. Drop inbox-migration page — it overlaps with the review queue (files in inbox become session candidates there; if you want to physically move them after confirm, that's a session-level action, not a settings page)
3. Heavy annotations + DESIGN.md handoff

Let me add a DirectoryPicker primitive first.Now replace text-path inputs with DirPicker in settings (sources, cleanup, root recovery, setup) and drop inbox migration.

_[tool: str_replace_edit]_

Now update Data Sources to use DirPicker, remove inbox migration from settings nav, drop it from canvas.

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Now drop the inbox migration wireframe and update setup + root-recovery to use DirPicker. Then drop it from canvas.

_[tool: str_replace_edit]_

_[tool: grep]_

_[tool: read_file]_

_[tool: str_replace_edit]_

Now update setup, root recovery, and the project wizard to use DirPicker. Drop inbox migration from canvas. Then add annotations broadly.

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: write_file]_

Now the big piece: DESIGN.md as the authoritative handoff spec.

_[tool: run_script]_

Quick batch fix: my existing notes are positioned outside the artboard (negative x) so they're clipped. Let me reposition them all to be visible.

_[tool: done]_

_[tool: show_html]_

_[tool: save_screenshot]_

## User

i''m expecting much more annotation. every component in a page should have some annotations on the details and design choices made.

## User

please do that but also sticky notes with the details for specific components.

## User

please do that but also sticky notes with the details for specific components.

## Assistant

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Building it now. I'll do this efficiently: WfWrap with the DesignNotes band, restyle the existing `<Note>` component to look like real sticky notes, then wire dense notes into every wireframe.

_[tool: write_file]_

_[tool: str_replace_edit]_

Now wire WfWrap into app.jsx with each artboard's notes, and bump heights.

_[tool: write_file]_

_[tool: show_html]_

_[tool: get_webview_logs]_

_[tool: save_screenshot]_

_[tool: done]_

_[tool: str_replace_edit]_

Now I'll add inline sticky notes pointing at specific components on the most important wireframes. Starting with project detail combined, plan review, session detail, settings cleanup & naming, wizard step 3.

_[tool: grep]_

_[tool: read_file]_

_[tool: str_replace_edit]_

_[tool: grep]_

_[tool: str_replace_edit]_

_[tool: grep]_

_[tool: grep]_

_[tool: str_replace_edit]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: str_replace_edit]_

_[tool: grep]_

_[tool: read_file]_

_[tool: get_webview_logs]_

_[tool: screenshot_user_view]_

_[tool: eval_js_user_view]_

_[tool: eval_js_user_view]_

_[tool: eval_js_user_view]_

_[tool: eval_js_user_view]_

_[tool: eval_js_user_view]_

_[tool: write_file]_

Found it — I reintroduced the same bug the verifier caught originally. DCSection filters children by `c.type === DCArtboard`. My `Wf` wrapper hides them. Need to inline.

_[tool: done]_

_[tool: eval_js_user_view]_

Rendering — 25 artboards, 27 wireframe instances visible. The blank canvas was my regression from adding the `Wf` helper component. Fixed by inlining every `DCArtboard` directly inside `DCSection` (the canvas filters children strictly by component type).

Notes are now wired in via `<WfWrap>` *inside* each artboard, which is fine since the wrap is a child of the artboard, not a wrapper around it.

_[tool: fork_verifier_agent]_

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: screenshot_user_view]_

Fix verified — 25 artboards / 27 wireframes rendering. The canvas was blanked by my `Wf` helper component hiding `DCArtboard` from `DCSection`'s child filter. Inlined every artboard.

What's now in place for handoff:

- **`DESIGN.md`** — authoritative spec, 12 sections covering principles, IA, visual system, component primitives, per-page specs, behavior contracts, state shapes, implementation order, and hard nos
- **Yellow DesignNotes band** at the bottom of every artboard with 8-15 numbered design decisions
- **`wireframe-notes.jsx`** — the source of truth for all annotation arrays, easy to edit
- **Inline sticky notes** (yellow paper with numbered chips) anchored in the right gutter of several key wireframes
- **PinNum chips** (small numbered circles) inline next to specific UI elements on project-detail combined, plan-review, and session-detail
- **DirPicker** primitive replacing every directory text input
- **Processing directory default** = `processing/` across PI/Siril/planetary in cleanup settings
- Inbox migration page removed (inbox files appear in the review queue, not a separate flow)

Still tactical work to do:
- Inline sticky notes + PinNum chips only added to ~3 wireframes so far. The other 14 have the DesignNotes band but not yet pin chips inline. Tell me which 4-5 you most want fully pinned and I'll do those next.
- Some sticky notes overlap content because they're absolute-positioned. If you'd rather they sit in a dedicated right-side gutter outside the AppFrame, that's a layout change I can make.
