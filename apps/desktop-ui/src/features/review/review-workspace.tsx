/**
 * Review (S6; spec 067 PIX-FR-10 to PIX-FR-15, D-W13, D-W14, D-W22, D-W40,
 * D-W53): the body of a session intake's Review step. One session's frames
 * in a Workspace: the frame list at the top (a table, a filmstrip or a
 * grid), the preview with Compare and the corner inspector under it, the
 * plots across the session, and a status line with Finish review.
 *
 * - The three views are one list: they share the filter, the sort, the
 *   selection and the current frame, and every hotkey (keys.ts) acts the
 *   same in each. T and the toolbar's height control cycle the table through
 *   about 8 rows (resizable, remembered), the one-line strip and full
 *   height; ⌥1 to ⌥4 filter it.
 * - P, X and U set library quality (Usable, Unusable, Unreviewed), shown as
 *   Picked, Rejected and Unreviewed. A mark applies to the selection when
 *   more than one frame is selected, else to the current frame; after it the
 *   next frame becomes current when auto-advance is on, and always with
 *   Shift+P or Shift+X. A mark on a ⌘A selection asks first (PIX-FR-14).
 * - The corner inspector (⌘I or the toolbar control) swaps each plate for
 *   nine 1:1 tiles with optional FWHM and eccentricity overlays from the
 *   recorded stars; it works in fullscreen and in Compare.
 * - Finish review (⌘↩) runs this step's own action, `pix_finish_review` at
 *   the grouping revision the list was read at, and only then calls
 *   `onFinished`: it never runs the intake flow's current step (409cm.6).
 * - Read-only (`readOnly`, while intake's Review step is locked): marks and
 *   Finish review are unavailable for the reason intake names, in every
 *   control, menu and palette command; viewing, navigation, filters, the
 *   views, Compare and the corner inspector still work. The step footer
 *   shows the lock, and fullscreen, which covers it, shows it in its bar.
 */
import { ArrowLeftRight, ChevronLeft, ChevronRight, Expand, Grid3x3, ImageOff, Lock, Minimize, Rows3 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { failureOf, type Quality, type ReviewFilter, type ReviewFrame_Serialize } from "@/api/ipc"
import { getPreferences, useMessages } from "@/app/preferences"
import type { SessionReviewProps } from "@/app/shell-contract"
import { MOD_LABEL } from "@/app/shortcuts"
import { ActionBar, ActionButton, actionCommand, IconButton, useAction } from "@/components/app/actions"
import type { Action, MenuItem, PaletteCommand } from "@/components/app/contracts"
import { DataTable, sortRows, type TableSort } from "@/components/app/data-table"
import { DisplayMenu, type DisplayGroup } from "@/components/app/display-menu"
import { announce, EmptyState, toast, UnknownValue } from "@/components/app/feedback"
import { FilterControls } from "@/components/app/filter-bar"
import { Pill } from "@/components/app/pill"
import { failureMessage } from "@/components/app/run-result"
import type { CornerOverlay } from "@/components/domain/corner-grid"
import { type FrameThumbnail, FrameThumbnails, type Thumbnail } from "@/components/domain/frame-thumbnails"
import { type PlateView, STRETCH_LABEL, STRETCHES, type Stretch, ZOOM_LABEL, ZOOMS, type Zoom } from "@/components/domain/plate"
import { type PlotSeries, SessionPlots } from "@/components/domain/session-plots"
import { Workspace, type WorkspacePane } from "@/components/templates/workspace"
import { formatCount } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { registerReviewCommands } from "./commands"
import { FRAME_METRICS, formatMetric, frameColumns, metricLabel, metricOf, QualityLabel, qualityWord, thumbnailReason } from "./columns"
import { FramePlate } from "./frame-plate"
import { REVIEW_KEYS, reviewKey } from "./keys"
import { admitted, afterHeightKey, currentAfterMark, currentIn, FILTER_ORDER, type ListView, listHeightOf, NO_SELECTION, type Selection, selectionAfter, stepFrom, type TableHeight } from "./model"
import { setReviewPrefs, useReviewPrefs } from "./prefs"
import { grayBmpUrl, grayTile } from "./pixels"
import { useReviewWrites, useSessionReview, useThumbnails } from "./queries"

type Frame = ReviewFrame_Serialize

/**
 * Text entry only: a Select trigger is not typing. The same rule as the
 * shell's own (app/shortcuts.tsx), which does not export it.
 */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.getAttribute("role") === "combobox")
}

