/**
 * Structured goal editing (slice B): the three goal kinds (integration time,
 * frame count, quality bar) for one channel, and the channel chips that add
 * a goal from the band set (`GOAL_CHANNELS`), never free text (D-W29). Used
 * by the Project's goals and by New Project's template values.
 */
import { Plus, X } from "lucide-react"
import { useId } from "react"
import { useMessages } from "@/app/preferences"
import { Pill } from "@/components/app/pill"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GOAL_CHANNELS } from "@/domain/labels"
import type { GoalChannel, GoalTemplateValue, QualityBar } from "@/domain/types"
import type { Messages } from "@/lib/i18n"
import { SelectField } from "@/features/t3/fields"

export type GoalKinds = Pick<GoalTemplateValue, "integrationS" | "frameCount" | "qualityBar">

type BarChoice = "none" | QualityBar["kind"]

function barOptions(m: Messages): Array<{ value: BarChoice; label: string }> {
  return [
    { value: "none", label: m.goal_bar_any() },
    { value: "usable-only", label: m.status_usable() },
    { value: "max-fwhm", label: m.goal_bar_fwhm() },
    { value: "usable-max-fwhm", label: m.goal_bar_usable_fwhm() },
  ]
}

function barOf(choice: BarChoice, limit: number): QualityBar | null {
  if (choice === "none") return null
  if (choice === "usable-only") return { kind: "usable-only" }
  return { kind: choice, maxArcsec: limit }
}

/** Integration (h), frames and quality bar for one channel; an empty kind is no goal of that kind. */
export function GoalKindsFields({ channel, value, onChange }: { channel: string; value: GoalKinds; onChange: (patch: Partial<GoalKinds>) => void }) {
  const m = useMessages()
  const id = useId()
  const bar: BarChoice = value.qualityBar?.kind ?? "none"
  const limit = value.qualityBar && value.qualityBar.kind !== "usable-only" ? value.qualityBar.maxArcsec : 3
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="grid gap-1">
        <label htmlFor={`${id}-h`} className="text-[0.6875rem] text-muted-foreground">
          {m.goal_hours()}
        </label>
        <Input
          id={`${id}-h`}
          aria-label={m.goal_hours_label({ channel })}
          type="number"
          min={0}
          step={0.5}
          className="h-7 w-20 tabular-nums"
          value={value.integrationS === null ? "" : String(value.integrationS / 3600)}
          onChange={(e) => onChange({ integrationS: e.target.value === "" ? null : Math.round(Number(e.target.value) * 3600) })}
        />
      </div>
      <div className="grid gap-1">
        <label htmlFor={`${id}-f`} className="text-[0.6875rem] text-muted-foreground">
          {m.goal_frames()}
        </label>
        <Input
          id={`${id}-f`}
          aria-label={m.goal_frames_label({ channel })}
          type="number"
          min={0}
          step={1}
          className="h-7 w-20 tabular-nums"
          value={value.frameCount === null ? "" : String(value.frameCount)}
          onChange={(e) => onChange({ frameCount: e.target.value === "" ? null : Math.round(Number(e.target.value)) })}
        />
      </div>
      <SelectField
        className="w-36 gap-1 [&>label]:text-[0.6875rem] [&>label]:font-normal [&>label]:text-muted-foreground"
        triggerClassName="min-h-7"
        label={m.goal_quality()}
        value={bar}
        onChange={(next) => onChange({ qualityBar: barOf(next as BarChoice, limit) })}
        options={barOptions(m)}
      />
      {bar === "max-fwhm" || bar === "usable-max-fwhm" ? (
        <div className="grid gap-1">
          <label htmlFor={`${id}-q`} className="text-[0.6875rem] text-muted-foreground">
            {m.goal_fwhm_max()}
          </label>
          <Input
            id={`${id}-q`}
            aria-label={m.goal_fwhm_label({ channel })}
            type="number"
            min={0.5}
            step={0.1}
            className="h-7 w-20 tabular-nums"
            value={String(limit)}
            onChange={(e) => onChange({ qualityBar: barOf(bar, Number(e.target.value) || 0) })}
          />
        </div>
      ) : null}
    </div>
  )
}

/** "+ Ha" chips for the channels without a goal yet; `channels` are the ones the rigs capture (all chips when none). */
export function ChannelChips({ channels, taken, onAdd, label }: { channels: GoalChannel[]; taken: GoalChannel[]; onAdd: (channel: GoalChannel) => void; label: string }) {
  const m = useMessages()
  const offered = (channels.length > 0 ? channels : GOAL_CHANNELS).filter((c) => !taken.includes(c))
  if (offered.length === 0) return null
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      {offered.map((channel) => (
        <Pill key={channel} tone="muted" icon={Plus} onClick={() => onAdd(channel)} title={m.goal_add_channel_goal({ channel })}>
          {channel}
        </Pill>
      ))}
    </div>
  )
}

export const DEFAULT_GOAL: GoalKinds = { integrationS: 10 * 3600, frameCount: null, qualityBar: null }

/** Template values: one row per channel with its goal kinds; chips add a channel. */
export function GoalValuesEditor({ values, channels, onChange }: { values: GoalTemplateValue[]; channels: GoalChannel[]; onChange: (next: GoalTemplateValue[]) => void }) {
  const m = useMessages()
  return (
    <div className="space-y-2">
      {values.length > 0 ? (
        <ul className="divide-y divide-separator rounded-md border border-border">
          {values.map((value) => (
            <li key={value.channel} className="flex flex-wrap items-end gap-3 px-3 py-2">
              <Pill tone="info" className="mb-1">
                {value.channel}
              </Pill>
              <GoalKindsFields channel={value.channel} value={value} onChange={(patch) => onChange(values.map((v) => (v.channel === value.channel ? { ...v, ...patch } : v)))} />
              <Button size="icon-sm" variant="ghost" className="mb-0.5 ml-auto" aria-label={m.project_remove_named({ name: value.channel })} onClick={() => onChange(values.filter((v) => v.channel !== value.channel))}>
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <ChannelChips label={m.goal_add_channel()} channels={channels} taken={values.map((v) => v.channel)} onAdd={(channel) => onChange([...values, { channel, ...DEFAULT_GOAL }])} />
    </div>
  )
}
