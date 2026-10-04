/**
 * Session filters for the View workspace (VSEL-FR-05, C4). Filters change the
 * candidate list only: never the selected session ids, the session
 * definitions, measurement work or quality (VSEL-FR-06, PIX-AC-06).
 */
import { SlidersHorizontal } from "lucide-react"
import { useId } from "react"
import { type FilterChip } from "@/components/app/data"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { AssetAvailability, QualityBreakdown } from "@/domain/derive"
import type { Session } from "@/domain/types"
import { formatExposure, formatNight } from "@/lib/format"
import type { AvailabilityFilter, QualityFilter, SessionFilters } from "@/store/slices/t3"
import { NumberField, type Option, SelectField } from "./fields"
import { sessionExposureS } from "./model"

/** What a filter needs to know about one candidate row. */
export interface FilterableRow {
  session: Session
  trainId: string | null
  trainName: string | null
  locationIds: string[]
  availability: AssetAvailability
  breakdown: QualityBreakdown
}

const QUALITY_LABEL: Record<QualityFilter, string> = {
  unreviewed: "Unreviewed",
  usable: "Usable",
  unusable: "Unusable",
  "changed-content": "Changed content",
}

const AVAILABILITY_LABEL: Record<AvailabilityFilter, string> = {
  available: "Available",
  offline: "Offline",
  unreadable: "Unreadable",
  absent: "Not found",
}

export function matchesFilters(row: FilterableRow, f: SessionFilters): boolean {
  const s = row.session
  if (f.object && !(s.objectLabel ?? "").toLowerCase().includes(f.object.toLowerCase())) return false
  if (f.missingObject && s.objectLabel) return false
  if (f.channels.length > 0 && !f.channels.includes(s.channel ?? "")) return false
  if (f.night && s.night !== f.night) return false
  if (f.startedFrom && s.startedAt.slice(0, 10) < f.startedFrom) return false
  if (f.startedTo && s.startedAt.slice(0, 10) > f.startedTo) return false
  const exposureS = sessionExposureS(s)
  if (f.exposureMin !== null && exposureS < f.exposureMin) return false
  if (f.exposureMax !== null && exposureS > f.exposureMax) return false
  if (f.equipment && (f.equipment === "unknown" ? row.trainId !== null : row.trainId !== f.equipment)) return false
  if (f.quality) {
    const b = row.breakdown
    const count = { unreviewed: b.unreviewed, usable: b.usable, unusable: b.unusable, "changed-content": b.changedContent }[f.quality].frames
    if (count === 0) return false
  }
  if (f.locationId && !row.locationIds.includes(f.locationId)) return false
  if (f.availability && row.availability !== f.availability) return false
  if (f.targetId && s.target.value !== f.targetId) return false
  if (f.camera && s.cameraName !== f.camera) return false
  if (f.gain !== null && s.gain !== f.gain) return false
  if (f.offset !== null && s.offset !== f.offset) return false
  if (f.binning !== null && s.binning !== f.binning) return false
  if (f.tempMin !== null && (s.ccdTempC === null || s.ccdTempC < f.tempMin)) return false
  if (f.tempMax !== null && (s.ccdTempC === null || s.ccdTempC > f.tempMax)) return false
  return true
}

export interface FilterLookups {
  trainName: (id: string) => string
  locationName: (id: string) => string
  targetName: (id: string) => string
}

