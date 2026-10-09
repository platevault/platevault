/**
 * S13 Import (slice A): the Lightroom-style workflow entry (D-W11, D-W12,
 * D-W20, D-W24). `ImportSheet` is the sheet host mounted once at the app
 * root (toolbar Import, Home and the palette open it with
 * `openSheet({ kind: "import" })`); `ImportRoute` is the `/import` deep link,
 * which shows Home with the sheet over it.
 *
 * The sheet is the preview: pick a source (a saved source offers Import new),
 * see each file's templated destination in Captures or Calibration, the
 * holds (Unclassified until typed, still being written until it settles),
 * the skips (SHA-256 duplicates), writability and free space, and Copy or
 * Move. Import runs as an operation with progress, then lists the sessions
 * it filled. A second tab adds an existing library folder and indexes it in
 * place.
 */
import { Link, useNavigate } from "@tanstack/react-router"
import { FolderOpen, HardDrive, Usb } from "lucide-react"
import { type ReactNode, useEffect, useId, useState } from "react"
import { closeSheet, openSheet, useShellUi } from "@/app/ui-state"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { PathText } from "@/components/app/data"
import { type Column, DataTable } from "@/components/app/data-table"
import { Notice } from "@/components/app/feedback"
import { FolderPicker } from "@/components/app/folder-picker"
import { OperationPanel } from "@/components/app/operation-panel"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { filesUnder } from "@/domain/disk"
import { sessionLongLabel } from "@/domain/membership"
import { namingTemplate } from "@/domain/templates"
import type { ImageType, LocationRole } from "@/domain/types"
import { ROLE_COPY, suggestDisplayName, validateLocation } from "@/features/t1/lib/locations"
import { formatBytes, formatCount, formatDateTime, plural } from "@/lib/format"
import { isSettled } from "@/store/operations"
import { updateSlice, useStore } from "@/store/core"
import type { ImportDraft } from "@/store/slices/a"
import { HomePage } from "./home"
import { CARD_VOLUME, type DestinationGroup, destinationLocations, type ImportPlan, insertCard, planImport, settleGrowingFiles, TYPE_LABEL, TYPEABLE } from "./import-model"
import { addLibraryFolder, type ImportPayload, saveImportSource, startImport } from "./import-run"

/** Simulated time the capture device needs to finish writing a held file. */
const SETTLE_MS = 6000

