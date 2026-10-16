/**
 * S14 Calibration library (slice E; CAL-FR-13 to CAL-FR-17, LIB-FR-26,
 * P-CAL3): a ListPage with three views.
 *
 * - Masters: one table grouped by kind, filtered by search, Kind, Camera and
 *   Age. A master is one record with dated versions (CAL-FR-14); darks, bias
 *   and dark flats whose newest version is older than the setting read
 *   "Old · {n} d"; flats never age. A row opens the master's DetailPanel:
 *   every recorded fact, each version with its file, digest and the
 *   sessions it is pinned on, Add version… (a new dated version that moves
 *   no session), Hide and Move to Trash. Hide and Move to Trash are refused
 *   while an open, Closed or Archived Project uses the master through its
 *   sessions, naming those Projects; otherwise their confirmation lists the
 *   sessions it is pinned on, which then need calibration again. The
 *   master's menu links it to one physical camera (LIB-FR-26).
 * - Processes: one row per calibration process; a row opens its StepPage
 *   (`/calibration/processes/$processId/$step`).
 * - Hidden: hidden masters, each with Show master (CAL-FR-16).
 *
 * Header: Import masters… (Folder → Preview, CAL-FR-13) and the
 * "Calibration ▾" object menu with Calibration settings… (keep raw frames,
 * old masters after). Search parameters: `view`, `process` (opens Processes
 * on that row), `master` (opens its details) and `filter=dismissed` (Hidden).
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { Inbox, Layers, SearchX } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { useFollowLink } from "@/app/run-ui"
import { ActionButton } from "@/components/app/actions"
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
import { KIND_NAME, masterAge, newestVersion, versionDrift, versionsNewestFirst } from "@/domain/calibration"
import { type MasterPin, masterPins, masterProjects, versionPins } from "@/domain/calibration-library"
import { CALIBRATION_STEP_NAME, calibrationProcesses, type ProcessView } from "@/domain/calibration-process"
import { projectLink, rigName, type StepLink } from "@/domain/derive"
import { fileAt } from "@/domain/disk"
import { sessionLabel } from "@/domain/membership"
import type { CalibrationKind, CalibrationMaster, Catalog, Disk, MasterId, MasterVersion, Session } from "@/domain/types"
import { fileName, formatCount, formatDateTime, formatExposure, formatNight } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { hideMaster, restoreMaster, setMasterCamera, trashMaster } from "@/store/actions/calibration"
import { type CommitResult, useStore } from "@/store/core"
import { masterLabel, masterNight, PROCESS_STATUS, versionNight } from "./calibration-model"
import { AddMasterVersionDialog, CalibrationSettingsDialog, ImportMastersDialog } from "./dialogs"

type View = "masters" | "processes" | "hidden"

const KIND_ORDER: CalibrationKind[] = ["flat", "dark", "bias", "dark-flat"]

function kindHeading(m: Messages, kind: CalibrationKind): string {
  return { flat: m.calibration_heading_flats, dark: m.calibration_heading_darks, bias: m.calibration_heading_bias, "dark-flat": m.calibration_heading_dark_flats }[kind]()
}

function originWord(m: Messages, kind: MasterVersion["origin"]["kind"]): string {
  return { library: m.calibration_origin_indexed, generated: m.calibration_origin_results, stacked: m.calibration_origin_stacked, imported: m.calibration_origin_imported }[kind]()
}

const gainOffset = (master: CalibrationMaster) => `${master.gain ?? "–"} · ${master.offset ?? "–"}`
const temperature = (master: CalibrationMaster) => (master.ccdTempC === null ? "–" : `${Math.round(master.ccdTempC)} °C`)
const exposure = (master: CalibrationMaster) => (master.exposureS === null ? "–" : formatExposure(master.exposureS))
const sessionLink = (sessionId: string): StepLink => ({ to: "/sessions/$sessionId", params: { sessionId } })

/** The sessions of some pins, once each, in pin order. */
function pinnedSessions(pins: readonly MasterPin[]): Session[] {
  return [...new Map(pins.map((p) => [p.session.id, p.session])).values()]
}

/** "3 sessions" with the sessions in its preview, each linked to its page; plain text when no session pins the master. */
function UsedBy({ pins }: { pins: MasterPin[] }) {
  const m = useMessages()
  const sessions = pinnedSessions(pins)
  const label = m.session_count({ count: sessions.length })
  const first = sessions[0]
  if (!first) return label
  return <UsedByPreview label={label} link={sessionLink(first.id)} items={sessions.map((s) => ({ label: sessionLabel(m, s), link: sessionLink(s.id) }))} />
}

