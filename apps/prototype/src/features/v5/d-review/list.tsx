/**
 * The three views of one frame list (D-W40, PIX-FR-11): the table (with its
 * three heights, D-W22), the filmstrip (the one-line strip with thumbnails)
 * and the grid (Lightroom-style culling). They share the order, the current
 * frame and the selection; the review owns all three, so switching keeps them.
 * Click makes a frame current, ⌘/Ctrl-click toggles it in the selection,
 * Shift-click selects the range from the current frame.
 */
import { ArrowDown, ArrowUp, ArrowUpDown, ImageOff, Loader } from "lucide-react"
import { type MouseEvent, type ReactNode, type Ref, useEffect, useLayoutEffect, useRef } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu"
import { currentFile, formatMetricFixed, previewUnavailableReason, sessionLabel } from "@/domain/membership"
import type { AssetId, Catalog, Disk, MetricKey } from "@/domain/types"
import { formatExposure, formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { STATUS, StatusBadge } from "@/components/app/status"
import { useSize } from "@/features/t3/frame-preview"
import type { ReviewContext, ReviewFrame } from "./model"
import { MEMBER_WORD, QualityLabel, qualityWord } from "./quality"
import { useThumbnail } from "./thumbnails"

export type Activate = (id: AssetId, mode: "set" | "toggle" | "range") => void

export interface SortState {
  columnId: string
  direction: "asc" | "desc"
}

export interface FrameColumn {
  id: string
  header: string
  /** Source note marker: 1 built-in, 2 imported (v4 Direction B). */
  note?: 1 | 2
  align?: "right"
  contexts?: ReviewContext["kind"][]
  sortValue: (f: ReviewFrame) => string | number | null
  cell: (f: ReviewFrame) => ReactNode
}

const MEASURE_WORD: Record<ReviewFrame["measure"], { value: "valid" | "pending" | "verifying" | "unavailable"; label: string }> = {
  measured: { value: "valid", label: "Measured" },
  pending: { value: "pending", label: "Pending" },
  verifying: { value: "verifying", label: "Verifying" },
  "history-only": { value: "unavailable", label: "Not measured" },
  "not-measured": { value: "unavailable", label: "Not measured" },
}

function metricColumn(key: MetricKey, header: string): FrameColumn {
  return {
    id: key,
    header,
    note: 1,
    align: "right",
    sortValue: (f) => f.builtIn[key]?.value ?? null,
    cell: (f) => {
      const m = f.builtIn[key]
      return m ? (
        formatMetricFixed(m)
      ) : (
        <span className="text-muted-foreground">
          –<span className="sr-only">{MEASURE_WORD[f.measure].label}</span>
        </span>
      )
    },
  }
}

/** Every column the review offers; the Frame column is always shown (PIX-FR-16). */
export function frameColumns(names: Map<AssetId, string>): FrameColumn[] {
  const path = (f: ReviewFrame) => f.asset.copies[0]?.path ?? f.asset.fileName
  return [
    {
      id: "frame",
      header: "Frame",
      sortValue: (f) => names.get(f.asset.id) ?? f.asset.fileName,
      cell: (f) => (
        <span className="block max-w-[22rem] truncate font-medium" title={path(f)}>
          {names.get(f.asset.id)}
        </span>
      ),
    },
    { id: "panel", header: "Panel", contexts: ["group"], sortValue: (f) => f.panel?.n ?? null, cell: (f) => (f.panel ? `Panel ${f.panel.n}` : "–") },
    { id: "subject", header: "Subject", contexts: ["candidates"], sortValue: (f) => f.subject, cell: (f) => f.subject ?? "–" },
    { id: "session", header: "Session", sortValue: (f) => f.session?.startedAt ?? null, cell: (f) => (f.session ? sessionLabel(f.session) : <span className="text-muted-foreground">No session</span>) },
    { id: "time", header: "Time", sortValue: (f) => f.asset.observed.dateObs, cell: (f) => formatTime(f.asset.observed.dateObs) },
    { id: "exposure", header: "Exposure", align: "right", sortValue: (f) => f.asset.observed.exposureS, cell: (f) => formatExposure(f.asset.observed.exposureS) },
    { id: "quality", header: "Quality", sortValue: (f) => qualityWord(f), cell: (f) => <QualityLabel frame={f} short /> },
    { id: "member", header: "In run", contexts: ["run", "group"], sortValue: (f) => f.member, cell: (f) => (f.member ? MEMBER_WORD[f.member] : "–") },
    metricColumn("fwhm", "FWHM"),
    metricColumn("hfr", "HFR"),
    metricColumn("eccentricity", "Ecc."),
    metricColumn("star-count", "Stars"),
    metricColumn("background", "Background"),
    metricColumn("snr", "SNR"),
    {
      id: "fwhm-imported",
      header: "FWHM imported",
      note: 2,
      align: "right",
      sortValue: (f) => f.imported.fwhm?.value ?? null,
      cell: (f) =>
        f.imported.fwhm ? (
          <span title="Imported · content unverified">
            {formatMetricFixed(f.imported.fwhm)}
            <span className="sr-only">, imported, content unverified</span>
          </span>
        ) : (
          <span className="text-muted-foreground">None</span>
        ),
    },
    {
      id: "measurement",
      header: "Measurement",
      sortValue: (f) => f.measure,
      cell: (f) => <StatusBadge kind="measurement" value={MEASURE_WORD[f.measure].value} label={MEASURE_WORD[f.measure].label} />,
    },
    {
      id: "availability",
      header: "Copy",
      sortValue: (f) => f.availability,
      cell: (f) => <StatusBadge kind="availability" value={f.availability} label={STATUS.availability[f.availability].label} />,
    },
  ]
}

export function sortFrames(frames: ReviewFrame[], sort: SortState, columns: FrameColumn[]): ReviewFrame[] {
  const column = columns.find((c) => c.id === sort.columnId)
  if (!column) return [...frames].sort((a, b) => a.order - b.order)
  const factor = sort.direction === "asc" ? 1 : -1
  return [...frames].sort((a, b) => {
    const va = column.sortValue(a)
    const vb = column.sortValue(b)
    if (va === null && vb === null) return a.order - b.order
    if (va === null) return 1
    if (vb === null) return -1
    const d = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))
    return d * factor || a.order - b.order
  })
}

