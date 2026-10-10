/**
 * S13 Import (slice A): the Lightroom-style workflow entry (D-W11, D-W12,
 * D-W20, D-W24). `ImportSheet` is the sheet host mounted once at the app
 * root (toolbar Import, Home and the palette open it with
 * `openSheet({ kind: "import" })`); `ImportRoute` is the `/import` deep link,
 * which shows Home with the sheet over it.
 *
 * The sheet is the preview. Pick a source: a removable device (detected when
 * connected, its capture layout recognised: ASIAIR, N.I.N.A., SharpCap,
 * Ekos, SGP or Voyager; a generic device has no layout), a saved source
 * (Import new skips what it imported before) or Choose folder. Then see each
 * file's destination and where it ends up: lights become sessions, raw
 * calibration frames go to the calibration process (Calibration → stack,
 * P-CAL3), and masters go straight to structured calibration storage. Holds
 * (Unclassified until typed, still being written until it settles), skips
 * (SHA-256 duplicates), writability and free space, and Copy or Move. Import
 * runs as an operation, then lists what it filled. A second tab adds an
 * existing library folder and indexes it in place.
 */
import { Link, useNavigate } from "@tanstack/react-router"
import { Check, ChevronRight, Download, FolderOpen, FolderSearch, Usb } from "lucide-react"
import { type ReactNode, useEffect, useId, useState } from "react"
import { useMessages } from "@/app/preferences"
import { closeSheet, openPanel, openSheet, useShellUi } from "@/app/ui-state"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { PathText } from "@/components/app/data"
import { type Column, DataTable } from "@/components/app/data-table"
import { Notice } from "@/components/app/feedback"
import { FolderPicker } from "@/components/app/folder-picker"
import { OperationPanel } from "@/components/app/operation-panel"
import { CountBadge, Pill } from "@/components/app/pill"
import { Refusal, type RefusalProps } from "@/components/app/refusal"
import { ContextMenuArea, type MenuEntry, menuKey } from "@/components/app/row-menu"
import type { Tone } from "@/components/app/status"
import { HelpTip, NoteMarker } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { isRemovablePath, removableDevices } from "@/domain/devices"
import { filesUnder } from "@/domain/disk"
import { sessionLongLabel } from "@/domain/membership"
import { namingTemplate } from "@/domain/templates"
import type { ImageType, LocationRole, NamingFrameType } from "@/domain/types"
import { suggestDisplayName, validateLocation } from "@/features/t1/lib/locations"
import { formatBytes, formatCount, formatDateTime } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { isSettled } from "@/store/operations"
import { type PrototypeState, updateSlice, useStore } from "@/store/core"
import { settleGrowingFiles } from "@/store/simulation"
import type { ImportDraft, ImportSourceChoice } from "@/store/slices/a"
import { HomePage } from "./home"
import {
  type DestinationGroup,
  destinationLocations,
  freshFrameCount,
  type ImportPlan,
  type ImportRoute as Route,
  planImport,
  routeFor,
  routeLabel,
  savedSourceAt,
  sourcePathOf,
  TYPEABLE,
  typeLabel,
} from "./import-model"
import { addLibraryFolder, type ImportPayload, saveImportSource, startImport } from "./import-run"
import { refusalOf } from "./parts"

/** Simulated time the capture device needs to finish writing a held file. */
const SETTLE_MS = 6000

const ROUTE_TONE: Record<Route, Tone> = { sessions: "muted", stack: "info", masters: "success" }

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
  setDraft({ source, newOnly, typed: {} })
}

export function ImportSheet() {
  const { sheet } = useShellUi()
  const open = sheet?.kind === "import"
  return (
    <Sheet open={open} onOpenChange={(next) => !next && closeSheet()}>
      <SheetContent side="right" className="gap-0 p-0 data-[side=right]:w-[50rem] data-[side=right]:max-w-[94vw] data-[side=right]:sm:max-w-[94vw]" data-import-sheet>
        {open ? <ImportBody /> : null}
      </SheetContent>
    </Sheet>
  )
}

export function ImportRoute() {
  useEffect(() => {
    openSheet({ kind: "import" })
  }, [])
  return <HomePage />
}

function ImportBody() {
  const last = useStore((s) => s.slices.a.lastImport)
  const [tab, setTab] = useState<"source" | "folder">(last?.kind === "index" ? "folder" : "source")
  const m = useMessages()
  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as "source" | "folder")} className="min-h-0 flex-1 gap-0">
      <SheetHeader className="flex-row flex-wrap items-center gap-x-4 gap-y-2 border-b border-separator py-3 pr-12">
        <SheetTitle>{m.shell_import()}</SheetTitle>
        <TabsList>
          <TabsTrigger value="source">{m.import_tab_source()}</TabsTrigger>
          <TabsTrigger value="folder">{m.import_tab_folder()}</TabsTrigger>
        </TabsList>
      </SheetHeader>
      <TabsContent value="source" className="flex min-h-0 flex-1 flex-col">
        {last?.kind === "import" ? <ProgressView operationId={last.operationId} kind="import" /> : <SourceTab />}
      </TabsContent>
      <TabsContent value="folder" className="flex min-h-0 flex-1 flex-col">
        {last?.kind === "index" ? <ProgressView operationId={last.operationId} kind="index" /> : <FolderTab />}
      </TabsContent>
    </Tabs>
  )
}

