/**
 * S13 Import (slice A) as a StepPage: `/import?step=source|preview` (§5.2,
 * F9). The Lightroom-style workflow entry (D-W11, D-W12, D-W20, D-W24):
 *
 * - Source: a removable device (detected when connected, its capture layout
 *   recognised: ASIAIR, N.I.N.A., SharpCap, Ekos, SGP or Voyager), a saved
 *   source (Import new skips what it imported before) or a chosen folder,
 *   which can be saved as a source. An existing library folder is added in
 *   Settings › Locations, where it is indexed in place.
 * - Preview (import-preview.tsx): each file's destination; lights become
 *   sessions filed under their Target (P-IMP2), raw calibration frames go to
 *   a calibration process (P-CAL3), masters to the Calibration library;
 *   held and skipped files; Copy or Move. Its terminal Proceed is Import…,
 *   with every file in the confirm. It is unavailable while the preview has
 *   a blocking row (F3).
 * - Import runs as an operation: the page turns read-only and shows its
 *   progress and outcome. A source that vanishes pauses it as Interrupted
 *   until Retry. Its calibration fills only sessions still waiting; sessions
 *   set to No that it matches are offered, unticked, under "Also use for
 *   these sessions" (LIB-FR-25). Import ends by opening the first imported
 *   session the review queue holds (C14), or Sessions with the imported
 *   sessions marked.
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { Check, Download, FolderOpen, FolderSearch, HardDrive, Layers, ListChecks, Plus, RotateCcw, Save } from "lucide-react"
import { useEffect, useState } from "react"
import { useMessages } from "@/app/preferences"
import { useFollowLink } from "@/app/run-ui"
import { ActionBar } from "@/components/app/actions"
import type { Action, Column, FlowStep, MenuItem, StepFlow } from "@/components/app/contracts"
import { DataTable } from "@/components/app/data-table"
import { EmptyState } from "@/components/app/feedback"
import { SwitchField, TextField } from "@/components/app/fields"
import { FolderPicker } from "@/components/app/folder-picker"
import { OperationPanel } from "@/components/app/operation-panel"
import { Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { stepEditable } from "@/components/app/step-flow"
import { StepPage } from "@/components/templates/step-page"
import { type ArrivalUse, type CalSource, calibrationArrival, KIND_NAME, rawSource, sourceRef, versionSource } from "@/domain/calibration"
import { importReviewLink, type StepLink } from "@/domain/derive"
import { removableDevices } from "@/domain/devices"
import { sessionLongLabel } from "@/domain/membership"
import type { CalibrationSource, Operation, SessionId } from "@/domain/types"
import { formatBytes, formatCount, formatDateTime } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { alsoUseCalibration } from "@/store/actions/calibration"
import { type PrototypeState, updateSlice, useStore } from "@/store/core"
import { isSettled } from "@/store/operations"
import { settleGrowingFiles } from "@/store/simulation"
import type { ImportDraft, ImportSourceChoice } from "@/store/slices/a"
import { freshFrameCount, type ImportPlan, planImport, routeFor, savedSourceAt, sourcePathOf, typeLabel } from "./import-model"
import { importConfirm, PreviewStep } from "./import-preview"
import { type ImportPayload, saveImportSource, startImport } from "./import-run"

/** Simulated time the capture device needs to finish writing a held file. */
const SETTLE_MS = 6000

type ImportStepId = "source" | "preview"

function importLink(step: ImportStepId): StepLink {
  return { to: "/import", search: { step } }
}

function setDraft(patch: Partial<ImportDraft>) {
  updateSlice("a", (a) => ({ ...a, importDraft: { ...a.importDraft, ...patch } }))
}

/** A folder as an import source: its saved source when it has one, so Import new applies. */
function choiceAt(state: PrototypeState, path: string): ImportSourceChoice {
  const saved = savedSourceAt(state.catalog, path)
  return saved ? { kind: "saved", id: saved.id } : { kind: "folder", path }
}

