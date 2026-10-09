/**
 * S6 Review workspace (slice D): one frame list in three views, the preview
 * with its plots and inspector, the two quality levels and the review
 * hotkeys (D-W13, D-W14, D-W15, D-W22, D-W40, D-W41, D-W42, D-W53, D-W54;
 * spec 067 PIX-FR-01 to PIX-FR-18).
 *
 * Layout (D-W22): the frame table spans the full width at the top; T cycles
 * it through about 8 rows (resizable, the height is remembered), a one-line
 * strip showing the current frame, and full height. The preview, inspector
 * and the plots across the session fill the rest. F is fullscreen; G is the
 * grid; the filmstrip is the strip with thumbnails.
 */
import { useSearch } from "@tanstack/react-router"
import { ArrowLeftRight, ChevronLeft, ChevronRight, Columns3, Expand, Filter, Grid3x3, ImageOff, Keyboard, LayoutList, ListChecks, Minimize, PanelRight, Rows3, Save, Upload, X } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { MissingRecord } from "@/app/missing-record"
import { getPreferences } from "@/app/preferences"
import { MOD_LABEL } from "@/app/shortcuts"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { EmptyState, Notice } from "@/components/app/feedback"
import { Button } from "@/components/ui/button"
import { ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut } from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { currentFile, previewUnavailableReason } from "@/domain/membership"
import type { AssetId, MetricKey, QualityValue } from "@/domain/types"
import { setFrameUi } from "@/features/t3/actions"
import { useSize } from "@/features/t3/frame-preview"
import { ImportDialog, ImportReview } from "@/features/t3/import-dialog"
import { METRIC_LABEL } from "@/features/t3/measure"
import { frameField, type StarRecord, type ViewWindow } from "@/features/t3/raster"
import { plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { discardRunDraft, saveRun } from "@/store/actions/runs"
import { useStore } from "@/store/core"
import { runPipeline } from "@/domain/derive"
import { registerReviewCommands } from "./commands"
import { Inspector } from "./inspector"
import { type Activate, FrameGrid, FrameTable, Filmstrip, frameColumns, type SortState, sortFrames } from "./list"
import { markAnnouncement, markLibrary, MARK_WORD, setProjectOnlyReject } from "./marks"
import { MeasureBar } from "./measure-bar"
import { bucketAfterMark, FILTERS, PLOT_METRICS, type QualityFilter, type ReviewContext, type ReviewFrame, reviewScope } from "./model"
import { displayName, NAME_PRESETS, namePreset } from "./names"
import { SessionPlots, type Threshold } from "./plots"
import { setReviewPrefs, type TableHeight, useReviewPrefs } from "./prefs"
import { Plate, type PlateView, plateWindow, STRETCH_LABEL, ZOOM_LABEL, type Zoom } from "./preview"
import { ReviewShortcutsDialog } from "./shortcuts"

type ListView = "table" | "filmstrip" | "grid"
const HEIGHT_NEXT: Record<TableHeight, TableHeight> = { rows: "strip", strip: "full", full: "rows" }
const HEIGHT_LABEL: Record<TableHeight, string> = { rows: "About 8 rows", strip: "One-line strip", full: "Full height" }
const ROW_PX = 26
/** The preview stage's minimum: caption, a plate of about 240 px, the note and the plots strip. */
const STAGE_MIN_PX = 416
/** Review's own chrome around the table and the stage: toolbar, table handle and status line. */
const REVIEW_CHROME_PX = 66
const ARROW_OWNERS = "[role=tablist],[data-slot=toggle-group],[role=separator],[role=slider],[role=radiogroup],[role=menu]"

/** Text entry only: a Select trigger (role combobox) is not typing, and the capture-phase handler keeps its typeahead from firing. */
function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
}

/** An open dialog, menu or list owns the keyboard; closed popups can stay in the DOM, so only visible ones count. */
function popupOpen() {
  return [...document.querySelectorAll("[role=dialog], [role=alertdialog], [role=menu], [role=listbox]")].some((el) => el.checkVisibility())
}

