/**
 * The Project's View tab (VSEL-FR-12 to VSEL-FR-21, PREP-FR-01 to
 * PREP-FR-19): the View settings (the detected or added application,
 * Symlinks or Copies, the Processing location and the Project folder it
 * makes), Open in {app} and Reveal View, the applied View with its
 * footprint, the running Apply with its phase, the pending changes with
 * their source, and what `View (previous)/` still holds.
 *
 * Every change stays pending until Apply. Its sheet (slice C, a centred
 * FormDialog) lists, in order: what `View (previous)/` still holds for
 * review, the facts (application, mode, entries, footprint, space needed and
 * free), the changes with their source, the copies a tool changed, the
 * corrected values and how they reach the tool, the planned folder tree,
 * the files PlateVault didn't place (each ticked to keep), and the
 * application's notes. Apply stays unavailable while any refusal holds;
 * each refusal shows where it is resolved. A sheet that went stale is
 * refused on Apply and refreshes with the latest plan (provisional). A
 * Project discards only its own edits; a change from the Library or
 * calibration links to where it is fixed (D-W109).
 *
 * Provisional copy, labelled so on screen: the layout-change note, the
 * application notes (WBPP keywords, Siril sets, SASpro passes), the
 * per-night copy, Use copies for this Project, and the reviewed Move to
 * Trash of `View (previous)/`.
 */
