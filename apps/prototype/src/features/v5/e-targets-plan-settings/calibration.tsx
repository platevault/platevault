/**
 * S14 Calibration library (slice E; P-CAL2, P-CAL3, C2, C9): a ListPage with
 * three views.
 *
 * - Masters: one table grouped by kind, filtered by search, Kind, Camera and
 *   Age. Darks, bias and dark flats older than the setting read
 *   "Old · {n} d"; flats never age (C9). A row opens the master's
 *   DetailPanel: every recorded fact, Used by as a preview, Replace… (C9) and
 *   Hide (P-CAL2).
 * - Processes: one row per calibration process; a row opens its StepPage
 *   (`/calibration/processes/$processId/$step`).
 * - Hidden: hidden masters and the master offers runs dismissed, each with
 *   Restore. A replaced master stays here, named by its replacement.
 *
 * Header: Import masters… (Folder → Preview, C9) and the "Calibration ▾"
 * object menu with Calibration settings… (keep raw frames, old masters
 * after). Search parameters: `view`, `process` (opens Processes on that
 * row), `master` (opens its details) and `filter=dismissed` (Hidden).
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { Inbox, Layers, SearchX } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { useFollowLink } from "@/app/run-ui"
import { ActionButton } from "@/components/app/actions"
import type { Action, Column, Facet, MenuItem } from "@/components/app/contracts"
import { KeyValueList, type KeyValueItem } from "@/components/app/data"
import { EmptyState, toast } from "@/components/app/feedback"
import { CountBadge, Pill } from "@/components/app/pill"
import { UsedByPreview } from "@/components/app/previews"
import { StatusBadge } from "@/components/app/status"
import type { PageDetail } from "@/components/templates/detail-panel"
import { ListPage } from "@/components/templates/list-page"
import type { ObjectMenu, PageViews } from "@/components/templates/parts"
import { inputDrift, KIND_NAME, masterAge } from "@/domain/calibration"
import { type Dismissal, dismissals, type MasterUse, masterUsage } from "@/domain/calibration-library"
import { CALIBRATION_STEP_NAME, calibrationProcesses, type ProcessView } from "@/domain/calibration-process"
import { rigName, runStepLink } from "@/domain/derive"
import type { CalibrationKind, CalibrationMaster, Catalog, Disk, MasterId, Run } from "@/domain/types"
import { fileName, formatCount, formatDateTime, formatExposure, formatNight } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { hideMaster, restoreMaster, restoreMasterOffer } from "@/store/actions/calibration"
import { type CommitResult, useStore } from "@/store/core"
import { masterLabel, masterNight, masterSha256, PROCESS_STATUS } from "./calibration-model"
import { CalibrationSettingsDialog, ImportMastersDialog, ReplaceMasterDialog } from "./dialogs"

type View = "masters" | "processes" | "hidden"

const KIND_ORDER: CalibrationKind[] = ["flat", "dark", "bias", "dark-flat"]

function kindHeading(m: Messages, kind: CalibrationKind): string {
  return { flat: m.calibration_heading_flats, dark: m.calibration_heading_darks, bias: m.calibration_heading_bias, "dark-flat": m.calibration_heading_dark_flats }[kind]()
}

function originWord(m: Messages, kind: CalibrationMaster["origin"]["kind"]): string {
  return { library: m.calibration_origin_indexed, generated: m.calibration_origin_results, stacked: m.calibration_origin_stacked, imported: m.calibration_origin_imported }[kind]()
}

const gainOffset = (master: CalibrationMaster) => `${master.gain ?? "–"} · ${master.offset ?? "–"}`
const temperature = (master: CalibrationMaster) => (master.ccdTempC === null ? "–" : `${Math.round(master.ccdTempC)} °C`)
const exposure = (master: CalibrationMaster) => (master.exposureS === null ? "–" : formatExposure(master.exposureS))

/** The run whose Calibrate step offers this candidate master, if any. */
function offeringRun(catalog: Catalog, masterId: MasterId): Run | undefined {
  return Object.values(catalog.runs).find((r) => !r.trashedAt && r.masterOffers.some((o) => o.masterId === masterId && o.state === "pending"))
}

/** "Used by 2 runs" with the runs in its preview; plain text when no run uses the master. */
function UsedBy({ usage }: { usage: MasterUse[] }) {
  const m = useMessages()
  const label = m.calibration_used_by_runs({ count: usage.length })
  const first = usage[0]
  if (!first) return label
  return <UsedByPreview label={label} link={runStepLink(first.run, "calibrate")} items={usage.map((u) => ({ label: u.run.name, link: runStepLink(u.run, "calibrate") }))} />
}

