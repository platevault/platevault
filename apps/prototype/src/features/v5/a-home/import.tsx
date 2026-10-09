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
import { ROLE_COPY, suggestDisplayName, validateLocation } from "@/features/t1/lib/locations"
import { formatBytes, formatCount, formatDateTime, plural } from "@/lib/format"
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
  ROUTE_LABEL,
  routeFor,
  savedSourceAt,
  sourcePathOf,
  TYPE_LABEL,
  TYPEABLE,
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
  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as "source" | "folder")} className="min-h-0 flex-1 gap-0">
      <SheetHeader className="flex-row flex-wrap items-center gap-x-4 gap-y-2 border-b border-separator py-3 pr-12">
        <SheetTitle>Import</SheetTitle>
        <TabsList>
          <TabsTrigger value="source">From a source</TabsTrigger>
          <TabsTrigger value="folder">Library folder</TabsTrigger>
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

function Counted({ label, count, noun }: { label: string; count: number; noun: string }) {
  return (
    <>
      {label} <CountBadge count={count} label={plural(count, noun)} />
    </>
  )
}

// ---------------------------------------------------------------------------
// From a source
// ---------------------------------------------------------------------------

function SourceTab() {
  const state = useStore((s) => s)
  const draft = state.slices.a.importDraft
  const plan = planImport(state, draft)
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
  const verb = draft.mode === "move" ? "Move" : "Import"
  const count = plan?.items.length ?? 0
  const blockers = plan?.blockers ?? []

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
            <Refusal action={`Can't ${verb.toLowerCase()}`} reason={blockers[0]!.label} blockers={[]} />
          ) : blockers.length > 1 ? (
            <Refusal action={`Can't ${verb.toLowerCase()}`} reason={plural(blockers.length, "blocker")} blockers={blockers} />
          ) : plan ? (
            <span className="text-muted-foreground tabular-nums">
              {plural(count, "frame")} · {formatBytes(plan.bytes)}
            </span>
          ) : (
            <span className="text-muted-foreground">Choose a source</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={closeSheet}>
            Cancel
          </Button>
          <Button size="sm" disabled={!plan || blockers.length > 0} onClick={() => (draft.mode === "move" ? setConfirmMove(true) : start())} data-import-start>
            {plan ? `${verb} ${plural(count, "frame")}` : verb}
          </Button>
        </div>
      </footer>
      {plan ? (
        <ConfirmDialog
          open={confirmMove}
          onOpenChange={setConfirmMove}
          title={`Move ${plural(count, "frame")}?`}
          description={`${plan.sourceLabel} · ${plan.sourcePath}`}
          changes={[
            `Copies ${plural(count, "frame")} (${formatBytes(plan.bytes)}) into ${[...new Set(plan.items.map((i) => i.location.displayName))].join(" and ")}`,
            "Verifies each copy (SHA-256)",
            `Sends ${plural(count, "verified source")} on ${plan.volume?.name ?? "the source"} to the OS Trash`,
          ]}
          confirmLabel={`Move ${plural(count, "frame")}`}
          onConfirm={start}
        />
      ) : null}
    </>
  )
}

function SelectedPill() {
  return (
    <Pill tone="success" icon={Check}>
      Selected
    </Pill>
  )
}

