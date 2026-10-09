/**
 * Slice B UI parts shared by the Project screens and sheets: the subject
 * search (My targets, the bundled catalogues and SIMBAD, D-W17), the mosaic
 * panel editor (centre and rotation, D-W38, D-W73) and the inline commit
 * error. The Project state is the shared `StatusBadge kind="project"`; a
 * run's six-step rail is `StepRail` in `src/app/run-ui.tsx`.
 */
import { Loader, Search } from "lucide-react"
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react"
import { ActionError, Notice } from "@/components/app/feedback"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { myTargets } from "@/domain/derive"
import { BUNDLED_CATALOGUE, type CatalogueEntry, type FieldOfView, matchesQuery, normalizeName, SIMBAD_FIXTURE } from "@/domain/sky"
import type { Catalog, TargetId } from "@/domain/types"
import { formatDec, formatDegrees, formatRa } from "@/lib/format"
import type { CommitResult } from "@/store/core"
import { store, useStore } from "@/store/core"

// ---------------------------------------------------------------------------
// Commit errors beside the control
// ---------------------------------------------------------------------------

/** Runs a store action and keeps its refusal or failure next to the control (D08). */
export function useCommitError() {
  const [error, setError] = useState<string | null>(null)
  function run(action: () => CommitResult): boolean {
    const result = action()
    setError(result.ok ? null : result.message)
    return result.ok
  }
  return { error, setError, run }
}

export function InlineError({ message, className }: { message: string | null; className?: string }) {
  return message ? <ActionError message={message} className={className} /> : null
}

// ---------------------------------------------------------------------------
// Subject search: My targets, catalogues and SIMBAD (D-W17)
// ---------------------------------------------------------------------------

const LOOKUP_MS = 600

/** A subject the user picked: an existing Target, or a catalogue or resolver entry that becomes a Target record on save. */
export type SubjectPick =
  | { kind: "target"; targetId: TargetId; name: string; ra: number | null; dec: number | null; size: { width: number; height: number } | null }
  | { kind: "new"; entry: CatalogueEntry; resolver: string | null; name: string; ra: number; dec: number; size: { width: number; height: number } | null }

function matches(query: string, name: string, aliases: string[]): boolean {
  return matchesQuery([name, ...aliases], query)
}

function fromEntry(entry: CatalogueEntry, resolver: string | null): SubjectPick {
  return { kind: "new", entry, resolver, name: entry.designation, ra: entry.ra, dec: entry.dec, size: entry.sizeDeg }
}

interface ResultRow {
  key: string
  pick: SubjectPick
  aliases: string[]
  type: string | null
}

type LookupState = { query: string; status: "running" } | { query: string; status: "done"; rows: ResultRow[] } | { query: string; status: "off" | "failed"; message: string } | null

/**
 * Search across My targets, the bundled catalogues and, on request, SIMBAD.
 * The list is a group of buttons, each naming what it adds. `taken` names
 * subjects already chosen; they read "Added".
 */