/** The usual start: the first connected device with new frames, else any connected device, else the first saved source. */
function defaultSource(state: PrototypeState): ImportSourceChoice | null {
  const connected = removableDevices(state.disk).filter((d) => d.connected)
  const device = connected.find((d) => freshFrameCount(state, d.volume.mountPath) > 0) ?? connected[0]
  if (device) return choiceAt(state, device.volume.mountPath)
  const saved = Object.values(state.catalog.importSources).sort((a, b) => a.name.localeCompare(b.name))[0]
  return saved ? { kind: "saved", id: saved.id } : null
}

function selectSource(source: ImportSourceChoice, newOnly = true) {
  setDraft({ source, newOnly, typed: {}, targets: {} })
}

/** The import this page started, while its operation is recorded. */
function lastImportOp(state: PrototypeState): Operation | null {
  const last = state.slices.a.lastImport
  return last?.kind === "import" ? (state.operations[last.operationId] ?? null) : null
}

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

/**
 * Import as a flow: Source → Preview, ordered. The route's step holds where
 * the user is: Preview is current once the Source step proceeded to it with
 * a readable source, and it stays read-only while Source is not. Import…
 * starts the operation (F2): the flow then has no Proceed and reads the
 * operation's progress, then its outcome.
 */
function importFlow(m: Messages, plan: ImportPlan | null, draft: ImportDraft, step: ImportStepId, op: Operation | null): StepFlow {
  const linkFor = (id: string) => importLink(id as ImportStepId)
  const sourceSummary = plan ? `${plan.sourceLabel} · ${m.session_frame_count({ count: plan.items.length, frames: formatCount(plan.items.length) })}` : m.import_choose_source()
  if (op) {
    const running = !isSettled(op.status)
    const summary = running ? m.sessions_import_progress({ done: formatCount(op.progress.done), total: formatCount(op.progress.total) }) : op.summary ? say(m, op.summary) : say(m, op.title)
    const steps: FlowStep[] = [
      { id: "source", label: m.import_step_source(), state: "finished", summary: say(m, op.title) },
      { id: "preview", label: m.import_preview(), state: op.status === "succeeded" ? "finished" : running ? "current" : "blocked", summary },
    ]
    return { steps, current: "preview", ordered: true, proceed: null, next: null, linkFor }
  }
  const sourceGate = !plan ? { reason: m.import_choose_source(), blockers: [] } : !plan.online ? { reason: plan.blockers[0]?.label ?? m.import_choose_source(), blockers: [] } : null
  const current: ImportStepId = step === "preview" && sourceGate === null ? "preview" : "source"
  const blockers = plan?.blockers ?? []
  const previewGate = blockers.length === 0 ? null : { reason: blockers.length === 1 ? blockers[0]!.label : m.refusal_blockers({ count: blockers.length }), blockers: blockers.length === 1 ? [] : blockers }
  const steps: FlowStep[] = [
    { id: "source", label: m.import_step_source(), state: current === "source" ? (sourceGate ? "blocked" : "current") : "finished", gate: current === "source" ? sourceGate : null, summary: sourceSummary },
    {
      id: "preview",
      label: m.import_preview(),
      state: current === "preview" ? (previewGate ? "blocked" : "current") : "todo",
      gate: current === "preview" ? previewGate : null,
      summary: plan?.online ? `${m.session_frame_count({ count: plan.items.length, frames: formatCount(plan.items.length) })} · ${formatBytes(plan.bytes)}` : undefined,
    },
  ]
  if (current === "source") return { steps, current, ordered: true, proceed: { id: "import-proceed", label: m.stepflow_proceed(), run: () => undefined }, next: importLink("preview"), linkFor }
  const proceed: Action = {
    id: "import-start",
    label: m.stepflow_import(),
    ...(plan && plan.items.length > 0 ? { confirm: importConfirm(m, plan, draft) } : {}),
    run: () => {
      if (plan && plan.blockers.length === 0) startImport(plan, draft)
    },
  }
  return { steps, current, ordered: true, proceed, next: null, linkFor }
}

