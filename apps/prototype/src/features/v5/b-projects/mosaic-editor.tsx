/**
 * Mosaic editor (S3, one frame; D-W38, D-W73): "New mosaic" and "Start
 * mosaic run" open it at `/projects/$projectId?mosaic=new|<subjectId>`
 * (`&rig=`, `&profile=`, `&sessions=` from a candidate selection).
 *
 * - Left, the field: each panel drawn from the rig's field of view at its
 *   centre and rotation, north up and east left. Click a panel to include
 *   or exclude it; a dashed "+" beside a panel adds one there.
 * - Right, the sessions: placed on a panel by their pointing, or by the user
 *   (drag a row onto a panel, its panel menu, or its context menu). Sessions
 *   in more than one panel, outside every panel or without pointing are
 *   flagged and stay out until placed.
 * - Start group saves the subject's panels and starts one run group with a
 *   panel run for each included panel (`confirmMosaic`).
 */
import { Link, useNavigate } from "@tanstack/react-router"
import { Ban, Crosshair, GripVertical, Plus, X } from "lucide-react"
import { type DragEvent, type KeyboardEvent, useId, useMemo, useState } from "react"
import { Box } from "@/components/app/box"
import { Notice } from "@/components/app/feedback"
import { PageHeader } from "@/components/app/page"
import { CountBadge, Pill } from "@/components/app/pill"
import { Refusal } from "@/components/app/refusal"
import { ContextMenuArea, type MenuEntry, menuKey } from "@/components/app/row-menu"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { liveAssetIds, PANEL_FLAG_LABEL, type PanelFlag, panelForSession, projectCandidates, rigFieldOfView, rigName } from "@/domain/derive"
import type { FieldOfView } from "@/domain/sky"
import type { MosaicPanel, Project, Session, SessionId, Subject } from "@/domain/types"
import { formatDec, formatNight, formatRa, plural } from "@/lib/format"
import { type CommitResult, useStore } from "@/store/core"
import { SelectField } from "@/features/t3/fields"
import { CommitOutcome, type SubjectPick, SubjectSearch } from "./parts"
import { NO_PROFILE, profileOptions } from "./start-run"
import { confirmMosaic } from "./subject-actions"

/** Panels overlap by 10% of the field. */
const STEP = 0.9
const UNKNOWN_FOV = { widthDeg: 1, heightDeg: 1 }
const LAYOUTS: Array<[number, number]> = [
  [2, 1],
  [1, 2],
  [2, 2],
  [3, 1],
  [3, 2],
]

interface PanelState extends MosaicPanel {
  include: boolean
}

let panelCounter = 0
function newPanelId(): string {
  panelCounter += 1
  return `pnl_${Date.now().toString(36)}_${panelCounter}`
}

const cosDec = (dec: number) => Math.max(0.1, Math.cos((dec * Math.PI) / 180))

function layout(centre: { ra: number; dec: number }, cols: number, rows: number, fov: { widthDeg: number; heightDeg: number }): PanelState[] {
  const out: PanelState[] = []
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const ra = (centre.ra - ((c - (cols - 1) / 2) * fov.widthDeg * STEP) / cosDec(centre.dec) + 360) % 360
      const dec = centre.dec + ((rows - 1) / 2 - r) * fov.heightDeg * STEP
      out.push({ id: newPanelId(), n: out.length + 1, ra: Number(ra.toFixed(3)), dec: Number(dec.toFixed(3)), rotationDeg: 0, include: true })
    }
  }
  return out
}

/** Unoccupied neighbour slots east, west, north and south of each panel. */
function freeSlots(panels: PanelState[], fov: { widthDeg: number; heightDeg: number }): Array<{ ra: number; dec: number; key: string; beside: number; side: string }> {
  const out: Array<{ ra: number; dec: number; key: string; beside: number; side: string }> = []
  const near = (ra: number, dec: number) =>
    panels.some((p) => Math.abs(((p.ra - ra + 540) % 360) - 180) * cosDec(dec) < fov.widthDeg * 0.5 && Math.abs(p.dec - dec) < fov.heightDeg * 0.5) ||
    out.some((s) => Math.abs(((s.ra - ra + 540) % 360) - 180) * cosDec(dec) < fov.widthDeg * 0.5 && Math.abs(s.dec - dec) < fov.heightDeg * 0.5)
  for (const p of panels) {
    const dRa = (fov.widthDeg * STEP) / cosDec(p.dec)
    for (const [side, ra, dec] of [
      ["east", p.ra + dRa, p.dec],
      ["west", p.ra - dRa, p.dec],
      ["north", p.ra, p.dec + fov.heightDeg * STEP],
      ["south", p.ra, p.dec - fov.heightDeg * STEP],
    ] as const) {
      const r = Number(((ra + 360) % 360).toFixed(3))
      const d = Number(dec.toFixed(3))
      if (!near(r, d)) out.push({ ra: r, dec: d, key: `${r}|${d}`, beside: p.n, side })
    }
  }
  return out
}

