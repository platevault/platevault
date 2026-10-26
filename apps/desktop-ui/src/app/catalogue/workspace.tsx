/**
 * Catalogue entry (R9-COMPOSITION-PLAN §3.4, §8.3): the Workspace template,
 * the full-height body of a review step (session intake Review). Each
 * specimen fills a frame the height of a short window with synthetic frames:
 *
 * - list heights: `rows` with its separator (drag it, ↑/↓, Page Up/Down,
 *   Home/End, or click it for the next preset), `strip` and `full`;
 * - the stage with one pane and with Compare's two, and its empty state;
 * - the aside docked beside the stage, and as an overlay dialog below
 *   1000 px (focus held, Escape closes);
 * - fullscreen, which Escape leaves.
 *
 * Every string comes from the messages; frame names are synthetic data.
 */
import { ImageOff } from "lucide-react"
import { useMemo, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Column } from "@/components/app/contracts"
import { DataTable } from "@/components/app/data-table"
import { EmptyState } from "@/components/app/feedback"
import { Plate, type PlateImage, type PlateView } from "@/components/domain/plate"
import { renderWindow, starField } from "./fixtures/raster"
import { Workspace, type WorkspaceListHeight, type WorkspacePane } from "@/components/templates/workspace"
import { formatCount } from "@/lib/format"
import { ComponentSection, Specimen } from "./specimen"

const TRUTH = { fwhmPx: 3.2, eccentricity: 0.32, starCount: 260, background: 820, saturatedStars: 3, invalidSamples: 0, trailed: false }

interface Row {
  id: string
  name: string
  n: number
}

const ROWS: Row[] = Array.from({ length: 24 }, (_, i) => ({ id: `f${i + 1}`, name: `Light_${String(i + 1).padStart(4, "0")}.fits`, n: i + 1 }))

function Specimens() {
  const m = useMessages()
  const field = useMemo(() => starField("catalogue-workspace", TRUTH, 1600, 1100, null), [])
  const image = useMemo<PlateImage>(() => ({ width: field.width, height: field.height, render: (window, stretch) => renderWindow(field, window, stretch) }), [field])
  const [view, setView] = useState<PlateView>({ zoom: "fit", centre: null, stretch: "auto" })
  const [rowsPx, setRowsPx] = useState(9 * 26)
  const [current, setCurrent] = useState("f1")
  const [asideOpen, setAsideOpen] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const columns: Column<Row>[] = [
    { id: "name", header: m.review_col_frame(), rowHeader: true, sortValue: (r) => r.name, cell: (r) => r.name },
    { id: "n", header: m.catalogue_workspace_col_number(), align: "right", sortValue: (r) => r.n, cell: (r) => formatCount(r.n) },
  ]
  const list = (rows: Row[]) => <DataTable label={m.review_frames_in_review()} rows={rows} columns={columns} getRowId={(r) => r.id} activeRowId={current} onRowClick={(r) => setCurrent(r.id)} scroll="fill" />
  const name = ROWS.find((r) => r.id === current)?.name ?? ""
  const pane = (id: string, label: string): WorkspacePane => ({ id, caption: label, content: <Plate image={image} view={view} onView={setView} label={label} /> })
  const frame = (height: WorkspaceListHeight, panes: WorkspacePane[], options: { overlay?: boolean; fullscreen?: boolean } = {}) => (
    <div className="flex h-[32rem] w-full min-w-0 rounded-md border">
      <Workspace
        label={m.review_workspace_label()}
        toolbar={{ start: m.catalogue_workspace_toolbar(), end: <ActionButton action={{ id: "fullscreen", label: m.review_cmd_fullscreen(), run: () => setFullscreen(true) }} /> }}
        list={list(height === "strip" ? ROWS.filter((r) => r.id === current) : ROWS)}
        listHeight={height}
        rowsPx={rowsPx}
        onRowsPx={setRowsPx}
        stage={panes}
        stageEmpty={<EmptyState icon={ImageOff} title={m.review_no_current_frame()} action={null} />}
        aside={() => (asideOpen ? { label: m.review_frame_inspector(), title: name, closeLabel: m.review_close_inspector(), onClose: () => setAsideOpen(false), children: <ActionButton action={{ id: "pick", label: m.review_picked(), run: () => {} }} /> } : null)}
        asideOverlay={options.overlay}
        status={[m.review_shown_of({ count: ROWS.length, total: ROWS.length }), asideOpen ? null : <ActionButton action={{ id: "inspector", label: m.review_show_inspector(), run: () => setAsideOpen(true) }} />]}
        statusLabel={m.review_status_line()}
        fullscreen={fullscreen && options.fullscreen ? { label: m.review_cmd_fullscreen(), bar: <ActionButton action={{ id: "leave", label: m.review_leave_fullscreen(), run: () => setFullscreen(false) }} />, onExit: () => setFullscreen(false) } : null}
      />
    </div>
  )
  return (
    <div className="space-y-3">
      <Specimen caption={m.catalogue_workspace_rows()}>{frame("rows", [pane("current", name)], { fullscreen: true })}</Specimen>
      <Specimen caption={m.catalogue_workspace_compare()}>{frame("strip", [pane("current", name), pane("reference", ROWS[1]!.name)])}</Specimen>
      <Specimen caption={m.catalogue_workspace_full()}>{frame("full", [])}</Specimen>
      <Specimen caption={m.catalogue_workspace_empty()}>{frame("rows", [])}</Specimen>
      <Specimen caption={m.catalogue_workspace_overlay()}>{frame("rows", [pane("current", name)], { overlay: true })}</Specimen>
    </div>
  )
}

export function WorkspaceCatalogue() {
  return (
    <ComponentSection components={["Workspace"]} description={useMessages().catalogue_workspace_desc()}>
      <Specimens />
    </ComponentSection>
  )
}
