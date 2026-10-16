/**
 * S14 Calibration library (slice E; CAL-FR-01, CAL-FR-06, CAL-FR-13 to
 * CAL-FR-17, LIB-FR-26, P-CAL3): a ListPage with five views.
 *
 * - Masters: one table grouped by kind (darks, flats, bias; dark flats are
 *   never matched, so the library does not list them), sortable by every
 *   column and filtered by search, Kind, Camera, Temperature, Gain · offset
 *   and State. A master is one record with dated versions (CAL-FR-14); none
 *   is Latest. A dark or bias master whose newest version is older than the
 *   Old masters after setting reads "Old · {n} d" (CAL-FR-15); flats never
 *   age, and the badge raises no issue anywhere else. A row opens the
 *   master's DetailPanel: its facts, then each version with its capture
 *   date, file, digest and the sessions that pin it. Add version… adds a
 *   dated version and moves no session. Hide and Move to Trash act on the
 *   whole master and are refused while an open, Closed or Archived Project
 *   uses it through its sessions, naming those Projects (provisional);
 *   otherwise their confirmation lists the sessions it is pinned on, which
 *   then need calibration again. Move to Trash names every version's file
 *   with its SHA-256. The master's menu links it to one physical camera
 *   (LIB-FR-26).
 * - Raw sets: every raw dark, flat and bias set (CAL-FR-01, CAL-FR-04), with
 *   its settings, the light sessions that pin it and its stacking state.
 * - Candidates: generated masters found in a Project's `Processing/` folder
 *   that the library does not hold, offered on the Output step or hidden
 *   there; Add to library adopts one as a verified copy (CAL-FR-06,
 *   CAL-AC-12).
 * - Processes: one row per calibration process; a row opens its StepPage
 *   (`/calibration/processes/$processId/$step`).
 * - Hidden: hidden masters, each with Restore (CAL-FR-16).
 *
 * Header: Import masters… (Files → Preview, CAL-FR-13) and the "Calibration
 * ▾" object menu with Calibration settings… (keep raw frames, Old masters
 * after). Search parameters: `view`, `process` (opens Processes on that
 * row), `master` (opens its details) and `filter=dismissed` (Hidden).
 *
 * Issues (F7, P-ISS1): a master's drift and a process's failure are on their
 * rows, whose ⋯ and context menu offer Dismiss issue, then Restore issue
 * once dismissed; the Issues facet of Masters and Processes is Show
 * dismissed. The Library's "1 to stack" is dismissed and restored from the
 * Calibration ▾ menu.
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { Inbox, Layers, SearchX, Sparkles } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { useFollowLink } from "@/components/app/links"
import { ActionButton } from "@/components/app/actions"
import { issuesFacet, matchesIssueFilter, pageIssues, parseIssueFilter, rowIssues, withIssueItems } from "@/components/app/issue-actions"
import { Box } from "@/components/app/box"
import type { Action, Column, Facet, FileRow, MenuItem } from "@/components/app/contracts"
import { KeyValueList, type KeyValueItem } from "@/components/app/data"
import { EmptyState, toast } from "@/components/app/feedback"
import { CountBadge, Pill } from "@/components/app/pill"
import { UsedByPreview } from "@/components/app/previews"
import { StatusBadge } from "@/components/app/status"
import type { PageDetail } from "@/components/templates/detail-panel"
import { ListPage } from "@/components/templates/list-page"
import type { ObjectMenu, PageViews } from "@/components/templates/parts"
import { KIND_NAME, KINDS, masterAge, masterKindOf, newestVersion, versionDrift, versionsNewestFirst } from "@/domain/calibration"
import { type MasterPin, masterPins, masterProjects, versionPins } from "@/domain/calibration-library"
import { CALIBRATION_STEP_NAME, calibrationProcesses, type ProcessView } from "@/domain/calibration-process"
import { isLocked, projectLink, rigName, type StepLink } from "@/domain/derive"
import { fileAt } from "@/domain/disk"
import { nightOf } from "@/domain/indexing"
import { sessionLabel } from "@/domain/membership"
import type { CalibrationKind, CalibrationMaster, Catalog, Disk, DiskFile, MasterId, MasterVersion, Session } from "@/domain/types"
import { fileName, formatCount, formatDateTime, formatExposure, formatNight } from "@/lib/format"
import { type Messages, msg, say } from "@/lib/i18n"
import { hideMaster, restoreMaster, setMasterCamera, trashMaster } from "@/store/actions/calibration"
import { adoptionCheck, adoptProcessingMaster } from "@/store/actions/project-view"
import { type CommitResult, store, useStore } from "@/store/core"
import { useIssues } from "@/store/issues"
import {
  libraryMasters,
  type MasterCandidate,
  masterCamera,
  masterCandidates,
  masterLabel,
  masterNight,
  PROCESS_STATUS,
  type RawSet,
  rawSetName,
  rawSets,
  versionNight,
} from "./calibration-model"
import { AddMasterVersionDialog, CalibrationSettingsDialog, ImportMastersDialog } from "./dialogs"

type View = "masters" | "raw" | "candidates" | "processes" | "hidden"

const VIEWS: readonly View[] = ["masters", "raw", "candidates", "processes", "hidden"]

function kindHeading(m: Messages, kind: CalibrationKind): string {
  return { flat: m.calibration_heading_flats, dark: m.calibration_heading_darks, bias: m.calibration_heading_bias, "dark-flat": m.calibration_heading_dark_flats }[kind]()
}

function originWord(m: Messages, kind: MasterVersion["origin"]["kind"]): string {
  return { library: m.calibration_origin_indexed, generated: m.calibration_origin_generated, stacked: m.calibration_origin_stacked, imported: m.calibration_origin_imported }[kind]()
}

const gainOffset = (s: { gain: number | null; offset: number | null }) => `${s.gain ?? "–"} · ${s.offset ?? "–"}`
const temperature = (s: { ccdTempC: number | null }) => (s.ccdTempC === null ? "–" : `${Math.round(s.ccdTempC)} °C`)
const exposure = (s: { exposureS: number | null }) => (s.exposureS === null ? "–" : formatExposure(s.exposureS))
const sessionLink = (sessionId: string): StepLink => ({ to: "/sessions/$sessionId", params: { sessionId } })

/** The sessions of some pins, once each, in pin order. */
function pinnedSessions(pins: readonly MasterPin[]): Session[] {
  return [...new Map(pins.map((p) => [p.session.id, p.session])).values()]
}