/** One chip per active filter; removing a chip clears only that filter. */
export function filterChips(f: SessionFilters, names: FilterLookups): Array<FilterChip & { clear: Partial<SessionFilters> }> {
  const chips: Array<FilterChip & { clear: Partial<SessionFilters> }> = []
  const push = (id: string, label: string, clear: Partial<SessionFilters>) => chips.push({ id, label, clear })
  if (f.object) push("object", `OBJECT contains “${f.object}”`, { object: "" })
  if (f.missingObject) push("missing", "Missing OBJECT", { missingObject: false })
  for (const channel of f.channels) push(`ch-${channel}`, `Channel ${channel}`, { channels: f.channels.filter((c) => c !== channel) })
  if (f.night) push("night", `Night ${formatNight(f.night)}`, { night: null })
  if (f.startedFrom) push("from", `Started from ${f.startedFrom}`, { startedFrom: null })
  if (f.startedTo) push("to", `Started to ${f.startedTo}`, { startedTo: null })
  if (f.exposureMin !== null) push("expmin", `Exposure ≥ ${formatExposure(f.exposureMin)}`, { exposureMin: null })
  if (f.exposureMax !== null) push("expmax", `Exposure ≤ ${formatExposure(f.exposureMax)}`, { exposureMax: null })
  if (f.equipment) push("equipment", `Equipment ${f.equipment === "unknown" ? "unknown" : names.trainName(f.equipment)}`, { equipment: null })
  if (f.quality) push("quality", `Quality ${QUALITY_LABEL[f.quality]}`, { quality: null })
  if (f.locationId) push("location", `Location ${names.locationName(f.locationId)}`, { locationId: null })
  if (f.availability) push("availability", `Availability ${AVAILABILITY_LABEL[f.availability]}`, { availability: null })
  if (f.targetId) push("target", `Target ${names.targetName(f.targetId)}`, { targetId: null })
  if (f.camera) push("camera", `Camera ${f.camera}`, { camera: null })
  if (f.gain !== null) push("gain", `Gain ${f.gain}`, { gain: null })
  if (f.offset !== null) push("offset", `Offset ${f.offset}`, { offset: null })
  if (f.binning !== null) push("binning", `Binning ${f.binning}`, { binning: null })
  if (f.tempMin !== null) push("tmin", `Temperature ≥ ${f.tempMin} °C`, { tempMin: null })
  if (f.tempMax !== null) push("tmax", `Temperature ≤ ${f.tempMax} °C`, { tempMax: null })
  if (f.selectedOnly) push("selected", "Selected sessions only", { selectedOnly: false })
  return chips
}

const unique = <T,>(values: T[]) => [...new Set(values)]

function options<T extends string | number>(values: T[], label: (v: T) => string = String): Option[] {
  return [{ value: "any", label: "Any" }, ...unique(values).sort().map((v) => ({ value: String(v), label: label(v) }))]
}

