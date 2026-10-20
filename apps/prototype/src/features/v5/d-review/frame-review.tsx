/**
 * Review (slice D; P-REV2, §5.3): the session intake Review step body. One
 * library session's frames in a Workspace: the frame list (a DataTable, the
 * filmstrip or the grid, D-W40), the plate with Compare and the corner
 * inspector, the session plots, the inspector, and a status line. P, X and U
 * set library quality (P-REJ2): X marks a frame Unusable everywhere.
 *
 * - Everything about how frames show (view, list height, zoom, stretch,
 *   overlays, names, columns, inspector, auto-advance) is in one Display
 *   menu (P13); the list's quality filter leads the toolbar.
 * - Selection swaps the table's toolbar for its batch bar (Usable ·
 *   Unusable · Unreviewed, the STATUS words); "Select by threshold…" and
 *   "Mark rest usable" sit in that toolbar. A mark on more than 20 frames
 *   asks first under the Quick actions switch's Open page; One-click runs it
 *   at once with an Undo notice (astro-plan-zzjlz). Mark rest usable asks
 *   first in both modes, naming the remaining count (D-W118).
 * - Hotkeys (PIX-FR-13) act the same in the table, the filmstrip and the
 *   grid, never while a field or a menu has focus, and follow the app's
 *   single-key setting (WCAG 2.1.4). They are listed on the Help page.
 * - The host (the intake StepPage) owns Finish review; the workspace's own
 *   Finish command and ⌘↵ call `onFinished`, once no frame is Unreviewed.
 *   Marks are always allowed: a Project holding the session gets them as
 *   pending changes.
 */
import { useSearch } from "@tanstack/react-router"
import { ArrowLeftRight, ChevronLeft, ChevronRight, Expand, FolderOpen, ImageOff, Minimize, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { MissingRecord } from "@/app/missing-record"
import { getPreferences, useMessages } from "@/app/preferences"
import { MOD_LABEL, REVIEW_KEY } from "@/app/shortcuts"
import { ActionBar, ActionButton, IconButton, useAction } from "@/components/app/actions"
import type { Action, MenuItem, QuickUndo } from "@/components/app/contracts"
import { PathText } from "@/components/app/data"
import { DataTable, sortRows, type TableSort } from "@/components/app/data-table"
import { DisplayMenu, type DisplayGroup } from "@/components/app/display-menu"
import { announce, EmptyState, UnknownValue } from "@/components/app/feedback"
import { FilterControls } from "@/components/app/filter-bar"
import { Pill } from "@/components/app/pill"
import { CornerGrid, type CornerOverlay } from "@/components/domain/corner-grid"
import { FrameThumbnails } from "@/components/domain/frame-thumbnails"
import { Plate, type PlateImage, type PlateView, STRETCH_LABEL, STRETCHES, type Stretch, ZOOM_LABEL, ZOOMS, type Zoom } from "@/components/domain/plate"
import { detectedStars, frameField, renderWindow, sampleAt, type StarRecord, type ViewWindow } from "@/components/domain/raster"
import { type PlotSeries, SessionPlots } from "@/components/domain/session-plots"
import { type WorkspaceAside, type WorkspacePane, Workspace } from "@/components/templates/workspace"
import { sessionUnreviewedFrames } from "@/domain/derive"
import { currentFile, formatMetricFixed, previewUnavailableReason } from "@/domain/membership"
import type { AssetId, QualityValue } from "@/domain/types"
import { formatCount } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { METRIC_LABEL } from "@/store/actions/measure"
import { markRestUsable } from "@/store/actions/library"
import { type CommitResult, useStore } from "@/store/core"
import { setFrameUi } from "./actions"
import { frameColumns } from "./columns"
import { registerReviewCommands } from "./commands"
import { ImportDialog, ImportedMeasurementsDialog } from "./import-dialog"
import { Inspector, type InspectorTab } from "./inspector"
import { MARK_WORD, markAnnouncement, markLibrary } from "./marks"
import { MeasureStatus } from "./measure-bar"
import { bucketAfterMark, FILTERS, PLOT_METRICS, type QualityFilter, type ReviewBucket, type ReviewContext, type ReviewFrame, reviewScope } from "./model"
import { displayName, NAME_PRESETS, namePreset } from "./names"
import { setReviewPrefs, type TableHeight, useReviewPrefs } from "./prefs"
import { QualityLabel, qualityWord } from "./quality"
import { type Threshold, ThresholdDialog } from "./threshold"

type ListView = "table" | "filmstrip" | "grid"

const HEIGHT_NEXT: Record<TableHeight, TableHeight> = { rows: "strip", strip: "full", full: "rows" }
/** A mark on more frames than this asks first, or under the Quick actions switch's One-click offers an Undo instead. */
const BULK_MARK_CONFIRM_OVER = 20
/** The library mark that puts a frame back in a review bucket (the inverse of `bucketAfterMark`). */
const MARK_OF: Record<ReviewBucket, QualityValue> = { picked: "usable", rejected: "unusable", unreviewed: "unreviewed" }
/** Controls that own the arrow keys while they have focus. */
const ARROW_OWNERS = "[role=tablist],[role=separator],[role=slider],[role=radiogroup],[role=menu],[role=listbox],[data-histogram],[data-workspace-handle]"

function heightLabel(m: Messages, height: TableHeight): string {
  return height === "rows" ? m.review_height_rows() : height === "strip" ? m.review_height_strip() : m.review_height_full()
}

/** Text entry only: a Select trigger is not typing, and the capture-phase handler keeps its typeahead from firing. */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
}