function Part({ title, children, aside, id }: { title: ReactNode; children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <section className="space-y-2 border-b border-separator px-4 py-3 last:border-b-0" aria-labelledby={id} data-import-part={id}>
      <div className="flex flex-wrap items-center justify-between gap-2" data-chrome>
        <h3 id={id} className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          {title}
        </h3>
        {aside ? <div className="flex items-center gap-1.5">{aside}</div> : null}
      </div>
      {children}
    </section>
  )
}

function Counted({ label, count, countLabel }: { label: string; count: number; countLabel: string }) {
  return (
    <>
      {label} <CountBadge count={count} label={countLabel} />
    </>
  )
}

// ---------------------------------------------------------------------------
// From a source
// ---------------------------------------------------------------------------

/** "Captures and Calibration": the destination location names as one phrase. */
function locationList(m: Messages, names: string[]): string {
  return names.length > 1 ? m.import_name_list({ first: names.slice(0, -1).join(", "), last: names.at(-1)! }) : (names[0] ?? "")
}

function SourceTab() {
  const state = useStore((s) => s)
  const draft = state.slices.a.importDraft
  const plan = planImport(state, draft)
  const m = useMessages()
  const [confirmMove, setConfirmMove] = useState(false)
  const settling = plan?.held.settling.map((f) => f.path).join("|") ?? ""
  // The capture device finishes writing: held files settle and join the preview.
  useEffect(() => {
    if (!settling) return
    const timer = window.setTimeout(() => settleGrowingFiles(settling.split("|")), SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [settling])
  const preselect = draft.source ? null : defaultSource(state)
  const preselectKey = preselect ? JSON.stringify(preselect) : ""
  useEffect(() => {
    if (preselectKey) selectSource(JSON.parse(preselectKey) as ImportSourceChoice)
  }, [preselectKey])

  const start = () => {
    if (!plan || plan.blockers.length > 0) return
    startImport(plan, draft)
  }
  const move = draft.mode === "move"
  const count = plan?.items.length ?? 0
  const frames = formatCount(count)
  const blockers = plan?.blockers ?? []
  const cant = move ? m.import_cant_move() : m.import_cant_import()

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto" data-import-preview>
        <SourcePart plan={plan} draft={draft} />
        {plan?.online ? (
          <>
            <PreviewPart plan={plan} />
            <DestinationPart plan={plan} />
            <HeldPart plan={plan} draft={draft} />
            <SkippedPart plan={plan} />
            <ModePart plan={plan} draft={draft} />
          </>
        ) : null}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-separator bg-chrome px-4 py-2.5" data-chrome>
        <div className="min-w-0 flex-1 text-xs" data-import-blockers={blockers.length > 0 || undefined}>
          {blockers.length === 1 ? (
            <Refusal action={cant} reason={blockers[0]!.label} blockers={[]} />
          ) : blockers.length > 1 ? (
            <Refusal action={cant} reason={m.refusal_blockers({ count: blockers.length })} blockers={blockers} />
          ) : plan ? (
            <span className="text-muted-foreground tabular-nums">
              {m.session_frame_count({ count, frames })} · {formatBytes(plan.bytes)}
            </span>
          ) : (
            <span className="text-muted-foreground">{m.import_choose_source()}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={closeSheet}>
            {m.verb_cancel()}
          </Button>
          <Button size="sm" disabled={!plan || blockers.length > 0} onClick={() => (draft.mode === "move" ? setConfirmMove(true) : start())} data-import-start>
            {plan ? (move ? m.import_move_frames({ count, frames }) : m.import_import_frames({ count, frames })) : move ? m.import_move() : m.shell_import()}
          </Button>
        </div>
      </footer>
      {plan ? (
        <ConfirmDialog
          open={confirmMove}
          onOpenChange={setConfirmMove}
          title={m.import_move_frames_title({ count, frames })}
          description={`${plan.sourceLabel} · ${plan.sourcePath}`}
          changes={[
            m.import_copies_into({ count, frames, size: formatBytes(plan.bytes), locations: locationList(m, [...new Set(plan.items.map((i) => i.location.displayName))]) }),
            m.import_verifies_copies(),
            plan.volume ? m.import_sends_to_trash({ count, sources: frames, volume: plan.volume.name }) : m.import_sends_source_to_trash({ count, sources: frames }),
          ]}
          confirmLabel={m.import_move_frames({ count, frames })}
          onConfirm={start}
        />
      ) : null}
    </>
  )
}

function SelectedPill() {
  const m = useMessages()
  return (
    <Pill tone="success" icon={Check}>
      {m.import_selected()}
    </Pill>
  )
}

function SourcePart({ plan, draft }: { plan: ImportPlan | null; draft: ImportDraft }) {
  const state = useStore((s) => s)
  const m = useMessages()
  const devices = removableDevices(state.disk)
  const sources = Object.values(state.catalog.importSources).sort((a, b) => a.name.localeCompare(b.name))
  const [picking, setPicking] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [saveRefusal, setSaveRefusal] = useState<RefusalProps | null>(null)
  const newOnlyId = useId()
  const selectedPath = sourcePathOf(state, draft)?.path ?? null
  const mounted = (path: string) => Object.values(state.disk.volumes).some((v) => v.mounted && (path === v.mountPath || path.startsWith(`${v.mountPath}/`)))
  const chosenFolder = draft.source?.kind === "folder" ? draft.source.path : null
  const folderPath = chosenFolder && !devices.some((d) => d.volume.mountPath === chosenFolder) ? chosenFolder : null
  const firstMount = devices.find((d) => d.connected)?.volume.mountPath ?? "/Volumes"

  const deviceMenu = (key: string): MenuEntry[] => {
    const device = devices.find((d) => `device:${d.volume.id}` === key)
    if (!device) return []
    return [
      { heading: device.volume.name },
      { label: m.shell_import(), icon: Download, disabled: !device.connected, onSelect: () => selectSource(choiceAt(state, device.volume.mountPath)) },
      { label: m.import_choose_folder(), icon: FolderSearch, disabled: !device.connected, onSelect: () => setPicking(device.volume.mountPath) },
    ]
  }
  const savedMenu = (key: string): MenuEntry[] => {
    const src = sources.find((s) => `saved:${s.id}` === key)
    if (!src) return []
    return [
      { heading: src.name },
      { label: m.import_new(), icon: Download, onSelect: () => selectSource({ kind: "saved", id: src.id }, true) },
      { label: m.import_all(), onSelect: () => selectSource({ kind: "saved", id: src.id }, false) },
    ]
  }

  return (
    <Part title={m.evidence_column_source()} id="import-source">
      <div className="space-y-3">
        <div className="space-y-1" data-removable-devices>
          <h4 className="text-[0.6875rem] font-medium text-muted-foreground">{m.import_removable_devices()}</h4>
          <ContextMenuArea menu={deviceMenu}>
            <ul className="divide-y divide-border/60 rounded-md border border-separator text-sm">
              {devices.length === 0 ? <li className="px-2.5 py-1.5 text-xs text-muted-foreground">{m.import_none_connected()}</li> : null}
              {devices.map((d) => {
                const selected = d.connected && selectedPath === d.volume.mountPath
                const fresh = freshFrameCount(state, d.volume.mountPath)
                return (
                  <li
                    key={d.volume.id}
                    {...menuKey(`device:${d.volume.id}`)}
                    aria-current={selected || undefined}
                    className="flex min-h-(--row-h) flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1 aria-[current=true]:bg-primary/8"
                    data-device={d.volume.id}
                  >
                    <Usb aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className={d.connected ? "font-medium" : "font-medium text-muted-foreground"}>{d.volume.name}</span>
                    {d.layout ? (
                      <span className="inline-flex items-center gap-0.5" data-device-layout={d.layout.layout}>
                        <Pill tone="info">{d.layout.label}</Pill>
                        <NoteMarker label={m.import_how_recognised({ name: d.volume.name })} rows={[{ label: m.import_layout(), value: say(m, d.layout.evidence) }]} />
                      </span>
                    ) : null}
                    <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                      {d.connected ? (
                        <>
                          <span>{m.import_file_count({ count: d.imageFiles, files: formatCount(d.imageFiles) })}</span>
                          <Pill tone={fresh > 0 ? "info" : "muted"}>{m.import_new_count({ count: fresh, frames: formatCount(fresh) })}</Pill>
                        </>
                      ) : (
                        <Pill tone="muted">{m.import_not_connected()}</Pill>
                      )}
                    </span>
                    {selected ? (
                      <SelectedPill />
                    ) : (
                      <Button size="xs" variant="outline" disabled={!d.connected} onClick={() => selectSource(choiceAt(state, d.volume.mountPath))} data-device-import>
                        {m.shell_import()}
                        <span className="sr-only"> {m.import_from_named({ name: d.volume.name })}</span>
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </ContextMenuArea>
        </div>

        <div className="space-y-1" data-saved-sources>
          <h4 className="text-[0.6875rem] font-medium text-muted-foreground">{m.import_saved_sources()}</h4>
          <ContextMenuArea menu={savedMenu}>
            <ul className="divide-y divide-border/60 rounded-md border border-separator text-sm">
              {sources.length === 0 ? <li className="px-2.5 py-1.5 text-xs text-muted-foreground">{m.import_none_saved()}</li> : null}
              {sources.map((src) => {
                const selected = draft.source?.kind === "saved" && draft.source.id === src.id
                const connected = mounted(src.path)
                const fresh = connected ? freshFrameCount(state, src.path) : 0
                return (
                  <li key={src.id} {...menuKey(`saved:${src.id}`)} aria-current={selected || undefined} className="flex min-h-(--row-h) flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1 aria-[current=true]:bg-primary/8">
                    <FolderOpen aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-medium" title={src.lastImportedAt ? m.import_last_import({ date: formatDateTime(src.lastImportedAt) }) : m.import_never_imported()}>
                      {src.name}
                    </span>
                    <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{src.path}</span>
                    <span className="ml-auto">{connected ? <Pill tone={fresh > 0 ? "info" : "muted"}>{m.import_new_count({ count: fresh, frames: formatCount(fresh) })}</Pill> : <Pill tone="muted">{m.import_not_connected()}</Pill>}</span>
                    {selected ? (
                      <SelectedPill />
                    ) : (
                      <Button size="xs" variant="outline" onClick={() => selectSource({ kind: "saved", id: src.id }, true)}>
                        {m.import_new()}
                        <span className="sr-only"> {m.import_from_named({ name: src.name })}</span>
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </ContextMenuArea>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button size="xs" variant="outline" onClick={() => setPicking(folderPath ?? firstMount)} data-choose-folder>
            <FolderSearch data-icon="inline-start" aria-hidden="true" />
            {m.import_choose_folder()}
          </Button>
          {folderPath ? (
            <>
              <PathText path={folderPath} />
              <SelectedPill />
            </>
          ) : null}
        </div>

        {plan?.online && plan.saved ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Switch id={newOnlyId} size="sm" checked={draft.newOnly} onCheckedChange={(checked) => setDraft({ newOnly: checked })} />
            <label htmlFor={newOnlyId}>{m.import_new()}</label>
            {draft.newOnly && plan.skipped.imported.length > 0 ? <Pill tone="muted">{m.import_imported_before({ count: plan.skipped.imported.length })}</Pill> : null}
          </div>
        ) : null}

        {plan?.online && !plan.saved && folderPath ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Input aria-label={m.import_source_name()} placeholder={m.import_name_placeholder()} value={name} onChange={(e) => setName(e.target.value)} className="h-6 w-48" />
              <Button size="xs" variant="outline" onClick={() => setSaveRefusal(refusalOf(saveImportSource(name, folderPath), m.import_cant_save()))}>
                {m.import_save_source()}
              </Button>
            </div>
            {saveRefusal ? <Refusal {...saveRefusal} /> : null}
          </div>
        ) : null}

        {plan && !plan.online ? (
          <Notice
            tone="offline"
            title={m.import_source_not_connected({ name: plan.sourceLabel })}
            actions={
              isRemovablePath(state.disk, plan.sourcePath) ? (
                <Button size="xs" variant="outline" onClick={() => openPanel("simulation")} data-insert-card>
                  {m.import_prototype_controls()}
                </Button>
              ) : undefined
            }
          />
        ) : null}
      </div>

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
    </Part>
  )
}

function RoutePill({ route }: { route: Route }) {
  const m = useMessages()
  return <Pill tone={ROUTE_TONE[route]}>{routeLabel(m, route)}</Pill>
}

function PreviewPart({ plan }: { plan: ImportPlan }) {
  const m = useMessages()
  const columns: Column<DestinationGroup>[] = [
    {
      id: "folder",
      header: m.import_column_folder(),
      rowHeader: true,
      sortValue: (g) => `${g.route}|${g.relative}`,
      cell: (g) => (
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-xs" title={`${g.location.path}/${g.relative}`}>
              {g.relative}
            </span>
            {g.fallbacks.length > 0 ? (
              <Pill tone="warning" title={m.import_fallback_used({ tokens: g.fallbacks.map((f) => `{${f}}`).join(", ") })}>
                {m.import_fallback()}
              </Pill>
            ) : null}
          </span>
          <span className="text-xs text-muted-foreground">{g.location.displayName}</span>
        </span>
      ),
    },
    { id: "type", header: m.import_column_type(), cell: (g) => (g.items.some((i) => i.typed) ? m.import_type_typed({ type: typeLabel(m, g.type) }) : typeLabel(m, g.type)) },
    { id: "frames", header: m.sessions_column_frames(), align: "right", sortValue: (g) => g.items.length, cell: (g) => formatCount(g.items.length) },
    { id: "size", header: m.import_column_size(), align: "right", sortValue: (g) => g.bytes, cell: (g) => formatBytes(g.bytes) },
    { id: "into", header: m.import_column_into(), sortValue: (g) => g.route, cell: (g) => <RoutePill route={g.route} /> },
  ]
  return (
    <Part
      title={<Counted label={m.import_preview()} count={plan.items.length} countLabel={m.session_frame_count({ count: plan.items.length, frames: formatCount(plan.items.length) })} />}
      id="import-preview"
      aside={<span className="text-xs text-muted-foreground tabular-nums">{formatBytes(plan.bytes)}</span>}
    >
      <DataTable label={m.import_destinations()} rows={plan.groups} columns={columns} getRowId={(g) => g.key} scroll="none" empty={<p className="px-3 py-2 text-sm text-muted-foreground">{m.import_nothing_to_import()}</p>} />
    </Part>
  )
}

function DestinationPart({ plan }: { plan: ImportPlan }) {
  const catalog = useStore((s) => s.catalog)
  const naming = useStore((s) => s.settings.naming)
  const m = useMessages()
  const typesFor = (role: "captures" | "calibration") => [...new Set(plan.items.filter((i) => i.role === role).map((i) => i.type))]
  const templateOf = (t: ImageType) => namingTemplate(naming, (t === "dark-flat" ? "dark" : t) as NamingFrameType)
  return (
    <Part
      title={m.import_destination()}
      id="import-destination"
      aside={
        <Link to="/settings/naming" onClick={closeSheet} className="text-xs text-link underline-offset-2 hover:underline">
          {m.settings_naming()}
        </Link>
      }
    >
      <div className="space-y-2">
        {plan.destinations.map((d) => {
          const locations = destinationLocations(catalog, d.role)
          const items = locations.map((l) => ({ value: l.id, label: l.displayName }))
          const types: ImageType[] = typesFor(d.role).length > 0 ? typesFor(d.role) : d.role === "captures" ? ["light"] : ["flat"]
          const label = d.role === "captures" ? m.import_lights() : m.status_role_calibration()
          return (
            <div key={d.role} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-destination={d.role}>
              <span className="inline-flex w-24 items-center gap-0.5 text-muted-foreground">
                {label}
                <NoteMarker label={m.import_naming_of({ name: label })} rows={types.map((t) => ({ label: typeLabel(m, t), value: routeFor(t) === "masters" ? `${templateOf(t)}Master…_<night>` : templateOf(t) }))} />
              </span>
              <Select items={items} value={d.location?.id ?? null} onValueChange={(next) => setDraft(d.role === "captures" ? { capturesLocationId: next as string } : { calibrationLocationId: next as string })}>
                <SelectTrigger size="sm" aria-label={d.role === "captures" ? m.import_captures_location() : m.import_calibration_location()} className="min-w-44">
                  <SelectValue placeholder={m.import_no_location()} />
                </SelectTrigger>
                <SelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {d.location ? (
                <span className="flex flex-wrap items-center gap-1 tabular-nums">
                  {d.problem ? <Pill tone="danger">{d.problem}</Pill> : d.writable ? <Pill tone="success">{m.import_writable()}</Pill> : <Pill tone="muted">{m.import_not_writable()}</Pill>}
                  <Pill tone="muted">{m.import_free({ size: formatBytes(d.freeBytes) })}</Pill>
                  {d.neededBytes > 0 ? <Pill tone="neutral">{m.import_needs({ size: formatBytes(d.neededBytes) })}</Pill> : null}
                </span>
              ) : (
                <Pill tone={d.problem ? "danger" : "muted"}>{d.problem ?? m.import_no_location()}</Pill>
              )}
            </div>
          )
        })}
      </div>
    </Part>
  )
}

function HeldPart({ plan, draft }: { plan: ImportPlan; draft: ImportDraft }) {
  const m = useMessages()
  const typedGroups = new Map<string, { type: ImageType; paths: string[] }>()
  for (const [path, type] of Object.entries(draft.typed)) {
    const folder = path.slice(0, path.lastIndexOf("/"))
    const entry = typedGroups.get(`${folder}|${type}`) ?? { type, paths: [] }
    entry.paths.push(path)
    typedGroups.set(`${folder}|${type}`, entry)
  }
  const typedShown = [...typedGroups.entries()].filter(([, g]) => g.paths.some((p) => p.startsWith(plan.sourcePath)))
  const total = plan.held.unclassified.reduce((n, h) => n + h.files.length, 0) + plan.held.settling.length
  if (total === 0 && typedShown.length === 0) return null
  const rel = (path: string) => path.slice(plan.sourcePath.length + 1) || path
  const items = TYPEABLE.map((t) => ({ value: t, label: typeLabel(m, t) }))
  return (
    <Part title={<Counted label={m.import_held()} count={total} countLabel={m.import_held_count({ count: total, files: formatCount(total) })} />} id="import-held">
      <ul className="space-y-1.5 text-sm" data-import-held>
        {plan.held.unclassified.map((hold) => (
          <li key={hold.folder} className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <Pill tone="warning">{m.import_type_unclassified()}</Pill>
              <span className="tabular-nums">{m.import_file_count({ count: hold.files.length, files: formatCount(hold.files.length) })}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">{rel(hold.folder)}</span>
              {/* eslint-disable-next-line alm/no-user-string -- FITS header keywords, never translated */}
              <NoteMarker label={m.import_why_held()} rows={[{ label: "IMAGETYP", value: m.status_missing() }, ...(hold.objectLabel ? [{ label: "OBJECT", value: hold.objectLabel }] : [])]} />
            </span>
            <Select items={items} value={null} onValueChange={(next) => next && setDraft({ typed: { ...draft.typed, ...Object.fromEntries(hold.files.map((f) => [f.path, String(next) as ImageType])) } })}>
              <SelectTrigger size="sm" aria-label={m.import_type_files_as({ count: hold.files.length, folder: rel(hold.folder) })} className="w-32" data-type-as>
                <SelectValue placeholder={m.import_type_as()} />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </li>
        ))}
        {typedShown.map(([key, g]) => (
          <li key={key} className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <Pill tone="info">{m.import_typed_as({ type: typeLabel(m, g.type) })}</Pill>
              <span className="tabular-nums">{m.import_file_count({ count: g.paths.length, files: formatCount(g.paths.length) })}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">{rel(key.split("|")[0]!)}</span>
            </span>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                const typed = { ...draft.typed }
                for (const p of g.paths) delete typed[p]
                setDraft({ typed })
              }}
            >
              {m.import_undo()}
            </Button>
          </li>
        ))}
        {plan.held.settling.length > 0 ? (
          <li className="flex flex-wrap items-center gap-1.5">
            <Pill tone="muted">{m.import_writing()}</Pill>
            {plan.held.settling.map((f) => (
              <span key={f.path} className="font-mono text-xs text-muted-foreground">
                {rel(f.path)}
              </span>
            ))}
            <NoteMarker label={m.import_why_held()} rows={[{ label: m.import_held(), value: m.import_until_settled() }]} />
          </li>
        ) : null}
      </ul>
    </Part>
  )
}

function SkippedPart({ plan }: { plan: ImportPlan }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const sessions = useStore((s) => s.catalog.sessions)
  const panel = useId()
  const m = useMessages()
  const s = plan.skipped
  const total = s.duplicate.length + s.imported.length + s.notImage.length + s.nameTaken.length
  if (total === 0) return null
  const rel = (path: string) => path.slice(plan.sourcePath.length + 1) || path
  const bySession = new Map<string, number>()
  for (const d of s.duplicate) bySession.set(d.sessionId ?? "", (bySession.get(d.sessionId ?? "") ?? 0) + 1)
  return (
    <Part title={<Counted label={m.import_skipped()} count={total} countLabel={m.import_skipped_count({ count: total, files: formatCount(total) })} />} id="import-skipped">
      <div className="space-y-1.5" data-import-skipped>
        <ul className="flex flex-wrap items-center gap-1.5 text-sm">
          {s.duplicate.length > 0 ? (
            <li className="inline-flex items-center gap-0.5">
              <Pill tone="neutral">{m.import_duplicate_count({ count: s.duplicate.length, files: formatCount(s.duplicate.length) })}</Pill>
              <NoteMarker label={m.import_duplicates()} rows={[{ label: m.import_match(), value: m.import_match_sha() }]} />
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panel}
                onClick={() => setOpen((v) => !v)}
                className="inline-flex h-5 items-center rounded-sm px-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <ChevronRight aria-hidden="true" className={open ? "size-3.5 rotate-90 motion-safe:transition-transform" : "size-3.5 motion-safe:transition-transform"} />
                <span className="sr-only">{open ? m.import_hide_sessions() : m.import_show_sessions()}</span>
              </button>
            </li>
          ) : null}
          {s.imported.length > 0 ? (
            <li>
              <Pill tone="muted">{m.import_imported_before({ count: s.imported.length })}</Pill>
            </li>
          ) : null}
          {s.nameTaken.length > 0 ? (
            <li className="inline-flex items-center gap-0.5">
              <Pill tone="warning">{m.import_name_taken_count({ count: s.nameTaken.length })}</Pill>
              <NoteMarker label={m.import_name_taken()} rows={[{ label: m.import_destination(), value: m.import_name_taken_detail() }]} />
            </li>
          ) : null}
          {s.notImage.length > 0 ? (
            <li>
              <Pill tone="muted" title={s.notImage.map((f) => rel(f.path)).join("\n")}>
                {m.import_other_file_count({ count: s.notImage.length, files: formatCount(s.notImage.length) })}
              </Pill>
            </li>
          ) : null}
        </ul>
        {open && s.duplicate.length > 0 ? (
          <ul id={panel} className="flex flex-wrap gap-1 pl-1">
            {[...bySession.entries()].map(([sessionId, n]) => (
              <li key={sessionId}>
                {sessions[sessionId] ? (
                  <Pill
                    tone="neutral"
                    onClick={() => {
                      closeSheet()
                      void navigate({ to: "/sessions/$sessionId", params: { sessionId } })
                    }}
                  >
                    {sessionLongLabel(m, sessions[sessionId]!)} · {n}
                  </Pill>
                ) : (
                  <Pill tone="muted">{m.import_library_frames({ count: n })}</Pill>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Part>
  )
}

function ModePart({ plan, draft }: { plan: ImportPlan; draft: ImportDraft }) {
  const m = useMessages()
  return (
    <Part title={m.import_copy_or_move()} id="import-mode">
      <RadioGroup aria-label={m.import_copy_or_move()} value={draft.mode} onValueChange={(next) => setDraft({ mode: next as "copy" | "move" })} className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <span className="flex items-center gap-1.5 text-sm">
          <label className="flex items-center gap-2">
            <RadioGroupItem value="copy" />
            <span className="font-medium">{m.import_copy()}</span>
          </label>
          <NoteMarker label={m.import_copy()} rows={[{ label: m.import_copy(), value: m.import_copy_detail() }]} />
        </span>
        <span className="flex items-center gap-1.5 text-sm">
          <label className="flex items-center gap-2">
            <RadioGroupItem value="move" disabled={!plan.move.allowed} />
            <span className={plan.move.allowed ? "font-medium" : "font-medium text-muted-foreground"}>{m.import_move()}</span>
          </label>
          <NoteMarker label={m.import_move()} rows={[{ label: m.import_move(), value: m.import_move_detail() }]} />
          {plan.move.reason ? <Pill tone="muted">{plan.move.reason}</Pill> : null}
        </span>
      </RadioGroup>
    </Part>
  )
}

// ---------------------------------------------------------------------------
// Progress and outcome
// ---------------------------------------------------------------------------

function ProgressView({ operationId, kind }: { operationId: string; kind: "import" | "index" }) {
  const navigate = useNavigate()
  const op = useStore((s) => s.operations[operationId])
  const sessions = useStore((s) => s.catalog.sessions)
  const m = useMessages()
  const reset = () => updateSlice("a", (a) => ({ ...a, lastImport: null }))
  const go = (to: string) => {
    closeSheet()
    void navigate({ to: to as never })
  }
  if (!op) {
    return (
      <div className="flex-1 p-4">
        <Notice tone="info" title={m.import_no_longer_recorded()} actions={<Button size="xs" variant="outline" onClick={reset}>{m.import_start_again()}</Button>} />
      </div>
    )
  }
  const settled = isSettled(op.status)
  const payload = kind === "import" ? (op.payload as unknown as ImportPayload) : null
  // Lights first: they are what Sessions highlights.
  const imported = (payload?.sessionIds ?? [])
    .map((id) => sessions[id])
    .filter((s) => s !== undefined)
    .sort((a, b) => Number(b.imageType === "light") - Number(a.imageType === "light"))
  const masters = (payload?.copied ?? []).filter((c) => routeFor(c.type) === "masters").length
  const shown = imported.length + (masters > 0 ? 1 : 0)
  // An import of calibration only has nothing to highlight in Sessions.
  const toCalibration = kind === "import" && shown > 0 && !imported.some((s) => s.imageType === "light")
  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" data-import-progress>
        <OperationPanel operationId={operationId} headingLevel={3} />
        {payload?.trashOperationId ? <OperationPanel operationId={payload.trashOperationId} headingLevel={3} /> : null}
        {payload && settled && shown > 0 ? (
          <section className="space-y-1.5" aria-labelledby="import-sessions">
            <h3 id="import-sessions" className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              {m.import_imported()} <CountBadge count={imported.length + masters} label={m.import_imported_count({ count: imported.length + masters })} />
            </h3>
            <ul className="divide-y divide-border/60 rounded-md border border-separator text-sm" data-imported>
              {imported.map((s) => (
                <li key={s.id} className="flex min-h-(--row-h) items-center justify-between gap-2 px-2.5 py-1">
                  {s.imageType === "light" ? (
                    <Link to="/sessions/$sessionId" params={{ sessionId: s.id }} onClick={closeSheet} className="font-medium underline-offset-2 hover:underline">
                      {sessionLongLabel(m, s)}
                    </Link>
                  ) : (
                    <span>{sessionLongLabel(m, s)}</span>
                  )}
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                    {typeLabel(m, s.imageType)} · {m.session_frame_count({ count: s.assetIds.length, frames: formatCount(s.assetIds.length) })}
                    {s.imageType === "light" ? (
                      s.target.status === "confirmed" || s.target.status === "associated" ? (
                        <Pill tone="success">{m.import_target_set()}</Pill>
                      ) : (
                        <Pill tone="warning">{m.sessions_filter_needs_target()}</Pill>
                      )
                    ) : (
                      <Pill tone="info" onClick={() => go("/calibration")}>
                        {routeLabel(m, "stack")}
                      </Pill>
                    )}
                  </span>
                </li>
              ))}
              {masters > 0 ? (
                <li className="flex min-h-(--row-h) items-center justify-between gap-2 px-2.5 py-1">
                  <span>{m.import_master_count({ count: masters })}</span>
                  <Pill tone="success" onClick={() => go("/calibration")}>
                    {routeLabel(m, "masters")}
                  </Pill>
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-separator bg-chrome px-4 py-2.5" data-chrome>
        <Button size="sm" variant="ghost" onClick={reset} disabled={!settled}>
          {kind === "import" ? m.import_more() : m.import_add_another()}
        </Button>
        {toCalibration ? (
          <Button size="sm" disabled={!settled} onClick={() => go("/calibration")}>
            {m.import_show_in_calibration()}
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={!settled}
            onClick={() => {
              closeSheet()
              void navigate({ to: "/sessions", search: kind === "import" ? { import: operationId } : {} })
            }}
            data-show-in-sessions
          >
            {m.import_show_in_sessions()}
          </Button>
        )}
      </footer>
    </>
  )
}

// ---------------------------------------------------------------------------
// Add existing library folder (index in place)
// ---------------------------------------------------------------------------

const FOLDER_ROLES: LocationRole[] = ["captures", "calibration"]

function roleTitle(m: Messages, role: LocationRole): string {
  return role === "captures" ? m.status_role_captures() : m.status_role_calibration()
}

function FolderTab() {
  const state = useStore((s) => s)
  const m = useMessages()
  const [path, setPath] = useState<string | null>(null)
  const [role, setRole] = useState<LocationRole>("captures")
  const [name, setName] = useState("")
  const [picking, setPicking] = useState(false)
  const [refusal, setRefusal] = useState<RefusalProps | null>(null)
  const draft = { path: path ?? "", displayName: name, role }
  const errors = path ? validateLocation(state.catalog, draft) : {}
  const images = path ? filesUnder(state.disk, path).filter((f) => (f.kind === "fits" || f.kind === "xisf") && f.header).length : 0
  const invalid = [errors.path ?? null, errors.displayName ?? null].filter((b): b is string => b !== null)
  const roleItems = FOLDER_ROLES.map((r) => ({ value: r, label: roleTitle(m, r) }))
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Part title={m.import_column_folder()} id="folder-path" aside={<HelpTip label={m.import_index_help_label()}>{m.import_index_help()}</HelpTip>}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
              <FolderOpen data-icon="inline-start" aria-hidden="true" />
              {m.import_choose_folder()}
            </Button>
            {path ? (
              <>
                <PathText path={path} />
                <Pill tone="muted">{m.import_image_file_count({ count: images, files: formatCount(images) })}</Pill>
              </>
            ) : null}
          </div>
        </Part>
        <Part title={m.import_role()} id="folder-role">
          <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-sm">
            <span className="text-muted-foreground">{m.import_role()}</span>
            <Select items={roleItems} value={role} onValueChange={(next) => setRole(next as LocationRole)}>
              <SelectTrigger size="sm" aria-label={m.import_library_role()} className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label htmlFor="add-folder-name" className="text-muted-foreground">
              {m.import_name_placeholder()}
            </label>
            <Input id="add-folder-name" value={name} onChange={(e) => setName(e.target.value)} className="h-6 w-64" aria-invalid={Boolean(errors.displayName) || undefined} />
          </div>
        </Part>
        {refusal ? (
          <div className="px-4 pb-3">
            <Refusal {...refusal} />
          </div>
        ) : null}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-separator bg-chrome px-4 py-2.5" data-chrome>
        <div className="min-w-0 flex-1 text-xs">
          {!path ? (
            <span className="text-muted-foreground">{m.import_choose_a_folder()}</span>
          ) : invalid.length === 1 ? (
            <Refusal action={m.session_cant_add()} reason={invalid[0]!} blockers={[]} />
          ) : invalid.length > 1 ? (
            <Refusal action={m.session_cant_add()} reason={m.refusal_blockers({ count: invalid.length })} blockers={invalid.map((label) => ({ label }))} />
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={closeSheet}>
            {m.verb_cancel()}
          </Button>
          <Button size="sm" disabled={!path || invalid.length > 0} onClick={() => setRefusal(refusalOf(addLibraryFolder(draft).result, m.session_cant_add()))}>
            {m.import_add_and_index()}
          </Button>
        </div>
      </footer>
      <FolderPicker
        open={picking}
        onOpenChange={setPicking}
        title={m.import_choose_library_folder()}
        description={m.import_indexed_in_place()}
        initialPath={path}
        chooseVerb={m.verb_add()}
        onChoose={(chosen) => {
          setPath(chosen)
          if (!name.trim()) setName(suggestDisplayName(state.disk, chosen))
          setPicking(false)
        }}
      />
    </>
  )
}