function setDraft(patch: Partial<ImportDraft>) {
  updateSlice("a", (a) => ({ ...a, importDraft: { ...a.importDraft, ...patch } }))
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
      <SheetHeader className="gap-2 border-b border-separator pb-3">
        <div className="pr-8">
          <SheetTitle>Import</SheetTitle>
          <SheetDescription>Copy or move frames from a card, folder or network share into your library, or index a folder that is already organised.</SheetDescription>
        </div>
        <TabsList>
          <TabsTrigger value="source">From a source</TabsTrigger>
          <TabsTrigger value="folder">Add existing library folder</TabsTrigger>
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

function Part({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-2 border-b border-separator px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2" data-chrome>
        <h3 className="text-xs font-semibold tracking-normal text-muted-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
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
  // A saved source is the usual start: preselect the first one.
  const firstSaved = Object.values(state.catalog.importSources).sort((a, b) => a.name.localeCompare(b.name))[0]?.id
  useEffect(() => {
    if (!draft.source && firstSaved) setDraft({ source: { kind: "saved", id: firstSaved } })
  }, [draft.source, firstSaved])

  const start = () => {
    if (!plan || plan.blockers.length > 0) return
    startImport(plan, draft)
  }
  const verb = draft.mode === "move" ? "Move" : "Import"
  const count = plan?.items.length ?? 0

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto" data-import-preview>
        <SourcePart plan={plan} draft={draft} />
        {plan?.online ? (
          <>
            <DestinationPart plan={plan} />
            <PreviewPart plan={plan} />
            <HeldPart plan={plan} draft={draft} />
            <SkippedPart plan={plan} />
            <ModePart plan={plan} draft={draft} />
          </>
        ) : null}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-separator bg-chrome px-4 py-2.5" data-chrome>
        <div className="min-w-0 flex-1 text-xs">
          {plan && plan.blockers.length > 0 ? (
            <ul className="space-y-0.5 text-warning" data-import-blockers>
              {plan.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : plan ? (
            <span className="text-muted-foreground tabular-nums">
              {plural(count, "frame")} · {formatBytes(plan.bytes)} into {plural(plan.groups.length, "folder")}
            </span>
          ) : (
            <span className="text-muted-foreground">Choose a source to see what it would import.</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={closeSheet}>
            Cancel
          </Button>
          <Button size="sm" disabled={!plan || plan.blockers.length > 0} onClick={() => (draft.mode === "move" ? setConfirmMove(true) : start())} data-import-start>
            {plan ? `${verb} ${plural(count, "frame")}` : verb}
          </Button>
        </div>
      </footer>
      {plan ? (
        <ConfirmDialog
          open={confirmMove}
          onOpenChange={setConfirmMove}
          title={`Move ${plural(count, "frame")} into the library?`}
          description={`From ${plan.sourceLabel} (${plan.sourcePath}).`}
          changes={[
            `Copies ${plural(count, "frame")} (${formatBytes(plan.bytes)}) into ${[...new Set(plan.items.map((i) => i.location.displayName))].join(" and ")}`,
            "Verifies each copy's SHA-256 against its source",
            `Then sends the ${plural(count, "verified source file")} on ${plan.volume?.name ?? "the source"} to the OS Trash`,
          ]}
          unchanged={["Held and skipped files stay on the source", "A source whose copy fails is kept", "Nothing is deleted permanently: the OS Trash can put sources back"]}
          confirmLabel={`Move ${plural(count, "frame")}`}
          onConfirm={start}
        />
      ) : null}
    </>
  )
}

function SourcePart({ plan, draft }: { plan: ImportPlan | null; draft: ImportDraft }) {
  const sources = useStore((s) => Object.values(s.catalog.importSources).sort((a, b) => a.name.localeCompare(b.name)))
  const disk = useStore((s) => s.disk)
  const [picking, setPicking] = useState(false)
  const [name, setName] = useState("")
  const [saveError, setSaveError] = useState<string | null>(null)
  const newOnlyId = useId()
  const value = draft.source?.kind === "saved" ? `saved:${draft.source.id}` : draft.source ? "folder" : ""
  const folderPath = draft.source?.kind === "folder" ? draft.source.path : null
  const mountedAt = (path: string) => Object.values(disk.volumes).some((v) => v.mounted && (path === v.mountPath || path.startsWith(`${v.mountPath}/`)))

  return (
    <Part title="Source" aside={<span className="text-xs text-muted-foreground">Local, removable or network (mounted by the OS)</span>}>
      <RadioGroup
        aria-label="Import source"
        value={value}
        onValueChange={(next) => {
          const v = next as string
          if (v.startsWith("saved:")) setDraft({ source: { kind: "saved", id: v.slice(6) }, typed: {} })
          else if (v === "folder") setPicking(true)
        }}
        className="gap-0 divide-y divide-border rounded-md border border-separator"
      >
        {sources.map((src) => {
          const connected = mountedAt(src.path)
          return (
            <label key={src.id} className="flex min-h-(--row-h) items-center gap-2.5 px-2.5 py-1.5 text-sm has-data-checked:bg-foreground/[0.04]">
              <RadioGroupItem value={`saved:${src.id}`} />
              <Usb aria-hidden="true" className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{src.name}</span>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{src.path}</span>
                <span className="block text-xs text-muted-foreground">Saved source · {src.lastImportedAt ? `last imported ${formatDateTime(src.lastImportedAt)}` : "never imported"}</span>
              </span>
              <StatusBadge kind="availability" value={connected ? "online" : "offline"} label={connected ? "Connected" : "Not connected"} />
            </label>
          )
        })}
        <div className="flex min-h-(--row-h) items-center gap-2.5 px-2.5 py-1.5 text-sm has-data-checked:bg-foreground/[0.04]">
          <RadioGroupItem value="folder" aria-label="Another folder" />
          <FolderOpen aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1">{folderPath ? <PathText path={folderPath} /> : <span className="text-muted-foreground">Another folder, card or share</span>}</span>
          <Button size="xs" variant="outline" onClick={() => setPicking(true)}>
            Choose folder…
          </Button>
        </div>
      </RadioGroup>

      {plan && !plan.online ? (
        plan.sourcePath === CARD_VOLUME.mountPath ? (
          <Notice tone="offline" title={`${plan.sourceLabel} is not connected`} actions={<Button size="xs" variant="outline" onClick={insertCard} data-insert-card>Insert the card (simulation)</Button>}>
            Insert the card; macOS mounts it at {plan.sourcePath}. The prototype simulates the card the ASIAIR wrote last night.
          </Notice>
        ) : (
          <Notice tone="offline" title={`${plan.sourceLabel} is not connected`}>
            Connect its volume; it mounts at {plan.sourcePath}. Network shares must be mounted by the OS first.
          </Notice>
        )
      ) : null}

      {plan?.online && plan.saved ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Switch id={newOnlyId} size="sm" checked={draft.newOnly} onCheckedChange={(checked) => setDraft({ newOnly: checked })} />
          <label htmlFor={newOnlyId}>Import new</label>
          <span className="text-xs text-muted-foreground">
            {draft.newOnly
              ? plan.skipped.imported.length > 0
                ? `Skips ${plural(plan.skipped.imported.length, "file")} already imported from ${plan.saved.name}.`
                : `Skips files already imported from ${plan.saved.name}; none are on it now.`
              : "Off: files imported before are offered again (library duplicates are still skipped)."}
          </span>
        </div>
      ) : null}

      {plan?.online && !plan.saved && folderPath ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Input aria-label="Source name" placeholder="Name, e.g. ASIAIR SD card" value={name} onChange={(e) => setName(e.target.value)} className="h-6 w-56" />
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              const result = saveImportSource(name, folderPath)
              setSaveError(result.ok ? null : result.message)
            }}
          >
            Save as source
          </Button>
          <span className="text-xs text-muted-foreground">A saved source offers Import new next time.</span>
          {saveError ? (
            <span role="alert" className="text-xs text-destructive">
              {saveError}
            </span>
          ) : null}
        </div>
      ) : null}

      <FolderPicker
        open={picking}
        onOpenChange={setPicking}
        title="Choose an import source"
        description="A card, a folder or a mounted network share. Nothing is read until you import."
        initialPath={folderPath ?? CARD_VOLUME.mountPath}
        chooseVerb="Import from"
        onChoose={(path) => {
          setDraft({ source: { kind: "folder", path }, typed: {} })
          setPicking(false)
        }}
      />
    </Part>
  )
}

function DestinationPart({ plan }: { plan: ImportPlan }) {
  const catalog = useStore((s) => s.catalog)
  const naming = useStore((s) => s.settings.naming)
  const typesFor = (role: "captures" | "calibration") => [...new Set(plan.items.filter((i) => i.role === role).map((i) => i.type))]
  return (
    <Part
      title="Destination"
      aside={
        <Link to="/settings/naming" onClick={closeSheet} className="text-xs text-link underline-offset-2 hover:underline">
          Edit naming templates
        </Link>
      }
    >
      <div className="space-y-2">
        {plan.destinations.map((d) => {
          const locations = destinationLocations(catalog, d.role)
          const items = locations.map((l) => ({ value: l.id, label: l.displayName }))
          const types: ImageType[] = typesFor(d.role).length > 0 ? typesFor(d.role) : d.role === "captures" ? ["light"] : ["flat"]
          return (
            <div key={d.role} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 text-sm" data-destination={d.role}>
              <span className="pt-0.5 text-muted-foreground">{d.role === "captures" ? "Lights" : "Calibration"}</span>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Select items={items} value={d.location?.id ?? null} onValueChange={(next) => setDraft(d.role === "captures" ? { capturesLocationId: next as string } : { calibrationLocationId: next as string })}>
                    <SelectTrigger size="sm" aria-label={`${d.role === "captures" ? "Captures" : "Calibration"} location`} className="min-w-48">
                      <SelectValue placeholder={`No ${d.role} location`} />
                    </SelectTrigger>
                    <SelectContent>
                      {items.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {d.location ? <PathText path={d.location.path} className="text-xs text-muted-foreground" /> : null}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                  {types.map((t) => (
                    <span key={t} className="text-muted-foreground">
                      {TYPE_LABEL[t]}: <code className="font-mono text-foreground">{namingTemplate(naming, t === "dark-flat" ? "dark" : (t as Exclude<ImageType, "unknown" | "dark-flat">))}</code>
                    </span>
                  ))}
                </div>
                <div className="text-xs tabular-nums">
                  {d.location ? (
                    <span className={d.problem ? "text-destructive" : "text-muted-foreground"}>
                      {d.writable ? "Writable" : "Not writable"} · {formatBytes(d.freeBytes)} free on {d.volume?.name ?? "its volume"}
                      {d.neededBytes > 0 ? ` · this import needs ${formatBytes(d.neededBytes)}` : " · nothing goes here"}
                      {d.problem ? `. ${d.problem}.` : ""}
                    </span>
                  ) : (
                    <span className={d.problem ? "text-destructive" : "text-muted-foreground"}>{d.problem ?? "No location of this role; nothing goes here."}</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </Part>
  )
}

function PreviewPart({ plan }: { plan: ImportPlan }) {
  const columns: Column<DestinationGroup>[] = [
    {
      id: "folder",
      header: "Destination folder",
      rowHeader: true,
      sortValue: (g) => `${g.role}|${g.relative}`,
      cell: (g) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-mono text-xs" title={`${g.location.path}/${g.relative}`}>
            {g.relative}
          </span>
          <span className="text-xs text-muted-foreground">{g.location.displayName}</span>
        </span>
      ),
    },
    { id: "type", header: "Type", cell: (g) => (g.items.some((i) => i.typed) ? `${TYPE_LABEL[g.type]} (typed)` : TYPE_LABEL[g.type]) },
    { id: "frames", header: "Frames", align: "right", sortValue: (g) => g.items.length, cell: (g) => formatCount(g.items.length) },
    { id: "size", header: "Size", align: "right", sortValue: (g) => g.bytes, cell: (g) => formatBytes(g.bytes) },
    { id: "note", header: "Template note", cell: (g) => (g.fallbacks.length > 0 ? <span className="text-xs text-warning">Fallback for {g.fallbacks.map((f) => `{${f}}`).join(", ")}</span> : <span className="text-xs text-muted-foreground">All tokens resolved</span>) },
  ]
  return (
    <Part title={`Preview · ${plural(plan.items.length, "frame")} · ${formatBytes(plan.bytes)}`}>
      <DataTable
        label="Import destinations"
        rows={plan.groups}
        columns={columns}
        getRowId={(g) => g.key}
        scroll="none"
        empty={<p className="px-3 py-3 text-sm text-muted-foreground">Nothing to import yet. Held and skipped files are listed below.</p>}
      />
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
  return (
    <Part title={`Held · ${formatCount(total)}`} aside={<span className="text-xs text-muted-foreground">Held files stay on the source</span>}>
      <ul className="space-y-1.5 text-sm" data-import-held>
        {plan.held.unclassified.map((hold) => {
          const items = TYPEABLE.map((t) => ({ value: t.value, label: t.label }))
          return (
            <li key={hold.folder} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">
                <StatusBadge kind="association" value="unresolved" label="Unclassified" />
                <span className="ml-2">
                  {plural(hold.files.length, "file")} in <span className="font-mono text-xs">{rel(hold.folder)}</span>
                </span>
                <span className="block text-xs text-muted-foreground">No frame type (IMAGETYP missing){hold.objectLabel ? ` · OBJECT ${hold.objectLabel}` : ""}. Typing it releases the files into the preview; headers stay as captured.</span>
              </span>
              <Select
                items={items}
                value={null}
                onValueChange={(next) => next && setDraft({ typed: { ...draft.typed, ...Object.fromEntries(hold.files.map((f) => [f.path, String(next) as ImageType])) } })}
              >
                <SelectTrigger size="sm" aria-label={`Type the ${hold.files.length} files in ${rel(hold.folder)} as`} className="w-36" data-type-as>
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
          )
        })}
        {typedShown.map(([key, g]) => (
          <li key={key} className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Typed as {TYPE_LABEL[g.type]}: {plural(g.paths.length, "file")} in <span className="font-mono">{rel(key.split("|")[0]!)}</span>, now in the preview.
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
              Undo typing
            </Button>
          </li>
        ))}
        {plan.held.settling.length > 0 ? (
          <li className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="processing" value="pending" label="Still being written" />
            <span className="min-w-0">
              {plan.held.settling.map((f) => (
                <span key={f.path} className="font-mono text-xs">
                  {rel(f.path)}
                </span>
              ))}
              <span className="block text-xs text-muted-foreground">Held until the file stops changing, so a half-written frame is never copied. It joins the preview when it settles.</span>
            </span>
          </li>
        ) : null}
      </ul>
    </Part>
  )
}

function SkippedPart({ plan }: { plan: ImportPlan }) {
  const [open, setOpen] = useState(false)
  const sessions = useStore((s) => s.catalog.sessions)
  const s = plan.skipped
  const total = s.duplicate.length + s.imported.length + s.notImage.length + s.nameTaken.length
  if (total === 0) return null
  const rel = (path: string) => path.slice(plan.sourcePath.length + 1) || path
  const bySession = new Map<string, number>()
  for (const d of s.duplicate) bySession.set(d.sessionId ?? "", (bySession.get(d.sessionId ?? "") ?? 0) + 1)
  return (
    <Part title={`Skipped · ${formatCount(total)}`}>
      <ul className="space-y-1 text-sm" data-import-skipped>
        {s.duplicate.length > 0 ? (
          <li>
            <span className="font-medium">{plural(s.duplicate.length, "duplicate")}</span>
            <span className="text-muted-foreground"> · byte-identical (SHA-256) to frames already in the library</span>
            <Button size="xs" variant="ghost" className="ml-1" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? "Hide" : "Show"}
            </Button>
            {open ? (
              <ul className="mt-1 space-y-0.5 pl-3 text-xs text-muted-foreground">
                {[...bySession.entries()].map(([sessionId, n]) => (
                  <li key={sessionId}>
                    {plural(n, "file")} match{n === 1 ? "es" : ""}{" "}
                    {sessions[sessionId] ? (
                      <Link to="/sessions/$sessionId" params={{ sessionId }} onClick={closeSheet} className="text-link underline-offset-2 hover:underline">
                        {sessionLongLabel(sessions[sessionId]!)}
                      </Link>
                    ) : (
                      "library frames"
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ) : null}
        {s.imported.length > 0 ? (
          <li>
            <span className="font-medium">{plural(s.imported.length, "file")}</span>
            <span className="text-muted-foreground"> already imported from {plan.saved?.name ?? "this source"} (Import new)</span>
          </li>
        ) : null}
        {s.nameTaken.length > 0 ? (
          <li>
            <span className="font-medium">{plural(s.nameTaken.length, "file")}</span>
            <span className="text-muted-foreground"> whose destination already holds different bytes; nothing is overwritten. Change the naming template to import them.</span>
          </li>
        ) : null}
        {s.notImage.length > 0 ? (
          <li>
            <span className="font-medium">{plural(s.notImage.length, "other file")}</span>
            <span className="text-muted-foreground"> (not FITS or XISF: {s.notImage.slice(0, 2).map((f) => rel(f.path)).join(", ")}) stay on the source</span>
          </li>
        ) : null}
      </ul>
    </Part>
  )
}

function ModePart({ plan, draft }: { plan: ImportPlan; draft: ImportDraft }) {
  return (
    <Part title="Copy or Move">
      <RadioGroup aria-label="Copy or Move" value={draft.mode} onValueChange={(next) => setDraft({ mode: next as "copy" | "move" })} className="gap-1.5">
        <label className="flex items-start gap-2.5 text-sm">
          <RadioGroupItem value="copy" className="mt-0.5" />
          <span>
            <span className="font-medium">Copy</span>
            <span className="block text-xs text-muted-foreground">Copies each file and verifies its SHA-256. The source stays as it is.</span>
          </span>
        </label>
        <label className="flex items-start gap-2.5 text-sm">
          <RadioGroupItem value="move" className="mt-0.5" disabled={!plan.move.allowed} />
          <span>
            <span className={plan.move.allowed ? "font-medium" : "font-medium text-muted-foreground"}>Move</span>
            <span className="block text-xs text-muted-foreground">
              Copies each file, verifies its SHA-256, then sends the source to the OS Trash. Nothing is deleted permanently.
              {plan.move.reason ? <span className="block text-warning">Unavailable: {plan.move.reason}</span> : null}
            </span>
          </span>
        </label>
      </RadioGroup>
      {plan.volume ? (
        <p className="text-xs text-muted-foreground">
          <HardDrive aria-hidden="true" className="mr-1 inline size-3.5 align-[-2px]" />
          Source volume {plan.volume.name}: {plan.volume.writable ? "writable" : "read-only"}, OS Trash {plan.volume.trash}
          {plan.volume.network ? ", network share" : ""}.
        </p>
      ) : null}
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
  if (!op) {
    return (
      <div className="flex-1 p-4">
        <Notice tone="info" title="That operation is no longer recorded" actions={<Button size="xs" variant="outline" onClick={reset}>Start again</Button>} />
      </div>
    )
  }
  const settled = isSettled(op.status)
  const payload = kind === "import" ? (op.payload as unknown as ImportPayload) : null
  const imported = (payload?.sessionIds ?? []).map((id) => sessions[id]).filter((s) => s !== undefined)
  const lights = imported.filter((s) => s.imageType === "light")
  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" data-import-progress>
        <OperationPanel operationId={operationId} headingLevel={3} />
        {payload?.trashOperationId ? <OperationPanel operationId={payload.trashOperationId} headingLevel={3} /> : null}
        {payload && settled && imported.length > 0 ? (
          <section className="space-y-1.5" aria-labelledby="import-sessions">
            <h3 id="import-sessions" className="text-xs font-semibold text-muted-foreground">
              Now in the library · {plural(lights.length, "light session")}, {imported.length - lights.length} calibration
            </h3>
            <ul className="divide-y divide-border rounded-md border border-separator text-sm">
              {imported.map((s) => (
                <li key={s.id} className="flex min-h-(--row-h) items-center justify-between gap-2 px-2.5 py-1">
                  {s.imageType === "light" ? (
                    <Link to="/sessions/$sessionId" params={{ sessionId: s.id }} onClick={closeSheet} className="font-medium underline-offset-2 hover:underline">
                      {sessionLongLabel(s)}
                    </Link>
                  ) : (
                    <span>{sessionLongLabel(s)}</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {TYPE_LABEL[s.imageType]} · {plural(s.assetIds.length, "frame")}
                    {s.imageType === "light" ? ` · ${s.target.status === "confirmed" || s.target.status === "associated" ? "Target set" : "Needs a Target"}` : " · Calibration library"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-separator bg-chrome px-4 py-2.5" data-chrome>
        <Button size="sm" variant="ghost" onClick={reset} disabled={!settled}>
          {kind === "import" ? "Import more" : "Add another folder"}
        </Button>
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
  const [error, setError] = useState<string | null>(null)
  const draft = { path: path ?? "", displayName: name, role }
  const errors = path ? validateLocation(state.catalog, draft) : {}
  const images = path ? filesUnder(state.disk, path).filter((f) => (f.kind === "fits" || f.kind === "xisf") && f.header).length : 0
  const blockers = [!path ? "Choose a folder" : null, errors.path ?? null, errors.displayName ?? null].filter((b): b is string => b !== null)
  const roleItems = FOLDER_ROLES.map((r) => ({ value: r, label: ROLE_COPY[r].title }))
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Part title="Folder">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
              <FolderOpen data-icon="inline-start" aria-hidden="true" />
              Choose folder…
            </Button>
            {path ? <PathText path={path} /> : <span className="text-muted-foreground">An archive that is already organised the way you want it.</span>}
          </div>
          {path ? <p className="text-xs text-muted-foreground tabular-nums">{plural(images, "FITS or XISF file")} in this folder now.</p> : null}
          {errors.path ? (
            <p role="alert" className="text-xs text-destructive">
              {errors.path}
            </p>
          ) : null}
        </Part>
        <Part title="Library role and name">
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
              Display name
            </label>
            <Input id="add-folder-name" value={name} onChange={(e) => setName(e.target.value)} className="h-6 w-64" aria-invalid={Boolean(errors.displayName) || undefined} />
          </div>
          <p className="text-xs text-muted-foreground">{ROLE_COPY[role].description}</p>
          {errors.displayName && path ? (
            <p role="alert" className="text-xs text-destructive">
              {errors.displayName}
            </p>
          ) : null}
        </Part>
        <Part title="Index in place">
          <p className="text-sm text-pretty">PlateVault reads metadata and hashes every file where it is. It never copies, moves or renames anything in the folder, and no naming template applies.</p>
        </Part>
        {error ? (
          <div className="px-4 pb-3">
            <Notice tone="refusal" title="Not added">
              {error}
            </Notice>
          </div>
        ) : null}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-separator bg-chrome px-4 py-2.5" data-chrome>
        <span className="min-w-0 flex-1 text-xs text-warning">{blockers[0] ?? ""}</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={closeSheet}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={blockers.length > 0}
            onClick={() => {
              const { result } = addLibraryFolder(draft)
              setError(result.ok ? null : result.message)
            }}
          >
            Add and index
          </Button>
        </div>
      </footer>
      <FolderPicker
        open={picking}
        onOpenChange={setPicking}
        title="Choose an existing library folder"
        description="It is indexed in place; nothing in it moves."
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