/** An open dialog, menu or list owns the keyboard. The workspace's own fullscreen and overlay inspector do not count. */
function popupOpen(): boolean {
  return [...document.querySelectorAll("[role=dialog]:not([data-workspace-aside]):not([data-workspace-fullscreen]), [role=alertdialog], [role=menu], [role=listbox]")].some((el) => el.checkVisibility())
}

const withKey = (m: Messages, label: string, key: string) => m.shell_with_shortcut({ label, shortcut: key })

export interface ReviewWorkspaceProps {
  context: ReviewContext
  /** Finish review, as the host's Proceed runs it; the workspace calls it from its own Finish command once no frame is Unreviewed. */
  onFinished?: () => void
}

export function ReviewWorkspace({ context, onFinished }: ReviewWorkspaceProps) {
  const m = useMessages()
  const state = useStore((s) => s)
  const { catalog, disk } = state
  // biome-ignore lint/correctness/useExhaustiveDependencies: the context is rebuilt by its parent every render; its session identifies it.
  const scope = useMemo(() => reviewScope(state, context), [state, context.sessionId])
  const prefs = useReviewPrefs()
  const search: Record<string, unknown> = useSearch({ strict: false })
  const runner = useAction()

  const [filter, setFilter] = useState<QualityFilter>("all")
  const [sort, setSort] = useState<TableSort | null>(null)
  const [selected, setSelected] = useState<Set<AssetId>>(() => new Set())
  const [view, setView] = useState<ListView>("table")
  const [beforeGrid, setBeforeGrid] = useState<Exclude<ListView, "grid">>("table")
  const [height, setHeight] = useState<TableHeight>("rows")
  const [compare, setCompare] = useState(false)
  const [refId, setRefId] = useState<AssetId | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [plateView, setPlateView] = useState<PlateView>({ zoom: "fit", centre: null, stretch: "auto" })
  const [shownWindow, setShownWindow] = useState<ViewWindow | null>(null)
  const [readout, setReadout] = useState<{ x: number; y: number } | null>(null)
  const [starsOn, setStarsOn] = useState(false)
  const [star, setStar] = useState<StarRecord | null>(null)
  const [tab, setTab] = useState<InspectorTab>("values")
  const [threshold, setThreshold] = useState<Threshold | null>(null)
  const [corners, setCorners] = useState(false)
  const [cornerOverlay, setCornerOverlay] = useState<CornerOverlay>({ fwhm: true, eccentricity: true })
  const [revealed, setRevealed] = useState<string | null>(null)
  const [overlayInspector, setOverlayInspector] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importsOpen, setImportsOpen] = useState(false)
  const gridCols = useRef(4)
  const overlayMode = useRef(false)

  const sessionId = context.sessionId
  const frames = scope?.frames ?? []
  const template = namePreset(prefs.namePreset).template
  const names = useMemo(() => new Map(frames.map((f) => [f.asset.id, displayName(catalog, f, template)])), [frames, catalog, template])
  const allColumns = useMemo(() => frameColumns(m, names), [m, names])
  const columns = allColumns.filter((c) => c.id === "frame" || prefs.columns.includes(c.id))
  const counts: Record<QualityFilter, number> = {
    all: frames.length,
    picked: frames.filter((f) => f.bucket === "picked").length,
    rejected: frames.filter((f) => f.bucket === "rejected").length,
    unreviewed: frames.filter((f) => f.bucket === "unreviewed").length,
  }
  const shown = frames.filter((f) => filter === "all" || f.bucket === filter)
  const ordered = sort ? sortRows(shown, allColumns, sort) : shown
  const storedActive = state.slices.d.frames[sessionId]?.activeAssetId ?? null
  const current = ordered.find((f) => f.asset.id === storedActive) ?? ordered[0] ?? null
  const index = current ? ordered.indexOf(current) : -1
  const selectedFrames = frames.filter((f) => selected.has(f.asset.id))
  const hiddenSelected = selectedFrames.filter((f) => !shown.includes(f)).length
  const targets = selectedFrames.length > 1 ? selectedFrames : current ? [current] : []
  const reference = compare ? (frames.find((f) => f.asset.id === refId) ?? null) : null
  const unreviewed = scope ? (scope.session ? sessionUnreviewedFrames(catalog, scope.session) : frames.filter((f) => f.bucket === "unreviewed").length) : 0

  const fileOf = (f: ReviewFrame | null) => (f && f.availability === "available" ? currentFile(disk, catalog, f.asset) : undefined)
  const field = useMemo(() => (current ? frameField(current.asset.id, fileOf(current)) : null), [current?.asset.id, current?.asset.sha256, current?.availability])
  const refField = useMemo(() => (reference ? frameField(reference.asset.id, fileOf(reference)) : null), [reference?.asset.id, reference?.asset.sha256, reference?.availability])
  const image = useMemo<PlateImage | null>(() => (field ? { width: field.width, height: field.height, render: (window, stretch) => renderWindow(field, window, stretch) } : null), [field])
  const refImage = useMemo<PlateImage | null>(() => (refField ? { width: refField.width, height: refField.height, render: (window, stretch) => renderWindow(refField, window, stretch) } : null), [refField])
  const stars = useMemo(() => (field && starsOn ? detectedStars(field) : undefined), [field, starsOn])
  const readoutValue = field && readout ? sampleAt(field, readout.x, readout.y) : null

  function select(id: AssetId) {
    if (!scope) return
    setFrameUi(scope.session.id, { activeAssetId: id })
  }

  function step(delta: number) {
    const next = ordered[Math.min(ordered.length - 1, Math.max(0, index + delta))]
    if (!next || next === current) return
    select(next.asset.id)
    announce(m.review_announce_frame({ name: names.get(next.asset.id) ?? next.asset.fileName, index: ordered.indexOf(next) + 1, total: ordered.length }))
  }

  function activate(id: AssetId, mode: "set" | "toggle" | "range") {
    if (mode === "set") setSelected(new Set())
    else if (mode === "toggle") {
      setSelected((prev) => {
        // ⌘-click on another frame starts from the current one; Space on the current frame ticks it.
        const next = new Set(prev.size === 0 && current && current.asset.id !== id ? [current.asset.id] : prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    } else {
      const from = Math.max(0, index)
      const to = ordered.findIndex((f) => f.asset.id === id)
      setSelected(new Set(ordered.slice(Math.min(from, to), Math.max(from, to) + 1).map((f) => f.asset.id)))
    }
    select(id)
  }

  /** Marks `list`; a single current frame then advances when auto-advance is on, or `always` (⇧). */
  function mark(value: QualityValue, list: ReviewFrame[], always = false): CommitResult {
    if (!scope || list.length === 0) return { ok: true }
    const result = markLibrary(scope, list, value)
    if (!result.ok) return result
    announce(markAnnouncement(list, value))
    if (list.length === 1 && current && list[0] === current) {
      const leaves = filter !== "all" && bucketAfterMark(value) !== filter
      const successor = ordered[index + 1] ?? null
      const fallback = ordered[index - 1] ?? null
      const next = prefs.autoAdvance || always ? (successor ?? fallback) : leaves ? (successor ?? fallback) : null
      if (next) select(next.asset.id)
    }
    return result
  }

  const markLabel: Record<QualityValue, string> = { usable: MARK_WORD.usable, unusable: MARK_WORD.unusable, unreviewed: MARK_WORD.unreviewed }
  const markKey: Record<QualityValue, string> = { usable: REVIEW_KEY.pick, unusable: REVIEW_KEY.reject, unreviewed: REVIEW_KEY.unreviewed }
  /**
   * The Undo of a bulk mark (owner tick A3): each frame back to the bucket it
   * reads now, one mark per bucket. A decision that no longer applies to the
   * frame's bytes reads Unreviewed, so it goes back to Unreviewed.
   */
  function marksBefore(list: ReviewFrame[], value: QualityValue): QuickUndo {
    const byMark = new Map<QualityValue, ReviewFrame[]>()
    for (const f of list) byMark.set(MARK_OF[f.bucket], [...(byMark.get(MARK_OF[f.bucket]) ?? []), f])
    return {
      message: m.store_saved_frames_marked({ count: list.length, n: list.length, quality: markLabel[value] }),
      run: () => (scope ? [...byMark].map(([was, frames]) => markLibrary(scope, frames, was)).find((result) => !result.ok) : undefined),
    }
  }
  function markAction(value: QualityValue, list: ReviewFrame[], always = false): Action {
    // The STATUS words (Usable, Unusable, Unreviewed), as the buttons that ask read.
    const said = { count: list.length, n: list.length, quality: markLabel[value] }
    const bulk = list.length > BULK_MARK_CONFIRM_OVER
    return {
      id: `mark-${value}`,
      label: markLabel[value],
      shortcut: markKey[value],
      unavailable: list.length === 0 ? { action: markLabel[value], reason: m.review_no_current_frame(), blockers: [] } : undefined,
      confirm: bulk ? { title: m.review_bulk_mark_title(said), confirm: { label: m.store_label_mark_frames(said) } } : undefined,
      quick: bulk ? { oneClick: { undo: () => marksBefore(list, value) }, openPage: "keep" } : undefined,
      run: () => mark(value, list, always),
    }
  }
  const marksFor = (list: ReviewFrame[]) => (["usable", "unusable", "unreviewed"] as const).map((value) => markAction(value, list))

  function startCompare(withId?: AssetId) {
    const withFrame = withId && withId !== current?.asset.id ? frames.find((f) => f.asset.id === withId) : undefined
    const currentName = current ? (names.get(current.asset.id) ?? "") : m.review_no_frame()
    if (withFrame) {
      setRefId(withFrame.asset.id)
      setCompare(true)
      announce(m.review_announce_compare({ current: currentName, reference: names.get(withFrame.asset.id) ?? "" }))
      return
    }
    if (compare) {
      setCompare(false)
      return
    }
    const other = selectedFrames.find((f) => f.asset.id !== current?.asset.id) ?? ordered[index - 1] ?? ordered[index + 1] ?? null
    if (!refId || !frames.some((f) => f.asset.id === refId)) setRefId(other?.asset.id ?? null)
    setCompare(true)
    announce(other ? m.review_announce_compare({ current: currentName, reference: names.get(other.asset.id) ?? "" }) : m.review_announce_compare_none({ current: currentName }))
  }

  function toggleCorners() {
    setCorners((on) => {
      announce(on ? m.review_announce_corners_off() : m.review_announce_corners_on())
      return !on
    })
  }

  function reveal(frame: ReviewFrame) {
    const path = frame.asset.copies[0]?.path ?? null
    setRevealed(path)
    announce(path ? m.review_announce_revealed({ path }) : m.review_announce_no_copy())
  }

  function chooseView(next: ListView) {
    if (next === "grid" && view !== "grid") setBeforeGrid(view as Exclude<ListView, "grid">)
    setView(next)
  }

  function toggleGrid() {
    if (view === "grid") setView(beforeGrid)
    else chooseView("grid")
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

  function applyThreshold(matches: ReviewFrame[], t: Threshold) {
    setSelected((prev) => new Set([...(t.add ? prev : []), ...matches.map((f) => f.asset.id)]))
    if (matches[0]) select(matches[0].asset.id)
    const said = { count: matches.length, metric: METRIC_LABEL[t.metric], value: String(t.value) }
    announce(t.direction === "above" ? m.review_announce_threshold_above(said) : m.review_announce_threshold_below(said))
    setThreshold(null)
  }

  /** Finish review: only a session review finishes, and only once no frame is Unreviewed (C10). */
  function finish() {
    if (!scope?.session || unreviewed > 0 || !onFinished) return
    onFinished()
  }

  const toggleInspector = () => (overlayMode.current ? setOverlayInspector((on) => !on) : setReviewPrefs({ inspectorOpen: !prefs.inspectorOpen }))

  // `?assetId=` opens that frame, with the filter widened when it hides it.
  const linked = typeof search.assetId === "string" ? search.assetId : null
  useEffect(() => {
    if (!linked || !scope) return
    const f = scope.frames.find((x) => x.asset.id === linked)
    if (!f) return
    setFilter((was) => (was === "all" || was === f.bucket ? was : "all"))
    select(linked)
    // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per linked frame.
  }, [linked, sessionId])

  useEffect(() => {
    setStar(null)
    setRevealed(null)
    setReadout(null)
  }, [current?.asset.id])

  // The current row stays in view; while focus is on a row it follows the current frame. The other way round,
  // a frame row that takes focus (the list's Home, End, Page Up and Page Down, P-KBD1) becomes the current frame.
  useEffect(() => {
    if (view !== "table" || !current) return
    const row = document.querySelector<HTMLElement>(`[data-workspace-list] tr[aria-current="true"]`)
    row?.scrollIntoView({ block: "nearest" })
    const focus = document.activeElement
    if (row && focus instanceof HTMLElement && focus !== row && focus.closest("[data-workspace-list] tbody tr")) row.focus({ preventScroll: true })
  }, [current?.asset.id, view])

  const latest = {
    step,
    follow: (id: string) => {
      const frame = ordered.find((f) => f.asset.id === id)
      if (frame && frame !== current) select(frame.asset.id)
    },
    mark: (value: QualityValue, always = false) => runner.run(markAction(value, targets, always)),
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
      if (overlayMode.current && overlayInspector) {
        setOverlayInspector(false)
        return true
      }
      if (selected.size > 0) {
        setSelected(new Set())
        announce(m.review_announce_selection_cleared())
        return true
      }
      return false
    },
    toggleInspector,
    finish,
    zoomed: plateView.zoom !== "fit",
    gridCols: () => (view === "grid" ? gridCols.current : 1),
  }
  const handlers = useRef(latest)
  handlers.current = latest

  // Review hotkeys (PIX-FR-13), on the capture phase so they win over the app's G sequences while Review is open.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const h = handlers.current
      if (isTyping(event.target) || popupOpen()) return
      const target = event.target instanceof Element ? event.target : null
      const consume = () => {
        event.preventDefault()
        event.stopPropagation()
      }
      const key = event.key
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        if (key.toLowerCase() === "a") {
          h.selectAll()
          consume()
        } else if (key.toLowerCase() === "i" && !event.shiftKey) {
          h.toggleCorners()
          consume()
        } else if (key === "Enter") {
          h.finish()
          consume()
        }
        return
      }
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
        if (target === document.body || target?.closest("[data-frame-item], [data-workspace-list] tbody tr, [data-plate]")) {
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
        c: () => h.startCompare(),
        g: h.toggleGrid,
        t: h.cycleHeight,
        i: h.toggleInspector,
      }
      const action = actions[lower]
      if (!action || (event.shiftKey && !["p", "x"].includes(lower))) return
      action()
      consume()
    }
    function onFocusIn(event: FocusEvent) {
      const row = event.target instanceof HTMLElement && event.target.matches("[data-workspace-list] tbody tr[data-row]") ? event.target : null
      if (row?.dataset.row) handlers.current.follow(row.dataset.row)
    }
    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("focusin", onFocusIn)
    const h = () => handlers.current
    // Getters: the palette reads each label at render, in the chosen language.
    registerReviewCommands([
      { id: "next", get label() { return m.review_cmd_next() }, keys: REVIEW_KEY.next, run: () => h().step(1) },
      { id: "previous", get label() { return m.review_cmd_previous() }, keys: REVIEW_KEY.previous, run: () => h().step(-1) },
      { id: "pick", get label() { return m.review_cmd_usable() }, keys: REVIEW_KEY.pick, run: () => h().mark("usable") },
      { id: "reject", get label() { return m.review_cmd_unusable() }, keys: REVIEW_KEY.reject, run: () => h().mark("unusable") },
      { id: "unreviewed", get label() { return m.review_cmd_unreviewed() }, keys: REVIEW_KEY.unreviewed, run: () => h().mark("unreviewed") },
      { id: "zoom", get label() { return m.review_cmd_zoom() }, keys: REVIEW_KEY.zoom, run: () => h().toggleZoom() },
      { id: "fullscreen", get label() { return m.review_cmd_fullscreen() }, keys: REVIEW_KEY.fullscreen, run: () => h().toggleFullscreen() },
      { id: "compare", get label() { return m.review_cmd_compare() }, keys: REVIEW_KEY.compare, run: () => h().startCompare() },
      { id: "grid", get label() { return m.review_cmd_grid() }, keys: REVIEW_KEY.grid, run: () => h().toggleGrid() },
      { id: "height", get label() { return m.review_cmd_height() }, keys: REVIEW_KEY.height, run: () => h().cycleHeight() },
      { id: "inspector", get label() { return m.review_frame_inspector() }, keys: REVIEW_KEY.inspector, run: () => h().toggleInspector() },
      { id: "corners", get label() { return m.review_corner_inspector() }, keys: `${MOD_LABEL}${REVIEW_KEY.inspector}`, run: () => h().toggleCorners() },
      { id: "select-all", get label() { return m.review_cmd_select_all() }, keys: `${MOD_LABEL}${REVIEW_KEY.selectAll}`, run: () => h().selectAll() },
      { id: "finish", get label() { return m.review_cmd_finish() }, keys: `${MOD_LABEL}${REVIEW_KEY.finish}`, run: () => h().finish() },
    ])
    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      window.removeEventListener("focusin", onFocusIn)
      registerReviewCommands(null)
    }
  }, [])

  if (!scope) {
    return context.kind === "session" ? <MissingRecord title={m.session_missing_title()} backTo="/sessions" backLabel={m.nav_sessions()} /> : <MissingRecord title={m.project_missing_title()} backTo="/projects" backLabel={m.nav_projects()} />
  }
  const session = scope.session

  // Row ⋯, right click and thumbnails: the selection when the frame is in it, else that frame.
  const rowItems = (id: AssetId): MenuItem[] => {
    const frame = frames.find((f) => f.asset.id === id)
    if (!frame) return []
    const list = selected.has(id) && selectedFrames.length > 1 ? selectedFrames : [frame]
    return [
      ...(list.length > 1 ? [{ heading: m.review_frames_count({ count: list.length }) }] : []),
      ...marksFor(list),
      { separator: true },
      { id: "compare-with", label: m.review_compare_with_current(), icon: ArrowLeftRight, shortcut: REVIEW_KEY.compare, unavailable: frames.length < 2 || id === current?.asset.id ? { action: m.review_compare_with_current(), reason: m.review_compare_needs_other(), blockers: [] } : undefined, run: () => startCompare(id) },
      { id: "reveal", label: m.review_reveal_path(), icon: FolderOpen, unavailable: frame.asset.copies.length === 0 ? { action: m.review_reveal_path(), reason: m.review_announce_no_copy(), blockers: [] } : undefined, run: () => reveal(frame) },
    ]
  }

  const emptyTitle = frames.length === 0 || filter === "all" ? m.review_empty_none() : filter === "picked" ? m.review_empty_usable() : filter === "rejected" ? m.sessions_empty_unusable() : m.review_empty_unreviewed()
  const emptyList = <EmptyState icon={ImageOff} title={emptyTitle} action={filter !== "all" ? <ActionButton action={{ id: "show-all", label: m.review_show_all(), run: () => setFilter("all") }} /> : null} />

  const selectByThreshold: Action = { id: "threshold", label: m.review_select_by_threshold_ellipsis(), opensDialog: true, run: () => setThreshold({ metric: "fwhm", direction: "above", value: null, add: false }) }
  // The owner's "Mark rest usable" (C10): it always asks, naming the remaining count ("Mark 37 remaining frames Usable?", D-W118),
  // so the Quick actions switch leaves it as declared.
  const restSaid = { count: unreviewed, n: unreviewed, quality: markLabel.usable }
  const markRest: Action = {
    id: "mark-rest-usable",
    label: m.review_mark_rest_usable(),
    unavailable: unreviewed === 0 ? { action: m.review_mark_rest_usable(), reason: m.review_mark_rest_none(), blockers: [] } : undefined,
    confirm: { title: m.review_mark_rest_title(restSaid), confirm: { label: m.store_label_mark_frames(restSaid) } },
    run: () => {
      const result = session ? markRestUsable(session.id) : ({ ok: true } as const)
      if (result.ok) announce(m.review_announce_rest_usable({ count: unreviewed }))
      return result
    },
  }

  const list =
    view === "table" ? (
      <DataTable
        label={m.review_frames_in_review()}
        rows={height === "strip" ? (current ? [current] : []) : ordered}
        columns={columns}
        getRowId={(f) => f.asset.id}
        selection={{ selected: [...selected], onChange: (ids) => setSelected(new Set(ids)), rowLabel: (f) => names.get(f.asset.id) ?? f.asset.fileName }}
        sort={sort}
        onSortChange={setSort}
        activeRowId={current?.asset.id ?? null}
        onRowClick={(f) => select(f.asset.id)}
        rowLabel={(f) => names.get(f.asset.id) ?? f.asset.fileName}
        rowActions={(f) => rowItems(f.asset.id)}
        toolbar={{ actions: session ? [selectByThreshold, markRest] : [selectByThreshold] }}
        batchActions={(ids) => marksFor(frames.filter((f) => ids.includes(f.asset.id)))}
        empty={emptyList}
        scroll="fill"
        stickyFirstColumn
      />
    ) : (
      <FrameThumbnails
        layout={view === "grid" ? "grid" : "strip"}
        label={view === "grid" ? m.review_frame_grid() : m.review_view_filmstrip()}
        items={ordered.map((f) => ({
          id: f.asset.id,
          name: names.get(f.asset.id) ?? f.asset.fileName,
          file: fileOf(f),
          unreadable: f.availability === "available" ? null : say(m, previewUnavailableReason(f.availability)),
          status: <QualityLabel frame={f} short />,
          statusText: qualityWord(m, f),
          dimmed: f.bucket === "rejected",
        }))}
        activeId={current?.asset.id ?? null}
        selected={selected}
        onActivate={activate}
        empty={emptyList}
        menu={{ items: rowItems, runner }}
        onColumns={(n) => {
          gridCols.current = n
        }}
      />
    )

  const unavailableText = (f: ReviewFrame) => (f.availability !== "available" ? say(m, previewUnavailableReason(f.availability)) : m.review_no_pixel_data())
  const plateOf = (f: ReviewFrame, img: PlateImage | null, fld: typeof field, primary: boolean) => {
    const label = names.get(f.asset.id) ?? f.asset.fileName
    if (!img || !fld) return <UnknownValue label={unavailableText(f)} />
    if (corners) return <CornerGrid field={fld} stretch={plateView.stretch} overlay={cornerOverlay} label={label} />
    return (
      <Plate
        image={img}
        view={plateView}
        onView={setPlateView}
        label={label}
        stars={primary ? stars : undefined}
        starId={primary ? (star?.id ?? null) : null}
        onStar={
          primary
            ? (s: StarRecord) => {
                setStar(s)
                setTab("stars")
              }
            : undefined
        }
        onWindow={primary ? setShownWindow : undefined}
        onReadout={primary ? setReadout : undefined}
      />
    )
  }
  const readoutText = readout ? (readoutValue === null || Number.isNaN(readoutValue) ? m.review_readout_invalid({ x: formatCount(readout.x), y: formatCount(readout.y) }) : m.review_readout({ x: formatCount(readout.x), y: formatCount(readout.y), value: formatCount(Math.round(readoutValue)) })) : null
  const panes: WorkspacePane[] = current
    ? [
        {
          id: "current",
          caption: (
            <>
              {names.get(current.asset.id)}
              {" · "}
              {m.review_frame_position({ index: index + 1, total: ordered.length })}
              {field?.cfa ? <Pill tone="muted">{m.review_cfa({ cfa: field.cfa })}</Pill> : null}
              {readoutText ? ` · ${readoutText}` : null}
            </>
          ),
          content: plateOf(current, image, field, true),
        },
        ...(compare
          ? [
              {
                id: "reference",
                caption: (
                  <DisplayMenu
                    label={reference ? m.review_reference_of({ name: names.get(reference.asset.id) ?? "" }) : m.review_compare_reference()}
                    align="start"
                    groups={[
                      {
                        kind: "radio",
                        id: "reference",
                        label: m.review_reference_label(),
                        value: reference?.asset.id ?? "",
                        options: frames.filter((f) => f !== current).map((f) => ({ value: f.asset.id, label: names.get(f.asset.id) ?? f.asset.fileName })),
                        onChange: (id) => setRefId(id),
                      },
                    ]}
                  />
                ),
                content: reference ? plateOf(reference, refImage, refField, false) : <UnknownValue label={m.review_no_reference()} />,
              },
            ]
          : []),
      ]
    : []

  const plotFrames = frames
  const series: PlotSeries[] = PLOT_METRICS.map((metric) => {
    const unit = frames.find((f) => f.builtIn[metric])?.builtIn[metric]?.unit ?? ""
    return {
      id: metric,
      label: METRIC_LABEL[metric],
      points: plotFrames.flatMap((f) => {
        const value = f.builtIn[metric]?.value
        return value === null || value === undefined ? [] : [{ id: f.asset.id, index: f.order, value, name: names.get(f.asset.id) ?? f.asset.fileName, rejected: f.bucket === "rejected" }]
      }),
      format: (value) => formatMetricFixed(m, { value, unit }),
      tick: (value) => (unit === "stars" || unit === "ADU" ? formatCount(Math.round(value)) : formatMetricFixed(m, { value, unit })),
    }
  })

  const displayGroups: DisplayGroup[] = [
    {
      kind: "radio",
      id: "view",
      label: m.review_view(),
      value: view,
      options: [
        { value: "table", label: m.review_view_table() },
        { value: "filmstrip", label: m.review_view_filmstrip() },
        { value: "grid", label: m.review_view_grid() },
      ],
      onChange: (v) => chooseView(v as ListView),
    },
    ...(view === "table"
      ? [
          {
            kind: "radio" as const,
            id: "height",
            label: m.review_table_height(),
            value: height,
            options: (["rows", "strip", "full"] as const).map((h) => ({ value: h, label: heightLabel(m, h) })),
            onChange: (h: string) => setHeight(h as TableHeight),
          },
        ]
      : []),
    { kind: "radio", id: "zoom", label: m.review_zoom(), value: plateView.zoom, options: ZOOMS.map((z) => ({ value: z, label: ZOOM_LABEL[z] })), onChange: (z) => setPlateView((v) => ({ ...v, zoom: z as Zoom, centre: null })) },
    { kind: "radio", id: "stretch", label: m.review_display_stretch(), value: plateView.stretch, options: STRETCHES.map((s) => ({ value: s, label: STRETCH_LABEL[s] })), onChange: (s) => setPlateView((v) => ({ ...v, stretch: s as Stretch })) },
    {
      kind: "check",
      id: "overlays",
      label: m.display_menu_overlays(),
      items: [
        { id: "stars", label: m.review_tab_stars(), checked: starsOn },
        { id: "corners", label: m.review_corners(), checked: corners, shortcut: `${MOD_LABEL}${REVIEW_KEY.inspector}` },
        { id: "fwhm", label: m.review_fwhm_overlay(), checked: cornerOverlay.fwhm, disabled: !corners },
        { id: "ecc", label: m.review_ecc_overlay(), checked: cornerOverlay.eccentricity, disabled: !corners },
      ],
      onChange: (id, on) => {
        if (id === "stars") setStarsOn(on)
        else if (id === "corners") toggleCorners()
        else setCornerOverlay((o) => (id === "fwhm" ? { ...o, fwhm: on } : { ...o, eccentricity: on }))
      },
    },
    { kind: "radio", id: "names", label: m.review_frame_names(), value: prefs.namePreset, options: NAME_PRESETS.map((p) => ({ value: p.id, label: p.label, detail: p.template })), onChange: (id) => setReviewPrefs({ namePreset: id }) },
    {
      kind: "columns",
      id: "columns",
      label: m.review_columns(),
      columns: allColumns.map((c) => ({ id: c.id, label: c.header, checked: c.id === "frame" || prefs.columns.includes(c.id), required: c.id === "frame" })),
      onChange: (id, on) => setReviewPrefs({ columns: on ? [...prefs.columns, id] : prefs.columns.filter((c) => c !== id) }),
    },
    {
      kind: "check",
      id: "behaviour",
      items: [
        { id: "inspector", label: m.review_show_inspector(), checked: overlayMode.current ? overlayInspector : prefs.inspectorOpen, shortcut: REVIEW_KEY.inspector },
        { id: "advance", label: m.review_auto_advance_after_mark(), checked: prefs.autoAdvance },
      ],
      onChange: (id, on) => {
        if (id === "advance") setReviewPrefs({ autoAdvance: on })
        else if (overlayMode.current) setOverlayInspector(on)
        else setReviewPrefs({ inspectorOpen: on })
      },
    },
  ]

  const aside = (overlay: boolean): WorkspaceAside | null => {
    overlayMode.current = overlay
    if (!current || !(overlay ? overlayInspector : prefs.inspectorOpen)) return null
    return {
      label: m.review_frame_inspector(),
      title: names.get(current.asset.id) ?? current.asset.fileName,
      closeLabel: withKey(m, m.review_close_inspector(), REVIEW_KEY.inspector),
      onClose: () => (overlay ? setOverlayInspector(false) : setReviewPrefs({ inspectorOpen: false })),
      children: (
        <Inspector frame={current} catalog={catalog} field={field} window={shownWindow} readout={readoutValue} star={star} onStar={setStar} tab={tab} onTab={setTab} marks={marksFor(targets)} runner={runner} />
      ),
    }
  }

  const records = Object.values(catalog.measurementImports).filter((record) => record.sessionId === scope.session.id)
  const status = [
    <>
      {m.review_shown_of({ count: ordered.length, total: frames.length })}
      {selected.size > 0 ? ` · ${m.status_bar_selected({ count: selected.size })}` : null}
      {hiddenSelected > 0 ? ` (${m.review_hidden_count({ count: hiddenSelected })})` : null}
    </>,
    <MeasureStatus scope={scope} frames={frames} currentId={current?.asset.id ?? null} />,
    revealed ? (
      <>
        <PathText path={revealed} truncate />
        <IconButton label={m.review_dismiss_path()} icon={X} onClick={() => setRevealed(null)} />
      </>
    ) : null,
    <ActionButton action={{ id: "import", label: m.review_import_measurements_ellipsis(), opensDialog: true, run: () => setImportOpen(true) }} />,
    records.length > 0 ? <ActionButton action={{ id: "imports", label: m.review_imported_measurements_ellipsis({ count: records.length }), opensDialog: true, run: () => setImportsOpen(true) }} /> : null,
    runner.feedback,
  ]

  const currentName = current ? (names.get(current.asset.id) ?? current.asset.fileName) : ""

  return (
    <>
      <Workspace
        label={m.review_workspace_label()}
        toolbar={{
          start: (
            <FilterControls
              facets={{
                items: [
                  {
                    id: "quality",
                    label: m.review_col_quality(),
                    kind: "single",
                    value: filter === "all" ? "" : filter,
                    options: FILTERS.filter((f) => f.id !== "all").map((f) => ({ value: f.id, label: f.label, count: counts[f.id] })),
                  },
                ],
                onChange: (patch) => {
                  const next = patch.quality
                  if (typeof next === "string") latest.filter(next === "" ? "all" : (next as QualityFilter))
                },
              }}
            />
          ),
          end: (
            <>
              <IconButton label={m.review_cmd_previous()} icon={ChevronLeft} shortcut={REVIEW_KEY.previous} disabled={index <= 0} onClick={() => step(-1)} />
              <IconButton label={m.review_cmd_next()} icon={ChevronRight} shortcut={REVIEW_KEY.next} disabled={index < 0 || index >= ordered.length - 1} onClick={() => step(1)} />
              <ActionButton action={{ id: "compare", label: compare ? m.review_compare_end() : m.review_compare(), icon: ArrowLeftRight, shortcut: REVIEW_KEY.compare, run: () => startCompare() }} />
              <IconButton label={m.review_cmd_fullscreen()} icon={Expand} shortcut={REVIEW_KEY.fullscreen} disabled={!current} onClick={() => setFullscreen(true)} />
              <DisplayMenu label={m.review_display()} groups={displayGroups} />
            </>
          ),
        }}
        list={list}
        listHeight={view === "grid" ? "full" : view === "filmstrip" ? "strip" : height}
        rowsPx={prefs.rowsHeightPx}
        onRowsPx={(px) => setReviewPrefs({ rowsHeightPx: px })}
        stage={panes}
        stageEmpty={<UnknownValue label={m.review_no_current_frame()} />}
        strip={<SessionPlots series={series} count={frames.length} activeId={current?.asset.id ?? null} selected={selected} threshold={threshold && threshold.value !== null ? { seriesId: threshold.metric, direction: threshold.direction, value: threshold.value } : null} onSelect={select} />}
        aside={aside}
        status={status}
        statusLabel={m.review_status_line()}
        fullscreen={
          fullscreen && current
            ? {
                label: m.review_cmd_fullscreen(),
                onExit: () => setFullscreen(false),
                bar: (
                  <>
                    {currentName}
                    <QualityLabel frame={current} />
                    <ActionBar actions={marksFor(targets)} runner={runner} />
                    <IconButton label={withKey(m, m.review_leave_fullscreen(), REVIEW_KEY.fullscreen)} icon={Minimize} onClick={() => setFullscreen(false)} />
                  </>
                ),
              }
            : null
        }
      />
      <ThresholdDialog threshold={threshold} onThreshold={setThreshold} frames={shown} onApply={applyThreshold} onClose={() => setThreshold(null)} />
      <ImportDialog sessionId={scope.session.id} href={scope.href} viewAssetIds={new Set(frames.map((f) => f.asset.id))} open={importOpen} onOpenChange={setImportOpen} />
      <ImportedMeasurementsDialog records={records} href={scope.href} open={importsOpen} onOpenChange={setImportsOpen} />
      {runner.dialog}
    </>
  )
}