/**
 * An open dialog, menu or list owns the keyboard. The shell waits on any
 * `aria-modal` surface; Review also waits on an open menu or list, and its
 * own fullscreen (modal, but Review's) does not count.
 */
function popupOpen(): boolean {
  return [...document.querySelectorAll("[role=dialog]:not([data-workspace-fullscreen]):not([data-workspace-aside]), [role=alertdialog], [role=menu], [role=listbox]")].some((el) => el.checkVisibility?.() ?? true)
}

const withKey = (m: Messages, label: string, shortcut: string) => m.shell_with_shortcut({ label, shortcut })

function filterLabel(m: Messages, filter: ReviewFilter): string {
  return filter === "all" ? m.review_filter_all() : filter === "picked" ? m.review_picked() : filter === "rejected" ? m.review_rejected() : m.status_unreviewed()
}

function viewLabel(m: Messages, view: ListView): string {
  return view === "table" ? m.review_view_table() : view === "filmstrip" ? m.review_view_filmstrip() : m.review_view_grid()
}

function heightLabel(m: Messages, height: TableHeight): string {
  return height === "rows" ? m.review_height_rows() : height === "strip" ? m.review_height_strip() : m.review_height_full()
}

const MARK_KEY: Record<Quality, string> = { usable: REVIEW_KEYS.pick, unusable: REVIEW_KEYS.reject, unreviewed: REVIEW_KEYS.unreviewed }

function markCommand(m: Messages, quality: Quality): string {
  return quality === "usable" ? m.review_cmd_usable() : quality === "unusable" ? m.review_cmd_unusable() : m.review_cmd_unreviewed()
}

function qualityName(m: Messages, quality: Quality): string {
  return quality === "usable" ? m.status_usable() : quality === "unusable" ? m.status_unusable() : m.status_unreviewed()
}

/** The Review step body of session intake (SessionIntakeProps.review). */
export function SessionReview({ sessionId, onFinished, readOnly }: SessionReviewProps) {
  return <ReviewWorkspace key={sessionId} sessionId={sessionId} onFinished={onFinished} readOnly={readOnly} />
}