export function SubjectSearch({ taken, onPick, autoFocus = false }: { taken: string[]; onPick: (pick: SubjectPick) => void; autoFocus?: boolean }) {
  const catalog = useStore((s) => s.catalog)
  const lookup = useStore((s) => s.settings.targetLookup)
  const [query, setQuery] = useState("")
  const [simbad, setSimbad] = useState<LookupState>(null)
  const timer = useRef<number | null>(null)
  const inputId = useId()
  const hintId = useId()
  useEffect(() => () => window.clearTimeout(timer.current ?? undefined), [])

  const groups = useMemo(() => localResults(catalog, query), [catalog, query])
  const providerName = lookup.provider === "simbad" ? "SIMBAD" : "CDS Sesame (SIMBAD)"

  function searchSimbad() {
    const text = query.trim()
    if (!text || simbad?.status === "running") return
    if (!lookup.enabled) {
      setSimbad({ query: text, status: "off", message: "Online lookup is off in Settings › Target lookup, so nothing was sent. My targets and the catalogues still search offline." })
      return
    }
    setSimbad({ query: text, status: "running" })
    timer.current = window.setTimeout(() => {
      const state = store.getState()
      if (state.faults.failNextResolverLookup) {
        store.setState((s) => ({ ...s, faults: { ...s.faults, failNextResolverLookup: false } }))
        setSimbad({ query: text, status: "failed", message: `${providerName} did not respond: the lookup failed as if offline. Nothing was added; My targets and the catalogues still work.` })
        return
      }
      const known = new Set(groups.flatMap((g) => g.rows.map((r) => normalizeName(r.pick.name))))
      const rows = SIMBAD_FIXTURE.filter((o) => matches(text, o.designation, o.aliases) && !known.has(normalizeName(o.designation))).map(
        (o): ResultRow => ({ key: `simbad:${o.designation}`, pick: fromEntry(o, providerName), aliases: o.aliases, type: o.objectType }),
      )
      setSimbad({ query: text, status: "done", rows })
    }, LOOKUP_MS)
  }

  const simbadCurrent = simbad && simbad.query === query.trim() ? simbad : null
  const shown = query.trim() !== ""

  return (
    <div className="space-y-2">
      <div className="grid gap-1.5">
        <Label htmlFor={inputId}>Search targets</Label>
        <div className="flex gap-2">
          <Input
            id={inputId}
            value={query}
            autoFocus={autoFocus}
            aria-describedby={hintId}
            placeholder="Name, alias or catalogue number, e.g. IC 1396"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                searchSimbad()
              }
            }}
          />
          <Button variant="outline" onClick={searchSimbad} disabled={!shown} aria-busy={simbadCurrent?.status === "running" || undefined}>
            {simbadCurrent?.status === "running" ? <Loader aria-hidden="true" className="motion-safe:animate-spin" data-icon="inline-start" /> : <Search aria-hidden="true" data-icon="inline-start" />}
            Search SIMBAD
          </Button>
        </div>
        <p id={hintId} className="text-xs text-muted-foreground">
          My targets and the bundled catalogues match as you type. Enter or Search SIMBAD asks {providerName}.
        </p>
      </div>
      {shown ? (
        <div className="max-h-72 overflow-y-auto rounded-md border" role="group" aria-label="Search results">
          {groups.map((group) => (
            <ResultGroup key={group.title} title={group.title} rows={group.rows} taken={taken} onPick={onPick} />
          ))}
          {simbadCurrent?.status === "done" ? <ResultGroup title={`SIMBAD (${providerName})`} rows={simbadCurrent.rows} taken={taken} onPick={onPick} empty={`${providerName} returned nothing new for “${simbadCurrent.query}”.`} /> : null}
          {groups.every((g) => g.rows.length === 0) && !simbadCurrent ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Nothing in My targets or the catalogues matches. Press Enter to search SIMBAD.</p>
          ) : null}
          {simbadCurrent?.status === "running" ? (
            <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
              Asking {providerName}…
            </p>
          ) : null}
        </div>
      ) : null}
      {simbadCurrent && (simbadCurrent.status === "off" || simbadCurrent.status === "failed") ? (
        <Notice tone={simbadCurrent.status === "failed" ? "offline" : "info"} title={simbadCurrent.status === "failed" ? "SIMBAD lookup failed" : "Online lookup is off"}>
          {simbadCurrent.message}
        </Notice>
      ) : null}
    </div>
  )
}

function localResults(catalog: Catalog, query: string): Array<{ title: string; rows: ResultRow[] }> {
  if (!query.trim()) return []
  const mine = myTargets(catalog)
  const mineIds = new Set(mine.map((m) => m.target.id))
  const myRows = mine
    .filter(({ target }) => matches(query, target.name, target.aliases))
    .map(({ target, projects }): ResultRow => ({
      key: target.id,
      pick: { kind: "target", targetId: target.id, name: target.name, ra: target.ra, dec: target.dec, size: target.sizeDeg },
      aliases: target.aliases,
      type: projects.length > 0 ? `Subject of ${projects.map((p) => p.name).join(", ")}` : "★ Favourite",
    }))
  const byName = new Map(Object.values(catalog.targets).map((t) => [t.name, t]))
  const catalogueRows = BUNDLED_CATALOGUE.filter((o) => matches(query, o.designation, o.aliases) && !(byName.get(o.designation) && mineIds.has(byName.get(o.designation)!.id))).map((o): ResultRow => {
    const record = byName.get(o.designation)
    return {
      key: `sky:${o.designation}`,
      pick: record ? { kind: "target", targetId: record.id, name: record.name, ra: record.ra, dec: record.dec, size: record.sizeDeg } : fromEntry(o, null),
      aliases: o.aliases,
      type: o.objectType,
    }
  })
  // Target records outside My targets and the bundled list (for example created by indexing).
  const otherRows = Object.values(catalog.targets)
    .filter((t) => !mineIds.has(t.id) && !BUNDLED_CATALOGUE.some((o) => o.designation === t.name) && matches(query, t.name, t.aliases))
    .map((t): ResultRow => ({ key: t.id, pick: { kind: "target", targetId: t.id, name: t.name, ra: t.ra, dec: t.dec, size: t.sizeDeg }, aliases: t.aliases, type: "Library Target" }))
  return [
    { title: "My targets", rows: myRows },
    { title: "Catalogues", rows: [...catalogueRows, ...otherRows] },
  ]
}