function modeOf(event: MouseEvent): "set" | "toggle" | "range" {
  return event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "set"
}

/**
 * Roving focus (WCAG 2.4.3, 2.4.11): the current frame scrolls into view and, while focus is in this list,
 * focus moves to it on every step and mark, so focus, the current frame and the actions stay on one element.
 * Focus counts as in the list after its item left it (a mark that moves the frame out of the filter).
 * Each list is one Tab stop: only the current item is tabbable.
 */
function useFollowFocus(activeId: AssetId | null, prefix: string) {
  const box = useRef<HTMLDivElement>(null)
  const owns = useRef(false)
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      owns.current = box.current?.contains(event.target as Node) ?? false
    }
    document.addEventListener("focusin", onFocusIn)
    return () => document.removeEventListener("focusin", onFocusIn)
  }, [])
  useLayoutEffect(() => {
    if (!activeId) return
    const el = document.getElementById(`${prefix}-${activeId}`)
    el?.scrollIntoView({ block: "nearest", inline: "nearest" })
    const focus = document.activeElement
    const inside = (focus !== null && box.current?.contains(focus)) || (owns.current && (focus === null || focus === document.body))
    if (!inside) return
    const target = el?.matches("[data-frame-item]") ? el : el?.querySelector<HTMLElement>("[data-frame-item]")
    if (target && target !== focus) target.focus({ preventScroll: true })
  }, [activeId, prefix])
  return box
}