import { CopyCheck, Eye, FolderOpen, Pencil, Trash2, Undo2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { DeveloperModeActions } from "@/app/developer-mode"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import { BoxTable } from "@/components/app/box"
import type { Action, Blocker, Column, MenuItem } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { DataTable } from "@/components/app/data-table"
import { Notice, toast } from "@/components/app/feedback"
import { PathField, SelectField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { useFollowLink } from "@/components/app/links"
import { OperationPanel } from "@/components/app/operation-panel"
import { Section } from "@/components/app/page"
import { Pill } from "@/components/app/pill"
import { ViewFolderTree } from "@/components/domain/view-folder-tree"
import type { DetailSection } from "@/components/templates/detail-page"
import { CHOICE_STATE_NAME, KIND_NAME, NO_KIND_NAME, sourceRef } from "@/domain/calibration"
import { isLocked, isMosaic, type StepLink } from "@/domain/derive"
import { filesUnder, freeBytes, volumeForPath } from "@/domain/disk"
import { MODE_NAME, orderedProfiles, profileRef } from "@/domain/labels"
import { sessionLongRef } from "@/domain/membership"
import {
  type ApplyPlan,
  type ApplyRefusal,
  applyPlan,
  applyRefusalRef,
  CHANGE_SOURCE_NAME,
  clonesCopy,
  entryVerified,
  groupKeywords,
  isDiscardable,
  type PendingChange,
  pendingChanges,
  projectApplication,
  projectOperation,
  projectPaths,
  SIRIL_TOOL,
  type SirilSet,
  toolFolder,
} from "@/domain/project-view"
import type { ApplicationKind, CalibrationChoice, Catalog, CorrectionField, Disk, InputMode, PinKind, PreviousLeftover, Project, ProjectId, ViewEntry } from "@/domain/types"
import { fileName, formatBytes, formatCount, formatDateTime } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { type ApplyPhase, type ApplySheet, applyPhase, discardChanges, reviewLeftover, startApply } from "@/store/actions/project-view"
import { setProjectSettings } from "@/store/actions/projects"
import { type CommitResult, type PrototypeState, store, updateSlice, useStore } from "@/store/core"

// ---------------------------------------------------------------------------
// The Apply sheet in slice C
// ---------------------------------------------------------------------------

/** Open the Apply sheet on the plan as it stands now (slice C); Apply refuses it once anything changes. */
export function openApplySheet(projectId: ProjectId) {
  const state = store.getState()
  const project = state.catalog.projects[projectId]
  if (!project) return
  const { fingerprint } = applyPlan(state, project)
  const ticked = state.slices.c.apply[projectId]?.tickedUnplaced ?? []
  updateSlice("c", (c) => ({ ...c, apply: { ...c.apply, [projectId]: { fingerprint, tickedUnplaced: ticked } } }))
}

function closeApplySheet(projectId: ProjectId) {
  updateSlice("c", (c) => {
    const { [projectId]: _, ...rest } = c.apply
    return { ...c, apply: rest }
  })
}

/**
 * The page header's Apply…. The sheet and a running Apply return focus to it (WCAG 2.4.3): Apply… on another tab opens
 * the sheet on this one, so the button that opened it is gone, and a settled Apply takes its section and Cancel away.
 */
function applyTrigger(): HTMLElement | null {
  return document.querySelector<HTMLElement>('header[data-chrome] [data-action="apply"]')
}

function setTicked(projectId: ProjectId, sheet: ApplySheet, ticked: readonly string[]) {
  updateSlice("c", (c) => ({ ...c, apply: { ...c.apply, [projectId]: { ...sheet, tickedUnplaced: [...ticked] } } }))
}

// ---------------------------------------------------------------------------
// Footprint (PREP-FR-04, PREP-AC-25; astro-plan-9onxj)
// ---------------------------------------------------------------------------

/** What a set of View entries holds: links count 0 B; every copy counts its full logical size, lights and calibration alike. */
export interface Footprint {
  lights: number
  calibration: number
  links: number
  copies: number
  /** Copies written as clones (same local volume as their original); their logical size still counts. */
  cloned: number
  bytes: number
}

interface FootprintItem {
  role: ViewEntry["role"]
  copy: boolean
  /** A plain copy can be a clone; an isolated patched copy holds new bytes. */
  plain: boolean
  originalPath: string
  sizeBytes: number
}

/** The footprint of View entries placed under `folder`. */
export function footprintOf(disk: Disk, folder: string, items: readonly FootprintItem[]): Footprint {
  const out: Footprint = { lights: 0, calibration: 0, links: 0, copies: 0, cloned: 0, bytes: 0 }
  for (const item of items) {
    if (item.role === "light") out.lights += 1
    else out.calibration += 1
    if (!item.copy) {
      out.links += 1
      continue
    }
    out.copies += 1
    out.bytes += item.sizeBytes
    if (item.plain && clonesCopy(disk, item.originalPath, folder)) out.cloned += 1
  }
  return out
}

/** The applied View's footprint, from what Apply placed. */
export function appliedFootprint(disk: Disk, entries: readonly ViewEntry[], folder: string): Footprint {
  return footprintOf(
    disk,
    folder,
    entries.map((e) => ({ role: e.role, copy: e.copySha256 !== null, plain: e.copySha256 === e.sha256, originalPath: e.originalPath, sizeBytes: e.sizeBytes })),
  )
}

/** The planned View's footprint, as the next Apply would build it. */
export function plannedFootprint(disk: Disk, plan: Pick<ApplyPlan, "plan" | "mode" | "paths">): Footprint {
  return footprintOf(
    disk,
    plan.paths?.view ?? "",
    plan.plan.entries.map((e) => ({ role: e.role, copy: plan.mode === "copy" || e.patches.length > 0, plain: e.patches.length === 0, originalPath: e.originalPath, sizeBytes: e.sizeBytes })),
  )
}

/** "Linked · 0 B", "18 frames copied · 3.4 GB (cloned)", or both parts when Symlinks carries isolated patched copies. */
export function footprintText(m: Messages, fp: Footprint): string {
  const linked = fp.links > 0 ? m.view_footprint_linked({ count: fp.links, n: formatCount(fp.links) }) : null
  if (fp.copies === 0) return m.view_footprint_links_only()
  const cloned = fp.cloned === 0 ? "" : fp.cloned === fp.copies ? ` ${m.view_footprint_cloned()}` : ` ${m.view_footprint_some_cloned({ count: fp.cloned, n: formatCount(fp.cloned) })}`
  const copied = `${m.view_footprint_copied({ count: fp.copies, n: formatCount(fp.copies) })} · ${formatBytes(fp.bytes)}${cloned}`
  return linked ? `${linked} · ${copied}` : copied
}

function entriesText(m: Messages, fp: Footprint): string {
  return m.view_entries_split({ lights: formatCount(fp.lights), calibration: formatCount(fp.calibration) })
}

/** Free space on the volume holding `path`, and that volume's name; null while it is not mounted. */
function freeOn(disk: Disk, path: string | null): { bytes: number; volume: string } | null {
  const volumeId = path ? volumeForPath(disk, path) : null
  const volume = volumeId ? disk.volumes[volumeId] : undefined
  return volumeId && volume?.mounted ? { bytes: freeBytes(disk, volumeId), volume: volume.name } : null
}

// ---------------------------------------------------------------------------
// Open in {app} (PREP-FR-10)
// ---------------------------------------------------------------------------

/** Why Open in {app} is refused now: no application, one not located, no View, its volume offline, or an entry that no longer matches its Apply snapshot. Null when it can open. */
export function openRefusal(m: Messages, state: Pick<PrototypeState, "catalog" | "disk">, project: Project): string | null {
  const profile = project.settings.profileId ? state.catalog.profiles[project.settings.profileId] : undefined
  if (!profile) return m.view_open_no_application()
  if (profile.executableState === "launch-fails") return m.view_open_launch_fails({ name: profile.name })
  if (profile.executableState !== "found") return m.view_open_not_located({ name: profile.name })
  const view = project.view
  if (!view) return m.project_view_not_built()
  if (!freeOn(state.disk, view.folderPath)) return m.view_offline()
  const changed = view.entries.filter((e) => !entryVerified(state.disk, view.folderPath, e)).length
  return changed > 0 ? m.view_open_entries_changed({ count: changed, n: formatCount(changed) }) : null
}

function blocked(m: Messages, label: string, reason: string | null): Action["unavailable"] {
  return reason ? { action: m.actions_blocked({ action: label }), reason, blockers: [] } : undefined
}

// ---------------------------------------------------------------------------
// Application notes (PREP-FR-17, PREP-AC-29/30/37/38; provisional)
// ---------------------------------------------------------------------------

/** What the user sets in their tool for this View, from its layout; every note is provisional and unqualified. */
export function toolNotes(m: Messages, application: ApplicationKind | null, appName: string, plan: Pick<ApplyPlan, "plan" | "siril">, groupKeyword: string): string[] {
  const { layout, entries } = plan.plan
  const mixedVersions = entries.some((e) => (e.role === "dark" || e.role === "bias") && /(^|\/)NIGHT_/.test(e.path))
  if (application === "pixinsight-wbpp")
    return [
      m.view_note_add_view({ name: "WBPP" }),
      m.view_note_wbpp_pre({ keyword: "NIGHT" }),
      ...(layout.gain ? [m.view_note_wbpp_pre({ keyword: "GAIN" })] : []),
      ...(layout.offset ? [m.view_note_wbpp_pre({ keyword: "OFFSET" })] : []),
      ...(layout.groupLevel ? [m.view_note_wbpp_group({ keyword: groupKeyword }), m.view_note_wbpp_reference({ keyword: groupKeyword })] : []),
      m.view_note_wbpp_output({ path: "Processing/WBPP/" }),
    ]
  if (application === "siril") return [m.view_note_siril_sets({ count: plan.siril?.length ?? 0, n: formatCount(plan.siril?.length ?? 0) }), m.view_note_siril_links()]
  if (application === "seti-astro") return [m.view_note_add_view({ name: appName }), ...(mixedVersions ? [m.view_note_saspro_two_passes()] : [])]
  return appName ? [m.view_note_add_view({ name: appName })] : []
}

function sirilCounts(m: Messages, set: SirilSet): string {
  const count = (folder: SirilSet["links"][number]["folder"]) => formatCount(set.links.filter((l) => l.folder === folder).length)
  return m.view_siril_set_counts({ lights: count("lights"), flats: count("flats"), darks: count("darks"), biases: count("biases") })
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

function choiceWord(m: Messages, catalog: Catalog, disk: Disk, kind: PinKind, choice: CalibrationChoice): string {
  if (choice.state === "pinned") return say(m, sourceRef(catalog, disk, choice.source))
  if (choice.state === "none") return say(m, NO_KIND_NAME[kind])
  return say(m, CHOICE_STATE_NAME[choice.state])
}

/** The from and to of a change whose label does not carry them. */
function changeDetail(m: Messages, catalog: Catalog, disk: Disk, change: PendingChange): string {
  return change.kind === "calibration-changed" ? `${choiceWord(m, catalog, disk, change.pinKind, change.from)} → ${choiceWord(m, catalog, disk, change.pinKind, change.to)}` : "–"
}

function fieldName(m: Messages, field: CorrectionField): string {
  const name: Record<CorrectionField, () => string> = { target: m.run_field_target, equipment: m.run_field_equipment, filter: m.run_field_filter, exposure: m.run_field_exposure, "focal-length": m.run_field_focal_length }
  return name[field]()
}

function leftoverReason(m: Messages, leftover: PreviousLeftover): string {
  if (leftover.kept) return m.status_keep()
  return leftover.reason === "changed-copy" ? m.project_previous_changed() : leftover.reason === "unverified-copy" ? m.project_previous_unverified() : m.project_previous_unplaced()
}

const PHASE_TEXT: Record<Exclude<ApplyPhase, "waiting">, (m: Messages) => string> = {
  building: (m) => m.view_phase_building(),
  verifying: (m) => m.view_phase_verifying(),
  swapping: (m) => m.view_phase_swapping(),
}

/** Keep, Move into View and a reviewed Move to Trash for one file in `View (previous)/` (D-W110). */
function leftoverActions(m: Messages, project: Project, leftover: PreviousLeftover): MenuItem[] {
  if (isLocked(project)) return []
  const name = fileName(leftover.path)
  const trash: Action = {
    id: "trash",
    label: m.common_move_to_trash(),
    icon: Trash2,
    kind: "destructive",
    confirm: { title: m.common_trash_named_title({ name }), summary: `${formatBytes(leftover.sizeBytes)} · ${m.view_previous_trash_provisional()}`, confirm: { label: m.common_move_to_trash(), kind: "destructive" } },
    run: () => reviewLeftover(project.id, leftover.path, "trash"),
  }
  return [
    ...(leftover.kept ? [] : [{ id: "keep", label: m.status_keep(), icon: CopyCheck, run: () => reviewLeftover(project.id, leftover.path, "keep") }]),
    { id: "move", label: m.project_previous_move(), icon: FolderOpen, run: () => reviewLeftover(project.id, leftover.path, "move") },
    trash,
  ]
}

function LeftoverTable({ project, leftovers, label }: { project: Project; leftovers: PreviousLeftover[]; label: string }) {
  const m = useMessages()
  const columns: Column<PreviousLeftover>[] = [
    { id: "file", header: m.dialog_col_file(), cell: (l) => l.path, sortValue: (l) => l.path, rowHeader: true, truncate: true },
    { id: "reason", header: m.dialog_col_status(), cell: (l) => leftoverReason(m, l), sortValue: (l) => leftoverReason(m, l), truncate: true },
    { id: "size", header: m.dialog_col_size(), cell: (l) => formatBytes(l.sizeBytes), sortValue: (l) => l.sizeBytes, align: "right" },
  ]
  return <BoxTable label={label} rows={leftovers} columns={columns} getRowId={(l) => l.path} rowLabel={(l) => l.path} rowActions={(l) => leftoverActions(m, project, l)} empty={m.view_previous_empty()} />
}

// ---------------------------------------------------------------------------
// View settings
// ---------------------------------------------------------------------------

/** The tool folder the Project's application works in: `Processing/WBPP/`, `Processing/Siril/`, or one named after an added application. */
function toolFolderName(catalog: Catalog, project: Project): string | null {
  const tool = project.settings.profileId ? catalog.profiles[project.settings.profileId] : undefined
  return tool?.application === "siril" ? SIRIL_TOOL : tool?.application === "pixinsight-wbpp" ? "WBPP" : (tool?.name ?? null)
}

/** The View settings as they stand, and the Project folder they make: `View/`, the tool's `Processing/<Tool>/` and `Output/` (J24 S6, S7). */
function ViewSettingsSummary({ project }: { project: Project }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const paths = useStore((s) => projectPaths(s, project))
  // Before the first Apply the Project folder is proposed; one that already holds files is named, not adopted (S4).
  const holdsFiles = useStore((s) => Boolean(paths && !project.folderPath && filesUnder(s.disk, paths.root).length > 0))
  const { settings } = project
  const profile = settings.profileId ? catalog.profiles[settings.profileId] : undefined
  const toolName = toolFolderName(catalog, project)
  return (
    <KeyValueList
      items={[
        { label: m.apps_col_application(), value: profile ? say(m, profileRef(profile)) : m.project_view_no_application() },
        { label: m.project_view_mode(), value: `${say(m, MODE_NAME[settings.mode])} · ${settings.mode === "symlink" ? m.view_mode_symlink_hint() : m.view_mode_copy_hint()}` },
        ...(paths
          ? [
              { label: m.view_project_folder(), value: project.folderPath ? paths.root : holdsFiles ? m.view_folder_exists({ path: paths.root }) : m.view_folder_new({ path: paths.root }), mono: true },
              { label: m.view_layout_view(), value: paths.view, mono: true },
              ...(toolName ? [{ label: m.view_layout_tool({ name: toolName }), value: toolFolder(paths, toolName), mono: true }] : []),
              { label: m.view_layout_output(), value: paths.output, mono: true },
            ]
          : [{ label: m.project_view_location(), value: m.apply_refused_no_folder() }]),
      ]}
    />
  )
}

/** Edit View settings…: the detected or added application, Symlinks or Copies, and the Processing location; each reaches the View on the next Apply. */
function ViewSettingsDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const { settings } = project
  const [profileId, setProfileId] = useState(settings.profileId ?? "")
  const [mode, setMode] = useState<InputMode>(settings.mode)
  const [parent, setParent] = useState(settings.processingParent)
  // Detected or added applications only (PREP-AC-24): one PlateVault found or the user located, and the Project's own choice.
  const profiles = orderedProfiles(catalog).filter((p) => p.executableState === "found" || p.executableState === "launch-fails" || p.id === settings.profileId)
  const profileOptions = [...(settings.profileId ? [] : [{ value: "", label: m.project_view_no_application(), disabled: true }]), ...profiles.map((p) => ({ value: p.id, label: say(m, profileRef(p)) }))]
  const modes: InputMode[] = ["symlink", "copy"]
  const save = (): CommitResult =>
    setProjectSettings(project.id, {
      ...(profileId && profileId !== settings.profileId ? { profileId } : {}),
      ...(mode !== settings.mode ? { mode } : {}),
      ...(parent !== settings.processingParent && !project.folderPath ? { processingParent: parent } : {}),
    })
  return (
    <FormDialog open onOpenChange={(next) => !next && onClose()} title={m.project_view_settings()} size="md" confirm={{ id: "view-settings-save", label: m.settings_save(), kind: "primary", run: save }}>
      <SelectField label={m.apps_col_application()} value={profileId} options={profileOptions} description={profiles.length === 0 ? m.view_no_applications() : undefined} onChange={setProfileId} />
      <SelectField
        label={m.project_view_mode()}
        value={mode}
        options={modes.map((value) => ({ value, label: say(m, MODE_NAME[value]) }))}
        description={mode === "symlink" ? m.view_mode_symlink_hint() : m.view_mode_copy_hint()}
        onChange={setMode}
      />
      <PathField
        mode="folder"
        label={m.project_view_location()}
        value={project.folderPath ?? parent}
        disabled={project.folderPath !== null}
        description={project.folderPath ? m.project_view_location_fixed() : undefined}
        onChange={setParent}
      />
    </FormDialog>
  )
}

// ---------------------------------------------------------------------------
// The Apply sheet (VSEL-FR-14, PREP-FR-08)
// ---------------------------------------------------------------------------

/** The Apply sheet, while slice C holds one open for the Project. */
function ApplySheetHost({ project }: { project: Project }) {
  const sheet = useStore((s) => s.slices.c.apply[project.id])
  return sheet ? <ApplySheetDialog project={project} sheet={sheet} /> : null
}

const sessionLink = (sessionId: string): StepLink => ({ to: "/sessions/$sessionId", params: { sessionId } })

/** Each refusal as a blocker, linked to where it is resolved. */
function refusalBlockers(m: Messages, refusal: ApplyRefusal, project: Project): Blocker[] {
  switch (refusal.kind) {
    case "unsettled":
      return refusal.sessions.map((s) => ({ label: m.view_blocker_unsettled({ name: say(m, sessionLongRef(s)) }), link: sessionLink(s.id) }))
    case "pin-drift":
      return refusal.problems.map((p) => ({ label: m.view_blocker_reassign({ kind: say(m, KIND_NAME[p.kind]), name: say(m, sessionLongRef(p.session)) }), link: sessionLink(p.session.id) }))
    case "offline":
      return refusal.paths.map((path) => ({ label: path, link: { to: "/settings/locations" } }))
    case "no-inputs":
      return [{ label: say(m, applyRefusalRef(refusal)), link: { to: "/projects/$projectId", params: { projectId: project.id } } }]
    default:
      return [{ label: say(m, applyRefusalRef(refusal)) }]
  }
}

/** The plan the sheet opened on, what to review first, and Apply. */
function ApplySheetDialog({ project, sheet }: { project: Project; sheet: ApplySheet }) {
  const m = useMessages()
  const follow = useFollowLink()
  const state = useStore((s) => s)
  const plan = applyPlan(state, project)
  const label = m.project_apply()
  const stale = plan.fingerprint !== sheet.fingerprint
  const refusals = plan.refusals
  const blockers = refusals.flatMap((r) => refusalBlockers(m, r, project))
  const footprint = plannedFootprint(state.disk, plan)
  const free = freeOn(state.disk, plan.paths?.root ?? null)
  const application = projectApplication(state.catalog, project)
  const profile = project.settings.profileId ? state.catalog.profiles[project.settings.profileId] : undefined
  const keywords = groupKeywords(state, project)
  const notes = toolNotes(m, application, profile?.name ?? "", plan, isMosaic(project) ? keywords.panel : keywords.group)
  const leftovers = (project.previous?.leftovers ?? []).filter((l) => !l.kept)
  const offline = refusals.find((r) => r.kind === "offline")
  const drift = refusals.find((r) => r.kind === "pin-drift")
  const developer = refusals.some((r) => r.kind === "developer-mode")
  const noLinks = refusals.find((r) => r.kind === "no-symlinks")
  const space = plan.space.twoViews && !plan.first ? m.project_apply_space_two_views({ size: formatBytes(plan.space.neededBytes) }) : formatBytes(plan.space.neededBytes)

  const facts = [
    { label: m.apps_col_application(), value: profile ? say(m, profileRef(profile)) : m.project_view_no_application() },
    { label: m.project_view_mode(), value: say(m, MODE_NAME[plan.mode]) },
    { label: m.dialog_changes(), value: plan.first ? m.project_apply_first() : formatCount(plan.changes.length) },
    { label: m.view_entries(), value: entriesText(m, footprint) },
    { label: m.view_footprint(), value: footprintText(m, footprint) },
    { label: m.project_apply_space(), value: space },
    { label: m.run_check_space(), value: free ? m.view_free_on({ size: formatBytes(free.bytes), volume: free.volume }) : m.view_offline() },
  ]
  const changeColumns: Column<PendingChange>[] = [
    { id: "change", header: m.dialog_changes(), cell: (c) => say(m, c.label), sortValue: (c) => say(m, c.label), rowHeader: true, truncate: true },
    { id: "detail", header: m.wrapup_col_detail(), cell: (c) => changeDetail(m, state.catalog, state.disk, c), sortValue: (c) => changeDetail(m, state.catalog, state.disk, c), truncate: true },
    { id: "source", header: m.project_change_source(), cell: (c) => say(m, CHANGE_SOURCE_NAME[c.source]), sortValue: (c) => c.source },
  ]
  type Unplaced = { path: string; sizeBytes: number }
  const unplacedColumns: Column<Unplaced>[] = [
    { id: "file", header: m.dialog_col_file(), cell: (f) => f.path, sortValue: (f) => f.path, rowHeader: true, truncate: true },
    { id: "size", header: m.dialog_col_size(), cell: (f) => formatBytes(f.sizeBytes), sortValue: (f) => f.sizeBytes, align: "right" },
  ]
  type Changed = ApplyPlan["drift"]["changed"][number]
  const changedColumns: Column<Changed>[] = [
    { id: "file", header: m.dialog_col_file(), cell: (c) => c.entry.path, sortValue: (c) => c.entry.path, rowHeader: true, truncate: true },
    { id: "state", header: m.dialog_col_status(), cell: (c) => (c.state === "changed" ? m.project_previous_changed() : m.view_entry_missing()), sortValue: (c) => c.state },
  ]
  type Correction = ApplyPlan["corrections"]["values"][number]
  const correctionColumns: Column<Correction>[] = [
    { id: "session", header: m.project_col_session(), cell: (c) => say(m, sessionLongRef(c.session)), sortValue: (c) => c.session.night, rowHeader: true, truncate: true },
    { id: "field", header: m.view_col_field(), cell: (c) => fieldName(m, c.field), sortValue: (c) => c.field },
    { id: "recorded", header: m.view_col_recorded(), cell: (c) => c.recorded ?? "–", sortValue: (c) => c.recorded, truncate: true },
    { id: "corrected", header: m.view_col_corrected(), cell: (c) => c.corrected, sortValue: (c) => c.corrected, truncate: true },
  ]
  const patched = plan.corrections.decisions.filter((d) => d.decision === "patched-copy").length
  type Drift = Extract<ApplyRefusal, { kind: "pin-drift" }>["problems"][number]
  const driftColumns: Column<Drift>[] = [
    { id: "session", header: m.project_col_session(), cell: (p) => say(m, sessionLongRef(p.session)), sortValue: (p) => p.session.night, rowHeader: true, truncate: true },
    { id: "kind", header: m.project_col_kind(), cell: (p) => say(m, KIND_NAME[p.kind]), sortValue: (p) => p.kind },
    { id: "state", header: m.dialog_col_status(), cell: (p) => (p.state === "changed" ? m.project_pin_changed({ kind: say(m, KIND_NAME[p.kind]) }) : m.project_pin_missing({ kind: say(m, KIND_NAME[p.kind]) })), sortValue: (p) => p.state },
  ]

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && closeApplySheet(project.id)}
      focusAfterConfirm={applyTrigger}
      focusAfterCancel={applyTrigger}
      title={m.common_apply_named({ name: project.name })}
      size="lg"
      confirm={{
        id: "apply",
        label,
        kind: "primary",
        run: () => {
          const { result } = startApply(project.id, sheet)
          if (result.ok) closeApplySheet(project.id)
          else openApplySheet(project.id)
          return result
        },
        unavailable: refusals.length > 0 ? { action: m.actions_blocked({ action: label }), reason: refusals.map((r) => say(m, applyRefusalRef(r))).join(" · "), blockers } : undefined,
      }}
    >
      {stale ? <Notice tone="warning" title={m.view_sheet_stale()} actions={<ActionButton action={{ id: "refresh", label: m.view_sheet_refresh(), run: () => openApplySheet(project.id) }} />} /> : null}
        {developer ? (
          <Notice
            tone="refusal"
            title={m.view_refused_developer_mode()}
            actions={
              <>
                <DeveloperModeActions />
                {application === "siril" ? null : <ActionButton action={{ id: "use-copies", label: m.project_use_copies(), run: () => setProjectSettings(project.id, { mode: "copy" }) }} />}
              </>
            }
          >
            {application === "siril" ? m.view_siril_needs_links() : m.view_use_copies_provisional()}
          </Notice>
        ) : null}
        {noLinks ? (
          <Notice tone="refusal" title={say(m, applyRefusalRef(noLinks))}>
            {m.view_choose_location_provisional()}
          </Notice>
        ) : null}
        {leftovers.length > 0 ? (
          <Section level={3} id="apply-previous" title={m.view_review_previous_first()} description={m.view_review_previous_hint()}>
            <LeftoverTable project={project} leftovers={leftovers} label={m.view_review_previous_first()} />
          </Section>
        ) : null}
        <KeyValueList items={facts} columns={2} />
        {plan.layoutChanged.length > 0 ? <Notice tone="warning" title={m.project_apply_readd_view()}>{m.view_provisional_copy()}</Notice> : null}
        {offline && offline.kind === "offline" ? (
          <Section level={3} id="apply-offline" title={say(m, applyRefusalRef(offline))} description={m.view_offline_hint()}>
            <KeyValueList items={offline.paths.map((path) => ({ label: m.view_offline_original(), value: path, mono: true }))} />
          </Section>
        ) : null}
      {drift && drift.kind === "pin-drift" ? (
        <Section level={3} id="apply-drift" title={say(m, applyRefusalRef(drift))} description={m.view_pin_drift_hint()}>
          <DataTable
            label={say(m, applyRefusalRef(drift))}
            rows={drift.problems}
            columns={driftColumns}
            getRowId={(p) => `${p.session.id}:${p.kind}`}
            scroll="none"
            rowLabel={(p) => say(m, sessionLongRef(p.session))}
            onRowClick={(p) => follow(sessionLink(p.session.id))}
            rowActions={(p) => [{ id: "reassign", label: m.view_blocker_reassign({ kind: say(m, KIND_NAME[p.kind]), name: say(m, sessionLongRef(p.session)) }), icon: Eye, run: () => follow(sessionLink(p.session.id)) }]}
          />
        </Section>
      ) : null}
        {plan.changes.length > 0 ? (
          <Section level={3} id="apply-changes" title={m.dialog_changes()}>
            <DataTable label={m.project_pending_changes_of({ name: project.name })} rows={plan.changes} columns={changeColumns} getRowId={(c) => c.id} scroll="none" />
          </Section>
        ) : null}
        {plan.drift.changed.length > 0 ? (
          <Section level={3} id="apply-changed-copies" title={m.view_changed_copies()} description={m.view_changed_copies_hint()}>
            <DataTable label={m.view_changed_copies()} rows={plan.drift.changed} columns={changedColumns} getRowId={(c) => c.entry.path} scroll="none" />
          </Section>
        ) : null}
        {plan.corrections.values.length > 0 ? (
          <Section level={3} id="apply-corrections" title={m.apps_corrected_values()} description={patched > 0 ? m.view_corrections_patched({ count: patched, n: formatCount(patched) }) : m.view_corrections_configuration({ name: profile?.name ?? "" })}>
            <DataTable label={m.apps_corrected_values()} rows={plan.corrections.values} columns={correctionColumns} getRowId={(c) => `${c.session.id}:${c.field}`} scroll="none" />
          </Section>
        ) : null}
        <Section level={3} id="apply-tree" title={m.view_new_view()}>
          <ViewFolderTree tree={plan.tree} mode={plan.mode} label={m.view_tree_of({ name: project.name })} />
        </Section>
        {plan.drift.unplaced.length > 0 ? (
          <Section level={3} id="apply-unplaced" title={m.project_apply_unplaced()} description={m.project_apply_unplaced_hint()}>
            <DataTable
              label={m.project_apply_unplaced()}
              rows={plan.drift.unplaced}
              columns={unplacedColumns}
              getRowId={(f) => f.path}
              scroll="none"
              selection={{ selected: sheet.tickedUnplaced, onChange: (ids) => setTicked(project.id, sheet, ids), rowLabel: (f) => f.path, countLabel: (count) => m.wrapup_items({ count }) }}
            />
          </Section>
        ) : null}
      {notes.length > 0 ? (
        <Section level={3} id="apply-notes" title={m.view_notes_for({ name: profile?.name ?? "" })} actions={<Pill>{m.status_provisional()}</Pill>}>
          <ul>
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          {plan.siril && plan.siril.length > 0 ? <KeyValueList items={plan.siril.map((set) => ({ label: `${SIRIL_TOOL}/${set.name}/`, value: sirilCounts(m, set) }))} /> : null}
        </Section>
      ) : null}
    </FormDialog>
  )
}

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