/** Adopted or Candidate, then Drifted, Old · {n} d and Offered when they apply. */
function MasterState({ master, old }: { master: CalibrationMaster; old: string | null }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const drifted = master.state === "adopted" && inputDrift(catalog, disk, { type: "master", masterId: master.id }) !== null
  const offered = master.state === "candidate" && offeringRun(catalog, master.id) !== undefined
  return (
    <>
      <StatusBadge kind="master" value={master.state} />
      {drifted ? <StatusBadge kind="content" value="drifted" /> : null}
      {old ? <Pill tone="warning">{old}</Pill> : null}
      {offered ? <Pill tone="info">{m.calibration_offered()}</Pill> : null}
    </>
  )
}

/** Search text of a master: kind, filter, camera, rig and path. */
function haystack(m: Messages, catalog: Catalog, master: CalibrationMaster): string {
  return [say(m, KIND_NAME[master.kind]), master.channel, master.cameraName, master.opticalTrainId ? rigName(m, catalog, master.opticalTrainId) : null, master.path].filter(Boolean).join(" ").toLowerCase()
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
  /** The Hidden row whose details are open: a hidden master and a dismissed offer of a listed master take different actions. */
  const [hiddenRowId, setHiddenRowId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [editingSettings, setEditingSettings] = useState(false)
  const [replacing, setReplacing] = useState<CalibrationMaster | null>(null)

  const view: View = search.view === "processes" || search.view === "hidden" || search.view === "masters" ? search.view : search.process ? "processes" : search.filter === "dismissed" ? "hidden" : "masters"
  const usage = masterUsage(catalog, disk)
  const now = Date.now() + clockOffset
  const oldLabel = (master: CalibrationMaster) => {
    const found = masterAge(master, settings, now)
    return found ? say(m, found.label) : null
  }
  const library = Object.values(catalog.masters).filter((master) => !master.dismissedAt)
  const hidden = dismissals(catalog)
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
  const hide = (master: CalibrationMaster): Action => ({ id: "hide-master", label: m.calibration_hide_master(), run: () => said(hideMaster(master.id), m.calibration_hid_master({ name: fileName(master.path) })) })
  const show = (master: CalibrationMaster): Action => ({ id: "show-master", label: m.calibration_show_master(), run: () => said(restoreMaster(master.id), m.calibration_shown_master({ name: fileName(master.path) })) })
  const replace = (master: CalibrationMaster): Action => ({ id: "replace-master", label: m.calibration_replace(), opensDialog: true, run: () => setReplacing(master) })
  const details = (master: CalibrationMaster): Action => ({ id: "details", label: m.settings_details(), run: () => setDetailId(master.id) })

  /** The master's own links: its raw session and the run that offers it. */
  const masterLinks = (master: CalibrationMaster): MenuItem[] => {
    const items: MenuItem[] = []
    const run = master.state === "candidate" ? offeringRun(catalog, master.id) : undefined
    if (run) items.push({ id: "open-offer", label: m.calibration_open_offer(), run: () => follow(runStepLink(run, "calibrate")) })
    const sessionId = master.origin.sessionId
    if (sessionId && catalog.sessions[sessionId]) items.push({ id: "open-session", label: m.calibration_open_raw_session(), run: () => follow({ to: "/sessions/$sessionId", params: { sessionId } }) })
    return items
  }

  const detail: PageDetail | null = open
    ? {
        dockId: "calibration-masters",
        title: masterLabel(m, open),
        status: <StatusBadge kind="master" value={open.state} />,
        actions: open.dismissedAt ? (open.replacedBy ? [] : [show(open)]) : [replace(open), hide(open)],
        menu: { label: m.calibration_master(), items: masterLinks(open) },
        content: <KeyValueList items={masterFacts(m, catalog, disk, open, usage.get(open.id) ?? [], oldLabel(open), now)} />,
        onClose: () => setDetailId(null),
      }
    : null

  const dialogs = (
    <>
      <ImportMastersDialog open={importing} onOpenChange={setImporting} />
      <CalibrationSettingsDialog open={editingSettings} onOpenChange={setEditingSettings} />
      <ReplaceMasterDialog master={replacing} onOpenChange={(next) => !next && setReplacing(null)} />
    </>
  )

  // --- Processes view --------------------------------------------------------

  if (view === "processes") {
    const shown = processes.filter((p) => say(m, p.name).toLowerCase().includes(needle))
    const openProcess = (p: ProcessView) => follow({ to: "/calibration/processes/$processId/$step", params: { processId: p.process.id, step: p.current ?? "raws" } })
    const rowActions = (p: ProcessView): MenuItem[] => {
      const items: MenuItem[] = [{ id: "open-process", label: m.calibration_open_process(), run: () => openProcess(p) }]
      if (p.session) items.push({ id: "open-session", label: m.calibration_open_raw_session(), run: () => follow({ to: "/sessions/$sessionId", params: { sessionId: p.session!.id } }) })
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
    const shown = hidden.filter((d) => haystack(m, catalog, d.master).includes(needle) || (d.kind === "offer" && d.run.name.toLowerCase().includes(needle)))
    const openHidden = open ? (hidden.find((d) => hiddenId(d) === hiddenRowId && d.master.id === open.id) ?? hidden.find((d) => d.master.id === open.id)) : undefined
    const restoreHidden = (d: Dismissal): Action | null => {
      if (d.kind === "offer") return { id: "restore-offer", label: m.store_cal_restore_offer(), run: () => said(restoreMasterOffer(d.run.id, d.master.id), m.calibration_offer_restored()) }
      return d.master.replacedBy ? null : show(d.master)
    }
    const openRun = (d: Dismissal): MenuItem[] => (d.kind === "offer" ? [{ id: "open-run", label: m.calibration_open_run(), run: () => follow(runStepLink(d.run, "calibrate")) }] : [])
    const openRow = (d: Dismissal) => {
      setHiddenRowId(hiddenId(d))
      setDetailId(d.master.id)
    }
    const rowActions = (d: Dismissal): MenuItem[] => {
      const action = restoreHidden(d)
      return [{ id: "details", label: m.settings_details(), run: () => openRow(d) }, ...(action ? [action] : []), ...openRun(d)]
    }
    // The panel acts on the row it was opened from: Show master or Restore offer, never Hide.
    const hiddenDetail: PageDetail | null =
      detail && openHidden
        ? { ...detail, actions: [restoreHidden(openHidden)].filter((a): a is Action => a !== null), menu: { label: m.calibration_master(), items: [...openRun(openHidden), ...masterLinks(openHidden.master)] } }
        : detail
    return (
      <>
        <ListPage
          {...header}
          summary={m.calibration_hidden_count({ count: hidden.length })}
          table={{
            label: m.calibration_hidden_caption(),
            rows: shown,
            columns: hiddenColumns(m, catalog),
            getRowId: hiddenId,
            initialSort: { columnId: "at", direction: "desc" },
            activeRowId: openHidden ? hiddenId(openHidden) : null,
            onRowClick: openRow,
            rowLabel: (d) => masterLabel(m, d.master),
            rowActions,
            primaryRowAction: restoreHidden,
            empty:
              hidden.length === 0 ? (
                <EmptyState icon={Inbox} title={m.calibration_nothing_hidden()} action={<ActionButton action={{ id: "show-masters", label: m.calibration_masters(), run: () => setView("masters") }} />} />
              ) : (
                <EmptyState icon={SearchX} title={m.sessions_no_match()} action={<ActionButton action={{ id: "clear", label: m.filters_clear(), run: () => setQuery("") }} />} />
              ),
            toolbar: { search: { label: m.calibration_filter_label(), placeholder: m.calibration_filter_placeholder(), value: query, onChange: setQuery }, matchCount: shown.length },
          }}
          detail={hiddenDetail}
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
  const rowActions = (master: CalibrationMaster): MenuItem[] => [details(master), replace(master), ...masterLinks(master), { separator: true }, hide(master)]

  return (
    <>
      <ListPage
        {...header}
        summary={m.calibration_masters_count({ count: library.length })}
        table={{
          label: m.calibration_masters(),
          rows: shown,
          columns: masterColumns(m, catalog, usage, oldLabel),
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

const hiddenId = (d: Dismissal) => (d.kind === "master" ? d.master.id : `${d.run.id}:${d.master.id}`)

function masterColumns(m: Messages, catalog: Catalog, usage: Map<MasterId, MasterUse[]>, oldLabel: (master: CalibrationMaster) => string | null): Column<CalibrationMaster>[] {
  const label = (master: CalibrationMaster) => masterLabel(m, master)
  const night = (master: CalibrationMaster) => masterNight(catalog, master)
  const users = (master: CalibrationMaster) => usage.get(master.id) ?? []
  return [
    { id: "master", header: m.calibration_master(), cell: label, sortValue: label, rowHeader: true, truncate: true },
    { id: "filter", header: m.tonight_filter(), cell: (master) => master.channel ?? "–", sortValue: (master) => master.channel ?? "" },
    { id: "exposure", header: m.calibration_key_exposure(), cell: exposure, sortValue: (master) => master.exposureS, align: "right" },
    { id: "gain", header: m.session_gain_offset(), cell: gainOffset, sortValue: (master) => master.gain, align: "right" },
    { id: "temp", header: m.calibration_key_temp(), cell: temperature, sortValue: (master) => master.ccdTempC, align: "right" },
    { id: "frames", header: m.calibration_frames(), cell: (master) => (master.frameCount === null ? "–" : formatCount(master.frameCount)), sortValue: (master) => master.frameCount, align: "right" },
    { id: "night", header: m.tonight_night(), cell: (master) => formatNight(night(master), true), sortValue: night },
    { id: "used-by", header: m.calibration_used_by(), cell: (master) => <UsedBy usage={users(master)} />, sortValue: (master) => users(master).length },
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
    { id: "tool", header: m.calibration_tool(), cell: tool, sortValue: tool },
    {
      id: "state",
      header: m.calibration_state(),
      cell: (p) => <Pill tone={PROCESS_STATUS[p.status].tone}>{say(m, PROCESS_STATUS[p.status].word)}</Pill>,
      sortValue: (p) => say(m, PROCESS_STATUS[p.status].word),
    },
  ]
}

function hiddenColumns(m: Messages, catalog: Catalog): Column<Dismissal>[] {
  const label = (d: Dismissal) => masterLabel(m, d.master)
  const run = (d: Dismissal) => (d.kind === "offer" ? d.run.name : "–")
  const replacedBy = (d: Dismissal) => (d.master.replacedBy ? catalog.masters[d.master.replacedBy] : undefined)
  const state = (d: Dismissal) => {
    const by = replacedBy(d)
    return by ? m.calibration_replaced_by({ name: fileName(by.path) }) : d.kind === "offer" ? m.calibration_offer_dismissed() : m.calibration_hidden()
  }
  return [
    { id: "master", header: m.calibration_master(), cell: label, sortValue: label, rowHeader: true, truncate: true },
    { id: "run", header: m.calibration_run(), cell: run, sortValue: run },
    { id: "state", header: m.calibration_state(), cell: state, sortValue: state },
    { id: "at", header: m.calibration_hidden_on(), cell: (d) => formatDateTime(d.at), sortValue: (d) => d.at },
  ]
}

/** Every recorded fact of one master (FB "Masters have details"). */
function masterFacts(m: Messages, catalog: Catalog, disk: Disk, master: CalibrationMaster, usage: MasterUse[], old: string | null, now: number): KeyValueItem[] {
  const none = "–"
  const session = master.origin.sessionId ? catalog.sessions[master.origin.sessionId] : undefined
  const ageDays = Math.floor((now - Date.parse(master.createdAt)) / 86_400_000)
  const replacement = master.replacedBy ? catalog.masters[master.replacedBy] : undefined
  const items: KeyValueItem[] = [
    { label: m.run_col_kind(), value: say(m, KIND_NAME[master.kind]) },
    { label: m.calibration_key_camera(), value: master.cameraName ?? none },
    { label: m.domain_optical_train(), value: master.opticalTrainId ? rigName(m, catalog, master.opticalTrainId) : none },
    { label: m.tonight_filter(), value: master.channel ?? none },
    { label: m.calibration_key_exposure(), value: exposure(master) },
    { label: m.session_gain_offset(), value: gainOffset(master) },
    { label: m.domain_criterion_temperature(), value: temperature(master) },
    { label: m.domain_criterion_binning(), value: `${master.binning}×${master.binning}` },
    { label: m.calibration_frames(), value: master.frameCount === null ? none : formatCount(master.frameCount) },
    { label: m.calibration_created(), value: formatDateTime(master.createdAt) },
    { label: m.calibration_age(), value: old ?? m.calibration_age_days({ n: ageDays }) },
    { label: m.evidence_column_source(), value: session ? `${originWord(m, master.origin.kind)} · ${formatNight(session.night, true)}` : originWord(m, master.origin.kind) },
    { label: m.calibration_stored(), value: master.path, mono: true },
    { label: m.storage_sha256(), value: masterSha256(catalog, disk, master) ?? none, mono: true },
    { label: m.calibration_used_by(), value: <UsedBy usage={usage} /> },
  ]
  if (master.dismissedAt) items.push({ label: m.calibration_hidden_on(), value: formatDateTime(master.dismissedAt) })
  if (replacement) items.push({ label: m.calibration_replaced_by_label(), value: fileName(replacement.path), mono: true })
  return items
}