interface Placement {
  panelId: string | null
  byUser: boolean
  flag: PanelFlag | null
  detail: string
}

interface SessionRow {
  session: Session
  frames: number
  placement: Placement
}

export function MosaicEditor({ project, subjectId, rigId: initialRig, profileId: initialProfile, sessionIds }: { project: Project; subjectId: string | null; rigId?: string; profileId?: string; sessionIds?: string[] }) {
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const runs = useStore((s) => s.catalog.runs)
  const subject = subjectId ? project.subjects.find((s) => s.id === subjectId) : undefined
  const ids = { name: useId(), rig: useId() }
  const [pick, setPick] = useState<SubjectPick | null>(null)
  const [name, setName] = useState(subject?.mosaic?.name ?? "")
  const [rigId, setRigId] = useState(initialRig && project.rigIds.includes(initialRig) ? initialRig : (project.rigIds[0] ?? ""))
  const [profileId, setProfileId] = useState(initialProfile ?? NO_PROFILE)
  const rig = catalog.opticalTrains[rigId]
  const fov: FieldOfView | null = rig ? rigFieldOfView(catalog, rig) : null
  const field = fov ?? UNKNOWN_FOV
  const [panels, setPanels] = useState<PanelState[]>(() => subject?.mosaic?.panels.map((p) => ({ ...p, include: true })) ?? [])
  const [placements, setPlacements] = useState<Record<SessionId, string | null>>({})
  const [problems, setProblems] = useState<string[]>([])
  const [outcome, setOutcome] = useState<CommitResult | null>(null)
  const [refusedPanel, setRefusedPanel] = useState<{ n: number; runs: string[] } | null>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const targetId = subject?.targetId ?? (pick?.kind === "target" ? pick.targetId : null)
  const draft: Subject = useMemo(
    () => ({ id: subject?.id ?? "__draft", targetId: targetId ?? "", mosaic: { name, centre: subject?.mosaic?.centre ?? { ra: pick?.ra ?? 0, dec: pick?.dec ?? 0 }, panels } }),
    [subject, targetId, name, pick, panels],
  )
  const panelRuns = (panelId: string) => Object.values(runs).filter((r) => r.projectId === project.id && r.subjectId === subject?.id && r.panelId === panelId)

  const rows: SessionRow[] = useMemo(() => {
    if (!targetId) return []
    const hypothetical = subject ? project : { ...project, subjects: [...project.subjects, draft] }
    const chosen = sessionIds ? new Set(sessionIds) : null
    return projectCandidates(catalog, hypothetical)
      .filter((c) => c.subject.targetId === targetId && c.rigId === rigId)
      .map((c) => {
        const own: string | null | undefined = c.session.id in placements ? (placements[c.session.id] ?? null) : chosen && !chosen.has(c.session.id) ? null : undefined
        const auto = panelForSession(catalog, draft, c.session, rigId)
        const placement: Placement =
          own !== undefined ? { panelId: own, byUser: true, flag: null, detail: own ? "Placed by you" : "Left out" } : { panelId: auto.panelId, byUser: false, flag: auto.flag, detail: auto.detail }
        return { session: c.session, frames: liveAssetIds(catalog, c.session).length, placement }
      })
  }, [catalog, project, subject, draft, targetId, rigId, placements, sessionIds])

  const included = panels.filter((p) => p.include)
  const countOn = (panelId: string) => rows.filter((r) => r.placement.panelId === panelId).length
  const flagged = rows.filter((r) => r.placement.flag !== null)
  const placed = rows.filter((r) => r.placement.panelId && included.some((p) => p.id === r.placement.panelId))
  const out = rows.length - placed.length - flagged.length
  const slots = freeSlots(panels, field)
  const backTo = { to: "/projects/$projectId", params: { projectId: project.id } } as const

  function assign(sessionId: SessionId, panelId: string | null | "auto") {
    setPlacements((current) => {
      const next = { ...current }
      if (panelId === "auto") delete next[sessionId]
      else next[sessionId] = panelId
      return next
    })
  }

  function addPanel(ra: number, dec: number) {
    const n = Math.max(0, ...panels.map((p) => p.n)) + 1
    setPanels((list) => [...list, { id: newPanelId(), n, ra, dec, rotationDeg: list[0]?.rotationDeg ?? 0, include: true }])
  }

  function removePanel(panel: PanelState) {
    const users = panelRuns(panel.id)
    if (users.length > 0) {
      setRefusedPanel({ n: panel.n, runs: users.map((r) => r.name) })
      return
    }
    setRefusedPanel(null)
    setPanels((list) => list.filter((p) => p.id !== panel.id))
    setPlacements((current) => Object.fromEntries(Object.entries(current).filter(([, v]) => v !== panel.id)))
  }

  function toggle(panelId: string) {
    setPanels((list) => list.map((p) => (p.id === panelId ? { ...p, include: !p.include } : p)))
  }

  function start() {
    const found = [...(targetId || pick ? [] : ["Target"]), ...(name.trim() ? [] : ["Name"]), ...(panels.length >= 2 ? [] : ["Two panels"]), ...(included.length > 0 ? [] : ["Included panel"]), ...(rigId ? [] : ["Rig"])]
    setProblems(found)
    if (found.length > 0) return
    const own = Object.fromEntries(rows.filter((r) => r.placement.byUser).map((r) => [r.session.id, r.placement.panelId]))
    const result = confirmMosaic({
      projectId: project.id,
      subjectId: subject?.id ?? null,
      pick,
      name,
      rigId,
      panels: panels.map(({ include: _include, ...p }) => p),
      includedIds: included.map((p) => p.id),
      placements: own,
      profileId: profileId === NO_PROFILE ? null : profileId,
    })
    setOutcome(result.result.ok ? null : result.result)
    if (result.groupId) void navigate({ to: "/projects/$projectId/groups/$groupId/$step", params: { projectId: project.id, groupId: result.groupId, step: "select" } })
  }

  function choosePick(next: SubjectPick) {
    setPick(next)
    if (!name.trim()) setName(`${next.name} mosaic`)
    if (next.ra !== null && next.dec !== null && panels.length === 0) setPanels(layout({ ra: next.ra, dec: next.dec }, 2, 1, field))
  }

  const menu = (key: string): MenuEntry[] => [
    { heading: "Place on" },
    ...included.map((p) => ({ label: `Panel ${p.n}`, onSelect: () => assign(key, p.id) })),
    { separator: true },
    { label: "By pointing", icon: Crosshair, onSelect: () => assign(key, "auto") },
    { label: "Leave out", icon: Ban, onSelect: () => assign(key, null) },
  ]

  const centre = draft.mosaic!.centre
  const hasField = panels.length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        eyebrow={
          <Link {...backTo} className="underline-offset-2 hover:underline">
            {project.name}
          </Link>
        }
        title={subject ? (subject.mosaic ? subject.mosaic.name : "Mosaic run") : "New mosaic"}
        meta={
          <>
            <Pill tone="info">
              {included.length}/{panels.length} panels
            </Pill>
            {flagged.length > 0 ? <Pill tone="warning">{plural(flagged.length, "flag")}</Pill> : null}
          </>
        }
        actions={
          <>
            <Button size="sm" variant="outline" render={<Link {...backTo} />}>
              Cancel
            </Button>
            <Button size="sm" onClick={start}>
              Start group
            </Button>
          </>
        }
      />
      <div className="space-y-3 px-5 pt-3">
        {problems.length > 0 ? <Refusal action="Can't start group" reason={`${plural(problems.length, "item")} missing`} blockers={problems.map((label) => ({ label }))} /> : null}
        <CommitOutcome result={outcome} action="Can't start group" />
      </div>
      <div className="grid min-h-0 flex-1 gap-4 px-5 py-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-3">
          <Box title="Field" id="mosaic-field" flush actions={!subject?.mosaic && pick ? <LayoutButtons onPick={(c, r) => setPanels(layout({ ra: centre.ra, dec: centre.dec }, c, r, field))} /> : null}>
            <div className="flex flex-wrap items-end gap-3 border-b border-border px-3 py-2">
              {!subject && pick ? (
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium">Target</span>
                  <span className="flex min-h-8 items-center gap-1.5">
                    <Pill tone="neutral">{pick.name}</Pill>
                    <Button size="icon-sm" variant="ghost" aria-label="Change Target" onClick={() => setPick(null)}>
                      <X aria-hidden="true" />
                    </Button>
                  </span>
                </div>
              ) : null}
              <div className="grid gap-1.5">
                <Label htmlFor={ids.name}>Name</Label>
                <Input id={ids.name} className="w-48" value={name} onChange={(e) => setName(e.target.value)} placeholder="IC 5070 mosaic" />
              </div>
              <SelectField className="w-56" label="Rig" value={rigId} onChange={setRigId} options={project.rigIds.map((id) => ({ value: id, label: rigName(catalog, id) }))} />
              <SelectField className="w-44" label="Profile (optional)" value={profileId} onChange={setProfileId} options={profileOptions(catalog)} />
            </div>
            {!subject && !pick ? (
              <div className="p-3">
                <SubjectSearch autoFocus taken={[]} onPick={choosePick} />
              </div>
            ) : (
              <div className="space-y-2 p-3">
                {!fov ? <Notice tone="warning" title="Field of view unknown · panels drawn at 1°" /> : null}
                {hasField ? (
                  <FieldView
                    panels={panels}
                    slots={adding ? slots : []}
                    field={field}
                    rows={rows}
                    dropOn={dropOn}
                    setDropOn={setDropOn}
                    onToggle={toggle}
                    onAdd={addPanel}
                    onDrop={(sessionId, panelId) => assign(sessionId, panelId)}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">Position unknown · pick a layout</p>
                )}
              </div>
            )}
          </Box>
          {hasField ? (
            <Box
              title="Panels"
              id="mosaic-panels"
              flush
              actions={
                <Button size="sm" variant={adding ? "secondary" : "outline"} aria-pressed={adding} onClick={() => setAdding((on) => !on)} disabled={!adding && slots.length === 0}>
                  <Plus aria-hidden="true" data-icon="inline-start" />
                  {adding ? "Done adding" : "Add panels"}
                </Button>
              }
            >
              {refusedPanel ? <Refusal className="border-b border-border px-3 py-2" action={`Can't remove Panel ${refusedPanel.n}`} reason={`used by ${plural(refusedPanel.runs.length, "run")}`} blockers={refusedPanel.runs.map((label) => ({ label }))} /> : null}
              <ul className="divide-y divide-separator">
                {panels.map((panel) => (
                  <li
                    key={panel.id}
                    className={`flex items-center gap-2 px-3 py-1.5 text-sm ${dropOn === panel.id ? "bg-info/12" : ""}`}
                    onDragOver={(e) => panel.include && dragOver(e, () => setDropOn(panel.id))}
                    onDragLeave={() => setDropOn(null)}
                    onDrop={(e) => {
                      if (!panel.include) return
                      drop(e, (sessionId) => assign(sessionId, panel.id))
                      setDropOn(null)
                    }}
                  >
                    <Checkbox id={`${panel.id}-inc`} checked={panel.include} onCheckedChange={() => toggle(panel.id)} />
                    <Label htmlFor={`${panel.id}-inc`} className="w-16 font-medium">
                      Panel {panel.n}
                    </Label>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
                      {formatRa(panel.ra)} {formatDec(panel.dec)}
                    </span>
                    {panelRuns(panel.id).length > 0 ? <Pill tone="muted">In a run</Pill> : null}
                    <CountBadge count={countOn(panel.id)} tone={countOn(panel.id) > 0 ? "info" : "muted"} label={plural(countOn(panel.id), "session")} />
                    <Button size="icon-sm" variant="ghost" aria-label={`Remove Panel ${panel.n}`} onClick={() => removePanel(panel)}>
                      <X aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            </Box>
          ) : null}
        </div>
        <Box
          title="Sessions"
          id="mosaic-sessions"
          flush
          className="min-h-0 self-start"
          actions={
            rows.length > 0 ? (
              <span className="flex items-center gap-1">
                <Pill tone="success">{placed.length} placed</Pill>
                {flagged.length > 0 ? <Pill tone="warning">{flagged.length} flagged</Pill> : null}
                {out > 0 ? <Pill tone="muted">{out} out</Pill> : null}
              </span>
            ) : null
          }
        >
          {rows.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{targetId || pick ? `No sessions on ${rig ? rigName(catalog, rigId) : "this rig"}` : "Pick a Target"}</p>
          ) : (
            <ContextMenuArea menu={menu}>
              <ul className="divide-y divide-separator" aria-label="Sessions to place">
                {[...rows]
                  .sort((a, b) => Number(b.placement.flag !== null) - Number(a.placement.flag !== null) || a.session.night.localeCompare(b.session.night))
                  .map((row) => (
                    <SessionItem key={row.session.id} row={row} panels={included} onAssign={(panelId) => assign(row.session.id, panelId)} />
                  ))}
              </ul>
            </ContextMenuArea>
          )}
        </Box>
      </div>
    </div>
  )
}

function dragOver(event: DragEvent, mark: () => void) {
  if (!event.dataTransfer.types.includes("application/x-pv-session")) return
  event.preventDefault()
  event.dataTransfer.dropEffect = "move"
  mark()
}

function drop(event: DragEvent, place: (sessionId: string) => void) {
  const id = event.dataTransfer.getData("application/x-pv-session")
  if (!id) return
  event.preventDefault()
  place(id)
}

function LayoutButtons({ onPick }: { onPick: (cols: number, rows: number) => void }) {
  return (
    <span role="group" aria-label="Layout" className="flex items-center gap-1">
      {LAYOUTS.map(([c, r]) => (
        <Button key={`${c}x${r}`} size="xs" variant="ghost" className="tabular-nums" onClick={() => onPick(c, r)}>
          {c}×{r}
        </Button>
      ))}
    </span>
  )
}

const PLACE_AUTO = "auto"
const PLACE_OUT = "out"

function SessionItem({ row, panels, onAssign }: { row: SessionRow; panels: PanelState[]; onAssign: (panelId: string | null | "auto") => void }) {
  const { session, placement } = row
  const panel = panels.find((p) => p.id === placement.panelId)
  const value = !placement.byUser ? PLACE_AUTO : placement.panelId ?? PLACE_OUT
  const label = `${formatNight(session.night)} · ${session.channel ?? "No filter"}`
  const options = [{ value: PLACE_AUTO, label: "By pointing" }, ...panels.map((p) => ({ value: p.id, label: `Panel ${p.n}` })), { value: PLACE_OUT, label: "Leave out" }]
  return (
    <li
      {...menuKey(session.id)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-pv-session", session.id)
        e.dataTransfer.effectAllowed = "move"
      }}
      className="flex items-center gap-2 px-2 py-1.5 text-sm"
    >
      <GripVertical aria-hidden="true" className="size-3.5 shrink-0 cursor-grab text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <span className="block truncate font-medium tabular-nums">{label}</span>
        <span className="flex items-center gap-1">
          {placement.flag ? (
            <Pill tone="warning" title={placement.detail}>
              {placement.flag === "ambiguous" ? "Ambiguous" : placement.flag === "off-panel" ? "Off panel" : PANEL_FLAG_LABEL[placement.flag]}
            </Pill>
          ) : panel ? (
            <Pill tone={placement.byUser ? "info" : "success"} title={placement.detail}>
              Panel {panel.n}
            </Pill>
          ) : (
            <Pill tone="muted" title={placement.detail}>
              {placement.panelId ? "Excluded panel" : "Left out"}
            </Pill>
          )}
          <span className="text-xs text-muted-foreground tabular-nums">{plural(row.frames, "frame")}</span>
        </span>
      </div>
      <Select items={options} value={value} onValueChange={(next) => onAssign(next === PLACE_AUTO ? "auto" : next === PLACE_OUT ? null : String(next))}>
        <SelectTrigger size="sm" aria-label={`Panel for ${label}`} className="w-28">
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
    </li>
  )
}