function RunningApply({ operationId }: { operationId: string }) {
  const m = useMessages()
  const phase = useStore((s) => {
    const op = s.operations[operationId]
    return op ? applyPhase(op) : null
  })
  // The phase names the section; waiting carries its hint (PREP-FR-18).
  return (
    <Section level={3} title={phase === "waiting" ? m.project_apply_waiting() : phase ? PHASE_TEXT[phase](m) : m.project_apply()} description={phase === "waiting" ? m.view_waiting_hint() : undefined}>
      <OperationPanel operationId={operationId} />
    </Section>
  )
}

function AppliedView({ project }: { project: Project }) {
  const m = useMessages()
  const disk = useStore((s) => s.disk)
  const view = project.view
  if (!view) return null
  const free = freeOn(disk, view.folderPath)
  if (!free) return <Notice tone="offline" title={m.view_offline()}>{m.view_offline_footprint()}</Notice>
  const footprint = appliedFootprint(disk, view.entries, view.folderPath)
  const previous = project.previous ? project.previous.leftovers.reduce((n, l) => n + l.sizeBytes, 0) : null
  return (
    <KeyValueList
      columns={2}
      items={[
        { label: m.view_applied_at(), value: formatDateTime(view.at) },
        { label: m.project_view_mode(), value: say(m, MODE_NAME[view.settings.mode]) },
        { label: m.view_entries(), value: entriesText(m, footprint) },
        { label: m.view_footprint(), value: footprintText(m, footprint) },
        { label: m.run_check_space(), value: m.view_free_on({ size: formatBytes(free.bytes), volume: free.volume }) },
        ...(previous !== null ? [{ label: m.project_previous_title(), value: formatBytes(previous) }] : []),
        { label: m.view_layout_view(), value: view.folderPath, mono: true },
      ]}
    />
  )
}