function ReviewWorkspace({ sessionId, onFinished, readOnly }: SessionReviewProps) {
  const m = useMessages()
  const prefs = useReviewPrefs()
  const runner = useAction()
  const review = useSessionReview(sessionId)
  const writes = useReviewWrites(sessionId)

  const [filter, setFilter] = useState<ReviewFilter>("all")
  const [sort, setSort] = useState<TableSort | null>(null)
  const [selection, setSelection] = useState<Selection>(NO_SELECTION)
  const [storedCurrent, setStoredCurrent] = useState<string | null>(null)
  const [view, setView] = useState<ListView>("table")
  const [beforeGrid, setBeforeGrid] = useState<Exclude<ListView, "grid">>("table")
  const [height, setHeight] = useState<TableHeight>("rows")
  const [compare, setCompare] = useState(false)
  const [refId, setRefId] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [plateView, setPlateView] = useState<PlateView>({ zoom: "fit", centre: null, stretch: "auto" })
  const [corners, setCorners] = useState(false)
  const gridCols = useRef(4)
  const markRuns = useRef(0)
  // The frame the user chose, not the derived current one: that falls back to the first frame shown while a mark's
  // answers take the marked frame out of the filtered list, which is no move of the user's.
  const storedRef = useRef<string | null>(null)

  const frames = useMemo(() => review.data?.frames ?? [], [review.data])
  const frameIds = useMemo(() => frames.map((f) => f.asset.id), [frames])
  const byId = useMemo(() => new Map(frames.map((f) => [f.asset.id, f])), [frames])
  const counts = review.data?.counts ?? { all: 0, picked: 0, rejected: 0, unreviewed: 0 }
  const columns = useMemo(() => frameColumns(m), [m])
  const ordered = useMemo(() => sortRows(admitted(frames, filter), columns, sort), [frames, filter, columns, sort])
  const orderedIds = useMemo(() => ordered.map((f) => f.asset.id), [ordered])
  const shownIds = useMemo(() => new Set(orderedIds), [orderedIds])
  const currentId = currentIn(orderedIds, storedCurrent)
  storedRef.current = storedCurrent
  const current = ordered.find((f) => f.asset.id === currentId) ?? null
  const index = current ? orderedIds.indexOf(current.asset.id) : -1
  const selectedFrames = frames.filter((f) => selection.ids.has(f.asset.id))
  const hiddenSelected = selectedFrames.filter((f) => !shownIds.has(f.asset.id)).length
  const targets = selectedFrames.length > 1 ? selectedFrames : current ? [current] : []
  const reference = compare ? (frames.find((f) => f.asset.id === refId && f.asset.id !== currentId) ?? null) : null
  const overlay: CornerOverlay = { fwhm: prefs.cornerFwhm, eccentricity: prefs.cornerEccentricity }
  const name = (f: Frame) => f.display.name

  // Keyed on every frame, not the shown order: a new filter or sort keeps the thumbnails already read.
  const thumbnails = useThumbnails(frameIds, view !== "table")
  const thumbOf = useMemo(() => {
    const thumbs = new Map<string, Thumbnail>()
    for (const entry of thumbnails.data ?? []) {
      const frame = byId.get(entry.assetId)
      if (!frame) continue
      thumbs.set(entry.assetId, entry.state === "ready" ? { state: "ready", url: grayBmpUrl(grayTile(entry.thumbnail.image)) } : entry.state === "pending" ? { state: "pending" } : { state: "unreadable", reason: thumbnailReason(m, entry, frame) })
    }
    return thumbs
  }, [thumbnails.data, byId, m])

  function select(id: string) {
    setStoredCurrent(id)
  }

  function step(delta: number) {
    const next = stepFrom(orderedIds, currentId, delta)
    if (next === null) return
    select(next)
    const frame = ordered.find((f) => f.asset.id === next)!
    announce(m.review_announce_frame({ name: name(frame), index: orderedIds.indexOf(next) + 1, total: orderedIds.length }))
  }

  function activate(id: string, mode: "set" | "toggle" | "range") {
    setSelection((was) => selectionAfter(was, orderedIds, currentId, id, mode))
    select(id)
  }

  async function mark(quality: Quality, list: readonly Frame[], always: boolean) {
    const before = { ordered: orderedIds, current: currentId, stored: storedCurrent, filter, autoAdvance: prefs.autoAdvance }
    const { marked, result } = await writes.mark(list, quality)
    if (result.ok) {
      announce(m.review_mark_announcement({ mark: qualityName(m, quality), what: list.length === 1 ? name(list[0]!) : m.review_frames_count({ count: list.length }) }))
      const next = currentAfterMark({ ...before, marked: list.map((f) => f.asset.id), quality, always })
      // A frame the user moved to while the mark was under way stays current.
      if (next !== null && storedRef.current === before.stored) select(next)
    } else if (marked > 0) {
      toast({ message: m.review_marked_before_refusal({ marked: formatCount(marked), total: formatCount(list.length) }) })
    }
    return result
  }

  function markAction(quality: Quality, list: readonly Frame[], always = false): Action {
    const label = markCommand(m, quality)
    const said = { count: list.length, n: list.length, quality: qualityName(m, quality) }
    // A mark on a ⌘A selection asks first, whatever its count (PIX-FR-14).
    const askFirst = selection.origin === "all" && list.length > 0 && list.every((f) => selection.ids.has(f.asset.id))
    return {
      id: `mark-${quality}`,
      label,
      shortcut: MARK_KEY[quality],
      unavailable: readOnly
        ? { action: label, reason: readOnly.reason, blockers: [] }
        : list.length === 0
          ? { action: label, reason: m.review_no_current_frame(), blockers: [] }
          : undefined,
      confirm: askFirst ? { title: m.review_bulk_mark_title(said), confirm: { label: m.store_label_mark_frames(said) } } : undefined,
      run: () => mark(quality, list, always),
    }
  }
  const marksFor = (list: readonly Frame[]) => (["usable", "unusable", "unreviewed"] as const).map((quality) => markAction(quality, list))

  const finishLabel = m.stepflow_finish_review()
  const finishAction: Action = {
    id: "finish-review",
    label: finishLabel,
    kind: "primary",
    shortcut: `${MOD_LABEL}↩`,
    unavailable: readOnly
      ? { action: finishLabel, reason: readOnly.reason, blockers: [] }
      : !review.data
        ? { action: finishLabel, reason: m.review_no_frame(), blockers: [] }
        : counts.unreviewed > 0
          ? { action: finishLabel, reason: m.flow_frames_unreviewed({ count: counts.unreviewed }), blockers: [] }
          : undefined,
    run: async () => {
      const result = await writes.finish(review.data!.groupingRevision)
      if (result.ok) onFinished()
      return result
    },
  }

  function chooseFilter(next: ReviewFilter) {
    setFilter(next)
    announce(m.review_announce_filter({ label: filterLabel(m, next), frames: m.review_frames_count({ count: counts[next] }) }))
  }

  function chooseView(next: ListView) {
    if (next === "grid" && view !== "grid") setBeforeGrid(view === "filmstrip" ? "filmstrip" : "table")
    setView(next)
    if (next !== view) announce(m.review_announce_view({ view: viewLabel(m, next) }))
  }

  function startCompare(withId?: string) {
    const currentName = current ? name(current) : m.review_no_frame()
    const withFrame = withId && withId !== currentId ? frames.find((f) => f.asset.id === withId) : undefined
    if (withFrame) {
      setRefId(withFrame.asset.id)
      setCompare(true)
      announce(m.review_announce_compare({ current: currentName, reference: name(withFrame) }))
      return
    }
    if (compare) {
      setCompare(false)
      announce(m.review_announce_compare_off())
      return
    }
    const other = selectedFrames.find((f) => f.asset.id !== currentId) ?? ordered[index - 1] ?? ordered[index + 1] ?? null
    const keep = refId !== null && refId !== currentId && frames.some((f) => f.asset.id === refId)
    if (!keep) setRefId(other?.asset.id ?? null)
    setCompare(true)
    const shown = keep ? frames.find((f) => f.asset.id === refId)! : other
    announce(shown ? m.review_announce_compare({ current: currentName, reference: name(shown) }) : m.review_announce_compare_none({ current: currentName }))
  }

  function toggleCorners() {
    announce(corners ? m.review_announce_corners_off() : m.review_announce_corners_on())
    setCorners(!corners)
  }

  function cycleHeight() {
    const next = afterHeightKey(view, height)
    setView(next.view)
    setHeight(next.height)
    announce(next.view !== view ? m.review_announce_view({ view: viewLabel(m, next.view) }) : m.review_announce_height({ height: heightLabel(m, next.height) }))
  }

  function toggleZoom() {
    const zoom: Zoom = plateView.zoom === "fit" ? "1" : "fit"
    setPlateView((v) => ({ ...v, zoom, centre: null }))
    announce(m.review_announce_zoom({ zoom: ZOOM_LABEL[zoom] }))
  }

  function toggleFullscreen() {
    if (!current && !fullscreen) return
    setFullscreen(!fullscreen)
    announce(fullscreen ? m.review_announce_fullscreen_off() : m.review_announce_fullscreen_on())
  }

  function toggleGrid() {
    chooseView(view === "grid" ? beforeGrid : "grid")
  }

  function selectAll() {
    setSelection({ ids: new Set(orderedIds), origin: "all" })
    announce(m.review_announce_selected({ count: orderedIds.length }))
  }

  const latest = {
    run(key: NonNullable<ReturnType<typeof reviewKey>>): boolean {
      switch (key.id) {
        case "step":
          step(key.delta)
          return true
        case "row":
          step(key.delta * (view === "grid" ? gridCols.current : 1))
          return true
        case "mark": {
          // Each key press is its own run: a quick second P queues behind the first instead of being dropped as already running.
          markRuns.current += 1
          const action = markAction(key.quality, targets, key.always)
          runner.run({ ...action, id: `${action.id}-${markRuns.current}` })
          return true
        }
        case "zoom":
          toggleZoom()
          return true
        case "fullscreen":
          toggleFullscreen()
          return true
        case "compare":
          startCompare()
          return true
        case "grid":
          toggleGrid()
          return true
        case "height":
          cycleHeight()
          return true
        case "select-all":
          selectAll()
          return true
        case "corners":
          toggleCorners()
          return true
        case "finish":
          runner.run(finishAction)
          return true
        case "filter":
          chooseFilter(key.filter)
          return true
        case "toggle-selected":
          if (current) activate(current.asset.id, "toggle")
          return true
        case "escape":
          if (fullscreen) {
            toggleFullscreen()
            return true
          }
          if (selection.ids.size > 0) {
            setSelection(NO_SELECTION)
            announce(m.review_announce_selection_cleared())
            return true
          }
          return false
      }
    },
    /** The palette's commands: the same actions the keys and controls run, with why one cannot run now. */
    commands(group: string): PaletteCommand[] {
      const noFrame = current ? null : m.review_no_current_frame()
      const act = (id: string, label: string, shortcut: string, key: NonNullable<ReturnType<typeof reviewKey>>, reason: string | null = null): Action => ({
        id: `review-${id}`,
        label,
        shortcut,
        unavailable: reason ? { action: label, reason, blockers: [] } : undefined,
        run: () => {
          latest.run(key)
        },
      })
      const actions: Action[] = [
        act("next", m.review_cmd_next(), REVIEW_KEYS.next, { id: "step", delta: 1 }, noFrame),
        act("previous", m.review_cmd_previous(), REVIEW_KEYS.previous, { id: "step", delta: -1 }, noFrame),
        ...marksFor(targets),
        act("zoom", m.review_cmd_zoom(), REVIEW_KEYS.zoom, { id: "zoom" }, noFrame),
        act("fullscreen", m.review_cmd_fullscreen(), REVIEW_KEYS.fullscreen, { id: "fullscreen" }, noFrame),
        act("compare", compare ? m.review_compare_end() : m.review_cmd_compare(), REVIEW_KEYS.compare, { id: "compare" }, noFrame ?? (frames.length < 2 ? m.review_compare_needs_other() : null)),
        act("grid", m.review_cmd_grid(), REVIEW_KEYS.grid, { id: "grid" }),
        act("height", m.review_cmd_height(), REVIEW_KEYS.height, { id: "height" }),
        act("corners", m.review_corner_inspector(), `${MOD_LABEL}I`, { id: "corners" }, noFrame),
        act("select-all", m.review_cmd_select_all(), `${MOD_LABEL}A`, { id: "select-all" }, orderedIds.length === 0 ? m.review_empty_none() : null),
        finishAction,
      ]
      return actions.map((action) => actionCommand(action, group, runner))
    },
    follow(id: string) {
      if (id !== currentId && orderedIds.includes(id)) select(id)
    },
    zoomed: plateView.zoom !== "fit",
    m,
  }
  const handlers = useRef(latest)
  handlers.current = latest

  // Review's keys, on the capture phase so they win over the app's own while Review is open: G is the grid here
  // (PIX-FR-13) where the shell starts a G go-to sequence (spec 063 FR-042), and ⌘↩ is Finish review. That G
  // conflict is an open owner question; until it is settled Review's G wins inside Review.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isTyping(event.target) || popupOpen()) return
      const target = event.target instanceof Element ? event.target : null
      const key = reviewKey(event, { singleKeys: getPreferences().singleKeyShortcuts, target, zoomedPlate: handlers.current.zoomed })
      if (key && handlers.current.run(key)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    // A frame row that takes focus (the list's Home, End, Page Up and Page Down) becomes the current frame.
    function onFocusIn(event: FocusEvent) {
      const row = event.target instanceof HTMLElement && event.target.matches("[data-workspace-list] tbody tr[data-row]") ? event.target : null
      if (row?.dataset.row) handlers.current.follow(row.dataset.row)
    }
    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("focusin", onFocusIn)
    registerReviewCommands((group) => handlers.current.commands(group))
    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      window.removeEventListener("focusin", onFocusIn)
      registerReviewCommands(null)
    }
  }, [])

  // The current row stays in view; while focus is on a row it follows the current frame.
  useEffect(() => {
    if (view !== "table" || currentId === null) return
    const row = document.querySelector<HTMLElement>(`[data-workspace-list] tr[aria-current="true"]`)
    row?.scrollIntoView({ block: "nearest" })
    const focus = document.activeElement
    if (row && focus instanceof HTMLElement && focus !== row && focus.closest("[data-workspace-list] tbody tr")) row.focus({ preventScroll: true })
  }, [currentId, view])

  const rowItems = (id: string): MenuItem[] => {
    const frame = frames.find((f) => f.asset.id === id)
    if (!frame) return []
    const list = selection.ids.has(id) && selectedFrames.length > 1 ? selectedFrames : [frame]
    const compareLabel = m.review_compare_with_current()
    return [
      ...(list.length > 1 ? [{ heading: m.review_frames_count({ count: list.length }) }] : []),
      ...marksFor(list),
      { separator: true },
      {
        id: "compare-with",
        label: compareLabel,
        icon: ArrowLeftRight,
        shortcut: REVIEW_KEYS.compare,
        unavailable: frames.length < 2 || id === currentId ? { action: compareLabel, reason: m.review_compare_needs_other(), blockers: [] } : undefined,
        run: () => startCompare(id),
      },
    ]
  }

  const emptyTitle = frames.length === 0 || filter === "all" ? m.review_empty_none() : filter === "picked" ? m.review_empty_picked() : filter === "rejected" ? m.review_empty_rejected() : m.review_empty_unreviewed()
  const emptyList = <EmptyState icon={ImageOff} title={emptyTitle} action={filter !== "all" ? <ActionButton action={{ id: "show-all", label: m.review_show_all(), run: () => chooseFilter("all") }} /> : null} />
  const loadFailure = review.error ? failureOf(review.error) : null

  const list =
    view === "table" ? (
      <DataTable
        label={m.review_frames_in_review()}
        rows={height === "strip" ? (current ? [current] : []) : ordered}
        columns={columns}
        getRowId={(f) => f.asset.id}
        selection={{ selected: [...selection.ids], onChange: (ids) =>
            // The header's select-all box ticks every shown row at once, as ⌘A does; ticking the rows one by one up to all of them stays a hand selection.
            setSelection((was) => ({ ids: new Set(ids), origin: ids.length === orderedIds.length && ids.length - was.ids.size > 1 ? "all" : "hand" })), rowLabel: name }}
        sort={sort}
        onSortChange={setSort}
        activeRowId={currentId}
        onRowClick={(f) => select(f.asset.id)}
        rowLabel={name}
        rowActions={(f) => rowItems(f.asset.id)}
        batchActions={(ids) => marksFor(frames.filter((f) => ids.includes(f.asset.id)))}
        empty={emptyList}
        loading={review.isPending}
        error={review.error ? { message: loadFailure ? failureMessage(m, loadFailure) : m.action_failure_unreachable(), onRetry: () => void review.refetch() } : undefined}
        scroll="fill"
        stickyFirstColumn
      />
    ) : (
      <FrameThumbnails
        layout={view === "grid" ? "grid" : "strip"}
        label={view === "grid" ? m.review_frame_grid() : m.review_view_filmstrip()}
        items={ordered.map(
          (f): FrameThumbnail => ({
            id: f.asset.id,
            name: name(f),
            thumb: thumbOf.get(f.asset.id) ?? { state: "pending" },
            status: <QualityLabel frame={f} short />,
            statusText: qualityWord(m, f),
            dimmed: f.label === "rejected",
          }),
        )}
        activeId={currentId}
        selected={selection.ids}
        onActivate={activate}
        empty={emptyList}
        menu={{ items: rowItems, runner }}
        onColumns={(n) => {
          gridCols.current = n
        }}
      />
    )

  const plate = (f: Frame) => <FramePlate frame={f} view={plateView} onView={setPlateView} corners={corners} overlay={overlay} label={name(f)} />
  const panes: WorkspacePane[] = current
    ? [
        {
          id: "current",
          caption: (
            <>
              {name(current)}
              {" · "}
              {m.review_frame_position({ index: index + 1, total: orderedIds.length })}
            </>
          ),
          content: plate(current),
        },
        ...(compare
          ? [
              {
                id: "reference",
                caption: (
                  <DisplayMenu
                    label={reference ? m.review_reference_of({ name: name(reference) }) : m.review_compare_reference()}
                    align="start"
                    groups={[
                      {
                        kind: "radio",
                        id: "reference",
                        label: m.review_reference_label(),
                        value: reference?.asset.id ?? "",
                        options: frames.filter((f) => f !== current).map((f) => ({ value: f.asset.id, label: name(f) })),
                        onChange: (id) => setRefId(id),
                      },
                    ]}
                  />
                ),
                content: reference ? plate(reference) : <UnknownValue label={m.review_no_reference()} />,
              },
            ]
          : []),
      ]
    : []

  const series: PlotSeries[] = FRAME_METRICS.map((metric) => ({
    id: metric,
    label: metricLabel(m, metric),
    points: frames.flatMap((f, at) => {
      const value = metricOf(f, metric)
      return value ? [{ id: f.asset.id, index: at, value: value.value!, name: name(f), rejected: f.label === "rejected" }] : []
    }),
    format: (value) => {
      const units = frames.map((f) => metricOf(f, metric)?.units).find((u) => u !== undefined) ?? "dimensionless"
      return formatMetric(m, value, units)
    },
    tick: (value) => {
      const units = frames.map((f) => metricOf(f, metric)?.units).find((u) => u !== undefined) ?? "dimensionless"
      return formatMetric(m, value, units)
    },
  }))

  const cornersItem = { id: "corners", label: m.review_corners(), checked: corners, shortcut: `${MOD_LABEL}I` }
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
      items: [cornersItem, { id: "fwhm", label: m.review_fwhm_overlay(), checked: overlay.fwhm, disabled: !corners }, { id: "ecc", label: m.review_ecc_overlay(), checked: overlay.eccentricity, disabled: !corners }],
      onChange: (id, on) => {
        if (id === "corners") toggleCorners()
        else if (id === "fwhm") setReviewPrefs({ cornerFwhm: on })
        else setReviewPrefs({ cornerEccentricity: on })
      },
    },
    { kind: "check", id: "behaviour", items: [{ id: "advance", label: m.review_auto_advance_after_mark(), checked: prefs.autoAdvance }], onChange: (_id, on) => setReviewPrefs({ autoAdvance: on }) },
  ]

  const status = [
    <>
      {m.review_shown_of({ count: orderedIds.length, total: frames.length })}
      {selection.ids.size > 0 ? ` · ${m.status_bar_selected({ count: selection.ids.size })}` : null}
      {hiddenSelected > 0 ? ` (${m.review_hidden_count({ count: hiddenSelected })})` : null}
    </>,
    runner.feedback,
    <ActionButton action={finishAction} runner={runner} />,
  ]

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
                    options: FILTER_ORDER.filter((f) => f !== "all").map((f) => ({ value: f, label: filterLabel(m, f), count: counts[f] })),
                  },
                ],
                onChange: (patch) => {
                  const next = patch.quality
                  if (typeof next === "string") chooseFilter(next === "" ? "all" : (next as ReviewFilter))
                },
              }}
            />
          ),
          end: (
            <>
              <IconButton label={m.review_cmd_previous()} icon={ChevronLeft} shortcut={REVIEW_KEYS.previous} disabled={index <= 0} onClick={() => step(-1)} />
              <IconButton label={m.review_cmd_next()} icon={ChevronRight} shortcut={REVIEW_KEYS.next} disabled={index < 0 || index >= orderedIds.length - 1} onClick={() => step(1)} />
              <IconButton label={m.review_cmd_height()} icon={Rows3} shortcut={REVIEW_KEYS.height} onClick={cycleHeight} />
              <IconButton label={m.review_corner_inspector()} icon={Grid3x3} shortcut={`${MOD_LABEL}I`} aria-pressed={corners} onClick={toggleCorners} />
              <ActionButton action={{ id: "compare", label: compare ? m.review_compare_end() : m.review_compare(), icon: ArrowLeftRight, shortcut: REVIEW_KEYS.compare, run: () => startCompare() }} />
              <IconButton label={m.review_cmd_fullscreen()} icon={Expand} shortcut={REVIEW_KEYS.fullscreen} disabled={!current} onClick={() => setFullscreen(true)} />
              <DisplayMenu label={m.review_display()} groups={displayGroups} />
            </>
          ),
        }}
        list={list}
        listHeight={listHeightOf(view, height)}
        rowsPx={prefs.rowsHeightPx}
        onRowsPx={(px) => setReviewPrefs({ rowsHeightPx: px })}
        stage={panes}
        stageEmpty={<UnknownValue label={m.review_no_current_frame()} />}
        strip={<SessionPlots series={series} count={frames.length} activeId={currentId} selected={selection.ids} onSelect={(id) => {
              // A plot point of a frame the filter hides does not become current.
              if (shownIds.has(id)) select(id)
            }}
          />
        }
        status={status}
        statusLabel={m.review_status_line()}
        fullscreen={
          fullscreen && current
            ? {
                label: m.review_cmd_fullscreen(),
                onExit: () => setFullscreen(false),
                bar: (
                  <>
                    {name(current)}
                    <QualityLabel frame={current} />
                    {/* The step footer that names the lock is under fullscreen: the bar names it instead. */}
                    {readOnly ? (
                      <Pill tone="muted" icon={Lock}>
                        {`${m.stepflow_read_only()} · ${readOnly.reason}`}
                      </Pill>
                    ) : null}
                    <ActionBar actions={marksFor(targets)} runner={runner} />
                    <IconButton label={m.review_corner_inspector()} icon={Grid3x3} shortcut={`${MOD_LABEL}I`} aria-pressed={corners} onClick={toggleCorners} />
                    <IconButton label={withKey(m, m.review_leave_fullscreen(), REVIEW_KEYS.fullscreen)} icon={Minimize} onClick={() => setFullscreen(false)} />
                  </>
                ),
              }
            : null
        }
      />
      {runner.dialog}
    </>
  )
}