export function FiltersPopover({
  rows,
  filters,
  onChange,
  names,
  activeCount,
}: {
  rows: FilterableRow[]
  filters: SessionFilters
  onChange: (patch: Partial<SessionFilters>) => void
  names: FilterLookups
  activeCount: number
}) {
  const missingId = useId()
  const fromId = useId()
  const toId = useId()
  const sessions = rows.map((r) => r.session)
  const channels = unique(sessions.map((s) => s.channel).filter((c): c is string => c !== null)).sort()
  const anyOr = (value: string) => (value === "any" ? null : value)
  const numberOr = (value: string) => (value === "any" ? null : Number(value))
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <SlidersHorizontal aria-hidden="true" data-icon="inline-start" />
        Filters
        {activeCount > 0 ? <span className="tabular-nums text-muted-foreground">({activeCount})</span> : null}
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[min(36rem,calc(100dvh-8rem))] w-[34rem] max-w-[calc(100vw-2rem)] gap-4 overflow-y-auto p-4">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold">Filters</h3>
          <p className="text-xs text-muted-foreground">Filters change this list, never the selection. They start no measurement.</p>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Channel</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {channels.map((channel) => {
              const id = `channel-${channel}`
              return (
                <div key={channel} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={filters.channels.includes(channel)}
                    onCheckedChange={(checked) => onChange({ channels: checked ? [...filters.channels, channel] : filters.channels.filter((c) => c !== channel) })}
                  />
                  <Label htmlFor={id} className="font-normal">
                    {channel}
                  </Label>
                </div>
              )
            })}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Night"
            value={filters.night ?? "any"}
            onChange={(v) => onChange({ night: anyOr(v) })}
            options={options(sessions.map((s) => s.night), (n) => formatNight(n, true))}
          />
          <SelectField
            label="Quality state"
            value={filters.quality ?? "any"}
            onChange={(v) => onChange({ quality: anyOr(v) as QualityFilter | null })}
            description="Sessions with at least one frame in this state."
            options={[{ value: "any", label: "Any" }, ...(Object.keys(QUALITY_LABEL) as QualityFilter[]).map((q) => ({ value: q, label: QUALITY_LABEL[q] }))]}
          />
          <div className="grid gap-1.5">
            <Label htmlFor={fromId}>Started from</Label>
            <Input id={fromId} type="date" value={filters.startedFrom ?? ""} onChange={(e) => onChange({ startedFrom: e.target.value || null })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={toId}>Started to</Label>
            <Input id={toId} type="date" value={filters.startedTo ?? ""} onChange={(e) => onChange({ startedTo: e.target.value || null })} />
          </div>
          <NumberField label="Exposure from" unit="s" min={0} value={filters.exposureMin} onChange={(v) => onChange({ exposureMin: v })} />
          <NumberField label="Exposure to" unit="s" min={0} value={filters.exposureMax} onChange={(v) => onChange({ exposureMax: v })} />
          <SelectField
            label="Equipment"
            value={filters.equipment ?? "any"}
            onChange={(v) => onChange({ equipment: anyOr(v) })}
            options={[
              { value: "any", label: "Any" },
              ...unique(rows.map((r) => r.trainId).filter((id): id is string => id !== null)).map((id) => ({ value: id, label: names.trainName(id) })),
              { value: "unknown", label: "Unknown equipment" },
            ]}
          />
          <SelectField
            label="Location"
            value={filters.locationId ?? "any"}
            onChange={(v) => onChange({ locationId: anyOr(v) })}
            options={[{ value: "any", label: "Any" }, ...unique(rows.flatMap((r) => r.locationIds)).map((id) => ({ value: id, label: names.locationName(id) }))]}
          />
          <SelectField
            label="Availability"
            value={filters.availability ?? "any"}
            onChange={(v) => onChange({ availability: anyOr(v) as AvailabilityFilter | null })}
            options={[{ value: "any", label: "Any" }, ...(Object.keys(AVAILABILITY_LABEL) as AvailabilityFilter[]).map((a) => ({ value: a, label: AVAILABILITY_LABEL[a] }))]}
          />
          <div className="flex items-end gap-2 pb-1.5">
            <Checkbox id={missingId} checked={filters.missingObject} onCheckedChange={(checked) => onChange({ missingObject: checked })} />
            <Label htmlFor={missingId} className="font-normal">
              Missing OBJECT only
            </Label>
          </div>
        </div>
        <Collapsible className="space-y-3">
          <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="-ml-2" />}>More metadata: Target, camera, gain, offset, binning, temperature</CollapsibleTrigger>
          <CollapsibleContent className="grid grid-cols-2 gap-3">
            <SelectField
              label="Target"
              value={filters.targetId ?? "any"}
              onChange={(v) => onChange({ targetId: anyOr(v) })}
              options={[{ value: "any", label: "Any" }, ...unique(sessions.map((s) => s.target.value).filter((id): id is string => id !== null)).map((id) => ({ value: id, label: names.targetName(id) }))]}
            />
            <SelectField
              label="Camera"
              value={filters.camera ?? "any"}
              onChange={(v) => onChange({ camera: anyOr(v) })}
              options={options(sessions.map((s) => s.cameraName).filter((c): c is string => c !== null))}
            />
            <SelectField label="Gain" value={filters.gain === null ? "any" : String(filters.gain)} onChange={(v) => onChange({ gain: numberOr(v) })} options={options(sessions.map((s) => s.gain).filter((g): g is number => g !== null))} />
            <SelectField
              label="Offset"
              value={filters.offset === null ? "any" : String(filters.offset)}
              onChange={(v) => onChange({ offset: numberOr(v) })}
              options={options(sessions.map((s) => s.offset).filter((o): o is number => o !== null))}
            />
            <SelectField label="Binning" value={filters.binning === null ? "any" : String(filters.binning)} onChange={(v) => onChange({ binning: numberOr(v) })} options={options(sessions.map((s) => s.binning))} />
            <div />
            <NumberField label="Temperature from" unit="°C" step={0.5} value={filters.tempMin} onChange={(v) => onChange({ tempMin: v })} />
            <NumberField label="Temperature to" unit="°C" step={0.5} value={filters.tempMax} onChange={(v) => onChange({ tempMax: v })} />
          </CollapsibleContent>
        </Collapsible>
      </PopoverContent>
    </Popover>
  )
}