export function useViewSections(project: Project): DetailSection[] {
  const m = useMessages()
  const follow = useFollowLink()
  const changes = useStore((s) => pendingChanges(s, project))
  const running = useStore((s) => {
    const op = projectOperation(s, project.id)
    return op?.kind === "apply" ? op.id : null
  })
  const openReason = useStore((s) => openRefusal(m, s, project))
  const viewOnline = useStore((s) => Boolean(project.view && freeOn(s.disk, project.view.folderPath)))
  const profileName = useStore((s) => (project.settings.profileId ? (s.catalog.profiles[project.settings.profileId]?.name ?? null) : null))
  const editable = !isLocked(project)
  const [editing, setEditing] = useState(false)
  // Focus was on Cancel (or anywhere in the running section) when the Apply settled: it lands on Apply…, not the page body.
  const ranApply = useRef<string | null>(null)
  useEffect(() => {
    const lost = document.activeElement === null || document.activeElement === document.body
    if (ranApply.current && !running && lost) applyTrigger()?.focus()
    ranApply.current = running
  }, [running])
  const discardLabel = m.project_discard()

  const changeColumns: Column<PendingChange>[] = [
    { id: "change", header: m.dialog_changes(), cell: (c) => say(m, c.label), sortValue: (c) => say(m, c.label), rowHeader: true, truncate: true },
    { id: "source", header: m.project_change_source(), cell: (c) => say(m, CHANGE_SOURCE_NAME[c.source]), sortValue: (c) => c.source },
  ]
  const changeActions = (c: PendingChange): MenuItem[] => [
    ...(c.link ? [{ id: "open", label: m.project_change_fix_at_source(), icon: Eye, run: () => follow(c.link!) }] : []),
    ...(editable && isDiscardable(c) ? [{ id: "discard", label: discardLabel, icon: Undo2, run: () => discardChanges(project.id, [c.id]) }] : []),
  ]
  const own = changes.filter(isDiscardable).length
  const pendingActions: Action[] =
    editable && own > 0
      ? [{ id: "discard-all", label: m.project_discard_own({ count: own }), icon: Undo2, confirm: { title: m.project_discard_own_title({ count: own }), confirm: { label: discardLabel, kind: "destructive" } }, run: () => discardChanges(project.id, "all") }]
      : []

  const openLabel = m.project_open_in({ name: profileName ?? m.view_your_tool() })
  const revealLabel = m.view_reveal()
  const viewActions: Action[] = [
    ...(editable ? [{ id: "edit-settings", label: m.view_edit_settings(), icon: Pencil, opensDialog: true, run: () => setEditing(true) }] : []),
    { id: "open-in", label: openLabel, icon: FolderOpen, unavailable: blocked(m, openLabel, openReason), run: () => toast({ message: m.view_opened_in({ name: profileName ?? "", path: project.view?.folderPath ?? "" }) }) },
    {
      id: "reveal",
      label: revealLabel,
      icon: Eye,
      unavailable: blocked(m, revealLabel, !project.view ? m.project_view_not_built() : viewOnline ? null : m.view_offline()),
      run: () => toast({ message: m.review_announce_revealed({ path: project.view?.folderPath ?? "" }) }),
    },
  ]

  const leftovers = project.previous?.leftovers ?? []
  const previousLabel = m.view_reveal_previous()
  const sections: DetailSection[] = [
    {
      id: "view-settings",
      title: m.project_view_settings(),
      actions: viewActions,
      content: (
        <>
          <ViewSettingsSummary project={project} />
          {editing ? <ViewSettingsDialog project={project} onClose={() => setEditing(false)} /> : null}
        </>
      ),
    },
  ]
  if (running) sections.push({ id: "apply-running", title: m.project_apply(), content: <RunningApply operationId={running} /> })
  if (project.view) sections.push({ id: "applied-view", title: m.view_applied_title(), content: <AppliedView project={project} /> })
  if (editable || changes.length > 0)
    sections.push({
      id: "pending",
      title: m.project_pending_changes(),
      count: changes.length,
      flush: true,
      actions: pendingActions,
      content: (
        <>
          <BoxTable label={m.project_pending_changes_of({ name: project.name })} rows={changes} columns={changeColumns} getRowId={(c) => c.id} rowLabel={(c) => say(m, c.label)} rowActions={changeActions} empty={project.view ? m.project_no_pending_changes() : m.project_view_not_built()} />
          {editable ? <ApplySheetHost project={project} /> : null}
        </>
      ),
    })
  if (leftovers.length > 0)
    sections.push({
      id: "previous",
      title: m.project_previous_title(),
      count: leftovers.length,
      flush: true,
      actions: [{ id: "reveal-previous", label: previousLabel, icon: Eye, run: () => toast({ message: m.review_announce_revealed({ path: project.previous?.folderPath ?? "" }) }) }],
      content: <LeftoverTable project={project} leftovers={leftovers} label={m.project_previous_title()} />,
    })
  return sections
}
