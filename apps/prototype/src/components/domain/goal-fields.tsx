/**
 * Goal fields (L2-domain): one channel's goal as C7 settles it, an amount of
 * time or of frames with an optional quality bar ("count only frames with
 * FWHM ≤ x″"; Usable frames always), the line that sums it up, and the
 * per-channel editor of template values. A Project's goals (Add goal…,
 * Edit…), New Project and Settings › Goal templates all edit goals through
 * these, so a template edits exactly like a Project's goals. Channels come
 * from the band set (`GOAL_CHANNELS`) through "Add goal ▾", never free text
 * (D-W29); "From template ▸" in the same menu prefills the values, which stay
 * editable (D-W30).
 */
import { X } from "lucide-react"
import { useMessages } from "@/app/preferences"
import { ActionMenu, IconButton } from "@/components/app/actions"
import { Box } from "@/components/app/box"
import type { MenuItem } from "@/components/app/contracts"
import { FieldGroup, NumberField, SegmentedField } from "@/components/app/fields"
import { formatHours } from "@/domain/derive"
import { GOAL_CHANNELS, qualityBarRef } from "@/domain/labels"
import { fwhmBar, qualityBarFor } from "@/domain/templates"
import type { GoalChannel, GoalTemplateValue } from "@/domain/types"
import { formatCount } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"

export type GoalKinds = Pick<GoalTemplateValue, "integrationS" | "frameCount" | "qualityBar">

export const DEFAULT_GOAL: GoalKinds = { integrationS: 10 * 3600, frameCount: null, qualityBar: qualityBarFor(null) }

type Unit = "time" | "frames"

function unitOf(kinds: GoalKinds): Unit {
  return kinds.integrationS === null && kinds.frameCount !== null ? "frames" : "time"
}

/** "10 h · FWHM ≤ 2.5″", "120 frames"; "Not set" without an amount. */
export function kindsLine(m: Messages, goal: GoalKinds): string {
  const amount = goal.integrationS !== null ? formatHours(goal.integrationS) : goal.frameCount !== null ? m.project_frames_count({ count: goal.frameCount, n: formatCount(goal.frameCount) }) : null
  const bar = fwhmBar(goal.qualityBar) !== null ? say(m, qualityBarRef(goal.qualityBar)) : null
  return [amount, bar].filter((part): part is string => part !== null).join(" · ") || m.status_not_set()
}

/** A goal counts time or frames (C7): without an amount it measures nothing. */
export function goalKindsError(m: Messages, kinds: GoalKinds): string | undefined {
  return kinds.integrationS === null && kinds.frameCount === null ? m.goal_hours_or_frames() : undefined
}

/** Counts (time or frames), the amount and the FWHM limit: side by side in a FieldGroup, one per row in a dialog. */
export function GoalKindsFields({ value, onChange }: { value: GoalKinds; onChange: (patch: Partial<GoalKinds>) => void }) {
  const m = useMessages()
  const unit = unitOf(value)
  const switchTo = (next: Unit) => {
    if (next === unit) return
    // The amount keeps its number: 10 h becomes 10 frames, and back.
    if (next === "frames") onChange({ frameCount: value.integrationS === null ? null : Math.round(value.integrationS / 3600), integrationS: null })
    else onChange({ integrationS: value.frameCount === null ? null : value.frameCount * 3600, frameCount: null })
  }
  return (
    <>
      <SegmentedField
        label={m.goal_counts()}
        value={unit}
        onChange={switchTo}
        options={[
          { value: "time", label: m.goal_unit_time() },
          { value: "frames", label: m.goal_frames() },
        ]}
      />
      {unit === "time" ? (
        <NumberField
          label={m.goal_hours()}
          min={0}
          step={0.5}
          value={value.integrationS === null ? null : value.integrationS / 3600}
          onChange={(hours) => onChange({ integrationS: hours === null ? null : Math.round(hours * 3600) })}
          error={goalKindsError(m, value)}
        />
      ) : (
        <NumberField label={m.goal_frames()} min={0} step={1} value={value.frameCount} onChange={(frames) => onChange({ frameCount: frames === null ? null : Math.round(frames) })} error={goalKindsError(m, value)} />
      )}
      <NumberField label={m.goal_fwhm_max()} min={0.5} step={0.1} value={fwhmBar(value.qualityBar)} onChange={(limit) => onChange({ qualityBar: qualityBarFor(limit) })} />
    </>
  )
}

export interface GoalTemplateChoice {
  id: string
  label: string
}

/**
 * Template values: one FieldGroup per channel with its goal kinds and a
 * Remove. "Add goal ▾" offers the channels the rigs capture (every channel
 * without rigs) and, with `templates`, "From template ▸", whose values
 * replace the rows.
 */
export function GoalValuesEditor({
  values,
  channels,
  onChange,
  templates,
}: {
  values: GoalTemplateValue[]
  channels: GoalChannel[]
  onChange: (next: GoalTemplateValue[]) => void
  templates?: { items: GoalTemplateChoice[]; apply: (id: string) => void }
}) {
  const m = useMessages()
  const offered = (channels.length > 0 ? channels : GOAL_CHANNELS).filter((c) => !values.some((v) => v.channel === c))
  const menu: MenuItem[] = [
    ...offered.map((channel) => ({ id: `add-goal-${channel}`, label: channel, run: () => onChange([...values, { channel, ...DEFAULT_GOAL }]) })),
    ...(templates && templates.items.length > 0
      ? [{ separator: true } as const, { submenu: m.goal_from_template(), items: templates.items.map((t) => ({ id: `template-${t.id}`, label: t.label, run: () => templates.apply(t.id) })) }]
      : []),
  ]
  const edit = (channel: GoalChannel, patch: Partial<GoalKinds>) => onChange(values.map((v) => (v.channel === channel ? { ...v, ...patch } : v)))
  return (
    <Box title={m.project_goals_title()} count={values.length} actions={<ActionMenu label={m.goal_add()} items={menu} />}>
      {values.length === 0
        ? m.projects_no_goals()
        : values.map((value) => (
            <FieldGroup
              key={value.channel}
              label={m.goal_channel_goal({ channel: value.channel })}
              action={<IconButton label={m.goal_remove_goal({ channel: value.channel })} icon={X} onClick={() => onChange(values.filter((v) => v.channel !== value.channel))} />}
            >
              <GoalKindsFields value={value} onChange={(patch) => edit(value.channel, patch)} />
            </FieldGroup>
          ))}
    </Box>
  )
}
