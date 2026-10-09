/**
 * S6 Review workspace (slice D): one frame list in three views, the preview
 * with its plots and inspector, the two quality levels and the review
 * hotkeys (D-W13, D-W14, D-W15, D-W22, D-W40, D-W41, D-W42, D-W53, D-W54;
 * spec 067 PIX-FR-01 to PIX-FR-18). Contexts: a run, a group, a Project's
 * candidates, or one library session (library marks only).
 *
 * Layout (D-W22): the frame table spans the full width at the top; T cycles
 * it through about 8 rows (resizable, the height is remembered), a one-line
 * strip showing the current frame, and full height. The preview, inspector
 * and the plots across the session fill the rest. F is fullscreen; G is the
 * grid; the filmstrip is the strip with thumbnails; ⌘/Ctrl+I swaps each
 * plate for the corner inspector (nine 1:1 tiles), in fullscreen and
 * Compare too.
 */
import { Link, useSearch } from "@tanstack/react-router"
import { ArrowLeftRight, ChevronLeft, ChevronRight, Columns3, Expand, Filter, FolderOpen, Grid3x3, ImageOff, Keyboard, LayoutList, ListChecks, Minimize, PanelRight, Rows3, Save, Scan, Upload, X } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { MissingRecord } from "@/app/missing-record"
import { getPreferences, useMessages } from "@/app/preferences"
import { MOD_LABEL } from "@/app/shortcuts"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { EmptyState } from "@/components/app/feedback"
import { Pill } from "@/components/app/pill"
import { Refusal, type RefusalProps, refusalFrom } from "@/components/app/refusal"
import type { MenuEntry } from "@/components/app/row-menu"
import { HelpTip } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { runHref, runPipeline, type StepLink } from "@/domain/derive"
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
import { type Messages, say } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { discardRunDraft, saveRun } from "@/store/actions/runs"
import { type CommitResult, useStore } from "@/store/core"
import { registerReviewCommands } from "./commands"
import { CornerGrid, type CornerOverlay } from "./corners"
import { Inspector } from "./inspector"
import { type Activate, FrameGrid, FrameTable, Filmstrip, frameColumns, type SortState, sortFrames } from "./list"
import { framesWhat, markAnnouncement, markLibrary, MARK_WORD, setProjectOnlyReject } from "./marks"
import { MeasureBar } from "./measure-bar"
import { bucketAfterMark, contextKey, FILTERS, PLOT_METRICS, type QualityFilter, type ReviewContext, type ReviewFrame, reviewScope } from "./model"
import { displayName, NAME_PRESETS, namePreset } from "./names"
import { SessionPlots, type Threshold } from "./plots"
import { setReviewPrefs, type TableHeight, useReviewPrefs } from "./prefs"
import { Plate, type PlateView, plateWindow, STRETCH_LABEL, ZOOM_LABEL, type Zoom } from "./preview"
import { REVIEW_KEY, ReviewShortcutsDialog } from "./shortcuts"