function ResultGroup({ title, rows, taken, onPick, empty }: { title: string; rows: ResultRow[]; taken: string[]; onPick: (pick: SubjectPick) => void; empty?: string }) {
  if (rows.length === 0 && !empty) return null
  return (
    <div className="border-b last:border-0">
      <p className="bg-chrome px-3 py-1 text-[0.6875rem] font-semibold text-muted-foreground" data-chrome>
        {title}
      </p>
      {rows.length === 0 ? <p className="px-3 py-1.5 text-sm text-muted-foreground">{empty}</p> : null}
      <ul>
        {rows.map((row) => {
          const added = taken.includes(row.pick.name)
          return (
            <li key={row.key} className="flex min-h-(--row-h) items-center gap-3 px-3 py-1 text-sm odd:bg-foreground/[0.02]">
              <div className="min-w-0 flex-1">
                <span className="font-medium">{row.pick.name}</span>
                {row.aliases[0] ? <span className="ml-2 text-muted-foreground">{row.aliases[0]}</span> : null}
                <span className="block text-xs text-muted-foreground tabular-nums">
                  {row.type ? `${row.type} · ` : ""}
                  {row.pick.ra !== null && row.pick.dec !== null ? `${formatRa(row.pick.ra)} ${formatDec(row.pick.dec)}` : "Position unknown"}
                  {row.pick.kind === "new" ? (row.pick.resolver ? ` · new Target from ${row.pick.resolver}` : " · new Target from the catalogue") : ""}
                </span>
              </div>
              <Button size="sm" variant="outline" disabled={added} onClick={() => onPick(row.pick)}>
                {added ? "Added" : "Add"}
                <span className="sr-only"> {row.pick.name}</span>
              </Button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mosaic panels: centre and rotation (D-W38, D-W73)
// ---------------------------------------------------------------------------

export interface PanelDraft {
  id: string
  ra: number
  dec: number
  rotationDeg: number
}

export interface MosaicDraft {
  name: string
  centre: { ra: number; dec: number }
  panels: PanelDraft[]
}

let panelCounter = 0
export function panelId(): string {
  panelCounter += 1
  return `pnl_${Date.now().toString(36)}_${panelCounter}`
}

/** A cols × rows grid of panels around the centre, overlapping 10% on the rig's field (or the Target's size). */
export function layoutPanels(centre: { ra: number; dec: number }, cols: number, rows: number, fov: FieldOfView | null, size: { width: number; height: number } | null): PanelDraft[] {
  const width = fov ? fov.widthDeg * 0.9 : (size?.width ?? 1) / cols
  const height = fov ? fov.heightDeg * 0.9 : (size?.height ?? 1) / rows
  const cos = Math.max(0.1, Math.cos((centre.dec * Math.PI) / 180))
  const out: PanelDraft[] = []
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const ra = (centre.ra + ((c - (cols - 1) / 2) * width) / cos + 360) % 360
      out.push({ id: panelId(), ra: Number(ra.toFixed(3)), dec: Number((centre.dec + (r - (rows - 1) / 2) * height).toFixed(3)), rotationDeg: 0 })
    }
  }
  return out
}

const LAYOUTS: Array<[number, number]> = [
  [2, 1],
  [3, 1],
  [2, 2],
  [3, 2],
]

/** Explicit panels by centre and rotation, each editable; the run group ties one panel run to each (D-W73). */
export function PanelsEditor({ mosaic, onChange, fov, size, fovLabel }: { mosaic: MosaicDraft; onChange: (next: MosaicDraft) => void; fov: FieldOfView | null; size: { width: number; height: number } | null; fovLabel: string }) {
  const nameId = useId()
  const update = (index: number, patch: Partial<PanelDraft>) => onChange({ ...mosaic, panels: mosaic.panels.map((p, i) => (i === index ? { ...p, ...patch } : p)) })
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="grid gap-1.5">
        <Label htmlFor={nameId}>Mosaic name</Label>
        <Input id={nameId} value={mosaic.name} onChange={(event) => onChange({ ...mosaic, name: event.target.value })} />
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        Centre {formatRa(mosaic.centre.ra)} {formatDec(mosaic.centre.dec)}. Tonight&apos;s windows use this centre (D-W63). Layouts use {fovLabel}.
      </p>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Lay out panels">
        <span className="text-xs text-muted-foreground">Lay out</span>
        {LAYOUTS.map(([cols, rows]) => (
          <Button key={`${cols}x${rows}`} size="sm" variant="outline" onClick={() => onChange({ ...mosaic, panels: layoutPanels(mosaic.centre, cols, rows, fov, size) })}>
            {cols} × {rows}
          </Button>
        ))}
      </div>
      {mosaic.panels.length === 0 ? <p className="text-sm text-muted-foreground">No panels yet. Choose a layout or add a panel; a mosaic needs two or more.</p> : null}
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Panels of {mosaic.name || "the mosaic"}</caption>
        <thead className="text-[0.6875rem] text-muted-foreground" data-chrome>
          <tr className="border-b">
            <th scope="col" className="py-1 pr-2 text-left font-medium">
              Panel
            </th>
            <th scope="col" className="py-1 pr-2 text-left font-medium">
              RA (°)
            </th>
            <th scope="col" className="py-1 pr-2 text-left font-medium">
              Dec (°)
            </th>
            <th scope="col" className="py-1 pr-2 text-left font-medium">
              Rotation (°)
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {mosaic.panels.map((panel, index) => (
            <tr key={panel.id} className="border-b last:border-0">
              <th scope="row" className="py-1 pr-2 text-left font-medium whitespace-nowrap" title={`${formatRa(panel.ra)} ${formatDec(panel.dec)} · ${formatDegrees(panel.rotationDeg, 0)}`}>
                Panel {index + 1}
              </th>
              <td className="py-1 pr-2">
                <NumberCell label={`Panel ${index + 1} RA in degrees`} value={panel.ra} onChange={(ra) => update(index, { ra })} />
              </td>
              <td className="py-1 pr-2">
                <NumberCell label={`Panel ${index + 1} Dec in degrees`} value={panel.dec} onChange={(dec) => update(index, { dec })} />
              </td>
              <td className="py-1 pr-2">
                <NumberCell label={`Panel ${index + 1} rotation in degrees`} value={panel.rotationDeg} onChange={(rotationDeg) => update(index, { rotationDeg })} />
              </td>
              <td className="py-1 text-right">
                <Button size="sm" variant="ghost" onClick={() => onChange({ ...mosaic, panels: mosaic.panels.filter((_, i) => i !== index) })}>
                  Remove<span className="sr-only"> panel {index + 1}</span>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          const last = mosaic.panels.at(-1)
          const step = fov ? fov.widthDeg * 0.9 : 0.5
          const base = last ?? { ra: mosaic.centre.ra, dec: mosaic.centre.dec, rotationDeg: 0 }
          onChange({ ...mosaic, panels: [...mosaic.panels, { id: panelId(), ra: last ? Number(((base.ra + step / Math.max(0.1, Math.cos((base.dec * Math.PI) / 180))) % 360).toFixed(3)) : base.ra, dec: base.dec, rotationDeg: base.rotationDeg }] })
        }}
      >
        Add panel
      </Button>
    </div>
  )
}

function NumberCell({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <Input
      aria-label={label}
      type="number"
      step="0.01"
      inputMode="decimal"
      className="h-6 w-20 tabular-nums"
      value={text}
      onChange={(event) => {
        setText(event.target.value)
        const next = Number(event.target.value)
        if (event.target.value !== "" && Number.isFinite(next)) onChange(next)
      }}
    />
  )
}

/** A labelled group of controls inside a sheet, with hairline separators instead of cards. */
export function SheetSection({ title, description, children, actions, id }: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode; id?: string }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} id={id} className="space-y-2 border-t border-separator px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="text-sm font-semibold">
            {title}
          </h3>
          {description ? <p className="mt-0.5 text-[0.75rem] text-pretty text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-1.5">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}