/** "3 sessions" with the sessions in its preview, each linked to its page; plain text when no session pins it. */
function UsedBy({ sessions }: { sessions: Session[] }) {
  const m = useMessages()
  const label = m.session_count({ count: sessions.length })
  const first = sessions[0]
  if (!first) return label
  return <UsedByPreview label={label} link={sessionLink(first.id)} items={sessions.map((s) => ({ label: sessionLabel(m, s), link: sessionLink(s.id) }))} />
}

/** A master's drift: a version's bytes no longer match what the library verified (CAL-FR-08). */
function drifted(disk: Disk, master: CalibrationMaster): boolean {
  return master.state === "adopted" && master.versions.some((v) => versionDrift(disk, v) !== null)
}

/** Adopted or Candidate, then Drifted and Old · {n} d when they apply. */
function MasterState({ master, old }: { master: CalibrationMaster; old: string | null }) {
  const disk = useStore((s) => s.disk)
  return (
    <>
      <StatusBadge kind="master" value={master.state} />
      {drifted(disk, master) ? <StatusBadge kind="content" value="drifted" /> : null}
      {old ? <Pill tone="warning">{old}</Pill> : null}
    </>
  )
}

/** Search text of a master: kind, filter, camera, rig and its versions' paths. */
function haystack(m: Messages, catalog: Catalog, master: CalibrationMaster): string {
  return [say(m, KIND_NAME[master.kind]), master.channel, master.cameraName, masterCamera(catalog, master), master.opticalTrainId ? rigName(m, catalog, master.opticalTrainId) : null, ...master.versions.map((v) => v.path)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

/** One version's file as the Move to Trash review names it: its name, folder and SHA-256 (CAL-FR-17). */
function trashRow(disk: Disk, version: MasterVersion): FileRow {
  return {
    file: fileName(version.path),
    from: version.path.slice(0, version.path.lastIndexOf("/")),
    action: "trash",
    size: fileAt(disk, version.path)?.sizeBytes ?? 0,
    sha256: version.adoption?.verifiedSha256 ?? version.sha256,
  }
}

/** The camera of a raw set: its rig camera's alias, else the header's model. */
function rawSetCamera(catalog: Catalog, set: RawSet): string {
  return masterCamera(catalog, set.source) ?? "–"
}

/** "Dark 300 s", "Flat 1.5 s", "Bias": a generated master's header kind. */
function candidateKind(m: Messages, file: DiskFile): string {
  const kind = masterKindOf(file)
  if (!kind) return "–"
  const name = say(m, KIND_NAME[kind])
  return kind === "bias" || !file.header ? name : `${name} ${formatExposure(file.header.exposureS)}`
}

/** One single facet's options from the values its rows read, each counted, in `order`. */
function facetOptions<T>(rows: readonly T[], read: (row: T) => string, order: (a: string, b: string) => number = (a, b) => a.localeCompare(b)): Facet["options"] {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(read(row), (counts.get(read(row)) ?? 0) + 1)
  return [...counts.entries()].sort(([a], [b]) => order(a, b)).map(([value, count]) => ({ value, label: value, count }))
}

const byKind = (a: string, b: string) => KINDS.indexOf(a as CalibrationKind) - KINDS.indexOf(b as CalibrationKind)
/** The leading number of a facet value ("-10 °C", "100 · 50"); the unknown "–" sorts last. */
const leading = (value: string) => {
  const n = Number.parseFloat(value)
  return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n
}
const byNumber = (a: string, b: string) => leading(a) - leading(b) || a.localeCompare(b)

export function CalibrationPage() {
  const m = useMessages()
  const navigate = useNavigate()
  const follow = useFollowLink()
  const search = useSearch({ strict: false }) as Record<string, string | undefined>
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const settings = useStore((s) => s.settings)
  const clockOffset = useStore((s) => s.faults.clockOffsetMs)
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [detailId, setDetailId] = useState<MasterId | null>(search.master ?? null)
  const [importing, setImporting] = useState(false)
  const [editingSettings, setEditingSettings] = useState(false)
  const [addingVersion, setAddingVersion] = useState<CalibrationMaster | null>(null)
  const issueView = useIssues()

  const requested = VIEWS.find((v) => v === search.view)
  const view: View = requested ?? (search.process ? "processes" : search.filter === "dismissed" ? "hidden" : "masters")
  const pins = masterPins(catalog)
  const pinsOf = (master: CalibrationMaster) => pins.get(master.id) ?? []
  const now = Date.now() + clockOffset
  const oldLabel = (master: CalibrationMaster) => {
    const found = masterAge(master, settings, now)
    return found ? say(m, found.label) : null
  }
  const { listed: library, hidden } = libraryMasters(catalog)
  const raws = rawSets(catalog, disk)
  const candidates = masterCandidates({ catalog, disk, settings })
  const processes = calibrationProcesses(catalog)
  const needle = query.trim().toLowerCase()
  const open = detailId ? catalog.masters[detailId] : undefined
  const facet = (id: string) => filters[id] ?? ""
  const issueFilter = parseIssueFilter(facet("issues"))
  const masterIssues = (master: CalibrationMaster) => rowIssues(issueView, { kind: "master", id: master.id })
  const processIssues = (p: ProcessView) => rowIssues(issueView, { kind: "process", id: p.process.id })
  const clearFilters = () => {
    setQuery("")
    setFilters({})
  }

  const setView = (next: string) => {
    clearFilters()
    void navigate({ to: "/calibration", search: { view: next }, replace: true })
  }
  const views: PageViews = {
    label: m.calibration_views(),
    value: view,
    onChange: setView,
    items: [
      { id: "masters", label: m.calibration_masters(), count: library.length },
      { id: "raw", label: m.calibration_raw_sets(), count: raws.length },
      { id: "candidates", label: m.calibration_candidates(), count: candidates.length },
      { id: "processes", label: m.calibration_processes(), count: processes.length },
      { id: "hidden", label: m.calibration_hidden(), count: hidden.length },
    ],
  }
  const importAction: Action = { id: "import-masters", label: m.calibration_import_masters(), kind: "primary", opensDialog: true, run: () => setImporting(true) }
  const menu: ObjectMenu = {
    label: m.nav_calibration(),
    items: withIssueItems(m, [{ id: "calibration-settings", label: m.calibration_settings(), opensDialog: true, run: () => setEditingSettings(true) }], pageIssues(issueView, "/calibration")),
  }
  const header = { title: m.nav_calibration(), actions: [importAction], menu, views }
  const toolbarFacets = (items: Facet[]) => ({ items, onChange: (patch: Record<string, string | string[]>) => setFilters((current) => ({ ...current, ...(patch as Record<string, string>) })) })
  const noMatch = <EmptyState icon={SearchX} title={m.sessions_no_match()} action={<ActionButton action={{ id: "clear", label: m.filters_clear(), run: clearFilters }} />} />

  // --- Master details ----------------------------------------------------------

  const said = (result: CommitResult, message: string): CommitResult => {
    if (result.ok) toast({ message })
    return result
  }
  /** Hide and Move to Trash are refused while a Project uses the master through its sessions, naming those Projects (CAL-FR-16, CAL-FR-17). */
  const inUse = (master: CalibrationMaster, label: string): Action["unavailable"] => {
    const projects = masterProjects(catalog, pins, master.id)
    if (projects.length === 0) return undefined
    return { action: m.actions_blocked({ action: label }), reason: m.equipment_used_by_projects({ count: projects.length }), blockers: projects.map((p) => ({ label: p.name, link: projectLink(p.id) })) }
  }
  /** The sessions the master is pinned on, which need calibration again once it goes; undefined when none. */
  const released = (master: CalibrationMaster): string | undefined => {
    const sessions = pinnedSessions(pinsOf(master))
    return sessions.length > 0 ? m.calibration_sessions_need_again({ count: sessions.length, sessions: sessions.map((s) => sessionLabel(m, s)).join(", ") }) : undefined
  }
  const hide = (master: CalibrationMaster): Action => {
    const label = m.calibration_hide_master()
    const summary = released(master)
    const name = masterLabel(m, catalog, master)
    return {
      id: "hide-master",
      label,
      unavailable: inUse(master, label),
      confirm: summary ? { title: m.calibration_hide_master_title({ name }), summary, confirm: { label } } : undefined,
      run: () => said(hideMaster(master.id), m.calibration_hid_master({ name })),
    }
  }
  const trash = (master: CalibrationMaster): Action => {
    const label = m.common_move_to_trash()
    return {
      id: "trash-master",
      label,
      kind: "destructive",
      unavailable: inUse(master, label),
      confirm: {
        title: m.common_trash_named_title({ name: masterLabel(m, catalog, master) }),
        summary: released(master),
        groups: [{ label: m.calibration_versions(), rows: versionsNewestFirst(master).map((v) => trashRow(disk, v)), defaultOpen: true }],
        confirm: { label, kind: "destructive" },
      },
      run: () => trashMaster(master.id).result,
    }
  }
  const restore = (master: CalibrationMaster): Action => ({
    id: "restore-master",
    label: m.calibration_restore_master(),
    run: () => said(restoreMaster(master.id), m.calibration_restored_master({ name: masterLabel(m, catalog, master) })),
  })
  const addVersion = (master: CalibrationMaster): Action => ({ id: "add-version", label: m.calibration_add_version(), opensDialog: true, run: () => setAddingVersion(master) })
  const details = (master: CalibrationMaster): Action => ({ id: "details", label: m.settings_details(), run: () => setDetailId(master.id) })

  /** Link camera ▸ (LIB-FR-26): each physical camera of the master's model, and Match by model once it is linked. */
  const cameraMenu = (master: CalibrationMaster): MenuItem[] => {
    const model = master.cameraName
    if (!model) return []
    const items: Action[] = Object.values(catalog.cameras)
      .filter((c) => c.id !== master.cameraId && (c.name === model || c.aliases.includes(model)))
      .map((c) => ({ id: `link-${c.id}`, label: c.physicalAlias ?? c.name, run: () => setMasterCamera(master.id, c.id) }))
    if (master.cameraId) items.push({ id: "match-by-model", label: m.calibration_match_by_model(), run: () => setMasterCamera(master.id, null) })
    return items.length > 0 ? [{ submenu: m.calibration_link_camera(), items }] : []
  }
  /** The master's own links: the raw session its newest stacked version came from, and its camera link. */
  const masterLinks = (master: CalibrationMaster): MenuItem[] => {
    const items: MenuItem[] = []
    const sessionId = versionsNewestFirst(master).find((v) => v.origin.sessionId && catalog.sessions[v.origin.sessionId])?.origin.sessionId
    if (sessionId) items.push({ id: "open-session", label: m.calibration_open_raw_session(), run: () => follow(sessionLink(sessionId)) })
    return [...items, ...cameraMenu(master)]
  }

  const detail: PageDetail | null = open
    ? {
        dockId: "calibration-masters",
        title: masterLabel(m, catalog, open),
        status: <StatusBadge kind="master" value={open.state} />,
        actions: open.hiddenAt ? [restore(open)] : [addVersion(open), hide(open), trash(open)],
        menu: { label: m.calibration_master(), items: masterLinks(open) },
        content: (
          <>
            <KeyValueList items={masterFacts(m, catalog, open, pinnedSessions(pinsOf(open)), oldLabel(open), now)} />
            {versionsNewestFirst(open).map((version) => (
              <Box key={version.id} title={m.calibration_version_of({ night: formatNight(versionNight(catalog, version), true) })} level={4}>
                <KeyValueList items={versionFacts(m, catalog, version, pinnedSessions(versionPins(pins, open.id, version.id)))} />
              </Box>
            ))}
          </>
        ),
        onClose: () => setDetailId(null),
      }
    : null

  const dialogs = (
    <>
      <ImportMastersDialog open={importing} onOpenChange={setImporting} />
      <CalibrationSettingsDialog open={editingSettings} onOpenChange={setEditingSettings} />
      <AddMasterVersionDialog master={addingVersion} onOpenChange={(next) => !next && setAddingVersion(null)} />
    </>
  )

  // --- Raw sets view -----------------------------------------------------------

  if (view === "raw") {
    const shown = raws.filter(
      (set) =>
        (facet("kind") === "" || set.source.kind === facet("kind")) &&
        (facet("camera") === "" || rawSetCamera(catalog, set) === facet("camera")) &&
        [rawSetName(m, set), set.session.channel, rawSetCamera(catalog, set)].filter(Boolean).join(" ").toLowerCase().includes(needle),
    )
    const openProcess = (set: RawSet) => set.process && follow({ to: "/calibration/processes/$processId/$step", params: { processId: set.process.process.id, step: set.process.current ?? "raws" } })
    const facets: Facet[] = [
      { id: "kind", label: m.run_col_kind(), kind: "single", value: facet("kind"), options: facetOptions(raws, (set) => set.source.kind, byKind).map((o) => ({ ...o, label: say(m, KIND_NAME[o.value as CalibrationKind]) })) },
      { id: "camera", label: m.calibration_key_camera(), kind: "single", value: facet("camera"), options: facetOptions(raws, (set) => rawSetCamera(catalog, set)) },
    ]
    return (
      <>
        <ListPage
          {...header}
          summary={m.calibration_raw_sets_count({ count: raws.length })}
          table={{
            label: m.calibration_raw_sets(),
            rows: shown,
            columns: rawSetColumns(m, catalog),
            getRowId: (set) => set.session.id,
            groups: { key: (set) => set.source.kind, label: (key, rows) => <>{kindHeading(m, key as CalibrationKind)} <CountBadge count={rows.length} /></>, compare: byKind },
            initialSort: { columnId: "night", direction: "desc" },
            onRowClick: (set) => follow(sessionLink(set.session.id)),
            rowLabel: (set) => rawSetName(m, set),
            rowActions: (set): MenuItem[] => [
              { id: "open-session", label: m.calibration_open_raw_session(), run: () => follow(sessionLink(set.session.id)) },
              ...(set.process ? [{ id: "open-process", label: m.calibration_open_process(), run: () => void openProcess(set) }] : []),
            ],
            stickyFirstColumn: true,
            empty:
              raws.length === 0 ? (
                <EmptyState icon={Layers} title={m.calibration_no_raw_sets()} description={m.calibration_no_raw_sets_help()} action={<ActionButton action={{ id: "open-import", label: m.import_open(), run: () => follow({ to: "/import" }) }} />} />
              ) : (
                noMatch
              ),
            toolbar: { search: { label: m.calibration_search_raw_sets(), placeholder: m.calibration_filter_placeholder(), value: query, onChange: setQuery }, facets: toolbarFacets(facets), matchCount: shown.length },
          }}
        />
        {dialogs}
      </>
    )
  }

  // --- Candidates view -----------------------------------------------------------

  if (view === "candidates") {
    const shown = candidates.filter((c) => [fileName(c.master.file.path), c.project.name, candidateKind(m, c.master.file)].join(" ").toLowerCase().includes(needle))
    /** Add to library (CAL-FR-06): a verified copy into structured calibration storage, refused with its reason; PlateVault's own unregistered copy at the destination goes to the Trash first, as reviewed (section 9). */
    const adopt = (c: MasterCandidate): Action => {
      const label = m.project_output_adopt()
      const name = fileName(c.master.file.path)
      const check = adoptionCheck(store.getState(), c.project.id, c.master.file.path)
      const blocked = (reason: string): Action => ({ id: "adopt", label, unavailable: { action: m.actions_blocked({ action: label }), reason, blockers: [] }, run: () => undefined })
      if (isLocked(c.project)) return blocked(m.apply_refused_locked())
      const done = (result: CommitResult) => said(result, say(m, msg("store_saved_added_to_library", { name })))
      if (!check.ok && check.ownCopy) {
        const own = fileAt(disk, check.ownCopy)
        return {
          id: "adopt",
          label,
          confirm: {
            title: m.project_output_adopt_title({ name }),
            summary: say(m, check.reasons[0]!),
            groups: own ? [{ label: m.calibration_own_copy(), rows: [{ file: fileName(own.path), from: own.path.slice(0, own.path.lastIndexOf("/")), action: "trash", size: own.sizeBytes, sha256: own.sha256 }], defaultOpen: true }] : undefined,
            confirm: { label: m.calibration_trash_copy_and_add() },
          },
          run: () => done(adoptProcessingMaster(c.project.id, c.master.file.path, c.master.file.sha256, { trashOwnCopy: true })),
        }
      }
      if (!check.ok) return blocked(say(m, check.reasons[0]!))
      return {
        id: "adopt",
        label,
        confirm: { title: m.project_output_adopt_title({ name }), summary: m.calibration_adopt_summary({ destination: check.destination, sha256: check.sha256 }), confirm: { label } },
        run: () => done(adoptProcessingMaster(c.project.id, c.master.file.path, check.sha256)),
      }
    }
    const outputLink = (c: MasterCandidate): StepLink => projectLink(c.project.id, { stage: "output" })
    return (
      <>
        <ListPage
          {...header}
          summary={m.calibration_candidates_count({ count: candidates.length })}
          table={{
            label: m.calibration_candidates(),
            rows: shown,
            columns: candidateColumns(m),
            getRowId: (c) => `${c.project.id}:${c.master.file.path}`,
            initialSort: { columnId: "captured", direction: "desc" },
            rowLabel: (c) => fileName(c.master.file.path),
            primaryRowAction: adopt,
            rowActions: (c): MenuItem[] => [adopt(c), { id: "open-output", label: m.calibration_open_output({ project: c.project.name }), run: () => follow(outputLink(c)) }],
            stickyFirstColumn: true,
            empty:
              candidates.length === 0 ? (
                <EmptyState
                  icon={Sparkles}
                  title={m.calibration_no_candidates()}
                  description={m.calibration_no_candidates_help()}
                  action={<ActionButton action={{ id: "open-projects", label: m.nav_projects(), run: () => follow({ to: "/projects" }) }} />}
                />
              ) : (
                noMatch
              ),
            toolbar: { search: { label: m.calibration_search_candidates(), placeholder: m.calibration_filter_placeholder(), value: query, onChange: setQuery }, matchCount: shown.length },
          }}
        />
        {dialogs}
      </>
    )
  }

  // --- Processes view --------------------------------------------------------

  if (view === "processes") {
    const shown = processes.filter((p) => say(m, p.name).toLowerCase().includes(needle) && matchesIssueFilter(processIssues(p), issueFilter))
    const openProcess = (p: ProcessView) => follow({ to: "/calibration/processes/$processId/$step", params: { processId: p.process.id, step: p.current ?? "raws" } })
    const rowActions = (p: ProcessView): MenuItem[] => {
      const items: MenuItem[] = [{ id: "open-process", label: m.calibration_open_process(), run: () => openProcess(p) }]
      if (p.session) items.push({ id: "open-session", label: m.calibration_open_raw_session(), run: () => follow(sessionLink(p.session!.id)) })
      if (p.master) items.push({ id: "open-master", label: m.calibration_open_master(), run: () => setDetailId(p.master!.id) })
      return withIssueItems(m, items, processIssues(p))
    }
    return (
      <>
        <ListPage
          {...header}
          summary={m.calibration_processes_count({ count: processes.length })}
          table={{
            label: m.calibration_processes_caption(),
            rows: shown,
            columns: processColumns(m, catalog),
            getRowId: (p) => p.process.id,
            activeRowId: search.process ?? null,
            onRowClick: openProcess,
            rowLabel: (p) => say(m, p.name),
            rowActions,
            empty:
              processes.length === 0 ? (
                <EmptyState icon={Layers} title={m.calibration_no_raw_sessions()} description={m.calibration_no_processes_help()} action={<ActionButton action={{ id: "open-import", label: m.import_open(), run: () => follow({ to: "/import" }) }} />} />
              ) : (
                noMatch
              ),
            toolbar: {
              search: { label: m.calibration_search_processes(), placeholder: m.calibration_filter_placeholder(), value: query, onChange: setQuery },
              facets: toolbarFacets([issuesFacet(m, processes.map(processIssues), issueFilter)]),
              matchCount: shown.length,
            },
          }}
          detail={detail}
        />
        {dialogs}
      </>
    )
  }

  // --- Hidden view -------------------------------------------------------------

  if (view === "hidden") {
    const shown = hidden.filter((master) => haystack(m, catalog, master).includes(needle))
    return (
      <>
        <ListPage
          {...header}
          summary={m.calibration_hidden_count({ count: hidden.length })}
          table={{
            label: m.calibration_hidden_masters(),
            rows: shown,
            columns: hiddenColumns(m, catalog),
            getRowId: (master) => master.id,
            initialSort: { columnId: "at", direction: "desc" },
            activeRowId: detailId,
            onRowClick: (master) => setDetailId(master.id),
            rowLabel: (master) => masterLabel(m, catalog, master),
            rowActions: (master): MenuItem[] => [details(master), restore(master)],
            primaryRowAction: restore,
            empty:
              hidden.length === 0 ? (
                <EmptyState icon={Inbox} title={m.calibration_nothing_hidden()} action={<ActionButton action={{ id: "show-masters", label: m.calibration_masters(), run: () => setView("masters") }} />} />
              ) : (
                noMatch
              ),
            toolbar: { search: { label: m.calibration_filter_label(), placeholder: m.calibration_filter_placeholder(), value: query, onChange: setQuery }, matchCount: shown.length },
          }}
          detail={detail}
        />
        {dialogs}
      </>
    )
  }

  // --- Masters view ------------------------------------------------------------

  const cameraOf = (master: CalibrationMaster) => masterCamera(catalog, master) ?? "–"
  const stateOf = (master: CalibrationMaster): string[] => [...(oldLabel(master) ? ["old"] : []), ...(drifted(disk, master) ? ["drifted"] : [])]
  const shown = library.filter(
    (master) =>
      (facet("kind") === "" || master.kind === facet("kind")) &&
      (facet("camera") === "" || cameraOf(master) === facet("camera")) &&
      (facet("temp") === "" || temperature(master) === facet("temp")) &&
      (facet("gain") === "" || gainOffset(master) === facet("gain")) &&
      (facet("state") === "" || stateOf(master).includes(facet("state"))) &&
      matchesIssueFilter(masterIssues(master), issueFilter) &&
      haystack(m, catalog, master).includes(needle),
  )
  const stateOptions = [
    { value: "old", label: m.calibration_age_old(), count: library.filter((master) => oldLabel(master) !== null).length },
    { value: "drifted", label: m.status_drifted(), count: library.filter((master) => drifted(disk, master)).length },
  ].filter((o) => o.count > 0)
  const facets: Facet[] = [
    { id: "kind", label: m.run_col_kind(), kind: "single", value: facet("kind"), options: facetOptions(library, (master) => master.kind, byKind).map((o) => ({ ...o, label: say(m, KIND_NAME[o.value as CalibrationKind]) })) },
    { id: "camera", label: m.calibration_key_camera(), kind: "single", value: facet("camera"), options: facetOptions(library, cameraOf) },
    { id: "temp", label: m.domain_criterion_temperature(), kind: "single", value: facet("temp"), options: facetOptions(library, temperature, byNumber) },
    { id: "gain", label: m.session_gain_offset(), kind: "single", value: facet("gain"), options: facetOptions(library, gainOffset, byNumber) },
    { id: "state", label: m.calibration_state(), kind: "single", value: facet("state"), options: stateOptions },
    issuesFacet(m, library.map(masterIssues), issueFilter),
  ]
  const rowActions = (master: CalibrationMaster): MenuItem[] => withIssueItems(m, [details(master), addVersion(master), ...masterLinks(master), { separator: true }, hide(master), trash(master)], masterIssues(master))

  return (
    <>
      <ListPage
        {...header}
        summary={m.calibration_masters_count({ count: library.length })}
        table={{
          label: m.calibration_masters(),
          rows: shown,
          columns: masterColumns(m, catalog, pins, oldLabel),
          getRowId: (master) => master.id,
          columnsId: "calibration.masters",
          groups: { key: (master) => master.kind, label: (key, rows) => <>{kindHeading(m, key as CalibrationKind)} <CountBadge count={rows.length} /></>, compare: byKind },
          initialSort: { columnId: "night", direction: "desc" },
          activeRowId: detailId,
          onRowClick: (master) => setDetailId(master.id),
          rowLabel: (master) => masterLabel(m, catalog, master),
          rowActions,
          stickyFirstColumn: true,
          empty: library.length === 0 ? <EmptyState icon={Inbox} title={m.calibration_no_masters()} action={<ActionButton action={{ ...importAction, kind: "standard" }} />} /> : noMatch,
          toolbar: {
            search: { label: m.calibration_filter_label(), placeholder: m.calibration_filter_placeholder(), value: query, onChange: setQuery },
            facets: toolbarFacets(facets),
            matchCount: shown.length,
          },
        }}
        detail={detail}
      />
      {dialogs}
    </>
  )
}

function masterColumns(m: Messages, catalog: Catalog, pins: ReadonlyMap<MasterId, MasterPin[]>, oldLabel: (master: CalibrationMaster) => string | null): Column<CalibrationMaster>[] {
  const label = (master: CalibrationMaster) => masterLabel(m, catalog, master)
  const night = (master: CalibrationMaster) => masterNight(catalog, master)
  const users = (master: CalibrationMaster) => pinnedSessions(pins.get(master.id) ?? [])
  return [
    { id: "master", header: m.calibration_master(), cell: label, sortValue: label, rowHeader: true, truncate: true },
    { id: "filter", header: m.tonight_filter(), truncate: true, cell: (master) => master.channel ?? "–", sortValue: (master) => master.channel ?? "" },
    // The name already carries the exposure, and the versions count is in the details: both are in the Columns menu, so the Master name shows in full at 1280 px.
    { id: "exposure", header: m.calibration_key_exposure(), hideable: true, defaultHidden: true, cell: exposure, sortValue: (master) => master.exposureS, align: "right" },
    { id: "gain", header: m.session_gain_offset(), cell: gainOffset, sortValue: (master) => master.gain, align: "right" },
    { id: "temp", header: m.calibration_key_temp(), cell: temperature, sortValue: (master) => master.ccdTempC, align: "right" },
    { id: "versions", header: m.calibration_versions(), hideable: true, defaultHidden: true, cell: (master) => formatCount(master.versions.length), sortValue: (master) => master.versions.length, align: "right" },
    { id: "night", header: m.calibration_newest_version(), truncate: true, cell: (master) => formatNight(night(master), true), sortValue: night },
    { id: "used-by", header: m.calibration_used_by(), cell: (master) => <UsedBy sessions={users(master)} />, sortValue: (master) => users(master).length },
    { id: "state", header: m.calibration_state(), cell: (master) => <MasterState master={master} old={oldLabel(master)} />, sortValue: (master) => `${oldLabel(master) ? 0 : 1}${master.state}` },
  ]
}

function rawSetColumns(m: Messages, catalog: Catalog): Column<RawSet>[] {
  const name = (set: RawSet) => rawSetName(m, set)
  const stacking = (set: RawSet) => (set.process ? say(m, PROCESS_STATUS[set.process.status].word) : "–")
  return [
    { id: "set", header: m.calibration_raw_set(), cell: name, sortValue: name, rowHeader: true, truncate: true },
    { id: "camera", header: m.calibration_key_camera(), cell: (set) => rawSetCamera(catalog, set), sortValue: (set) => rawSetCamera(catalog, set), truncate: true },
    { id: "filter", header: m.tonight_filter(), cell: (set) => set.source.channel ?? "–", sortValue: (set) => set.source.channel ?? "" },
    { id: "exposure", header: m.calibration_key_exposure(), cell: (set) => exposure(set.source), sortValue: (set) => set.source.exposureS, align: "right" },
    { id: "gain", header: m.session_gain_offset(), cell: (set) => gainOffset(set.source), sortValue: (set) => set.source.gain, align: "right" },
    { id: "temp", header: m.calibration_key_temp(), cell: (set) => temperature(set.source), sortValue: (set) => set.source.ccdTempC, align: "right" },
    { id: "frames", header: m.calibration_frames(), cell: (set) => formatCount(set.source.frameCount ?? 0), sortValue: (set) => set.source.frameCount, align: "right" },
    { id: "night", header: m.tonight_night(), cell: (set) => formatNight(set.session.night, true), sortValue: (set) => set.session.night },
    { id: "used-by", header: m.calibration_used_by(), cell: (set) => <UsedBy sessions={set.pinnedOn} />, sortValue: (set) => set.pinnedOn.length },
    {
      id: "stacking",
      header: m.calibration_status_stacking(),
      cell: (set) => (set.process ? <Pill tone={PROCESS_STATUS[set.process.status].tone}>{stacking(set)}</Pill> : "–"),
      sortValue: stacking,
    },
  ]
}

function candidateColumns(m: Messages): Column<MasterCandidate>[] {
  const file = (c: MasterCandidate) => c.master.file
  const header = <T,>(c: MasterCandidate, read: (h: NonNullable<DiskFile["header"]>) => T, none: T) => (file(c).header ? read(file(c).header!) : none)
  const offer = (c: MasterCandidate) => (c.master.offer?.state === "hidden" ? m.calibration_offer_declined() : m.calibration_offer_offered())
  return [
    { id: "file", header: m.dialog_col_file(), cell: (c) => fileName(file(c).path), sortValue: (c) => fileName(file(c).path), rowHeader: true, truncate: true },
    { id: "kind", header: m.run_col_kind(), cell: (c) => candidateKind(m, file(c)), sortValue: (c) => candidateKind(m, file(c)) },
    { id: "project", header: m.calibration_found_in(), cell: (c) => c.project.name, sortValue: (c) => c.project.name, truncate: true },
    { id: "camera", header: m.calibration_key_camera(), cell: (c) => header(c, (h) => h.instrument ?? "–", "–"), sortValue: (c) => header(c, (h) => h.instrument ?? "", ""), truncate: true },
    { id: "gain", header: m.session_gain_offset(), cell: (c) => header(c, gainOffset, "–"), sortValue: (c) => header(c, (h) => h.gain, null), align: "right" },
    { id: "temp", header: m.calibration_key_temp(), cell: (c) => header(c, temperature, "–"), sortValue: (c) => header(c, (h) => h.ccdTempC, null), align: "right" },
    { id: "captured", header: m.coverage_captured(), cell: (c) => header(c, (h) => formatNight(nightOf(h.dateObs), true), "–"), sortValue: (c) => header(c, (h) => h.dateObs, null) },
    { id: "offer", header: m.calibration_output_offer(), cell: (c) => <Pill tone={c.master.offer?.state === "hidden" ? "muted" : "info"}>{offer(c)}</Pill>, sortValue: offer },
  ]
}

function processColumns(m: Messages, catalog: Catalog): Column<ProcessView>[] {
  const name = (p: ProcessView) => say(m, p.name)
  const step = (p: ProcessView) => (p.current ? say(m, CALIBRATION_STEP_NAME[p.current]) : "–")
  const tool = (p: ProcessView) => (p.process.profileId ? (catalog.profiles[p.process.profileId]?.name ?? "–") : "–")
  const night = (p: ProcessView) => p.session?.night ?? p.process.createdAt.slice(0, 10)
  return [
    { id: "process", header: m.calibration_process(), cell: name, sortValue: name, rowHeader: true, truncate: true },
    { id: "kind", header: m.run_col_kind(), cell: (p) => say(m, KIND_NAME[p.process.kind]), sortValue: (p) => p.process.kind },
    { id: "night", header: m.tonight_night(), cell: (p) => formatNight(night(p), true), sortValue: night },
    { id: "frames", header: m.calibration_frames(), cell: (p) => formatCount(p.frames), sortValue: (p) => p.frames, align: "right" },
    { id: "step", header: m.project_col_step(), cell: step, sortValue: step },
    { id: "tool", header: m.calibration_tool(), cell: tool, sortValue: tool, truncate: true },
    {
      id: "state",
      header: m.calibration_state(),
      cell: (p) => <Pill tone={PROCESS_STATUS[p.status].tone}>{say(m, PROCESS_STATUS[p.status].word)}</Pill>,
      sortValue: (p) => say(m, PROCESS_STATUS[p.status].word),
    },
  ]
}

function hiddenColumns(m: Messages, catalog: Catalog): Column<CalibrationMaster>[] {
  const label = (master: CalibrationMaster) => masterLabel(m, catalog, master)
  return [
    { id: "master", header: m.calibration_master(), cell: label, sortValue: label, rowHeader: true, truncate: true },
    { id: "at", header: m.calibration_hidden_on(), cell: (master) => (master.hiddenAt ? formatDateTime(master.hiddenAt) : "–"), sortValue: (master) => master.hiddenAt ?? null },
  ]
}

/** The master record's facts (CAL-FR-14): what it matches, its camera link, its age by the newest version and the sessions its versions are pinned on. */
function masterFacts(m: Messages, catalog: Catalog, master: CalibrationMaster, sessions: Session[], old: string | null, now: number): KeyValueItem[] {
  const none = "–"
  const newest = newestVersion(master)
  const ageDays = newest ? Math.floor((now - Date.parse(newest.capturedAt)) / 86_400_000) : null
  const linked = master.cameraId ? catalog.cameras[master.cameraId] : undefined
  const items: KeyValueItem[] = [
    { label: m.run_col_kind(), value: say(m, KIND_NAME[master.kind]) },
    { label: m.calibration_key_camera(), value: master.cameraName ?? none },
    { label: m.calibration_linked_camera(), value: linked ? (linked.physicalAlias ?? linked.name) : m.calibration_match_by_model() },
    { label: m.domain_optical_train(), value: master.opticalTrainId ? rigName(m, catalog, master.opticalTrainId) : none },
    { label: m.tonight_filter(), value: master.channel ?? none },
    { label: m.calibration_key_exposure(), value: exposure(master) },
    { label: m.session_gain_offset(), value: gainOffset(master) },
    { label: m.domain_criterion_temperature(), value: temperature(master) },
    { label: m.domain_criterion_binning(), value: `${master.binning}×${master.binning}` },
    { label: m.calibration_age(), value: old ?? (ageDays === null ? none : m.calibration_age_days({ n: ageDays })) },
    { label: m.calibration_used_by(), value: <UsedBy sessions={sessions} /> },
  ]
  if (master.hiddenAt) items.push({ label: m.calibration_hidden_on(), value: formatDateTime(master.hiddenAt) })
  return items
}

/** One dated version's facts: its capture time, provenance, file, digest and the sessions that pin it. */
function versionFacts(m: Messages, catalog: Catalog, version: MasterVersion, sessions: Session[]): KeyValueItem[] {
  const session = version.origin.sessionId ? catalog.sessions[version.origin.sessionId] : undefined
  const origin = originWord(m, version.origin.kind)
  return [
    { label: m.coverage_captured(), value: formatDateTime(version.capturedAt) },
    { label: m.evidence_column_source(), value: session ? `${origin} · ${formatNight(session.night, true)}` : origin },
    { label: m.calibration_frames(), value: version.frameCount === null ? "–" : formatCount(version.frameCount) },
    { label: m.calibration_stored(), value: version.path, mono: true },
    { label: m.storage_sha256(), value: version.adoption?.verifiedSha256 ?? version.sha256, mono: true },
    { label: m.calibration_used_by(), value: <UsedBy sessions={sessions} /> },
  ]
}