function MiniSelect({ label, value, options, onChange, className }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; className?: string }) {
  return (
    <Select items={options} value={value} onValueChange={(next) => onChange(String(next))}>
      <SelectTrigger size="sm" aria-label={label} className={cn("min-h-6 text-xs", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function FrameReview({ context }: { context: ReviewContext }) {
  const state = useStore((s) => s)
  const { catalog, disk } = state
  const contextKeyStr = context.kind === "run" ? context.runId : context.kind === "group" ? context.groupId : context.projectId
  // biome-ignore lint/correctness/useExhaustiveDependencies: the context is rebuilt by its parent every render; its key identifies it.
  const scope = useMemo(() => reviewScope(state, context), [state, context.kind, contextKeyStr])
  const prefs = useReviewPrefs()
  const search: Record<string, unknown> = useSearch({ strict: false })
  const searchFilter = FILTERS.find((f) => f.id === search.filter)?.id
  const [filter, setFilter] = useState<QualityFilter>(searchFilter ?? (context.kind === "candidates" ? "unreviewed" : "all"))
  const [panelId, setPanelId] = useState<string>(typeof search.panel === "string" ? search.panel : "all")
  const [sort, setSort] = useState<SortState>({ columnId: "order", direction: "asc" })
  const [selected, setSelected] = useState<Set<AssetId>>(() => new Set())
  const [view, setView] = useState<ListView>("table")
  const [beforeGrid, setBeforeGrid] = useState<Exclude<ListView, "grid">>("table")
  const [height, setHeight] = useState<TableHeight>("rows")
  const [dragPx, setDragPx] = useState<number | null>(null)
  const [compare, setCompare] = useState(false)
  const [refId, setRefId] = useState<AssetId | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [plateView, setPlateView] = useState<PlateView>({ zoom: "fit", centre: null, stretch: "auto" })
  const [shownWindow, setShownWindow] = useState<ViewWindow | null>(null)
  const [starsOn, setStarsOn] = useState(false)
  const [star, setStar] = useState<StarRecord | null>(null)
  const [tab, setTab] = useState("values")
  const [threshold, setThreshold] = useState<Threshold | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [projectConfirm, setProjectConfirm] = useState<ReviewFrame[] | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [announcement, setAnnouncement] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [inspectorShown, setInspectorShown] = useState(false)
  const gridCols = useRef(4)
  const [rootRef, rootSize] = useSize<HTMLDivElement>()
  const statusLineRef = useRef<HTMLElement>(null)
  // Under 1000 px of pane (a 1280 px window with the sidebar, or less) the inspector leaves the row and opens over the preview.
  const inspectorOverlay = rootSize.width > 0 && rootSize.width < 1000

  const key = scope?.key ?? ""
  const storedActive = state.slices.d.frames[key]?.activeAssetId ?? null
  const template = namePreset(prefs.namePreset).template
  const frames = scope?.frames ?? []
  const names = useMemo(() => new Map(frames.map((f) => [f.asset.id, displayName(catalog, f, template)])), [frames, catalog, template])
  const allColumns = frameColumns(names).filter((c) => !c.contexts || c.contexts.includes(context.kind))
  const columns = allColumns.filter((c) => c.id === "frame" || prefs.columns.includes(c.id))
  const inPanel = frames.filter((f) => panelId === "all" || f.panel?.id === panelId)
  const counts: Record<QualityFilter, number> = {
    all: inPanel.length,
    picked: inPanel.filter((f) => f.bucket === "picked").length,
    rejected: inPanel.filter((f) => f.bucket === "rejected").length,
    unreviewed: inPanel.filter((f) => f.bucket === "unreviewed").length,
  }
  const shown = inPanel.filter((f) => filter === "all" || f.bucket === filter)
  const ordered = sortFrames(shown, sort, allColumns)
  const current = ordered.find((f) => f.asset.id === storedActive) ?? ordered[0] ?? null
  const index = current ? ordered.indexOf(current) : -1
  const selectedFrames = frames.filter((f) => selected.has(f.asset.id))
  const hiddenSelected = selectedFrames.filter((f) => !shown.includes(f)).length
  const targets = selectedFrames.length > 1 ? selectedFrames : current ? [current] : []
  const reference = compare ? (frames.find((f) => f.asset.id === refId) ?? null) : null

  const file = current && current.availability === "available" ? currentFile(disk, catalog, current.asset) : undefined
  const field = current ? frameField(current.asset.id, file) : null
  const refFile = reference && reference.availability === "available" ? currentFile(disk, catalog, reference.asset) : undefined
  const refField = reference ? frameField(reference.asset.id, refFile) : null
  const unavailableReason = current && current.availability !== "available" ? previewUnavailableReason(current.availability) : current && !field ? "No pixel data for this file." : null

  function announce(message: string) {
    setAnnouncement(message)
  }

  function select(id: AssetId) {
    if (!scope) return
    setFrameUi(scope.key, { activeAssetId: id })
    // The measure operation of the frame's own run takes it first (PIX-FR-01).
    const run = scope.frames.find((f) => f.asset.id === id)?.run
    if (run && run.id !== scope.key) setFrameUi(run.id, { activeAssetId: id })
  }

  const activate: Activate = (id, mode) => {
    if (mode === "set") setSelected(new Set())
    else if (mode === "toggle")
      setSelected((prev) => {
        const next = new Set(prev.size === 0 && current ? [current.asset.id] : prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    else {
      const from = Math.max(0, index)
      const to = ordered.findIndex((f) => f.asset.id === id)
      setSelected(new Set(ordered.slice(Math.min(from, to), Math.max(from, to) + 1).map((f) => f.asset.id)))
    }
    select(id)
  }

  function step(delta: number) {
    const next = ordered[Math.min(ordered.length - 1, Math.max(0, index + delta))]
    if (!next) return
    setSelected(new Set())
    select(next.asset.id)
    announce(`${names.get(next.asset.id)}: frame ${ordered.indexOf(next) + 1} of ${ordered.length}.`)
  }

  function mark(value: QualityValue, always = false) {
    if (!scope || !current) return
    const result = markLibrary(scope, targets, value)
    if (!result.ok) {
      setError(result.message)
      announce(result.message)
      return
    }
    setError(null)
    announce(markAnnouncement(targets, value))
    if (targets.length > 1) return
    const successor = ordered[index + 1] ?? null
    const fallback = ordered[index - 1] ?? null
    const leaves = filter !== "all" && bucketAfterMark(current, value) !== filter
    // Auto-advance on the last frame keeps it current; a mark that moves the frame out of the filter moves on either way.
    const next = prefs.autoAdvance || always ? (successor ?? (leaves ? fallback : null)) : leaves ? (successor ?? fallback) : null
    if (next) select(next.asset.id)
  }

  function confirmProjectReject(list: ReviewFrame[]) {
    if (!scope) return
    if (scope.readOnlyReason) {
      setError(scope.readOnlyReason)
      return
    }
    setProjectConfirm(list)
  }

  function clearProjectReject(list: ReviewFrame[]) {
    if (!scope) return
    const result = setProjectOnlyReject(scope, list, false)
    if (!result.ok) return setError(result.message)
    setError(null)
    announce(`Project reject cleared for ${list.length === 1 ? list[0]!.asset.fileName : plural(list.length, "frame")}. Library quality unchanged.`)
  }

  function startCompare() {
    if (compare) return setCompare(false)
    const other = selectedFrames.find((f) => f.asset.id !== current?.asset.id) ?? ordered[index - 1] ?? ordered[index + 1] ?? null
    if (!refId || !frames.some((f) => f.asset.id === refId)) setRefId(other?.asset.id ?? null)
    setCompare(true)
    announce(`Compare on: ${current ? names.get(current.asset.id) : "no frame"} beside ${other ? names.get(other.asset.id) : "no reference"}, linked zoom and pan.`)
  }

  function toggleGrid() {
    if (view === "grid") setView(beforeGrid)
    else {
      setBeforeGrid(view)
      setView("grid")
    }
  }

  function cycleHeight() {
    if (view !== "table") {
      setView("table")
      return
    }
    setHeight((h) => HEIGHT_NEXT[h])
  }

  function selectAll() {
    setSelected(new Set(ordered.map((f) => f.asset.id)))
    announce(`${plural(ordered.length, "frame")} selected.`)
  }

  function thresholdMatches(t: Threshold) {
    if (t.value === null) return { matches: [] as ReviewFrame[], missing: shown.filter((f) => f.builtIn[t.metric]?.value == null).length }
    const matches = shown.filter((f) => {
      const v = f.builtIn[t.metric]?.value
      return v !== null && v !== undefined && (t.direction === "above" ? v > t.value! : v < t.value!)
    })
    return { matches, missing: shown.filter((f) => f.builtIn[t.metric]?.value == null).length }
  }

  function applyThreshold(add: boolean) {
    if (!threshold) return
    const { matches } = thresholdMatches(threshold)
    setSelected((prev) => new Set([...(add ? prev : []), ...matches.map((f) => f.asset.id)]))
    if (matches[0]) select(matches[0].asset.id)
    announce(`${plural(matches.length, "frame")} with ${METRIC_LABEL[threshold.metric]} ${threshold.direction} ${threshold.value} selected. Quality is unchanged until you mark them.`)
  }

  // `?assetId=` opens that frame, with the filter widened when it hides it.
  const linked = typeof search.assetId === "string" ? search.assetId : null
  useEffect(() => {
    if (!linked || !scope) return
    const f = scope.frames.find((x) => x.asset.id === linked)
    if (!f) return
    setPanelId("all")
    setFilter((current) => (current === "all" || current === f.bucket ? current : "all"))
    select(linked)
    // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per linked frame.
  }, [linked, scope?.key])

  useEffect(() => {
    setStar(null)
  }, [current?.asset.id])

  const zoomed = plateView.zoom !== "fit"
  const latest = {
    step,
    mark,
    selectAll,
    toggleGrid,
    cycleHeight,
    startCompare,
    toggleZoom: () => setPlateView((v) => ({ ...v, zoom: v.zoom === "fit" ? "1" : "fit" })),
    toggleFullscreen: () => setFullscreen((f) => !f),
    filter: (id: QualityFilter) => {
      setFilter(id)
      announce(`Filter: ${FILTERS.find((f) => f.id === id)!.label}, ${plural(counts[id], "frame")}.`)
    },
    toggleSelected: () => current && activate(current.asset.id, "toggle"),
    escape: () => {
      if (fullscreen) {
        setFullscreen(false)
        return true
      }
      if (inspectorOverlay && inspectorShown) {
        setInspectorShown(false)
        return true
      }
      if (selected.size > 0) {
        setSelected(new Set())
        announce("Selection cleared.")
        return true
      }
      return false
    },
    shortcuts: () => setShortcutsOpen(true),
    toggleInspector: () => (inspectorOverlay ? setInspectorShown((v) => !v) : setReviewPrefs({ inspectorOpen: !prefs.inspectorOpen })),
    zoomed,
    gridCols: () => (view === "grid" ? gridCols.current : 1),
  }
  const handlers = useRef(latest)
  handlers.current = latest

  // Review hotkeys (PIX-FR-13), on the capture phase so they win over the app's G sequences and ? while Review is open.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const h = handlers.current
      if (isTyping(event.target)) return
      if (popupOpen()) return
      const target = event.target instanceof Element ? event.target : null
      const consume = () => {
        event.preventDefault()
        event.stopPropagation()
      }
      const key = event.key
      if ((event.metaKey || event.ctrlKey) && !event.altKey && key.toLowerCase() === "a") {
        h.selectAll()
        return consume()
      }
      if (event.metaKey || event.ctrlKey) return
      if (event.altKey) {
        const n = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(event.code)
        if (n >= 0) {
          h.filter(FILTERS[n]!.id)
          consume()
        }
        return
      }
      if (key === "Escape") {
        if (h.escape()) consume()
        return
      }
      if (key.startsWith("Arrow")) {
        if (target?.closest(ARROW_OWNERS) || (target?.closest("[data-plate]") && h.zoomed)) return
        const delta = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : key === "ArrowDown" ? h.gridCols() : -h.gridCols()
        h.step(delta)
        return consume()
      }
      if (!getPreferences().singleKeyShortcuts) return
      if (key === " ") {
        if (target === document.body || target?.closest("[data-frame-item], tr[data-frame-id], [data-plate]")) {
          h.toggleSelected()
          consume()
        }
        return
      }
      const lower = key.toLowerCase()
      const actions: Record<string, () => void> = {
        j: () => h.step(1),
        k: () => h.step(-1),
        p: () => h.mark("usable", event.shiftKey),
        x: () => h.mark("unusable", event.shiftKey),
        u: () => h.mark("unreviewed"),
        z: h.toggleZoom,
        f: h.toggleFullscreen,
        c: h.startCompare,
        g: h.toggleGrid,
        t: h.cycleHeight,
        i: h.toggleInspector,
        "?": h.shortcuts,
      }
      const action = actions[key === "?" ? "?" : lower]
      if (!action || (event.shiftKey && !["p", "x", "?"].includes(key === "?" ? "?" : lower))) return
      action()
      consume()
    }
    window.addEventListener("keydown", onKeyDown, true)
    const h = () => handlers.current
    registerReviewCommands([
      { id: "next", label: "Next frame", keys: "J", run: () => h().step(1) },
      { id: "previous", label: "Previous frame", keys: "K", run: () => h().step(-1) },
      { id: "pick", label: "Mark Picked", keys: "P", run: () => h().mark("usable") },
      { id: "reject", label: "Mark Rejected", keys: "X", run: () => h().mark("unusable") },
      { id: "unreviewed", label: "Mark Unreviewed", keys: "U", run: () => h().mark("unreviewed") },
      { id: "zoom", label: "Zoom Fit or 1:1", keys: "Z", run: () => h().toggleZoom() },
      { id: "fullscreen", label: "Fullscreen preview", keys: "F", run: () => h().toggleFullscreen() },
      { id: "compare", label: "Compare frames", keys: "C", run: () => h().startCompare() },
      { id: "grid", label: "Grid view", keys: "G", run: () => h().toggleGrid() },
      { id: "height", label: "Cycle table height", keys: "T", run: () => h().cycleHeight() },
      { id: "inspector", label: "Show or hide the frame inspector", keys: "I", run: () => h().toggleInspector() },
      { id: "select-all", label: "Select all shown frames", keys: `${MOD_LABEL}A`, run: () => h().selectAll() },
      { id: "shortcuts", label: "Review shortcuts", keys: "?", run: () => h().shortcuts() },
    ])
    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      registerReviewCommands(null)
    }
  }, [])

  if (!scope) {
    return <MissingRecord noun={context.kind === "candidates" ? "Project" : context.kind === "group" ? "run group" : "run"} backTo="/projects" backLabel="Open Projects" />
  }

  const menu = current ? (
    <>
      {(["usable", "unusable", "unreviewed"] as const).map((value) => (
        <ContextMenuItem key={value} disabled={scope.readOnlyReason !== null} onClick={() => mark(value)}>
          Mark {MARK_WORD[value]}
          {targets.length > 1 ? ` (${targets.length})` : ""}
          <ContextMenuShortcut>{value === "usable" ? "P" : value === "unusable" ? "X" : "U"}</ContextMenuShortcut>
        </ContextMenuItem>
      ))}
      <ContextMenuSeparator />
      {targets.length === 1 && current.rejectedBy.project ? (
        <ContextMenuItem disabled={scope.readOnlyReason !== null} onClick={() => clearProjectReject([current])}>
          Clear Project reject
        </ContextMenuItem>
      ) : (
        <ContextMenuItem disabled={scope.readOnlyReason !== null} onClick={() => confirmProjectReject(targets)}>
          Reject for this Project only…
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        onClick={() => {
          setRefId(current.asset.id)
          announce(`${names.get(current.asset.id)} is the compare reference.`)
        }}
      >
        Set as compare reference
      </ContextMenuItem>
      <ContextMenuItem onClick={selectAll}>
        Select all shown
        <ContextMenuShortcut>{MOD_LABEL}A</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  ) : null

  const emptyList = (
    <EmptyState
      icon={ImageOff}
      title={frames.length === 0 ? "No frames to review" : "No frames match"}
      description={
        frames.length === 0
          ? context.kind === "candidates"
            ? "This Project has no candidate sessions with frames outside the Trash."
            : "This review has no frames yet: add sessions in Select."
          : `No frame is ${FILTERS.find((f) => f.id === filter)!.label} here. Choose All to see every frame.`
      }
      action={
        frames.length > 0 ? (
          <Button size="sm" variant="outline" onClick={() => setFilter("all")}>
            Show all frames
          </Button>
        ) : undefined
      }
    />
  )

  const listProps = {
    frames: ordered,
    activeId: current?.asset.id ?? null,
    selected,
    names,
    onActivate: activate,
    onToggleSelected: (id: AssetId, on: boolean) =>
      setSelected((prev) => {
        const next = new Set(prev)
        if (on) next.add(id)
        else next.delete(id)
        return next
      }),
    menu,
    empty: emptyList,
  }

  // The table's height comes from the space left once the preview has its minimum (STAGE_MIN_PX): the
  // dragged or remembered "about 8 rows" is the most it takes, and never less than three rows.
  const rowsCap = rootSize.height > 0 ? Math.max(ROW_PX * 4 + 2, rootSize.height - STAGE_MIN_PX - REVIEW_CHROME_PX) : Number.POSITIVE_INFINITY
  const rowsPx = Math.min(dragPx ?? prefs.rowsHeightPx, rowsCap)
  const showStage = !(view === "table" && height === "full")
  const thresholdInfo = threshold ? thresholdMatches(threshold) : null
  const unitFor = (metric: MetricKey) => frames.find((f) => f.builtIn[metric])?.builtIn[metric]?.unit ?? ""

  const plateCaption = current ? (
    <div className="flex min-w-0 items-center gap-x-3 px-1 text-xs">
      <span className="min-w-0 truncate font-medium" title={current.asset.copies[0]?.path}>
        {names.get(current.asset.id)}
      </span>
      <span className="shrink-0 text-muted-foreground tabular-nums">
        Frame {index + 1} of {ordered.length}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <ToggleGroup value={[plateView.zoom]} onValueChange={(v) => v[0] && setPlateView((p) => ({ ...p, zoom: v[0] as Zoom }))} variant="outline" size="sm" spacing={0} aria-label="Zoom">
          {(["fit", "1", "2"] as const).map((z) => (
            <ToggleGroupItem key={z} value={z} className="h-6 px-2 text-xs">
              {ZOOM_LABEL[z]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup value={[plateView.stretch]} onValueChange={(v) => v[0] && setPlateView((p) => ({ ...p, stretch: v[0] as PlateView["stretch"] }))} variant="outline" size="sm" spacing={0} aria-label="Display stretch">
          {(["linear", "auto", "strong"] as const).map((s) => (
            <ToggleGroupItem key={s} value={s} className="h-6 px-2 text-xs">
              {STRETCH_LABEL[s]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button size="icon-sm" variant="outline" aria-label="Previous frame (K)" disabled={index <= 0} onClick={() => step(-1)}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button size="icon-sm" variant="outline" aria-label="Next frame (J)" disabled={index >= ordered.length - 1} onClick={() => step(1)}>
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button size="icon-sm" variant="outline" aria-label={fullscreen ? "Leave fullscreen (F)" : "Fullscreen preview (F)"} aria-pressed={fullscreen} onClick={() => setFullscreen((f) => !f)}>
          {fullscreen ? <Minimize aria-hidden="true" /> : <Expand aria-hidden="true" />}
        </Button>
        {inspectorOverlay && !fullscreen ? (
          <Toggle variant="outline" size="sm" className="h-6 min-w-6 px-1.5" pressed={inspectorShown} onPressedChange={setInspectorShown} aria-label="Frame inspector (I)">
            <PanelRight aria-hidden="true" />
          </Toggle>
        ) : null}
      </div>
    </div>
  ) : null

  const plateNote = (
    <p id="review-plate-note" className="truncate px-1 text-[0.6875rem] leading-4 text-muted-foreground">
      Prototype: a synthetic preview drawn from this frame's fixture facts. {zoomed ? "Drag or use the arrow keys on the preview to pan; Shift pans further." : "Z or 1:1 zooms in."} Stretch changes the display only; values are measured on linear data.
      {field?.cfa ? ` CFA ${field.cfa} mosaic plane as recorded, not debayered.` : ""}
    </p>
  )

  const plates =
    current === null ? (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">No current frame.</div>
    ) : (
      <div className="flex min-h-0 flex-1 gap-2">
        <PlateSlot
          label={compare ? `Current: ${names.get(current.asset.id)}` : null}
          field={field}
          unavailable={unavailableReason}
          render={(f) => (
            <Plate
              field={f}
              view={plateView}
              onView={setPlateView}
              label={`Preview of ${names.get(current.asset.id)}`}
              starsOn={starsOn}
              starId={star?.id ?? null}
              onStar={(s) => {
                setStar(s)
                setTab("stars")
              }}
              onWindow={setShownWindow}
              describedBy="review-plate-note"
            />
          )}
        />
        {compare ? (
          <PlateSlot
            label={
              <span className="flex min-w-0 items-center gap-1.5">
                Reference:
                <MiniSelect
                  label="Compare reference"
                  className="max-w-56"
                  value={reference?.asset.id ?? "none"}
                  onChange={(v) => setRefId(v === "none" ? null : v)}
                  options={[{ value: "none", label: "Choose a frame" }, ...ordered.map((f) => ({ value: f.asset.id, label: names.get(f.asset.id) ?? f.asset.fileName }))]}
                />
              </span>
            }
            field={refField}
            unavailable={!reference ? "Choose a reference frame to compare with." : reference.availability !== "available" ? previewUnavailableReason(reference.availability) : !refField ? "No pixel data for this file." : null}
            render={(f) => <Plate field={f} view={plateView} onView={setPlateView} label={`Reference ${reference ? names.get(reference.asset.id) : ""}`} starsOn={false} starId={null} onStar={() => {}} />}
          />
        ) : null}
      </div>
    )

  const plotsStrip = (
    <div className={cn("shrink-0 border-t border-separator px-2 py-1.5", rootSize.height > 0 && rootSize.height < 600 ? "h-24" : "h-28")}>
      <SessionPlots
        frames={shown}
        activeId={current?.asset.id ?? null}
        selected={selected}
        threshold={threshold}
        onSelect={(id) => activate(id, "set")}
        onThreshold={
          threshold
            ? (metric, value) => setThreshold({ ...threshold, metric, value: Number(value.toFixed(metric === "star-count" || metric === "background" ? 0 : 2)) })
            : null
        }
      />
    </div>
  )

  const inspector =
    current && (inspectorOverlay ? inspectorShown : prefs.inspectorOpen) ? (
      <Inspector
        scope={scope}
        frame={current}
        name={names.get(current.asset.id) ?? current.asset.fileName}
        catalog={catalog}
        field={field}
        window={shownWindow && field ? shownWindow : field ? plateWindow(field, 640, 420, { ...plateView, zoom: "fit" }) : null}
        view={plateView}
        starsOn={starsOn}
        onStarsOn={setStarsOn}
        star={star}
        onStar={(s) => {
          setStar(s)
          setStarsOn(true)
          if (plateView.zoom === "fit") setPlateView((v) => ({ ...v, zoom: "1", centre: { x: s.x, y: s.y } }))
          else setPlateView((v) => ({ ...v, centre: { x: s.x, y: s.y } }))
        }}
        tab={tab}
        onTab={setTab}
        targets={targets.length}
        actions={{ mark: (v) => mark(v), projectReject: () => confirmProjectReject(targets), clearProjectReject: () => clearProjectReject([current]) }}
        overlay={inspectorOverlay}
        onClose={inspectorOverlay ? () => setInspectorShown(false) : undefined}
      />
    ) : null

  const project = scope.project
  const confirmFrames = projectConfirm ?? []
  const confirmRuns = [...new Set(confirmFrames.flatMap((f) => (f.run && f.run.completion === "open" ? [f.run.name] : [])))]
  // Unsaved run drafts this review made: Review's status line offers Save run (the toolbar's Next focuses it).
  const drafts = scope.runs.filter((r) => r.draft && r.completion === "open" && !r.trashedAt)
  const draftNote = drafts.length === 1 ? (runPipeline(state, drafts[0]!).steps[1]!.status.endsWith("unsaved") ? runPipeline(state, drafts[0]!).steps[1]!.status : "Unsaved changes") : drafts.length > 1 ? `${plural(drafts.length, "panel run")} unsaved` : null
  const saveDrafts = () => {
    for (const run of drafts) {
      const result = saveRun(run.id)
      if (!result.ok) {
        setError(result.message)
        announce(result.message)
        return
      }
    }
    setError(null)
    announce(drafts.length === 1 ? `${drafts[0]!.name} saved as revision ${(drafts[0]!.revisions.at(-1)?.revision ?? 0) + 1}.` : `${plural(drafts.length, "run")} saved.`)
    statusLineRef.current?.focus()
  }
  const discardDrafts = () => {
    for (const run of drafts) discardRunDraft(run.id)
    announce("Unsaved changes discarded; the runs are back at their saved revisions.")
    statusLineRef.current?.focus()
  }
  const notes = [scope.membershipNote, scope.trashedPanels.length > 0 ? `${scope.trashedPanels.join(", ")} ${scope.trashedPanels.length === 1 ? "is" : "are"} in the Project's Trash: not listed or counted.` : null].filter((n): n is string => n !== null)

  return (
    <div ref={rootRef} className="@container flex min-h-[36.5rem] min-w-0 flex-1 flex-col" data-review={scope.key}>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {/* Toolbar: the list's filter, panel, view and height; selection, compare, display. One row from 784 px: labels fold to icons. */}
      <div data-chrome className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-separator bg-[color-mix(in_oklch,var(--chrome)_45%,var(--background))] px-3 py-1">
        <ToggleGroup value={[filter]} onValueChange={(v) => v[0] && setFilter(v[0] as QualityFilter)} variant="outline" size="sm" spacing={0} aria-label="Quality filter">
          {FILTERS.map((f) => (
            <ToggleGroupItem key={f.id} value={f.id} className="h-6 gap-1 px-2 text-xs" title={`⌥${f.key}`}>
              {f.label}
              <span className="text-muted-foreground tabular-nums">{counts[f.id]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {context.kind === "group" ? (
          <MiniSelect
            label="Panel filter"
            value={panelId}
            onChange={setPanelId}
            options={[{ value: "all", label: "All panels" }, ...scope.panels.map((p) => ({ value: p.id, label: `Panel ${p.n}` }))]}
          />
        ) : null}
        <ToggleGroup
          value={[view]}
          onValueChange={(v) => {
            const next = v[0] as ListView | undefined
            if (!next) return
            if (next === "grid" && view !== "grid") setBeforeGrid(view as Exclude<ListView, "grid">)
            setView(next)
          }}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="View"
        >
          <ToggleGroupItem value="table" className="h-6 gap-1 px-2 text-xs" title="Table">
            <LayoutList aria-hidden="true" className="size-3.5" />
            <span className="@max-[62rem]:sr-only">Table</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="filmstrip" className="h-6 gap-1 px-2 text-xs" title="Filmstrip">
            <Columns3 aria-hidden="true" className="size-3.5" />
            <span className="@max-[62rem]:sr-only">Filmstrip</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="grid" className="h-6 gap-1 px-2 text-xs" title="Grid (G)">
            <Grid3x3 aria-hidden="true" className="size-3.5" />
            <span className="@max-[62rem]:sr-only">Grid</span>
          </ToggleGroupItem>
        </ToggleGroup>
        {view === "table" ? (
          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={cycleHeight} title={`Table height: ${HEIGHT_LABEL[height]}. T switches to ${HEIGHT_LABEL[HEIGHT_NEXT[height]]}.`}>
            <Rows3 aria-hidden="true" />
            <span className="@max-[62rem]:sr-only">{HEIGHT_LABEL[height]}</span>
            <span className="sr-only">, table height</span>
            <Kbd className="ml-0.5">T</Kbd>
          </Button>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" variant="outline" className="h-6 text-xs" />}>
              <ListChecks aria-hidden="true" />
              Select
              {selected.size > 0 ? <span className="tabular-nums text-muted-foreground">{selected.size}</span> : null}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onClick={selectAll}>
                Select all shown ({ordered.length})<DropdownMenuShortcut>{MOD_LABEL}A</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setThreshold(threshold ?? { metric: "fwhm", direction: "above", value: null })}>Select by threshold…</DropdownMenuItem>
              <DropdownMenuItem disabled={selected.size === 0} onClick={() => setSelected(new Set())}>
                Clear selection<DropdownMenuShortcut>Esc</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Toggle variant="outline" size="sm" className="h-6 text-xs" pressed={compare} onPressedChange={() => startCompare()} title="Compare (C)">
            <ArrowLeftRight aria-hidden="true" />
            <span className="@max-[62rem]:sr-only">Compare</span>
          </Toggle>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" variant="outline" className="h-6 text-xs" title="Display" />}>
              <Filter aria-hidden="true" />
              <span className="@max-[62rem]:sr-only">Display</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Frame names</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={prefs.namePreset} onValueChange={(v) => setReviewPrefs({ namePreset: String(v) })}>
                  {NAME_PRESETS.map((p) => (
                    <DropdownMenuRadioItem key={p.id} value={p.id}>
                      <span className="flex min-w-0 flex-col">
                        <span>{p.label}</span>
                        <span className="font-mono text-[0.6875rem] text-muted-foreground">{p.template}</span>
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Columns</DropdownMenuLabel>
                {allColumns
                  .filter((c) => c.id !== "frame")
                  .map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c.id}
                      checked={prefs.columns.includes(c.id)}
                      closeOnClick={false}
                      onCheckedChange={(on) => setReviewPrefs({ columns: on ? [...prefs.columns, c.id] : prefs.columns.filter((id) => id !== c.id) })}
                    >
                      {c.header}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={prefs.autoAdvance} closeOnClick={false} onCheckedChange={(on) => setReviewPrefs({ autoAdvance: on })}>
                Auto-advance after a mark
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={inspectorOverlay ? inspectorShown : prefs.inspectorOpen}
                closeOnClick={false}
                onCheckedChange={(on) => (inspectorOverlay ? setInspectorShown(on) : setReviewPrefs({ inspectorOpen: on }))}
              >
                Show the inspector<DropdownMenuShortcut>I</DropdownMenuShortcut>
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="icon-sm" variant="ghost" aria-label="Review shortcuts (?)" onClick={() => setShortcutsOpen(true)}>
            <Keyboard aria-hidden="true" />
          </Button>
        </div>
      </div>

      {scope.readOnlyReason || error ? (
        <div className="shrink-0 space-y-1 border-b border-separator px-3 py-1.5">
          {scope.readOnlyReason ? <Notice tone="info" title={scope.readOnlyReason} /> : null}
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {threshold && thresholdInfo ? (
        <div role="group" aria-label="Select by threshold" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-separator px-3 py-1 text-xs">
          <span>Select frames with</span>
          <MiniSelect label="Threshold metric" value={threshold.metric} onChange={(v) => setThreshold({ ...threshold, metric: v as MetricKey })} options={PLOT_METRICS.map((m) => ({ value: m, label: METRIC_LABEL[m] }))} />
          <MiniSelect label="Direction" value={threshold.direction} onChange={(v) => setThreshold({ ...threshold, direction: v as Threshold["direction"] })} options={[{ value: "above", label: "above" }, { value: "below", label: "below" }]} />
          <Input
            type="number"
            inputMode="decimal"
            step="any"
            aria-label={`Threshold value${unitFor(threshold.metric) ? ` in ${unitFor(threshold.metric)}` : ""}`}
            className="h-6 w-24 text-xs"
            value={threshold.value ?? ""}
            onChange={(e) => setThreshold({ ...threshold, value: e.target.value === "" ? null : Number(e.target.value) })}
          />
          <span className="text-muted-foreground">{unitFor(threshold.metric)}</span>
          <Button size="sm" disabled={threshold.value === null} onClick={() => applyThreshold(false)}>
            Select {plural(thresholdInfo.matches.length, "frame")}
          </Button>
          <Button size="sm" variant="outline" disabled={threshold.value === null} onClick={() => applyThreshold(true)}>
            Add to selection
          </Button>
          <span className="text-muted-foreground">
            {thresholdInfo.missing > 0 ? `${plural(thresholdInfo.missing, "frame")} Not measured: never selected. ` : ""}Click a plot to set the value. Selecting never changes quality.
          </span>
          <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="Close threshold selection" onClick={() => setThreshold(null)}>
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      {view === "table" ? (
        <div
          className={cn("flex min-h-0 flex-col border-b border-separator", height === "full" ? "flex-1" : height === "rows" ? "shrink min-h-[calc(var(--row-h)*4+2px)]" : "shrink-0")}
          style={height === "rows" ? { height: rowsPx } : height === "strip" ? { height: ROW_PX * 2 + 2 } : undefined}
        >
          <FrameTable {...listProps} columns={columns} sort={sort} onSort={setSort} strip={height === "strip"} />
        </div>
      ) : view === "filmstrip" ? (
        <div className="shrink-0 border-b border-separator">
          <Filmstrip {...listProps} disk={disk} catalog={catalog} />
        </div>
      ) : null}
      {view === "table" && height === "rows" ? (
        <RowsHandle
          px={rowsPx}
          onDrag={setDragPx}
          onCommit={(px) => {
            setDragPx(null)
            setReviewPrefs({ rowsHeightPx: px })
          }}
        />
      ) : null}

      {showStage ? (
        <div className={cn("relative flex flex-1", fullscreen ? "fixed inset-0 z-50 min-h-0 flex-col bg-background" : "min-h-[26rem]")} aria-label={fullscreen ? "Fullscreen preview" : undefined} role={fullscreen ? "region" : undefined}>
          {fullscreen && current ? <FullscreenBar name={names.get(current.asset.id) ?? ""} frame={current} onExit={() => setFullscreen(false)} onMark={mark} disabled={scope.readOnlyReason} /> : null}
          <div className="flex min-h-0 min-w-0 flex-1">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {view === "grid" && !fullscreen ? (
                <FrameGrid
                  {...listProps}
                  disk={disk}
                  catalog={catalog}
                  onColumns={(n) => {
                    gridCols.current = n
                  }}
                />
              ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
                  {plateCaption}
                  {plates}
                  {plateNote}
                </div>
              )}
              {fullscreen ? null : plotsStrip}
            </div>
            {fullscreen ? null : inspector}
          </div>
        </div>
      ) : null}

      {/* Status line: counts, measurement, notes, imports and the unsaved Review changes with Save run. */}
      <footer
        role="group"
        ref={statusLineRef}
        tabIndex={-1}
        aria-label="Review status"
        data-chrome
        className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-separator px-3 py-0.5 text-xs text-muted-foreground tabular-nums outline-none"
      >
        <span className="shrink-0">
          {plural(ordered.length, "frame")} shown of {frames.length}
          {scope.trashedHidden > 0 ? ` · ${scope.trashedHidden} Trashed not listed` : ""}
          {selected.size > 0 ? (
            <span className="text-foreground">
              {" "}
              · {selected.size} selected{hiddenSelected > 0 ? ` (${hiddenSelected} hidden by the filter)` : ""}
            </span>
          ) : null}
        </span>
        <MeasureBar scope={scope} frames={frames} home={statusLineRef} />
        {notes.length > 0 ? (
          <span className="min-w-0 flex-1 truncate" title={notes.join(" ")}>
            {notes.join(" ")}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate" title="Source notes: 1 built-in, PlateVault PSF on linear data with the input SHA-256 per frame in Values; 2 imported, content unverified.">
            <sup className="text-link">1</sup> built-in · <sup className="text-link">2</sup> imported: content unverified
          </span>
        )}
        {context.kind === "run" ? (
          <Button size="xs" variant="ghost" className="shrink-0" onClick={() => setImportOpen(true)}>
            <Upload aria-hidden="true" data-icon="inline-start" />
            Import measurements
          </Button>
        ) : null}
        {draftNote ? (
          <span className="flex shrink-0 items-center gap-1.5 text-foreground">
            <span className="font-medium">{draftNote}</span>
            <Button size="xs" variant="ghost" onClick={discardDrafts}>
              Discard
            </Button>
            <Button id="review-save" size="xs" variant="outline" onClick={saveDrafts}>
              <Save aria-hidden="true" data-icon="inline-start" />
              Save run{drafts.length > 1 ? "s" : ""}
            </Button>
          </span>
        ) : null}
      </footer>

      <ReviewShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {context.kind === "run" ? (
        <ImportDialog viewId={scope.key} viewAssetIds={new Set(frames.map((f) => f.asset.id))} open={importOpen} onOpenChange={setImportOpen} />
      ) : null}
      {context.kind === "run" && importOpen === false ? <ImportList scopeKey={scope.key} /> : null}
      <ConfirmDialog
        open={projectConfirm !== null}
        onOpenChange={(open) => !open && setProjectConfirm(null)}
        title={`Reject ${confirmFrames.length === 1 ? confirmFrames[0]!.asset.fileName : plural(confirmFrames.length, "frame")} for ${project.name} only?`}
        description="Project scope: a rejection record in this Project only. Use it when a frame is fine in the library but wrong for this campaign."
        changes={[
          `Record ${plural(confirmFrames.length, "frame")} as Rejected · This Project in ${project.name}`,
          `${project.name}'s "in project" totals leave ${confirmFrames.length === 1 ? "it" : "them"} out`,
          ...(confirmRuns.length > 0 ? [`Remove ${confirmFrames.length === 1 ? "it" : "them"} from the draft of ${confirmRuns.join(", ")} with the reason Rejected`] : []),
        ]}
        unchanged={["Library quality: Picked, Rejected or Unreviewed stays as it is", "Captured totals and every other Project", "Saved and prepared revisions", "Source files and headers"]}
        confirmLabel={`Reject ${plural(confirmFrames.length, "frame")} for ${project.name}`}
        onConfirm={() => {
          const result = setProjectOnlyReject(scope, confirmFrames, true)
          if (result.ok) announce(`Rejected for ${project.name} only: ${plural(confirmFrames.length, "frame")}. Library quality unchanged.`)
          return result
        }}
      />
    </div>
  )
}

function PlateSlot({ label, field, unavailable, render }: { label: ReactNode; field: ReturnType<typeof frameField>; unavailable: string | null; render: (field: NonNullable<ReturnType<typeof frameField>>) => ReactNode }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
      {label ? <div className="flex min-h-6 items-center px-1 text-xs text-muted-foreground">{label}</div> : null}
      {unavailable || !field ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-[3px] border border-dashed p-4 text-center text-sm text-muted-foreground">{unavailable ?? "No pixel data for this file."}</div>
      ) : (
        render(field)
      )}
    </div>
  )
}

/** The drag handle of the "about 8 rows" height; ↑/↓ resize it a row at a time. The height is remembered (PIX-FR-10). */
function RowsHandle({ px, onDrag, onCommit }: { px: number; onDrag: (px: number) => void; onCommit: (px: number) => void }) {
  const start = useRef<{ y: number; px: number } | null>(null)
  const latest = useRef(px)
  latest.current = px
  const clamp = (v: number) => Math.round(Math.min(window.innerHeight * 0.7, Math.max(ROW_PX * 3, v)))
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Table height"
      aria-valuenow={Math.round(px / ROW_PX) - 1}
      aria-valuetext={`About ${Math.round(px / ROW_PX) - 1} rows`}
      tabIndex={0}
      className="group relative z-10 -mt-px h-1.5 shrink-0 cursor-row-resize outline-none focus-visible:bg-ring/40"
      onPointerDown={(event) => {
        start.current = { y: event.clientY, px }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (start.current) onDrag(clamp(start.current.px + event.clientY - start.current.y))
      }}
      onPointerUp={() => {
        if (start.current) onCommit(latest.current)
        start.current = null
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
        event.preventDefault()
        onCommit(clamp(px + (event.key === "ArrowDown" ? ROW_PX : -ROW_PX)))
      }}
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-separator group-hover:bg-primary" />
      <span aria-hidden="true" className="absolute top-1/2 left-1/2 h-1 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/40 group-hover:bg-primary" />
    </div>
  )
}

function FullscreenBar({ name, frame, onExit, onMark, disabled }: { name: string; frame: ReviewFrame; onExit: () => void; onMark: (value: QualityValue) => void; disabled: string | null }) {
  return (
    <div data-chrome className="flex h-9 shrink-0 items-center gap-3 border-b border-separator bg-chrome px-3 text-xs">
      <span className="truncate font-medium">{name}</span>
      <span className="text-muted-foreground">
        {frame.bucket === "picked" ? "Picked" : frame.bucket === "rejected" ? "Rejected" : "Unreviewed"}
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        {(["usable", "unusable", "unreviewed"] as const).map((v) => (
          <Button key={v} size="sm" variant="outline" disabled={disabled !== null} onClick={() => onMark(v)}>
            {MARK_WORD[v]}
            <Kbd>{v === "usable" ? "P" : v === "unusable" ? "X" : "U"}</Kbd>
          </Button>
        ))}
        <Button size="sm" onClick={onExit}>
          Leave fullscreen
          <Kbd>Esc</Kbd>
        </Button>
      </div>
    </div>
  )
}

/** Recorded measurement imports of a run, each with its row review. */
function ImportList({ scopeKey }: { scopeKey: string }) {
  const catalog = useStore((s) => s.catalog)
  const imports = Object.values(catalog.measurementImports).filter((i) => i.runId === scopeKey)
  const [open, setOpen] = useState(false)
  if (imports.length === 0) return null
  return (
    <div className="shrink-0 border-t border-separator">
      <button type="button" className="flex h-6 w-full items-center gap-2 px-3 text-left text-[0.6875rem] text-muted-foreground hover:text-foreground" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Upload aria-hidden="true" className="size-3" />
        {plural(imports.length, "measurement import")}: {open ? "hide" : "review"} rows
      </button>
      {open ? (
        <ul className="max-h-60 divide-y overflow-y-auto border-t">
          {imports.map((record) => (
            <ImportReview key={record.id} record={record} catalog={catalog} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}
