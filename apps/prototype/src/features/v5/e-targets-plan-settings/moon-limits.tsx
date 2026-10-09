/**
 * Moon limits per filter (slice E: Plan and the Targets good-tonight
 * filter): each band's minimum Moon separation and maximum illumination,
 * the constraint behind "good tonight". Writes go through the foundation's
 * `setMoonConstraint` when a field is left or Enter is pressed; a failed
 * write keeps its message beside the fields.
 */
import { MoonStar } from "lucide-react"
import { type KeyboardEvent, useId, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionError } from "@/components/app/feedback"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DEFAULT_MOON_CONSTRAINTS } from "@/domain/labels"
import type { Band, MoonConstraint } from "@/domain/types"
import { setMoonConstraint } from "@/store/actions/settings"
import { useStore } from "@/store/core"
import { BAND_ORDER } from "./good-tonight"

type Field = keyof MoonConstraint

const FIELD: Record<Field, { unit: string; max: number }> = {
  minSeparationDeg: { unit: "°", max: 180 },
  maxIlluminationPct: { unit: "%", max: 100 },
}

function LimitInput({ band, field, value, onError }: { band: Band; field: Field; value: number; onError: (message: string | null) => void }) {
  const m = useMessages()
  const [draft, setDraft] = useState<string | null>(null)
  const meta = FIELD[field]
  function commitDraft() {
    if (draft === null) return
    const parsed = Number.parseInt(draft, 10)
    setDraft(null)
    if (!Number.isFinite(parsed) || parsed === value) return
    const result = setMoonConstraint(band, field === "minSeparationDeg" ? { minSeparationDeg: parsed } : { maxIlluminationPct: parsed })
    onError(result.ok ? null : result.message)
  }
  return (
    <span className="inline-flex items-center gap-0.5">
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={meta.max}
        aria-label={field === "minSeparationDeg" ? m.tonight_limit_separation_field({ band }) : m.tonight_limit_illumination_field({ band })}
        value={draft ?? String(value)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") commitDraft()
          if (event.key === "Escape" && draft !== null) {
            event.stopPropagation()
            setDraft(null)
          }
        }}
        className="h-6 w-14 px-1.5 text-right text-xs tabular-nums"
      />
      <span aria-hidden="true" className="w-3 text-xs text-muted-foreground">
        {meta.unit}
      </span>
    </span>
  )
}

/** The editor: one row per band, Moon ≥ separation and lit ≤ illumination. */
export function MoonLimits({ bands }: { bands: Band[] }) {
  const m = useMessages()
  const constraints = useStore((s) => s.settings.moonConstraints)
  const [error, setError] = useState<string | null>(null)
  const headingId = useId()
  const ordered = [...bands].sort((a, b) => BAND_ORDER.indexOf(a) - BAND_ORDER.indexOf(b))
  const changed = ordered.filter((b) => constraints[b].minSeparationDeg !== DEFAULT_MOON_CONSTRAINTS[b].minSeparationDeg || constraints[b].maxIlluminationPct !== DEFAULT_MOON_CONSTRAINTS[b].maxIlluminationPct)
  return (
    <div className="space-y-2" role="group" aria-labelledby={headingId}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="text-xs font-semibold text-muted-foreground">
          {m.tonight_moon_limits()}
        </h3>
        {changed.length > 0 ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              for (const band of changed) {
                const result = setMoonConstraint(band, DEFAULT_MOON_CONSTRAINTS[band])
                if (!result.ok) return setError(result.message)
              }
              setError(null)
            }}
          >
            {m.tonight_reset()}
          </Button>
        ) : null}
      </div>
      <table className="w-full text-xs">
        <thead className="text-[0.6875rem] text-muted-foreground">
          <tr>
            <th scope="col" className="pb-1 text-left font-medium">
              {m.tonight_filter()}
            </th>
            <th scope="col" className="pb-1 text-right font-medium">
              {m.tonight_limit_separation_header()}
            </th>
            <th scope="col" className="pb-1 text-right font-medium">
              {m.tonight_limit_illumination_header()}
            </th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((band) => (
            <tr key={band}>
              <th scope="row" className="py-0.5 text-left font-medium">
                {band}
              </th>
              <td className="py-0.5 text-right">
                <LimitInput band={band} field="minSeparationDeg" value={constraints[band].minSeparationDeg} onError={setError} />
              </td>
              <td className="py-0.5 text-right">
                <LimitInput band={band} field="maxIlluminationPct" value={constraints[band].maxIlluminationPct} onError={setError} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error ? <ActionError message={error} /> : null}
    </div>
  )
}

/** "Moon limits" in a toolbar, opening the editor. */
export function MoonLimitsButton({ bands }: { bands: Band[] }) {
  const m = useMessages()
  return (
    <Popover>
      <PopoverTrigger render={<Button size="sm" variant="outline" />}>
        <MoonStar aria-hidden="true" data-icon="inline-start" />
        {m.tonight_moon_limits()}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60">
        <MoonLimits bands={bands} />
      </PopoverContent>
    </Popover>
  )
}