type ListView = "table" | "filmstrip" | "grid"
const HEIGHT_NEXT: Record<TableHeight, TableHeight> = { rows: "strip", strip: "full", full: "rows" }
function heightLabel(m: Messages, height: TableHeight): string {
  return height === "rows" ? m.review_height_rows() : height === "strip" ? m.review_height_strip() : m.review_height_full()
}
const ROW_PX = 26
/** The preview stage's minimum: caption, a plate of about 240 px and the plots strip. */
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
  const m = useMessages()
  const state = useStore((s) => s)
  const { catalog, disk } = state
  const contextKeyStr = contextKey(context)
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
  const [error, setError] = useState<RefusalProps | null>(null)
  const [corners, setCorners] = useState(false)
  const [cornerOverlay, setCornerOverlay] = useState<CornerOverlay>({ fwhm: true, eccentricity: true })
  const [revealed, setRevealed] = useState<string | null>(null)
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
  const allColumns = frameColumns(m, names).filter((c) => !c.contexts || c.contexts.includes(context.kind))
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
  const unavailableReason = current && current.availability !== "available" ? say(m, previewUnavailableReason(current.availability)) : current && !field ? m.review_no_pixel_data() : null

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
    announce(m.review_announce_frame({ name: names.get(next.asset.id) ?? next.asset.fileName, index: ordered.indexOf(next) + 1, total: ordered.length }))
  }

  /** A refused or failed write as a Refusal; a blocker that names the read-only reason links to where it resolves. */
  function refuse(result: CommitResult, action: string) {
    if (result.ok) return
    const links: Record<string, StepLink> = scope?.readOnlyReason && scope.readOnlyLink ? { [scope.readOnlyReason]: scope.readOnlyLink } : {}
    setError(refusalFrom(result, action, links) ?? { action, reason: result.message, blockers: [] })
    announce(`${action}: ${result.message}`)
  }

  function mark(value: QualityValue, always = false, list: ReviewFrame[] = targets) {
    if (!scope || !current) return
    const result = markLibrary(scope, list, value)
    if (!result.ok) return refuse(result, m.review_refusal_mark())
    setError(null)
    announce(markAnnouncement(list, value))
    if (list.length > 1) return
    const successor = ordered[index + 1] ?? null
    const fallback = ordered[index - 1] ?? null
    const leaves = filter !== "all" && bucketAfterMark(current, value) !== filter
    // Auto-advance on the last frame keeps it current; a mark that moves the frame out of the filter moves on either way.
    const next = prefs.autoAdvance || always ? (successor ?? (leaves ? fallback : null)) : leaves ? (successor ?? fallback) : null
    if (next) select(next.asset.id)
  }

  function confirmProjectReject(list: ReviewFrame[]) {
    if (!scope?.project) return
    if (scope.readOnlyReason) return refuse({ ok: false, reason: "refused", message: scope.readOnlyReason, reasons: [scope.readOnlyReason] }, m.review_refusal_reject())
    setProjectConfirm(list)
  }

  function clearProjectReject(list: ReviewFrame[]) {
    if (!scope) return
    const result = setProjectOnlyReject(scope, list, false)
    if (!result.ok) return refuse(result, m.review_refusal_clear())
    setError(null)
    announce(m.review_announce_project_reject_cleared({ what: framesWhat(list) }))
  }

  /** Compare the current frame with `with` (a right-clicked frame), else toggle Compare with the nearest other frame. */
  function startCompare(withId?: AssetId) {
    const reference = withId && withId !== current?.asset.id ? frames.find((f) => f.asset.id === withId) : undefined
    if (reference) {
      setRefId(reference.asset.id)
      setCompare(true)
      announce(m.review_announce_compare({ current: current ? (names.get(current.asset.id) ?? "") : m.review_no_frame(), reference: names.get(reference.asset.id) ?? "" }))
      return
    }
    if (compare) {
      if (!withId) setCompare(false)
      return
    }
    const other = selectedFrames.find((f) => f.asset.id !== current?.asset.id) ?? ordered[index - 1] ?? ordered[index + 1] ?? null
    if (!refId || !frames.some((f) => f.asset.id === refId)) setRefId(other?.asset.id ?? null)
    setCompare(true)
    const currentName = current ? (names.get(current.asset.id) ?? "") : m.review_no_frame()
    announce(other ? m.review_announce_compare({ current: currentName, reference: names.get(other.asset.id) ?? "" }) : m.review_announce_compare_none({ current: currentName }))
  }

  function toggleCorners() {
    setCorners((on) => {
      announce(on ? m.review_announce_corners_off() : m.review_announce_corners_on())
      return !on
    })
  }

  /** Prototype: there is no OS file manager, so Reveal shows the path it would open. */
  function reveal(frame: ReviewFrame) {
    const path = frame.asset.copies[0]?.path ?? null
    setRevealed(path)
    announce(path ? m.review_announce_revealed({ path }) : m.review_announce_no_copy())
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
    announce(m.review_announce_selected({ count: ordered.length }))
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
    const said = { count: matches.length, metric: METRIC_LABEL[threshold.metric], value: String(threshold.value) }
    announce(threshold.direction === "above" ? m.review_announce_threshold_above(said) : m.review_announce_threshold_below(said))
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
    setRevealed(null)
  }, [current?.asset.id])

  const zoomed = plateView.zoom !== "fit"
  const latest = {
    step,
    mark,
    selectAll,
    toggleGrid,
    cycleHeight,
    startCompare,
    toggleCorners,
    toggleZoom: () => setPlateView((v) => ({ ...v, zoom: v.zoom === "fit" ? "1" : "fit" })),
    toggleFullscreen: () => setFullscreen((f) => !f),
    filter: (id: QualityFilter) => {
      setFilter(id)
      announce(m.review_announce_filter({ label: FILTERS.find((f) => f.id === id)!.label, frames: m.review_frames_count({ count: counts[id] }) }))
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
        announce(m.review_announce_selection_cleared())
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
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && key.toLowerCase() === "i") {
        h.toggleCorners()
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
    // Getters: the palette reads each label at render, in the chosen language.
    registerReviewCommands([
      { id: "next", get label() { return m.review_cmd_next() }, keys: REVIEW_KEY.next, run: () => h().step(1) },
      { id: "previous", get label() { return m.review_cmd_previous() }, keys: REVIEW_KEY.previous, run: () => h().step(-1) },
      { id: "pick", get label() { return m.review_cmd_pick() }, keys: REVIEW_KEY.pick, run: () => h().mark("usable") },
      { id: "reject", get label() { return m.review_cmd_reject() }, keys: REVIEW_KEY.reject, run: () => h().mark("unusable") },
      { id: "unreviewed", get label() { return m.review_cmd_unreviewed() }, keys: REVIEW_KEY.unreviewed, run: () => h().mark("unreviewed") },
      { id: "zoom", get label() { return m.review_cmd_zoom() }, keys: REVIEW_KEY.zoom, run: () => h().toggleZoom() },
      { id: "fullscreen", get label() { return m.review_cmd_fullscreen() }, keys: REVIEW_KEY.fullscreen, run: () => h().toggleFullscreen() },
      { id: "compare", get label() { return m.review_cmd_compare() }, keys: REVIEW_KEY.compare, run: () => h().startCompare() },
      { id: "grid", get label() { return m.review_cmd_grid() }, keys: REVIEW_KEY.grid, run: () => h().toggleGrid() },
      { id: "height", get label() { return m.review_cmd_height() }, keys: REVIEW_KEY.height, run: () => h().cycleHeight() },
      { id: "inspector", get label() { return m.review_frame_inspector() }, keys: REVIEW_KEY.inspector, run: () => h().toggleInspector() },
      { id: "corners", get label() { return m.review_corner_inspector() }, keys: `${MOD_LABEL}${REVIEW_KEY.inspector}`, run: () => h().toggleCorners() },
      { id: "select-all", get label() { return m.review_cmd_select_all() }, keys: `${MOD_LABEL}${REVIEW_KEY.selectAll}`, run: () => h().selectAll() },
      { id: "shortcuts", get label() { return m.review_shortcuts_title() }, keys: REVIEW_KEY.shortcuts, run: () => h().shortcuts() },
    ])
    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      registerReviewCommands(null)
    }
  }, [])

  if (!scope) {
    const title = { candidates: m.project_missing_title, group: m.rungroup_missing_title, run: m.run_missing_title, session: m.session_missing_title }[context.kind]()
    return context.kind === "session" ? <MissingRecord title={title} backTo="/sessions" backLabel={m.session_open_sessions()} /> : <MissingRecord title={title} backTo="/projects" backLabel={m.project_back_to_projects()} />
  }

  // Right click on a row or thumbnail: the selection when the frame is in it, else that frame.
  const menu = (id: AssetId): MenuEntry[] => {
    const frame = frames.find((f) => f.asset.id === id)
    if (!frame) return []
    const list = selected.has(id) && selectedFrames.length > 1 ? selectedFrames : [frame]
    const blocked = scope.readOnlyReason !== null
    const markEntry = (label: string, value: QualityValue, shortcut: string): MenuEntry => ({ label, shortcut, disabled: blocked, onSelect: () => mark(value, false, list) })
    const projectEntries: MenuEntry[] = scope.project
      ? [
          { separator: true },
          list.length === 1 && frame.rejectedBy.project
            ? { label: m.review_clear_project_reject(), disabled: blocked, onSelect: () => clearProjectReject(list) }
            : { label: m.review_reject_for_project(), disabled: blocked, onSelect: () => confirmProjectReject(list) },
        ]
      : []
    return [
      ...(list.length > 1 ? [{ heading: m.review_frames_count({ count: list.length }) }] : []),
      markEntry(m.review_key_pick(), "usable", REVIEW_KEY.pick),
      markEntry(m.review_key_reject(), "unusable", REVIEW_KEY.reject),
      markEntry(m.status_unreviewed(), "unreviewed", REVIEW_KEY.unreviewed),
      ...projectEntries,
      { separator: true },
      { label: m.review_compare(), icon: ArrowLeftRight, shortcut: REVIEW_KEY.compare, disabled: frames.length < 2, onSelect: () => startCompare(id) },
      { label: m.review_reveal_path(), icon: FolderOpen, disabled: frame.asset.copies.length === 0, onSelect: () => reveal(frame) },
    ]
  }

  const emptyTitle = frames.length === 0 || filter === "all" ? m.review_empty_none() : filter === "picked" ? m.review_empty_picked() : filter === "rejected" ? m.review_empty_rejected() : m.review_empty_unreviewed()
  const back = context.kind === "session" ? { to: "/sessions", label: m.session_open_sessions() } : scope.runs[0] ? { to: runHref(scope.runs[0], "select"), label: m.review_open_select() } : { to: `/projects/${scope.project?.id ?? ""}`, label: m.target_open_project() }
  const emptyList = (
    <EmptyState
      icon={ImageOff}
      title={emptyTitle}
      description={null}
      action={
        frames.length > 0 ? (
          <Button size="sm" variant="outline" onClick={() => setFilter("all")}>
            {m.review_show_all()}
          </Button>
        ) : (
          <Button size="sm" variant="outline" render={<Link to={back.to as never} />}>
            {back.label}
          </Button>
        )
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
  const withKey = (label: string, shortcut: string) => m.shell_with_shortcut({ label, shortcut })

  const plateCaption = current ? (
    <div className="flex min-w-0 items-center gap-x-3 px-1 text-xs">
      <span className="min-w-0 truncate font-medium" title={current.asset.copies[0]?.path}>
        {names.get(current.asset.id)}
      </span>
      <span className="shrink-0 text-muted-foreground tabular-nums">{m.review_frame_position({ index: index + 1, total: ordered.length })}</span>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {field?.cfa ? (
          <Pill tone="muted" title={m.review_cfa_title()}>
            {m.review_cfa({ cfa: field.cfa })}
          </Pill>
        ) : null}
        <Toggle variant="outline" size="sm" className="h-6 gap-1 px-2 text-xs" pressed={corners} onPressedChange={toggleCorners} aria-label={m.review_corner_inspector()} title={withKey(m.review_corners(), `${MOD_LABEL}${REVIEW_KEY.inspector}`)}>
          <Scan aria-hidden="true" className="size-3.5" />
          <span className="@max-[62rem]:sr-only">{m.review_corners()}</span>
        </Toggle>
        {corners ? (
          <>
            <Toggle variant="outline" size="sm" className="h-6 px-2 text-xs" pressed={cornerOverlay.fwhm} onPressedChange={(on) => setCornerOverlay((o) => ({ ...o, fwhm: on }))} aria-label={m.review_fwhm_overlay()}>
              {METRIC_LABEL.fwhm}
            </Toggle>
            <Toggle variant="outline" size="sm" className="h-6 px-2 text-xs" pressed={cornerOverlay.eccentricity} onPressedChange={(on) => setCornerOverlay((o) => ({ ...o, eccentricity: on }))} aria-label={m.review_ecc_overlay()}>
              {m.review_ecc_short()}
            </Toggle>
          </>
        ) : (
          <>
            <ToggleGroup value={[plateView.zoom]} onValueChange={(v) => v[0] && setPlateView((p) => ({ ...p, zoom: v[0] as Zoom }))} variant="outline" size="sm" spacing={0} aria-label={m.review_zoom()}>
              {(["fit", "1", "2"] as const).map((z) => (
                <ToggleGroupItem key={z} value={z} className="h-6 px-2 text-xs">
                  {ZOOM_LABEL[z]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {zoomed ? <HelpTip label={m.review_pan_help()}>{m.review_pan_tip()}</HelpTip> : null}
          </>
        )}
        <ToggleGroup value={[plateView.stretch]} onValueChange={(v) => v[0] && setPlateView((p) => ({ ...p, stretch: v[0] as PlateView["stretch"] }))} variant="outline" size="sm" spacing={0} aria-label={m.review_display_stretch()}>
          {(["linear", "auto", "strong"] as const).map((s) => (
            <ToggleGroupItem key={s} value={s} className="h-6 px-2 text-xs">
              {STRETCH_LABEL[s]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button size="icon-sm" variant="outline" aria-label={withKey(m.review_cmd_previous(), REVIEW_KEY.previous)} disabled={index <= 0} onClick={() => step(-1)}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button size="icon-sm" variant="outline" aria-label={withKey(m.review_cmd_next(), REVIEW_KEY.next)} disabled={index >= ordered.length - 1} onClick={() => step(1)}>
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button size="icon-sm" variant="outline" aria-label={withKey(fullscreen ? m.review_leave_fullscreen() : m.review_cmd_fullscreen(), REVIEW_KEY.fullscreen)} aria-pressed={fullscreen} onClick={() => setFullscreen((f) => !f)}>
          {fullscreen ? <Minimize aria-hidden="true" /> : <Expand aria-hidden="true" />}
        </Button>
        {inspectorOverlay && !fullscreen ? (
          <Toggle variant="outline" size="sm" className="h-6 min-w-6 px-1.5" pressed={inspectorShown} onPressedChange={setInspectorShown} aria-label={withKey(m.review_frame_inspector(), REVIEW_KEY.inspector)}>
            <PanelRight aria-hidden="true" />
          </Toggle>
        ) : null}
      </div>
    </div>
  ) : null

  const plateFor = (f: NonNullable<typeof field>, label: string, primary: boolean) =>
    corners ? (
      <CornerGrid field={f} stretch={plateView.stretch} overlay={cornerOverlay} label={label} />
    ) : (
      <Plate
        field={f}
        view={plateView}
        onView={setPlateView}
        label={label}
        starsOn={primary && starsOn}
        starId={primary ? (star?.id ?? null) : null}
        onStar={(s) => {
          if (!primary) return
          setStar(s)
          setTab("stars")
        }}
        onWindow={primary ? setShownWindow : undefined}
      />
    )

  const plates =
    current === null ? (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{m.review_no_current_frame()}</div>
    ) : (
      <div className="flex min-h-0 flex-1 gap-2">
        <PlateSlot
          label={compare ? m.review_compare_current({ name: names.get(current.asset.id) ?? "" }) : null}
          field={field}
          unavailable={unavailableReason}
          render={(f) => plateFor(f, m.review_preview_of({ name: names.get(current.asset.id) ?? "" }), true)}
        />
        {compare ? (
          <PlateSlot
            label={
              <span className="flex min-w-0 items-center gap-1.5">
                {m.review_reference_label()}
                <MiniSelect
                  label={m.review_compare_reference()}
                  className="max-w-56"
                  value={reference?.asset.id ?? "none"}
                  onChange={(v) => setRefId(v === "none" ? null : v)}
                  options={[{ value: "none", label: m.review_choose_frame() }, ...ordered.map((f) => ({ value: f.asset.id, label: names.get(f.asset.id) ?? f.asset.fileName }))]}
                />
              </span>
            }
            field={refField}
            unavailable={!reference ? m.review_no_reference() : reference.availability !== "available" ? say(m, previewUnavailableReason(reference.availability)) : !refField ? m.review_no_pixels() : null}
            render={(f) => plateFor(f, m.review_reference_of({ name: reference ? (names.get(reference.asset.id) ?? "") : "" }), false)}
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
  // One draft: its Review step reads the draft note ("2 rejected, unsaved") while its link focuses Save run.
  const draftReview = drafts.length === 1 ? runPipeline(state, drafts[0]!).steps[1]! : null
  const draftNote = draftReview ? (draftReview.link.focusId === "review-save" ? say(m, draftReview.status) : m.status_unsaved_changes()) : drafts.length > 1 ? m.review_draft_panel_runs_unsaved({ count: drafts.length }) : null
  const saveDrafts = () => {
    for (const run of drafts) {
      const result = saveRun(run.id)
      if (!result.ok) return refuse(result, m.run_save_blocked())
    }
    setError(null)
    announce(drafts.length === 1 ? m.review_announce_saved_revision({ name: drafts[0]!.name, revision: (drafts[0]!.revisions.at(-1)?.revision ?? 0) + 1 }) : m.review_announce_runs_saved({ count: drafts.length }))
    statusLineRef.current?.focus()
  }
  const discardDrafts = () => {
    for (const run of drafts) discardRunDraft(run.id)
    announce(m.review_announce_discarded())
    statusLineRef.current?.focus()
  }
  const pills = [
    scope.membershipNote ? { label: scope.membershipNote.label, help: scope.membershipNote.help } : null,
    ...scope.trashedPanels.map((p) => ({ label: m.review_panel_in_trash({ name: p }), help: m.review_trash_help() })),
  ].filter((n): n is { label: string; help: string } => n !== null)

  return (
    <div ref={rootRef} className="@container flex min-h-[36.5rem] min-w-0 flex-1 flex-col" data-review={scope.key}>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {/* Toolbar: the list's filter, panel, view and height; selection, compare, display. One row from 784 px: labels fold to icons. */}
      <div data-chrome className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-separator bg-[color-mix(in_oklch,var(--chrome)_45%,var(--background))] px-3 py-1">
        <ToggleGroup value={[filter]} onValueChange={(v) => v[0] && setFilter(v[0] as QualityFilter)} variant="outline" size="sm" spacing={0} aria-label={m.review_quality_filter()}>
          {FILTERS.map((f) => (
            <ToggleGroupItem key={f.id} value={f.id} className="h-6 gap-1 px-2 text-xs" title={`⌥${f.key}`}>
              {f.label}
              <span className="text-muted-foreground tabular-nums">{counts[f.id]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {context.kind === "group" ? (
          <MiniSelect
            label={m.review_panel_filter()}
            value={panelId}
            onChange={setPanelId}
            options={[{ value: "all", label: m.review_all_panels() }, ...scope.panels.map((p) => ({ value: p.id, label: m.review_panel_n({ n: p.n }) }))]}
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
          aria-label={m.review_view()}
        >
          <ToggleGroupItem value="table" className="h-6 gap-1 px-2 text-xs" title={m.review_view_table()}>
            <LayoutList aria-hidden="true" className="size-3.5" />
            <span className="@max-[62rem]:sr-only">{m.review_view_table()}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="filmstrip" className="h-6 gap-1 px-2 text-xs" title={m.review_view_filmstrip()}>
            <Columns3 aria-hidden="true" className="size-3.5" />
            <span className="@max-[62rem]:sr-only">{m.review_view_filmstrip()}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="grid" className="h-6 gap-1 px-2 text-xs" title={withKey(m.review_view_grid(), REVIEW_KEY.grid)}>
            <Grid3x3 aria-hidden="true" className="size-3.5" />
            <span className="@max-[62rem]:sr-only">{m.review_view_grid()}</span>
          </ToggleGroupItem>
        </ToggleGroup>
        {view === "table" ? (
          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={cycleHeight} title={m.review_table_height_title({ current: heightLabel(m, height), key: REVIEW_KEY.height, next: heightLabel(m, HEIGHT_NEXT[height]) })}>
            <Rows3 aria-hidden="true" />
            <span className="@max-[62rem]:sr-only">{heightLabel(m, height)}</span>
            <span className="sr-only">{m.review_table_height_sr()}</span>
            <Kbd className="ml-0.5">{REVIEW_KEY.height}</Kbd>
          </Button>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" variant="outline" className="h-6 text-xs" />}>
              <ListChecks aria-hidden="true" />
              {m.review_select()}
              {selected.size > 0 ? <span className="tabular-nums text-muted-foreground">{selected.size}</span> : null}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onClick={selectAll}>
                {m.review_select_all_shown_count({ count: ordered.length })}
                <DropdownMenuShortcut>
                  {MOD_LABEL}
                  {REVIEW_KEY.selectAll}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setThreshold(threshold ?? { metric: "fwhm", direction: "above", value: null })}>{m.review_select_by_threshold_menu()}</DropdownMenuItem>
              <DropdownMenuItem disabled={selected.size === 0} onClick={() => setSelected(new Set())}>
                {m.selection_clear()}
                <DropdownMenuShortcut>{m.key_escape()}</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Toggle variant="outline" size="sm" className="h-6 text-xs" pressed={compare} onPressedChange={() => startCompare()} title={withKey(m.review_compare(), REVIEW_KEY.compare)}>
            <ArrowLeftRight aria-hidden="true" />
            <span className="@max-[62rem]:sr-only">{m.review_compare()}</span>
          </Toggle>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" variant="outline" className="h-6 text-xs" title={m.review_display()} />}>
              <Filter aria-hidden="true" />
              <span className="@max-[62rem]:sr-only">{m.review_display()}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{m.review_frame_names()}</DropdownMenuLabel>
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
                <DropdownMenuLabel>{m.review_columns()}</DropdownMenuLabel>
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
                {m.review_auto_advance_after_mark()}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={inspectorOverlay ? inspectorShown : prefs.inspectorOpen}
                closeOnClick={false}
                onCheckedChange={(on) => (inspectorOverlay ? setInspectorShown(on) : setReviewPrefs({ inspectorOpen: on }))}
              >
                {m.review_show_inspector()}
                <DropdownMenuShortcut>{REVIEW_KEY.inspector}</DropdownMenuShortcut>
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="icon-sm" variant="ghost" aria-label={withKey(m.review_shortcuts_title(), REVIEW_KEY.shortcuts)} onClick={() => setShortcutsOpen(true)}>
            <Keyboard aria-hidden="true" />
          </Button>
        </div>
      </div>

      {scope.readOnlyReason || error ? (
        <div className="shrink-0 space-y-1 border-b border-separator px-3 py-1.5">
          {scope.readOnlyReason ? <Refusal action={m.review_refusal_marks()} reason={scope.readOnlyReason} blockers={scope.readOnlyLink ? [{ label: m.activity_destination_trash(), link: scope.readOnlyLink }] : []} /> : null}
          {error ? <Refusal {...error} /> : null}
        </div>
      ) : null}

      {threshold && thresholdInfo ? (
        <div role="group" aria-label={m.review_select_by_threshold()} className="flex shrink-0 flex-wrap items-center gap-2 border-b border-separator px-3 py-1 text-xs">
          <span>{m.review_threshold_prefix()}</span>
          <MiniSelect label={m.review_threshold_metric()} value={threshold.metric} onChange={(v) => setThreshold({ ...threshold, metric: v as MetricKey })} options={PLOT_METRICS.map((metric) => ({ value: metric, label: METRIC_LABEL[metric] }))} />
          <MiniSelect
            label={m.review_direction()}
            value={threshold.direction}
            onChange={(v) => setThreshold({ ...threshold, direction: v as Threshold["direction"] })}
            options={[
              { value: "above", label: m.review_above() },
              { value: "below", label: m.review_below() },
            ]}
          />
          <Input
            type="number"
            inputMode="decimal"
            step="any"
            aria-label={unitFor(threshold.metric) ? m.review_threshold_value_in({ unit: unitFor(threshold.metric) }) : m.review_threshold_value()}
            className="h-6 w-24 text-xs"
            value={threshold.value ?? ""}
            onChange={(e) => setThreshold({ ...threshold, value: e.target.value === "" ? null : Number(e.target.value) })}
          />
          <span className="text-muted-foreground">{unitFor(threshold.metric)}</span>
          <Button size="sm" disabled={threshold.value === null} onClick={() => applyThreshold(false)}>
            {m.review_select_frames({ count: thresholdInfo.matches.length })}
          </Button>
          <Button size="sm" variant="outline" disabled={threshold.value === null} onClick={() => applyThreshold(true)}>
            {m.review_add_to_selection()}
          </Button>
          {thresholdInfo.missing > 0 ? (
            <Pill tone="muted" title={m.review_not_measured_never_selected()}>
              {m.review_count_not_measured({ count: thresholdInfo.missing })}
            </Pill>
          ) : null}
          <HelpTip label={m.review_threshold_help()}>{m.review_threshold_tip()}</HelpTip>
          <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label={m.review_close_threshold()} onClick={() => setThreshold(null)}>
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
        <div className={cn("relative flex flex-1", fullscreen ? "fixed inset-0 z-50 min-h-0 flex-col bg-background" : "min-h-[26rem]")} aria-label={fullscreen ? m.review_cmd_fullscreen() : undefined} role={fullscreen ? "region" : undefined}>
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
        aria-label={m.review_status_line()}
        data-chrome
        className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-separator px-3 py-0.5 text-xs text-muted-foreground tabular-nums outline-none"
      >
        <span className="shrink-0">
          {m.review_shown_of({ count: ordered.length, total: frames.length })}
          {scope.trashedHidden > 0 ? ` · ${m.rungroup_in_trash({ count: scope.trashedHidden })}` : ""}
          {selected.size > 0 ? (
            <span className="text-foreground">
              {" "}
              · {m.status_bar_selected({ count: selected.size })}
              {hiddenSelected > 0 ? ` (${m.review_hidden_count({ count: hiddenSelected })})` : ""}
            </span>
          ) : null}
        </span>
        <MeasureBar scope={scope} frames={frames} home={statusLineRef} />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {pills.map((p) => (
            <span key={p.label} className="flex shrink-0 items-center gap-0.5">
              <Pill tone="muted">{p.label}</Pill>
              <HelpTip label={m.review_help_named({ name: p.label })}>{p.help}</HelpTip>
            </span>
          ))}
          {revealed ? (
            <span className="flex min-w-0 items-center gap-0.5">
              <Pill tone="info" icon={FolderOpen} title={revealed} className="min-w-0">
                {revealed}
              </Pill>
              <Button size="icon-xs" variant="ghost" aria-label={m.review_dismiss_path()} onClick={() => setRevealed(null)}>
                <X aria-hidden="true" />
              </Button>
            </span>
          ) : null}
        </span>
        {context.kind === "run" ? (
          <Button size="xs" variant="ghost" className="shrink-0" onClick={() => setImportOpen(true)}>
            <Upload aria-hidden="true" data-icon="inline-start" />
            {m.shell_import()}
          </Button>
        ) : null}
        {draftNote ? (
          <span className="flex shrink-0 items-center gap-1.5 text-foreground">
            <span className="font-medium">{draftNote}</span>
            <Button size="xs" variant="ghost" onClick={discardDrafts}>
              {m.review_discard()}
            </Button>
            <Button id="review-save" size="xs" variant="outline" onClick={saveDrafts}>
              <Save aria-hidden="true" data-icon="inline-start" />
              {m.review_save_runs({ count: drafts.length })}
            </Button>
          </span>
        ) : null}
      </footer>

      <ReviewShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {context.kind === "run" ? (
        <ImportDialog viewId={scope.key} viewAssetIds={new Set(frames.map((f) => f.asset.id))} open={importOpen} onOpenChange={setImportOpen} />
      ) : null}
      {context.kind === "run" && importOpen === false ? <ImportList scopeKey={scope.key} /> : null}
      {project ? (
        <ConfirmDialog
          open={projectConfirm !== null}
          onOpenChange={(open) => !open && setProjectConfirm(null)}
          title={m.review_confirm_reject_title({ what: framesWhat(confirmFrames), project: project.name })}
          description={m.review_confirm_reject_description()}
          changes={[
            m.review_confirm_reject_change({ frames: m.review_frames_count({ count: confirmFrames.length }) }),
            m.review_confirm_out_of_totals({ project: project.name }),
            ...(confirmRuns.length > 0 ? [m.review_confirm_out_of_draft({ runs: confirmRuns.join(", ") })] : []),
          ]}
          confirmLabel={m.review_confirm_reject_label({ count: confirmFrames.length })}
          onConfirm={() => {
            const result = setProjectOnlyReject(scope, confirmFrames, true)
            if (result.ok) announce(m.review_announce_rejected_for({ project: project.name, frames: m.review_frames_count({ count: confirmFrames.length }) }))
            return result
          }}
        />
      ) : null}
    </div>
  )
}

function PlateSlot({ label, field, unavailable, render }: { label: ReactNode; field: ReturnType<typeof frameField>; unavailable: string | null; render: (field: NonNullable<ReturnType<typeof frameField>>) => ReactNode }) {
  const m = useMessages()
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
      {label ? <div className="flex min-h-6 items-center px-1 text-xs text-muted-foreground">{label}</div> : null}
      {unavailable || !field ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-[3px] border border-dashed p-4 text-center text-sm text-muted-foreground">{unavailable ?? m.review_no_pixel_data()}</div>
      ) : (
        render(field)
      )}
    </div>
  )
}

/** The drag handle of the "about 8 rows" height; ↑/↓ resize it a row at a time. The height is remembered (PIX-FR-10). */
function RowsHandle({ px, onDrag, onCommit }: { px: number; onDrag: (px: number) => void; onCommit: (px: number) => void }) {
  const m = useMessages()
  const start = useRef<{ y: number; px: number } | null>(null)
  const latest = useRef(px)
  latest.current = px
  const clamp = (v: number) => Math.round(Math.min(window.innerHeight * 0.7, Math.max(ROW_PX * 3, v)))
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={m.review_table_height()}
      aria-valuenow={Math.round(px / ROW_PX) - 1}
      aria-valuetext={m.review_about_rows({ count: Math.round(px / ROW_PX) - 1 })}
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
  const m = useMessages()
  return (
    <div data-chrome className="flex h-9 shrink-0 items-center gap-3 border-b border-separator bg-chrome px-3 text-xs">
      <span className="truncate font-medium">{name}</span>
      <span className="text-muted-foreground">
        {frame.bucket === "picked" ? m.review_picked() : frame.bucket === "rejected" ? m.review_rejected() : m.status_unreviewed()}
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        {(["usable", "unusable", "unreviewed"] as const).map((v) => (
          <Button key={v} size="sm" variant="outline" disabled={disabled !== null} onClick={() => onMark(v)}>
            {MARK_WORD[v]}
            <Kbd>{v === "usable" ? REVIEW_KEY.pick : v === "unusable" ? REVIEW_KEY.reject : REVIEW_KEY.unreviewed}</Kbd>
          </Button>
        ))}
        <Button size="sm" onClick={onExit}>
          {m.review_leave_fullscreen()}
          <Kbd>{m.key_escape()}</Kbd>
        </Button>
      </div>
    </div>
  )
}

/** Recorded measurement imports of a run, each with its row review. */
function ImportList({ scopeKey }: { scopeKey: string }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const imports = Object.values(catalog.measurementImports).filter((i) => i.runId === scopeKey)
  const [open, setOpen] = useState(false)
  if (imports.length === 0) return null
  return (
    <div className="shrink-0 border-t border-separator">
      <button type="button" className="flex h-6 w-full items-center gap-2 px-3 text-left text-[0.6875rem] text-muted-foreground hover:text-foreground" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Upload aria-hidden="true" className="size-3" />
        {open ? m.review_imports_hide_rows({ count: imports.length }) : m.review_imports_review_rows({ count: imports.length })}
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