/** The field: panels and free slots on the tangent plane around the mosaic centre (north up, east left), in hundredths of a degree. */
function FieldView({
  panels,
  slots,
  field,
  rows,
  dropOn,
  setDropOn,
  onToggle,
  onAdd,
  onDrop,
}: {
  panels: PanelState[]
  slots: ReturnType<typeof freeSlots>
  field: { widthDeg: number; heightDeg: number }
  rows: SessionRow[]
  dropOn: string | null
  setDropOn: (id: string | null) => void
  onToggle: (panelId: string) => void
  onAdd: (ra: number, dec: number) => void
  onDrop: (sessionId: string, panelId: string) => void
}) {
  const ra0 = panels.reduce((n, p) => n + p.ra, 0) / panels.length
  const dec0 = panels.reduce((n, p) => n + p.dec, 0) / panels.length
  const project = (ra: number, dec: number) => {
    let d = ra - ra0
    if (d > 180) d -= 360
    if (d < -180) d += 360
    return { x: -d * cosDec(dec0) * 100, y: -(dec - dec0) * 100 }
  }
  const w = field.widthDeg * 100
  const h = field.heightDeg * 100
  const points = [...panels, ...slots].map((p) => project(p.ra, p.dec))
  const minX = Math.min(...points.map((p) => p.x)) - w * 0.6
  const maxX = Math.max(...points.map((p) => p.x)) + w * 0.6
  const minY = Math.min(...points.map((p) => p.y)) - h * 0.6
  const maxY = Math.max(...points.map((p) => p.y)) + h * 0.6
  const unit = Math.max(maxX - minX, maxY - minY) / 100
  const key = (event: KeyboardEvent, act: () => void) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      act()
    }
  }
  return (
    <svg viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} className="h-80 w-full rounded-md bg-muted/40" role="group" aria-label="Mosaic field: click a panel to include or exclude it">
      {slots.map((s) => {
        const c = project(s.ra, s.dec)
        return (
          <g
            key={s.key}
            role="button"
            tabIndex={0}
            aria-label={`Add panel ${s.side} of Panel ${s.beside}`}
            className="cursor-pointer opacity-40 outline-none hover:opacity-90 focus-visible:opacity-100"
            onClick={() => onAdd(s.ra, s.dec)}
            onKeyDown={(e) => key(e, () => onAdd(s.ra, s.dec))}
          >
            <rect x={c.x - w / 2} y={c.y - h / 2} width={w} height={h} className="fill-transparent stroke-muted-foreground" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            <text x={c.x} y={c.y} textAnchor="middle" dominantBaseline="central" fontSize={unit * 8} className="fill-muted-foreground">
              +
            </text>
          </g>
        )
      })}
      {panels.map((p) => {
        const c = project(p.ra, p.dec)
        const over = dropOn === p.id
        return (
          <g
            key={p.id}
            role="checkbox"
            aria-checked={p.include}
            aria-label={`Panel ${p.n}`}
            tabIndex={0}
            transform={`rotate(${-p.rotationDeg} ${c.x} ${c.y})`}
            className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-ring"
            onClick={() => onToggle(p.id)}
            onKeyDown={(e) => key(e, () => onToggle(p.id))}
            onDragOver={(e) => p.include && dragOver(e, () => setDropOn(p.id))}
            onDragLeave={() => setDropOn(null)}
            onDrop={(e) => {
              if (p.include) drop(e, (sessionId) => onDrop(sessionId, p.id))
              setDropOn(null)
            }}
          >
            <rect
              x={c.x - w / 2}
              y={c.y - h / 2}
              width={w}
              height={h}
              strokeWidth={over ? 3 : 1.5}
              strokeDasharray={p.include ? undefined : "6 4"}
              vectorEffect="non-scaling-stroke"
              className={p.include ? (over ? "fill-info/25 stroke-info" : "fill-info/10 stroke-info") : "fill-transparent stroke-muted-foreground"}
            />
            <text x={c.x - w / 2 + unit * 2} y={c.y - h / 2 + unit * 6} fontSize={unit * 4.5} className={p.include ? "fill-foreground font-semibold" : "fill-muted-foreground"}>
              {p.n}
              {p.include ? "" : " · excluded"}
            </text>
          </g>
        )
      })}
      {rows.map((r) => {
        if (!r.session.pointing) return null
        const c = project(r.session.pointing.ra, r.session.pointing.dec)
        if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) return null
        const tone = r.placement.flag ? "fill-warning" : r.placement.panelId && panels.some((p) => p.id === r.placement.panelId && p.include) ? "fill-success" : "fill-muted-foreground"
        return <circle key={r.session.id} cx={c.x} cy={c.y} r={unit * 1.2} className={`${tone} pointer-events-none stroke-background`} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      })}
    </svg>
  )
}