export function ImportPage() {
  const m = useMessages()
  const follow = useFollowLink()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { step?: string; location?: string }
  const state = useStore((s) => s)
  const draft = state.slices.a.importDraft
  const plan = planImport(state, draft)
  const op = lastImportOp(state)
  const viewing: ImportStepId = search.step === "preview" ? "preview" : "source"
  const flow = importFlow(m, plan, draft, viewing, op)
  const editable = stepEditable(flow, viewing)

  // The capture device finishes writing: held files settle and join the preview.
  const settling = op ? "" : (plan?.held.settling.map((f) => f.path).join("|") ?? "")
  useEffect(() => {
    if (!settling) return
    const timer = window.setTimeout(() => settleGrowingFiles(settling.split("|")), SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [settling])
  const preselect = draft.source || op ? null : defaultSource(state)
  const preselectKey = preselect ? JSON.stringify(preselect) : ""
  useEffect(() => {
    if (preselectKey) selectSource(JSON.parse(preselectKey) as ImportSourceChoice)
  }, [preselectKey])
  // `?location=<id>` (Home's Import and Retry): that location's folder becomes the source, a Captures one the destination too; the param then drops so the source stays changeable.
  useEffect(() => {
    if (!search.location) return
    const location = state.catalog.locations[search.location]
    if (location && !location.retiredAt) {
      selectSource(choiceAt(state, location.path))
      if (location.role === "captures") setDraft({ capturesLocationId: location.id })
    }
    void navigate({ to: "/import", search: { step: search.step ?? "source" }, replace: true } as never)
    // Only the param's arrival applies it.
  }, [search.location])

  const toSource: Action = { id: "to-source", label: m.import_choose_source(), run: () => follow(importLink("source")) }
  const body =
    op && viewing === "preview" ? (
      <OutcomeStep state={state} op={op} />
    ) : viewing === "source" ? (
      <SourceStep state={state} plan={plan} draft={draft} editable={editable} />
    ) : plan?.online ? (
      <PreviewStep state={state} plan={plan} draft={draft} editable={editable} />
    ) : (
      <EmptyState icon={Download} title={m.import_choose_source()} action={<ActionBar actions={[toSource]} />} />
    )

  return <StepPage title={m.import_flow_title()} flow={flow} viewing={viewing} stepsLabel={m.import_steps()} step={body} />
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

interface SourceRow {
  key: string
  kind: "device" | "saved" | "folder"
  name: string
  path: string
  connected: boolean
  /** New frames under the source; null when it cannot be read. */
  fresh: number | null
  /** How a device's layout was recognised; a saved source's last import. */
  detail: string
  choice: ImportSourceChoice
}

function sourceRows(m: Messages, state: PrototypeState, draft: ImportDraft): SourceRow[] {
  const mounted = (path: string) => Object.values(state.disk.volumes).some((v) => v.mounted && (path === v.mountPath || path.startsWith(`${v.mountPath}/`)))
  const devices = removableDevices(state.disk)
  const rows: SourceRow[] = devices.map((d) => ({
    key: `device:${d.volume.id}`,
    kind: "device",
    name: d.volume.name,
    path: d.volume.mountPath,
    connected: d.connected,
    fresh: d.connected ? freshFrameCount(state, d.volume.mountPath) : null,
    detail: d.connected ? `${d.layout?.label ?? d.label} · ${m.import_file_count({ count: d.imageFiles, files: formatCount(d.imageFiles) })}` : m.import_not_connected(),
    choice: choiceAt(state, d.volume.mountPath),
  }))
  for (const src of Object.values(state.catalog.importSources).sort((a, b) => a.name.localeCompare(b.name))) {
    const connected = mounted(src.path)
    rows.push({
      key: `saved:${src.id}`,
      kind: "saved",
      name: src.name,
      path: src.path,
      connected,
      fresh: connected ? freshFrameCount(state, src.path) : null,
      detail: src.lastImportedAt ? m.import_last_import({ date: formatDateTime(src.lastImportedAt) }) : m.import_never_imported(),
      choice: { kind: "saved", id: src.id },
    })
  }
  const folder = draft.source?.kind === "folder" ? draft.source.path : null
  if (folder && !rows.some((r) => r.path === folder)) {
    const connected = mounted(folder)
    rows.push({ key: `folder:${folder}`, kind: "folder", name: folder.slice(folder.lastIndexOf("/") + 1) || folder, path: folder, connected, fresh: connected ? freshFrameCount(state, folder) : null, detail: m.import_chosen_folder(), choice: { kind: "folder", path: folder } })
  }
  return rows
}

function SourceStep({ state, plan, draft, editable }: { state: PrototypeState; plan: ImportPlan | null; draft: ImportDraft; editable: boolean }) {
  const m = useMessages()
  const follow = useFollowLink()
  const [picking, setPicking] = useState<string | null>(null)
  const [name, setName] = useState("")
  const rows = sourceRows(m, state, draft)
  const selectedPath = sourcePathOf(state, draft)?.path ?? null
  const selected = rows.find((r) => r.path === selectedPath && (draft.source?.kind !== "saved" || r.kind === "saved")) ?? null
  const firstMount = rows.find((r) => r.kind === "device" && r.connected)?.path ?? "/Volumes"
  const choose = (row: SourceRow) => editable && row.connected && selectSource(row.choice)
  const kindLabel: Record<SourceRow["kind"], () => string> = { device: m.import_kind_device, saved: m.import_kind_saved, folder: m.import_kind_folder }

  const columns: Column<SourceRow>[] = [
    { id: "name", header: m.import_column_source(), rowHeader: true, truncate: true, sortValue: (r) => r.name, cell: (r) => r.name },
    { id: "kind", header: m.import_column_type(), sortValue: (r) => r.kind, cell: (r) => kindLabel[r.kind]() },
    { id: "path", header: m.import_column_folder(), truncate: true, sortValue: (r) => r.path, cell: (r) => r.path },
    { id: "detail", header: m.import_column_detail(), truncate: true, sortValue: (r) => r.detail, cell: (r) => r.detail },
    { id: "new", header: m.import_column_new(), align: "right", sortValue: (r) => r.fresh, cell: (r) => (r.fresh === null ? "–" : formatCount(r.fresh)) },
    {
      id: "status",
      header: m.import_column_state(),
      sortValue: (r) => (r.key === selected?.key ? 0 : r.connected ? 1 : 2),
      cell: (r) => (r.key === selected?.key ? <StatusBadge kind="assignment" value="accepted" label={m.import_selected()} /> : <StatusBadge kind="availability" value={r.connected ? "online" : "offline"} label={r.connected ? undefined : m.import_not_connected()} />),
    },
  ]
  const rowActions = (r: SourceRow): MenuItem[] => {
    if (!editable) return []
    const unavailable = r.connected ? undefined : { action: m.import_cant_import(), reason: m.import_source_not_connected({ name: r.name }), blockers: [] }
    if (r.kind === "saved")
      return [
        { id: "import-new", label: m.import_new(), icon: Download, unavailable, run: () => selectSource(r.choice, true) },
        { id: "import-all", label: m.import_all(), icon: Layers, unavailable, run: () => selectSource(r.choice, false) },
      ]
    return [
      { id: "choose", label: m.import_use_source(), icon: Check, unavailable, run: () => selectSource(r.choice) },
      ...(r.kind === "device" ? [{ id: "choose-folder", label: m.import_choose_folder_title(), icon: FolderSearch, opensDialog: true, unavailable, run: () => setPicking(r.path) }] : []),
    ]
  }
  const actions: Action[] = [
    { id: "choose-folder", label: m.import_choose_folder_title(), icon: FolderOpen, opensDialog: true, unavailable: editable ? undefined : { action: m.import_choose_folder_title(), reason: m.stepflow_read_only(), blockers: [] }, run: () => setPicking(firstMount) },
    { id: "library-folder", label: m.import_add_library_folder(), icon: Plus, run: () => follow({ to: "/settings/locations" }) },
  ]
  const saveable = editable && selected?.kind === "folder" && plan?.online
  const save: Action = { id: "save-source", label: m.import_save_source(), icon: Save, run: () => saveImportSource(name, selected!.path) }

  return (
    <>
      <Section title={m.import_sources()} actions={<ActionBar actions={actions} />}>
        <DataTable
          label={m.import_sources()}
          rows={rows}
          columns={columns}
          getRowId={(r) => r.key}
          rowLabel={(r) => r.name}
          rowActions={rowActions}
          activeRowId={selected?.key ?? null}
          onRowClick={editable ? choose : undefined}
          scroll="none"
          empty={<EmptyState icon={HardDrive} title={m.import_none_connected()} action={<ActionBar actions={[actions[0]!]} />} />}
        />
      </Section>
      {selected?.kind === "saved" && plan?.online ? (
        <SwitchField
          label={m.import_new()}
          description={plan.skipped.imported.length > 0 ? m.import_imported_before({ count: plan.skipped.imported.length }) : undefined}
          checked={draft.newOnly}
          disabled={!editable}
          onChange={(newOnly) => setDraft({ newOnly })}
        />
      ) : null}
      {saveable ? (
        <Section title={m.import_save_source()} actions={<ActionBar actions={[save]} />}>
          <TextField label={m.import_source_name()} value={name} onChange={setName} placeholder={m.import_name_placeholder()} />
        </Section>
      ) : null}
      <FolderPicker
        open={picking !== null}
        onOpenChange={(open) => !open && setPicking(null)}
        title={m.import_choose_folder_title()}
        description={m.import_choose_folder_description()}
        initialPath={picking ?? firstMount}
        chooseVerb={m.import_from_verb()}
        onChoose={(path) => {
          selectSource(choiceAt(state, path))
          setPicking(null)
        }}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Progress and outcome
// ---------------------------------------------------------------------------

function OutcomeStep({ state, op }: { state: PrototypeState; op: Operation }) {
  const m = useMessages()
  const follow = useFollowLink()
  const navigate = useNavigate()
  const payload = op.payload as unknown as ImportPayload
  const settled = isSettled(op.status)
  // Lights first: they are what Sessions highlights.
  const imported = payload.sessionIds
    .map((id) => state.catalog.sessions[id])
    .filter((s) => s !== undefined)
    .sort((a, b) => Number(b.imageType === "light") - Number(a.imageType === "light"))
  const masters = payload.copied.filter((c) => routeFor(c.type) === "masters").length
  const toCalibration = masters > 0 || imported.some((s) => s.imageType !== "light")
  const review = settled ? importReviewLink(state.catalog, payload.sessionIds) : null
  const reset = () => {
    updateSlice("a", (a) => ({ ...a, lastImport: null }))
    follow(importLink("source"))
  }
  const actions: Action[] = [
    ...(review ? [{ id: "review", label: m.import_review_sessions(), icon: ListChecks, run: () => follow(review) }] : []),
    ...(settled && imported.some((s) => s.imageType === "light") ? [{ id: "sessions", label: m.import_show_in_sessions(), run: () => void navigate({ to: "/sessions", search: { import: op.id } }) }] : []),
    ...(settled && toCalibration ? [{ id: "calibration", label: m.import_show_in_calibration(), run: () => void navigate({ to: "/calibration" }) }] : []),
    { id: "more", label: m.import_more(), icon: RotateCcw, unavailable: settled ? undefined : { action: m.import_more(), reason: m.status_running(), blockers: [] }, run: reset },
  ]
  type Row = (typeof imported)[number]
  const columns: Column<Row>[] = [
    { id: "session", header: m.session_label(), rowHeader: true, truncate: true, sortValue: (s) => sessionLongLabel(m, s), cell: (s) => sessionLongLabel(m, s) },
    { id: "type", header: m.import_column_type(), sortValue: (s) => s.imageType, cell: (s) => typeLabel(m, s.imageType) },
    { id: "frames", header: m.sessions_column_frames(), align: "right", sortValue: (s) => s.assetIds.length, cell: (s) => formatCount(s.assetIds.length) },
    {
      id: "state",
      header: m.import_column_state(),
      sortValue: (s) => s.target.status,
      cell: (s) => (s.imageType === "light" ? <StatusBadge kind="association" value={s.target.status} /> : m.import_route_stack()),
    },
  ]
  return (
    <>
      <OperationPanel operationId={op.id} headingLevel={3} />
      {payload.trashOperationId ? <OperationPanel operationId={payload.trashOperationId} headingLevel={3} /> : null}
      {settled ? (
        <Section title={m.import_imported()} actions={<ActionBar actions={actions} />}>
          <DataTable
            label={m.import_imported()}
            rows={imported}
            columns={columns}
            getRowId={(s) => s.id}
            rowLabel={(s) => sessionLongLabel(m, s)}
            onRowClick={(s) => (s.imageType === "light" ? follow({ to: "/sessions/$sessionId", params: { sessionId: s.id } }) : void navigate({ to: "/calibration" }))}
            scroll="none"
            empty={masters > 0 ? m.import_master_count({ count: masters }) : m.import_nothing_to_import()}
          />
        </Section>
      ) : (
        <ActionBar actions={actions} />
      )}
      {settled ? <AlsoUseSection state={state} payload={payload} /> : null}
    </>
  )
}

/** The calibration an import brought in, as sources a session can pin: its new master versions and raw calibration sessions. */
function importedSources(state: PrototypeState, payload: ImportPayload): CalSource[] {
  const { catalog, disk } = state
  const dests = new Set(payload.copied.map((c) => c.dest))
  const masters = Object.values(catalog.masters).flatMap((master) => master.versions.filter((v) => dests.has(v.path)).map((v) => versionSource(catalog, master, v)))
  const raws = payload.sessionIds.flatMap((id) => {
    const session = catalog.sessions[id]
    return session && session.imageType !== "light" ? [rawSource(catalog, disk, session)] : []
  })
  return [...masters, ...raws].filter((s): s is CalSource => s !== null)
}

/** "Also use for these sessions" (LIB-FR-25): sessions set to No for a kind that the imported calibration matches, offered unticked. */
function AlsoUseSection({ state, payload }: { state: PrototypeState; payload: ImportPayload }) {
  const m = useMessages()
  const [selected, setSelected] = useState<string[]>([])
  const uses = calibrationArrival(state.catalog, state.settings, importedSources(state, payload)).noSessions
  if (uses.length === 0) return null
  const id = (u: ArrivalUse) => `${u.session.id}|${u.kind}`
  const label = (u: ArrivalUse) => sessionLongLabel(m, u.session)
  const source = (u: ArrivalUse) => say(m, sourceRef(state.catalog, state.disk, u.candidate.source.source))
  const columns: Column<ArrivalUse>[] = [
    { id: "session", header: m.session_label(), rowHeader: true, truncate: true, sortValue: label, cell: label },
    { id: "kind", header: m.run_col_kind(), sortValue: (u) => u.kind, cell: (u) => say(m, KIND_NAME[u.kind]) },
    { id: "source", header: m.evidence_column_source(), truncate: true, sortValue: source, cell: source },
  ]
  const alsoUse = (ids: string[]): Action => ({
    id: "also-use",
    label: m.import_also_use(),
    run: () => {
      const bySource = new Map<string, { source: CalibrationSource; sessionIds: SessionId[] }>()
      for (const u of uses.filter((use) => ids.includes(id(use)))) {
        const entry = bySource.get(u.candidate.source.key) ?? { source: u.candidate.source.source, sessionIds: [] }
        bySource.set(u.candidate.source.key, { ...entry, sessionIds: [...entry.sessionIds, u.session.id] })
      }
      for (const { source: pin, sessionIds } of bySource.values()) {
        const result = alsoUseCalibration(pin, sessionIds)
        if (!result.ok) return result
      }
      setSelected([])
    },
  })
  return (
    <Section title={m.import_also_use_title()}>
      <DataTable
        label={m.import_also_use_title()}
        rows={uses}
        columns={columns}
        getRowId={id}
        rowLabel={label}
        selection={{ selected, onChange: setSelected, rowLabel: label }}
        batchActions={(ids) => [alsoUse(ids)]}
        scroll="none"
      />
    </Section>
  )
}