/** Right click, Shift+F10 or the Menu key on a frame opens its menu; every item is also on the toolbar or inspector. */
function WithMenu({ menu, onOpen, children, className, boxRef }: { menu: ReactNode; onOpen: (event: MouseEvent) => void; children: ReactNode; className?: string; boxRef?: Ref<HTMLDivElement> }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger className={className}>
        <div ref={boxRef} className="contents" onContextMenu={onOpen}>
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>{menu}</ContextMenuContent>
    </ContextMenu>
  )
}

function frameIdOf(event: MouseEvent): AssetId | null {
  return (event.target as HTMLElement).closest<HTMLElement>("[data-frame-id]")?.dataset.frameId ?? null
}

export interface ListProps {
  frames: ReviewFrame[]
  activeId: AssetId | null
  selected: Set<AssetId>
  names: Map<AssetId, string>
  onActivate: Activate
  onToggleSelected: (id: AssetId, on: boolean) => void
  /** Context menu items for the frame under the pointer; it becomes current first. */
  menu: ReactNode
  empty: ReactNode
}

export function FrameTable({
  columns,
  sort,
  onSort,
  strip,
  ...props
}: ListProps & { columns: FrameColumn[]; sort: SortState; onSort: (sort: SortState) => void; strip: boolean }) {
  const { frames, activeId, selected, onActivate, onToggleSelected } = props
  const box = useFollowFocus(activeId, "frame-row")
  const shown = strip ? frames.filter((f) => f.asset.id === activeId).slice(0, 1) : frames
  const allSelected = frames.length > 0 && frames.every((f) => selected.has(f.asset.id))
  const someSelected = frames.some((f) => selected.has(f.asset.id))
  const tabbable = shown.some((f) => f.asset.id === activeId) ? activeId : (shown[0]?.asset.id ?? null)
  return (
    <WithMenu
      menu={props.menu}
      boxRef={box}
      onOpen={(event) => {
        const id = frameIdOf(event)
        if (id === null) event.stopPropagation()
        else if (id !== activeId && !selected.has(id)) onActivate(id, "set")
      }}
      className={cn("relative min-h-0 flex-1 overflow-auto bg-background", strip ? "overflow-hidden" : "scroll-pt-[calc(var(--row-h)+1px)]")}
    >
      <table className="w-full text-sm">
        <caption className="sr-only">{strip ? "Current frame" : "Frames in this review"}</caption>
        <thead data-chrome className="sticky top-0 z-10 bg-[color-mix(in_oklch,var(--chrome)_70%,var(--background))] text-[0.6875rem] font-medium text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]">
          <tr>
            <th scope="col" className="h-(--row-h) w-9 px-3">
              <Checkbox
                aria-label={`Select all ${frames.length} shown`}
                checked={allSelected}
                indeterminate={someSelected && !allSelected}
                disabled={frames.length === 0}
                onCheckedChange={(on) => {
                  for (const f of frames) onToggleSelected(f.asset.id, on)
                }}
              />
            </th>
            {columns.map((column) => {
              const active = sort.columnId === column.id
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                  className={cn("h-(--row-h) px-3 font-medium whitespace-nowrap", column.align === "right" ? "text-right" : "text-left")}
                >
                  <button
                    type="button"
                    className={cn("inline-flex h-6 items-center gap-1 rounded-sm hover:text-foreground", active && "text-foreground")}
                    onClick={() => onSort(active ? { columnId: column.id, direction: sort.direction === "asc" ? "desc" : "asc" } : { columnId: column.id, direction: "asc" })}
                  >
                    {column.header}
                    {column.note ? (
                      <sup className="text-link" aria-label={column.note === 1 ? "built-in, see note 1" : "imported, see note 2"}>
                        {column.note}
                      </sup>
                    ) : null}
                    {active ? sort.direction === "asc" ? <ArrowUp aria-hidden="true" className="size-3" /> : <ArrowDown aria-hidden="true" className="size-3" /> : <ArrowUpDown aria-hidden="true" className="size-3 opacity-50" />}
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} className="p-4">
                {props.empty}
              </td>
            </tr>
          ) : (
            shown.map((f) => {
              const id = f.asset.id
              const isSelected = selected.has(id)
              return (
                <tr
                  key={id}
                  id={`frame-row-${id}`}
                  data-frame-id={id}
                  aria-current={activeId === id ? "true" : undefined}
                  data-selected={isSelected || undefined}
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("button,[role=checkbox],input")) return
                    onActivate(id, modeOf(event))
                  }}
                  className={cn(
                    "h-(--row-h) border-b border-border/50 last:border-0 even:bg-foreground/[0.022] hover:bg-foreground/[0.05]",
                    "data-selected:bg-primary/14 data-selected:hover:bg-primary/20",
                    "aria-[current=true]:bg-accent aria-[current=true]:shadow-[inset_2px_0_0_var(--primary)]",
                  )}
                >
                  <td className="w-9 px-3">
                    <Checkbox tabIndex={-1} aria-label={`Select ${props.names.get(id)}`} checked={isSelected} onCheckedChange={(on) => onToggleSelected(id, on)} />
                  </td>
                  {columns.map((column) => {
                    const Cell = column.id === "frame" ? "th" : "td"
                    return (
                      <Cell
                        key={column.id}
                        scope={column.id === "frame" ? "row" : undefined}
                        className={cn("px-3 py-0.5 font-normal whitespace-nowrap tabular-nums", column.align === "right" ? "text-right" : "text-left")}
                      >
                        {column.id === "frame" ? (
                          <button type="button" data-frame-item tabIndex={id === tabbable ? 0 : -1} className="max-w-full rounded-sm text-left hover:underline" onClick={(event) => onActivate(id, modeOf(event))}>
                            {column.cell(f)}
                          </button>
                        ) : (
                          column.cell(f)
                        )}
                      </Cell>
                    )
                  })}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </WithMenu>
  )
}

function Thumbnail({ frame, disk, catalog, className }: { frame: ReviewFrame; disk: Disk; catalog: Catalog; className?: string }) {
  const file = frame.availability === "available" ? currentFile(disk, catalog, frame.asset) : undefined
  const reason = frame.availability === "available" ? null : previewUnavailableReason(frame.availability)
  const thumb = useThumbnail(frame.asset.id, file, reason)
  if (thumb.state === "ready") return <img src={thumb.url} alt="" className={cn("block h-full w-full rounded-[2px] bg-plate object-contain", className)} draggable={false} />
  return (
    <div className={cn("flex h-full w-full flex-col items-center justify-center gap-1 rounded-[2px] bg-plate px-1 text-center text-[0.625rem] leading-3 text-white/70", className)} title={thumb.state === "unreadable" ? thumb.reason : "Decoding thumbnail"}>
      {thumb.state === "pending" ? <Loader aria-hidden="true" className="size-3.5 animate-spin" /> : <ImageOff aria-hidden="true" className="size-3.5" />}
      <span>{thumb.state === "pending" ? "Pending" : "Unreadable"}</span>
    </div>
  )
}

function ThumbCell({ frame, props, disk, catalog, size, tabbable }: { frame: ReviewFrame; props: ListProps; disk: Disk; catalog: Catalog; size: "strip" | "grid"; tabbable: boolean }) {
  const id = frame.asset.id
  const isActive = props.activeId === id
  const isSelected = props.selected.has(id)
  const rejected = frame.bucket === "rejected"
  return (
    <li className={cn(size === "strip" ? "w-32 shrink-0" : "min-w-0")}>
      <button
        type="button"
        id={`frame-thumb-${id}`}
        data-frame-id={id}
        data-frame-item
        tabIndex={tabbable ? 0 : -1}
        aria-current={isActive ? "true" : undefined}
        aria-pressed={isSelected}
        aria-label={`${props.names.get(id)}, ${qualityWord(frame)}`}
        title={frame.asset.copies[0]?.path}
        onClick={(event) => props.onActivate(id, modeOf(event))}
        className={cn(
          "group/thumb block w-full rounded-[4px] p-1 text-left outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring",
          isSelected && "bg-primary/14 hover:bg-primary/20",
          isActive && "bg-accent shadow-[inset_0_0_0_2px_var(--primary)]",
        )}
      >
        <div className={cn("relative aspect-[3/2] w-full", rejected && "opacity-45")}>
          <Thumbnail frame={frame} disk={disk} catalog={catalog} />
        </div>
        <div className="mt-1 flex min-w-0 text-[0.6875rem] leading-4">
          {/* Middle truncation: the frame number at the end stays visible. */}
          <span className="truncate">{(props.names.get(id) ?? "").slice(0, -8)}</span>
          <span className="shrink-0">{(props.names.get(id) ?? "").slice(-8)}</span>
        </div>
        <div className="overflow-hidden whitespace-nowrap">
          <QualityLabel frame={frame} compact />
        </div>
      </button>
    </li>
  )
}

/** The current frame, else the first: the one Tab stop of a filmstrip or grid. */
function tabbableId(props: ListProps): AssetId | null {
  return props.frames.some((f) => f.asset.id === props.activeId) ? props.activeId : (props.frames[0]?.asset.id ?? null)
}

export function Filmstrip({ disk, catalog, ...props }: ListProps & { disk: Disk; catalog: Catalog }) {
  const box = useFollowFocus(props.activeId, "frame-thumb")
  const tabbable = tabbableId(props)
  return (
    <WithMenu
      menu={props.menu}
      boxRef={box}
      onOpen={(event) => {
        const id = frameIdOf(event)
        if (id === null) event.stopPropagation()
        else if (id !== props.activeId && !props.selected.has(id)) props.onActivate(id, "set")
      }}
      className="min-h-0 shrink-0 overflow-x-auto overflow-y-hidden bg-background"
    >
      {props.frames.length === 0 ? (
        <div className="p-3">{props.empty}</div>
      ) : (
        <ul aria-label="Filmstrip" className="flex gap-1 p-1">
          {props.frames.map((f) => (
            <ThumbCell key={f.asset.id} frame={f} props={props} disk={disk} catalog={catalog} size="strip" tabbable={f.asset.id === tabbable} />
          ))}
        </ul>
      )}
    </WithMenu>
  )
}

const GRID_MIN = 152
const GRID_GAP = 4

export function FrameGrid({ disk, catalog, onColumns, ...props }: ListProps & { disk: Disk; catalog: Catalog; onColumns: (cols: number) => void }) {
  const box = useFollowFocus(props.activeId, "frame-thumb")
  const tabbable = tabbableId(props)
  const [ref, size] = useSize<HTMLDivElement>()
  const cols = Math.max(1, Math.floor((size.width - 8 + GRID_GAP) / (GRID_MIN + GRID_GAP)))
  const reported = useRef(0)
  useLayoutEffect(() => {
    if (reported.current !== cols) {
      reported.current = cols
      onColumns(cols)
    }
  }, [cols, onColumns])
  return (
    <div ref={ref} className="min-h-0 flex-1">
      <WithMenu
        menu={props.menu}
        boxRef={box}
        onOpen={(event) => {
          const id = frameIdOf(event)
          if (id === null) event.stopPropagation()
          else if (id !== props.activeId && !props.selected.has(id)) props.onActivate(id, "set")
        }}
        className="block h-full overflow-y-auto bg-background"
      >
        {props.frames.length === 0 ? (
          <div className="p-3">{props.empty}</div>
        ) : (
          <ul aria-label="Frame grid" className="grid p-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: GRID_GAP }}>
            {props.frames.map((f) => (
              <ThumbCell key={f.asset.id} frame={f} props={props} disk={disk} catalog={catalog} size="grid" tabbable={f.asset.id === tabbable} />
            ))}
          </ul>
        )}
      </WithMenu>
    </div>
  )
}
