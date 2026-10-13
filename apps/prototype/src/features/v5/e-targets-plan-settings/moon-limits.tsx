/**
 * Moon limits (C6): one Moon-avoidance curve per filter, edited in a
 * FormDialog. A curve keeps the Moon `separationDeg` from the target at full
 * Moon, half that `widthDays` before or after full, and less as it thins
 * (design/R10-MOON-MODEL.md). Grades and Img time on Targets both read these
 * curves. The dialog edits a draft of every filter the selection passes;
 * Save writes the changed ones through `setMoonAvoidance`, which clamps.
 */
import { useEffect, useState } from "react"
import { useMessages } from "@/app/preferences"
import { KeyValueList } from "@/components/app/data"
import { NumberField, SelectField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { BANDS, DEFAULT_MOON_AVOIDANCE } from "@/domain/labels"
import { MOON_AVOIDANCE_LIMITS, type MoonAvoidance } from "@/domain/planning"
import type { Band } from "@/domain/types"
import { setMoonAvoidance } from "@/store/actions/settings"
import { type CommitResult, useStore } from "@/store/core"
import { avoidanceText } from "./good-tonight"

type Draft = Record<Band, { separationDeg: number | null; widthDays: number | null }>

function changed(draft: Draft[Band], curve: MoonAvoidance): boolean {
  return draft.separationDeg !== curve.separationDeg || draft.widthDays !== curve.widthDays
}

export function MoonLimitsDialog({ open, onOpenChange, bands }: { open: boolean; onOpenChange: (open: boolean) => void; bands: readonly Band[] }) {
  const m = useMessages()
  const curves = useStore((s) => s.settings.moonAvoidance)
  const ordered = BANDS.filter((b) => bands.includes(b))
  const [band, setBand] = useState<Band>(ordered[0] ?? "L")
  const [draft, setDraft] = useState<Draft>(curves)
  const [tried, setTried] = useState(false)
  // Each opening starts from the saved curves.
  useEffect(() => {
    if (!open) return
    setDraft(curves)
    setTried(false)
    setBand(ordered[0] ?? "L")
  }, [open])

  const current = draft[band]
  const missing = (value: number | null) => (tried && value === null ? m.tonight_curve_number_needed() : undefined)
  const edit = (patch: Partial<Draft[Band]>) => setDraft((d) => ({ ...d, [band]: { ...d[band], ...patch } }))

  function save(): CommitResult | void {
    setTried(true)
    const incomplete = ordered.find((b) => draft[b].separationDeg === null || draft[b].widthDays === null)
    if (incomplete) {
      setBand(incomplete)
      return { ok: false, reason: "refused", message: m.tonight_curve_incomplete({ band: incomplete }), reasons: [] }
    }
    for (const b of ordered) {
      if (!changed(draft[b], curves[b])) continue
      const result = setMoonAvoidance(b, { separationDeg: draft[b].separationDeg!, widthDays: draft[b].widthDays! })
      if (!result.ok) return result
    }
  }

  const fallback = DEFAULT_MOON_AVOIDANCE[band]
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={m.tonight_moon_limits()} size="md" confirm={{ id: "moon-limits-save", label: m.settings_save(), kind: "primary", run: save }}>
      <SelectField label={m.tonight_filter()} value={band} options={ordered.map((b) => ({ value: b, label: b }))} onChange={setBand} />
      <NumberField
        label={m.tonight_curve_separation()}
        unit="°"
        min={MOON_AVOIDANCE_LIMITS.separationDeg.min}
        max={MOON_AVOIDANCE_LIMITS.separationDeg.max}
        step={1}
        value={current.separationDeg}
        onChange={(separationDeg) => edit({ separationDeg })}
        description={m.tonight_curve_default({ value: `${fallback.separationDeg}°` })}
        error={missing(current.separationDeg)}
      />
      <NumberField
        label={m.tonight_curve_width()}
        unit={m.tonight_curve_days_unit()}
        min={MOON_AVOIDANCE_LIMITS.widthDays.min}
        max={MOON_AVOIDANCE_LIMITS.widthDays.max}
        step={1}
        value={current.widthDays}
        onChange={(widthDays) => edit({ widthDays })}
        description={m.tonight_curve_default({ value: m.tonight_curve_days({ count: fallback.widthDays }) })}
        error={missing(current.widthDays)}
      />
      <KeyValueList
        items={ordered.map((b) => {
          const d = draft[b]
          return { label: b, value: d.separationDeg === null || d.widthDays === null ? "–" : avoidanceText({ separationDeg: d.separationDeg, widthDays: d.widthDays }) }
        })}
      />
    </FormDialog>
  )
}