/** Adopted or Candidate, then Drifted (a version's bytes no longer match) and Old · {n} d when they apply. */
function MasterState({ master, old }: { master: CalibrationMaster; old: string | null }) {
  const disk = useStore((s) => s.disk)
  const drifted = master.state === "adopted" && master.versions.some((v) => versionDrift(disk, v) !== null)
  return (
    <>
      <StatusBadge kind="master" value={master.state} />
      {drifted ? <StatusBadge kind="content" value="drifted" /> : null}
      {old ? <Pill tone="warning">{old}</Pill> : null}
    </>
  )
}

/** Search text of a master: kind, filter, camera, rig and its versions' paths. */
function haystack(m: Messages, catalog: Catalog, master: CalibrationMaster): string {
  return [say(m, KIND_NAME[master.kind]), master.channel, master.cameraName, master.opticalTrainId ? rigName(m, catalog, master.opticalTrainId) : null, ...master.versions.map((v) => v.path)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

/** One version's file as the Move to Trash confirmation lists it. */
function trashRow(disk: Disk, version: MasterVersion): FileRow {
  return { file: fileName(version.path), from: version.path.slice(0, version.path.lastIndexOf("/")), action: "trash", size: fileAt(disk, version.path)?.sizeBytes ?? 0 }
}

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
  const [kind, setKind] = useState("")
  const [camera, setCamera] = useState("")
  const [age, setAge] = useState("")
  const [detailId, setDetailId] = useState<MasterId | null>(search.master ?? null)
  const [importing, setImporting] = useState(false)
  const [editingSettings, setEditingSettings] = useState(false)
  const [addingVersion, setAddingVersion] = useState<CalibrationMaster | null>(null)

  const view: View = search.view === "processes" || search.view === "hidden" || search.view === "masters" ? search.view : search.process ? "processes" : search.filter === "dismissed" ? "hidden" : "masters"
  const pins = masterPins(catalog)
  const pinsOf = (master: CalibrationMaster) => pins.get(master.id) ?? []
  const now = Date.now() + clockOffset
  const oldLabel = (master: CalibrationMaster) => {
    const found = masterAge(master, settings, now)
    return found ? say(m, found.label) : null
  }
  const library = Object.values(catalog.masters).filter((master) => !master.hiddenAt)
  const hidden = Object.values(catalog.masters).filter((master) => master.hiddenAt)
  const processes = calibrationProcesses(catalog)
  const needle = query.trim().toLowerCase()
  const open = detailId ? catalog.masters[detailId] : undefined

  const setView = (next: string) => {
    setQuery("")
    void navigate({ to: "/calibration", search: { view: next }, replace: true })
  }
  const views: PageViews = {
    label: m.calibration_views(),
    value: view,
    onChange: setView,
    items: [
      { id: "masters", label: m.calibration_masters(), count: library.length },
      { id: "processes", label: m.calibration_processes(), count: processes.length },
      { id: "hidden", label: m.calibration_hidden(), count: hidden.length },
    ],
  }

  const importAction: Action = { id: "import-masters", label: m.calibration_import_masters(), kind: "primary", opensDialog: true, run: () => setImporting(true) }
  const menu: ObjectMenu = {
    label: m.nav_calibration(),
    items: [{ id: "calibration-settings", label: m.calibration_settings(), opensDialog: true, run: () => setEditingSettings(true) }],
  }
  const header = { title: m.nav_calibration(), actions: [importAction], menu, views }

  // --- Master details --------------------------------------------------------

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
    return {
      id: "hide-master",
      label,
      unavailable: inUse(master, label),
      confirm: summary ? { title: m.calibration_hide_master_title({ name: masterLabel(m, master) }), summary, confirm: { label } } : undefined,
      run: () => said(hideMaster(master.id), m.calibration_hid_master({ name: masterLabel(m, master) })),
    }
  }
  const trash = (master: CalibrationMaster): Action => {
    const label = m.calibration_move_to_trash()
    return {
      id: "trash-master",
      label,
      kind: "destructive",
      unavailable: inUse(master, label),
      confirm: {
        title: m.calibration_trash_master_title({ name: masterLabel(m, master) }),
        summary: released(master),
        groups: [{ label: m.calibration_versions(), rows: versionsNewestFirst(master).map((v) => trashRow(disk, v)), defaultOpen: true }],
        confirm: { label, kind: "destructive" },
      },
      run: () => trashMaster(master.id).result,
    }
  }
  const show = (master: CalibrationMaster): Action => ({ id: "show-master", label: m.calibration_show_master(), run: () => said(restoreMaster(master.id), m.calibration_shown_master({ name: masterLabel(m, master) })) })
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
        title: masterLabel(m, open),
        status: <StatusBadge kind="master" value={open.state} />,
        actions: open.hiddenAt ? [show(open)] : [addVersion(open), hide(open), trash(open)],
        menu: { label: m.calibration_master(), items: masterLinks(open) },
        content: (
          <>
            <KeyValueList items={masterFacts(m, catalog, open, pinsOf(open), oldLabel(open), now)} />
            {versionsNewestFirst(open).map((version) => (
              <Box key={version.id} title={m.calibration_version_of({ night: formatNight(versionNight(catalog, version), true) })} level={4}>
                <KeyValueList items={versionFacts(m, catalog, version, versionPins(pins, open.id, version.id))} />
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

  // --- Processes view --------------------------------------------------------

  if (view === "processes") {
    const shown = processes.filter((p) => say(m, p.name).toLowerCase().includes(needle))
    const openProcess = (p: ProcessView) => follow({ to: "/calibration/processes/$processId/$step", params: { processId: p.process.id, step: p.current ?? "raws" } })
    const rowActions = (p: ProcessView): MenuItem[] => {
      const items: MenuItem[] = [{ id: "open-process", label: m.calibration_open_process(), run: () => openProcess(p) }]
      if (p.session) items.push({ id: "open-session", label: m.calibration_open_raw_session(), run: () => follow(sessionLink(p.session!.id)) })
      if (p.master) items.push({ id: "open-master", label: m.calibration_open_master(), run: () => setDetailId(p.master!.id) })
      return items
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
                <EmptyState icon={SearchX} title={m.sessions_no_match()} action={<ActionButton action={{ id: "clear", label: m.filters_clear(), run: () => setQuery("") }} />} />
              ),
            toolbar: { search: { label: m.calibration_search_processes(), placeholder: m.calibration_filter_placeholder(), value: query, onChange: setQuery }, matchCount: shown.length },
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
            columns: hiddenColumns(m),
            getRowId: (master) => master.id,
            initialSort: { columnId: "at", direction: "desc" },
            activeRowId: detailId,
            onRowClick: (master) => setDetailId(master.id),
            rowLabel: (master) => masterLabel(m, master),
            rowActions: (master): MenuItem[] => [details(master), show(master)],
            primaryRowAction: show,
            empty:
              hidden.length === 0 ? (
                <EmptyState icon={Inbox} title={m.calibration_nothing_hidden()} action={<ActionButton action={{ id: "show-masters", label: m.calibration_masters(), run: () => setView("masters") }} />} />
              ) : (
                <EmptyState icon={SearchX} title={m.sessions_no_match()} action={<ActionButton action={{ id: "clear", label: m.filters_clear(), run: () => setQuery("") }} />} />
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

  const cameras = [...new Set(library.map((master) => master.cameraName ?? "–"))].sort()
  const shown = library.filter(
    (master) =>
      (kind === "" || master.kind === kind) &&
      (camera === "" || (master.cameraName ?? "–") === camera) &&
      (age === "" || oldLabel(master) !== null) &&
      haystack(m, catalog, master).includes(needle),
  )
  const facets: Facet[] = [
    {
      id: "kind",
      label: m.run_col_kind(),
      kind: "single",
      value: kind,
      options: KIND_ORDER.filter((k) => library.some((master) => master.kind === k)).map((k) => ({ value: k, label: say(m, KIND_NAME[k]), count: library.filter((master) => master.kind === k).length })),
    },
    { id: "camera", label: m.calibration_key_camera(), kind: "single", value: camera, options: cameras.map((c) => ({ value: c, label: c, count: library.filter((master) => (master.cameraName ?? "–") === c).length })) },
    { id: "age", label: m.calibration_age(), kind: "single", value: age, options: [{ value: "old", label: m.calibration_age_old(), count: library.filter((master) => oldLabel(master) !== null).length }] },
  ]
  const clearFilters = () => {
    setQuery("")
    setKind("")
    setCamera("")
    setAge("")
  }
  const rowActions = (master: CalibrationMaster): MenuItem[] => [details(master), addVersion(master), ...masterLinks(master), { separator: true }, hide(master), trash(master)]

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
          groups: {
            key: (master) => master.kind,
            label: (key, rows) => (
              <>
                {kindHeading(m, key as CalibrationKind)} <CountBadge count={rows.length} />
              </>
            ),
            compare: (a, b) => KIND_ORDER.indexOf(a as CalibrationKind) - KIND_ORDER.indexOf(b as CalibrationKind),
          },
          initialSort: { columnId: "night", direction: "desc" },
          activeRowId: detailId,
          onRowClick: (master) => setDetailId(master.id),
          rowLabel: (master) => masterLabel(m, master),
          rowActions,
          stickyFirstColumn: true,
          empty:
            library.length === 0 ? (
              <EmptyState icon={Inbox} title={m.calibration_no_masters()} action={<ActionButton action={{ ...importAction, kind: "standard" }} />} />
            ) : (
              <EmptyState icon={SearchX} title={m.sessions_no_match()} action={<ActionButton action={{ id: "clear", label: m.filters_clear(), run: clearFilters }} />} />
            ),
          toolbar: {
            search: { label: m.calibration_filter_label(), placeholder: m.calibration_filter_placeholder(), value: query, onChange: setQuery },
            facets: {
              items: facets,
              onChange: (patch) => {
                if (typeof patch.kind === "string") setKind(patch.kind)
                if (typeof patch.camera === "string") setCamera(patch.camera)
                if (typeof patch.age === "string") setAge(patch.age)
              },
            },
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
  const label = (master: CalibrationMaster) => masterLabel(m, master)
  const night = (master: CalibrationMaster) => masterNight(catalog, master)
  const users = (master: CalibrationMaster) => pins.get(master.id) ?? []
  return [
    { id: "master", header: m.calibration_master(), cell: label, sortValue: label, rowHeader: true, truncate: true },
    { id: "filter", header: m.tonight_filter(), truncate: true, cell: (master) => master.channel ?? "–", sortValue: (master) => master.channel ?? "" },
    { id: "exposure", header: m.calibration_key_exposure(), cell: exposure, sortValue: (master) => master.exposureS, align: "right" },
    { id: "gain", header: m.session_gain_offset(), cell: gainOffset, sortValue: (master) => master.gain, align: "right" },
    { id: "temp", header: m.calibration_key_temp(), cell: temperature, sortValue: (master) => master.ccdTempC, align: "right" },
    { id: "versions", header: m.calibration_versions(), cell: (master) => formatCount(master.versions.length), sortValue: (master) => master.versions.length, align: "right" },
    { id: "night", header: m.tonight_night(), truncate: true, cell: (master) => formatNight(night(master), true), sortValue: night },
    { id: "used-by", header: m.calibration_used_by(), cell: (master) => <UsedBy pins={users(master)} />, sortValue: (master) => pinnedSessions(users(master)).length },
    { id: "state", header: m.calibration_state(), cell: (master) => <MasterState master={master} old={oldLabel(master)} />, sortValue: (master) => `${oldLabel(master) ? 0 : 1}${master.state}` },
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

function hiddenColumns(m: Messages): Column<CalibrationMaster>[] {
  const label = (master: CalibrationMaster) => masterLabel(m, master)
  return [
    { id: "master", header: m.calibration_master(), cell: label, sortValue: label, rowHeader: true, truncate: true },
    { id: "at", header: m.calibration_hidden_on(), cell: (master) => (master.hiddenAt ? formatDateTime(master.hiddenAt) : "–"), sortValue: (master) => master.hiddenAt ?? null },
  ]
}

/** The master record's facts (CAL-FR-14): what it matches, its camera link, its age by the newest version and the sessions its versions are pinned on. */
function masterFacts(m: Messages, catalog: Catalog, master: CalibrationMaster, pins: MasterPin[], old: string | null, now: number): KeyValueItem[] {
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
    { label: m.calibration_used_by(), value: <UsedBy pins={pins} /> },
  ]
  if (master.hiddenAt) items.push({ label: m.calibration_hidden_on(), value: formatDateTime(master.hiddenAt) })
  return items
}

/** One dated version's facts: its capture time, provenance, file, digest and the sessions that pin it. */
function versionFacts(m: Messages, catalog: Catalog, version: MasterVersion, pins: MasterPin[]): KeyValueItem[] {
  const session = version.origin.sessionId ? catalog.sessions[version.origin.sessionId] : undefined
  const origin = originWord(m, version.origin.kind)
  return [
    { label: m.coverage_captured(), value: formatDateTime(version.capturedAt) },
    { label: m.evidence_column_source(), value: session ? `${origin} · ${formatNight(session.night, true)}` : origin },
    { label: m.calibration_frames(), value: version.frameCount === null ? "–" : formatCount(version.frameCount) },
    { label: m.calibration_stored(), value: version.path, mono: true },
    { label: m.storage_sha256(), value: version.adoption?.verifiedSha256 ?? version.sha256, mono: true },
    { label: m.calibration_used_by(), value: <UsedBy pins={pins} /> },
  ]
}