function SourcePart({ plan, draft }: { plan: ImportPlan | null; draft: ImportDraft }) {
  const state = useStore((s) => s)
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
      { label: "Import", icon: Download, disabled: !device.connected, onSelect: () => selectSource(choiceAt(state, device.volume.mountPath)) },
      { label: "Choose folder…", icon: FolderSearch, disabled: !device.connected, onSelect: () => setPicking(device.volume.mountPath) },
    ]
  }
  const savedMenu = (key: string): MenuEntry[] => {
    const src = sources.find((s) => `saved:${s.id}` === key)
    if (!src) return []
    return [
      { heading: src.name },
      { label: "Import new", icon: Download, onSelect: () => selectSource({ kind: "saved", id: src.id }, true) },
      { label: "Import all", onSelect: () => selectSource({ kind: "saved", id: src.id }, false) },
    ]
  }

  return (
    <Part title="Source" id="import-source">
      <div className="space-y-3">
        <div className="space-y-1" data-removable-devices>
          <h4 className="text-[0.6875rem] font-medium text-muted-foreground">Removable devices</h4>
          <ContextMenuArea menu={deviceMenu}>
            <ul className="divide-y divide-border/60 rounded-md border border-separator text-sm">
              {devices.length === 0 ? <li className="px-2.5 py-1.5 text-xs text-muted-foreground">None connected</li> : null}
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
                        <NoteMarker label={`How ${d.volume.name} was recognised`} rows={[{ label: "Layout", value: d.layout.evidence }]} />
                      </span>
                    ) : null}
                    <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                      {d.connected ? (
                        <>
                          <span>{plural(d.imageFiles, "file")}</span>
                          <Pill tone={fresh > 0 ? "info" : "muted"}>{formatCount(fresh)} new</Pill>
                        </>
                      ) : (
                        <Pill tone="muted">Not connected</Pill>
                      )}
                    </span>
                    {selected ? (
                      <SelectedPill />
                    ) : (
                      <Button size="xs" variant="outline" disabled={!d.connected} onClick={() => selectSource(choiceAt(state, d.volume.mountPath))} data-device-import>
                        Import<span className="sr-only"> from {d.volume.name}</span>
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </ContextMenuArea>
        </div>

        <div className="space-y-1" data-saved-sources>
          <h4 className="text-[0.6875rem] font-medium text-muted-foreground">Saved sources</h4>
          <ContextMenuArea menu={savedMenu}>
            <ul className="divide-y divide-border/60 rounded-md border border-separator text-sm">
              {sources.length === 0 ? <li className="px-2.5 py-1.5 text-xs text-muted-foreground">None saved</li> : null}
              {sources.map((src) => {
                const selected = draft.source?.kind === "saved" && draft.source.id === src.id
                const connected = mounted(src.path)
                const fresh = connected ? freshFrameCount(state, src.path) : 0
                return (
                  <li key={src.id} {...menuKey(`saved:${src.id}`)} aria-current={selected || undefined} className="flex min-h-(--row-h) flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1 aria-[current=true]:bg-primary/8">
                    <FolderOpen aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-medium" title={src.lastImportedAt ? `Last import ${formatDateTime(src.lastImportedAt)}` : "Never imported"}>
                      {src.name}
                    </span>
                    <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{src.path}</span>
                    <span className="ml-auto">{connected ? <Pill tone={fresh > 0 ? "info" : "muted"}>{formatCount(fresh)} new</Pill> : <Pill tone="muted">Not connected</Pill>}</span>
                    {selected ? (
                      <SelectedPill />
                    ) : (
                      <Button size="xs" variant="outline" onClick={() => selectSource({ kind: "saved", id: src.id }, true)}>
                        Import new<span className="sr-only"> from {src.name}</span>
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
            Choose folder…
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
            <label htmlFor={newOnlyId}>Import new</label>
            {draft.newOnly && plan.skipped.imported.length > 0 ? <Pill tone="muted">{plan.skipped.imported.length} imported before</Pill> : null}
          </div>
        ) : null}

        {plan?.online && !plan.saved && folderPath ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Input aria-label="Source name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="h-6 w-48" />
              <Button size="xs" variant="outline" onClick={() => setSaveRefusal(refusalOf(saveImportSource(name, folderPath), "Can't save"))}>
                Save source
              </Button>
            </div>
            {saveRefusal ? <Refusal {...saveRefusal} /> : null}
          </div>
        ) : null}

        {plan && !plan.online ? (
          <Notice
            tone="offline"
            title={`${plan.sourceLabel} not connected`}
            actions={
              isRemovablePath(state.disk, plan.sourcePath) ? (
                <Button size="xs" variant="outline" onClick={() => openPanel("simulation")} data-insert-card>
                  Prototype controls
                </Button>
              ) : undefined
            }
          />
        ) : null}
      </div>

      <FolderPicker
        open={picking !== null}
        onOpenChange={(open) => !open && setPicking(null)}
        title="Choose folder"
        description="Device, folder or mounted share"
        initialPath={picking ?? firstMount}
        chooseVerb="Import from"
        onChoose={(path) => {
          selectSource(choiceAt(state, path))
          setPicking(null)
        }}
      />
    </Part>
  )
}

function RoutePill({ route }: { route: Route }) {
  return <Pill tone={ROUTE_TONE[route]}>{ROUTE_LABEL[route]}</Pill>
}

function PreviewPart({ plan }: { plan: ImportPlan }) {
  const columns: Column<DestinationGroup>[] = [
    {
      id: "folder",
      header: "Folder",
      rowHeader: true,
      sortValue: (g) => `${g.route}|${g.relative}`,
      cell: (g) => (
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-xs" title={`${g.location.path}/${g.relative}`}>
              {g.relative}
            </span>
            {g.fallbacks.length > 0 ? (
              <Pill tone="warning" title={`No value for ${g.fallbacks.map((f) => `{${f}}`).join(", ")}: its fallback is used`}>
                Fallback
              </Pill>
            ) : null}
          </span>
          <span className="text-xs text-muted-foreground">{g.location.displayName}</span>
        </span>
      ),
    },
    { id: "type", header: "Type", cell: (g) => (g.items.some((i) => i.typed) ? `${TYPE_LABEL[g.type]} (typed)` : TYPE_LABEL[g.type]) },
    { id: "frames", header: "Frames", align: "right", sortValue: (g) => g.items.length, cell: (g) => formatCount(g.items.length) },
    { id: "size", header: "Size", align: "right", sortValue: (g) => g.bytes, cell: (g) => formatBytes(g.bytes) },
    { id: "into", header: "Into", sortValue: (g) => g.route, cell: (g) => <RoutePill route={g.route} /> },
  ]
  return (
    <Part title={<Counted label="Preview" count={plan.items.length} noun="frame" />} id="import-preview" aside={<span className="text-xs text-muted-foreground tabular-nums">{formatBytes(plan.bytes)}</span>}>
      <DataTable label="Import destinations" rows={plan.groups} columns={columns} getRowId={(g) => g.key} scroll="none" empty={<p className="px-3 py-2 text-sm text-muted-foreground">Nothing to import</p>} />
    </Part>
  )
}

function DestinationPart({ plan }: { plan: ImportPlan }) {
  const catalog = useStore((s) => s.catalog)
  const naming = useStore((s) => s.settings.naming)
  const typesFor = (role: "captures" | "calibration") => [...new Set(plan.items.filter((i) => i.role === role).map((i) => i.type))]
  const templateOf = (t: ImageType) => namingTemplate(naming, (t === "dark-flat" ? "dark" : t) as NamingFrameType)
  return (
    <Part
      title="Destination"
      id="import-destination"
      aside={
        <Link to="/settings/naming" onClick={closeSheet} className="text-xs text-link underline-offset-2 hover:underline">
          Naming
        </Link>
      }
    >
      <div className="space-y-2">
        {plan.destinations.map((d) => {
          const locations = destinationLocations(catalog, d.role)
          const items = locations.map((l) => ({ value: l.id, label: l.displayName }))
          const types: ImageType[] = typesFor(d.role).length > 0 ? typesFor(d.role) : d.role === "captures" ? ["light"] : ["flat"]
          const label = d.role === "captures" ? "Lights" : "Calibration"
          return (
            <div key={d.role} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-destination={d.role}>
              <span className="inline-flex w-24 items-center gap-0.5 text-muted-foreground">
                {label}
                <NoteMarker label={`${label} naming`} rows={types.map((t) => ({ label: TYPE_LABEL[t], value: routeFor(t) === "masters" ? `${templateOf(t)}Master…_<night>` : templateOf(t) }))} />
              </span>
              <Select items={items} value={d.location?.id ?? null} onValueChange={(next) => setDraft(d.role === "captures" ? { capturesLocationId: next as string } : { calibrationLocationId: next as string })}>
                <SelectTrigger size="sm" aria-label={`${d.role === "captures" ? "Captures" : "Calibration"} location`} className="min-w-44">
                  <SelectValue placeholder="No location" />
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
                  {d.problem ? <Pill tone="danger">{d.problem}</Pill> : d.writable ? <Pill tone="success">Writable</Pill> : <Pill tone="muted">Not writable</Pill>}
                  <Pill tone="muted">{formatBytes(d.freeBytes)} free</Pill>
                  {d.neededBytes > 0 ? <Pill tone="neutral">needs {formatBytes(d.neededBytes)}</Pill> : null}
                </span>
              ) : (
                <Pill tone={d.problem ? "danger" : "muted"}>{d.problem ?? "No location"}</Pill>
              )}
            </div>
          )
        })}
      </div>
    </Part>
  )
}

function HeldPart({ plan, draft }: { plan: ImportPlan; draft: ImportDraft }) {
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
  const items = TYPEABLE.map((t) => ({ value: t.value, label: t.label }))
  return (
    <Part title={<Counted label="Held" count={total} noun="held file" />} id="import-held">
      <ul className="space-y-1.5 text-sm" data-import-held>
        {plan.held.unclassified.map((hold) => (
          <li key={hold.folder} className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <Pill tone="warning">Unclassified</Pill>
              <span className="tabular-nums">{plural(hold.files.length, "file")}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">{rel(hold.folder)}</span>
              <NoteMarker label="Why it is held" rows={[{ label: "IMAGETYP", value: "missing" }, ...(hold.objectLabel ? [{ label: "OBJECT", value: hold.objectLabel }] : [])]} />
            </span>
            <Select items={items} value={null} onValueChange={(next) => next && setDraft({ typed: { ...draft.typed, ...Object.fromEntries(hold.files.map((f) => [f.path, String(next) as ImageType])) } })}>
              <SelectTrigger size="sm" aria-label={`Type the ${hold.files.length} files in ${rel(hold.folder)} as`} className="w-32" data-type-as>
                <SelectValue placeholder="Type as…" />
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
              <Pill tone="info">Typed {TYPE_LABEL[g.type]}</Pill>
              <span className="tabular-nums">{plural(g.paths.length, "file")}</span>
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
              Undo
            </Button>
          </li>
        ))}
        {plan.held.settling.length > 0 ? (
          <li className="flex flex-wrap items-center gap-1.5">
            <Pill tone="muted">Writing</Pill>
            {plan.held.settling.map((f) => (
              <span key={f.path} className="font-mono text-xs text-muted-foreground">
                {rel(f.path)}
              </span>
            ))}
            <NoteMarker label="Why it is held" rows={[{ label: "Held", value: "until the file stops changing" }]} />
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
  const s = plan.skipped
  const total = s.duplicate.length + s.imported.length + s.notImage.length + s.nameTaken.length
  if (total === 0) return null
  const rel = (path: string) => path.slice(plan.sourcePath.length + 1) || path
  const bySession = new Map<string, number>()
  for (const d of s.duplicate) bySession.set(d.sessionId ?? "", (bySession.get(d.sessionId ?? "") ?? 0) + 1)
  return (
    <Part title={<Counted label="Skipped" count={total} noun="skipped file" />} id="import-skipped">
      <div className="space-y-1.5" data-import-skipped>
        <ul className="flex flex-wrap items-center gap-1.5 text-sm">
          {s.duplicate.length > 0 ? (
            <li className="inline-flex items-center gap-0.5">
              <Pill tone="neutral">{plural(s.duplicate.length, "duplicate")}</Pill>
              <NoteMarker label="Duplicates" rows={[{ label: "Match", value: "SHA-256 of a library frame" }]} />
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panel}
                onClick={() => setOpen((v) => !v)}
                className="inline-flex h-5 items-center rounded-sm px-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <ChevronRight aria-hidden="true" className={open ? "size-3.5 rotate-90 motion-safe:transition-transform" : "size-3.5 motion-safe:transition-transform"} />
                <span className="sr-only">{open ? "Hide sessions" : "Show sessions"}</span>
              </button>
            </li>
          ) : null}
          {s.imported.length > 0 ? (
            <li>
              <Pill tone="muted">{s.imported.length} imported before</Pill>
            </li>
          ) : null}
          {s.nameTaken.length > 0 ? (
            <li className="inline-flex items-center gap-0.5">
              <Pill tone="warning">{s.nameTaken.length} name taken</Pill>
              <NoteMarker label="Name taken" rows={[{ label: "Destination", value: "holds different bytes; nothing is overwritten" }]} />
            </li>
          ) : null}
          {s.notImage.length > 0 ? (
            <li>
              <Pill tone="muted" title={s.notImage.map((f) => rel(f.path)).join("\n")}>
                {plural(s.notImage.length, "other file")}
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
                    {sessionLongLabel(sessions[sessionId]!)} · {n}
                  </Pill>
                ) : (
                  <Pill tone="muted">Library frames · {n}</Pill>
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
  return (
    <Part title="Copy or Move" id="import-mode">
      <RadioGroup aria-label="Copy or Move" value={draft.mode} onValueChange={(next) => setDraft({ mode: next as "copy" | "move" })} className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <span className="flex items-center gap-1.5 text-sm">
          <label className="flex items-center gap-2">
            <RadioGroupItem value="copy" />
            <span className="font-medium">Copy</span>
          </label>
          <NoteMarker label="Copy" rows={[{ label: "Copy", value: "verified by SHA-256; the source stays" }]} />
        </span>
        <span className="flex items-center gap-1.5 text-sm">
          <label className="flex items-center gap-2">
            <RadioGroupItem value="move" disabled={!plan.move.allowed} />
            <span className={plan.move.allowed ? "font-medium" : "font-medium text-muted-foreground"}>Move</span>
          </label>
          <NoteMarker label="Move" rows={[{ label: "Move", value: "verified by SHA-256, then the source goes to the OS Trash" }]} />
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
  const reset = () => updateSlice("a", (a) => ({ ...a, lastImport: null }))
  const go = (to: string) => {
    closeSheet()
    void navigate({ to: to as never })
  }
  if (!op) {
    return (
      <div className="flex-1 p-4">
        <Notice tone="info" title="No longer recorded" actions={<Button size="xs" variant="outline" onClick={reset}>Start again</Button>} />
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
              Imported <CountBadge count={imported.length + masters} label={`${imported.length + masters} imported`} />
            </h3>
            <ul className="divide-y divide-border/60 rounded-md border border-separator text-sm" data-imported>
              {imported.map((s) => (
                <li key={s.id} className="flex min-h-(--row-h) items-center justify-between gap-2 px-2.5 py-1">
                  {s.imageType === "light" ? (
                    <Link to="/sessions/$sessionId" params={{ sessionId: s.id }} onClick={closeSheet} className="font-medium underline-offset-2 hover:underline">
                      {sessionLongLabel(s)}
                    </Link>
                  ) : (
                    <span>{sessionLongLabel(s)}</span>
                  )}
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                    {TYPE_LABEL[s.imageType]} · {plural(s.assetIds.length, "frame")}
                    {s.imageType === "light" ? (
                      s.target.status === "confirmed" || s.target.status === "associated" ? (
                        <Pill tone="success">Target set</Pill>
                      ) : (
                        <Pill tone="warning">Needs a Target</Pill>
                      )
                    ) : (
                      <Pill tone="info" onClick={() => go("/calibration")}>
                        {ROUTE_LABEL.stack}
                      </Pill>
                    )}
                  </span>
                </li>
              ))}
              {masters > 0 ? (
                <li className="flex min-h-(--row-h) items-center justify-between gap-2 px-2.5 py-1">
                  <span>{plural(masters, "master")}</span>
                  <Pill tone="success" onClick={() => go("/calibration")}>
                    {ROUTE_LABEL.masters}
                  </Pill>
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-separator bg-chrome px-4 py-2.5" data-chrome>
        <Button size="sm" variant="ghost" onClick={reset} disabled={!settled}>
          {kind === "import" ? "Import more" : "Add another"}
        </Button>
        {toCalibration ? (
          <Button size="sm" disabled={!settled} onClick={() => go("/calibration")}>
            Show in Calibration
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
            Show in Sessions
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

function FolderTab() {
  const state = useStore((s) => s)
  const [path, setPath] = useState<string | null>(null)
  const [role, setRole] = useState<LocationRole>("captures")
  const [name, setName] = useState("")
  const [picking, setPicking] = useState(false)
  const [refusal, setRefusal] = useState<RefusalProps | null>(null)
  const draft = { path: path ?? "", displayName: name, role }
  const errors = path ? validateLocation(state.catalog, draft) : {}
  const images = path ? filesUnder(state.disk, path).filter((f) => (f.kind === "fits" || f.kind === "xisf") && f.header).length : 0
  const invalid = [errors.path ?? null, errors.displayName ?? null].filter((b): b is string => b !== null)
  const roleItems = FOLDER_ROLES.map((r) => ({ value: r, label: ROLE_COPY[r].title }))
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Part title="Folder" id="folder-path" aside={<HelpTip label="About indexing in place">Indexed where it is: nothing in it is copied, moved or renamed, and no naming template applies.</HelpTip>}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
              <FolderOpen data-icon="inline-start" aria-hidden="true" />
              Choose folder…
            </Button>
            {path ? (
              <>
                <PathText path={path} />
                <Pill tone="muted">{plural(images, "image file")}</Pill>
              </>
            ) : null}
          </div>
        </Part>
        <Part title="Role" id="folder-role">
          <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-sm">
            <span className="text-muted-foreground">Role</span>
            <Select items={roleItems} value={role} onValueChange={(next) => setRole(next as LocationRole)}>
              <SelectTrigger size="sm" aria-label="Library role" className="w-48">
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
              Name
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
            <span className="text-muted-foreground">Choose a folder</span>
          ) : invalid.length === 1 ? (
            <Refusal action="Can't add" reason={invalid[0]!} blockers={[]} />
          ) : invalid.length > 1 ? (
            <Refusal action="Can't add" reason={plural(invalid.length, "blocker")} blockers={invalid.map((label) => ({ label }))} />
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={closeSheet}>
            Cancel
          </Button>
          <Button size="sm" disabled={!path || invalid.length > 0} onClick={() => setRefusal(refusalOf(addLibraryFolder(draft).result, "Can't add"))}>
            Add and index
          </Button>
        </div>
      </footer>
      <FolderPicker
        open={picking}
        onOpenChange={setPicking}
        title="Choose library folder"
        description="Indexed in place"
        initialPath={path}
        chooseVerb="Add"
        onChoose={(chosen) => {
          setPath(chosen)
          if (!name.trim()) setName(suggestDisplayName(state.disk, chosen))
          setPicking(false)
        }}
      />
    </>
  )
}
