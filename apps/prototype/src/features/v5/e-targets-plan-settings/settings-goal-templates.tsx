/**
 * S16 Settings › Goal templates (slice E; D-W30, D-W47, PRJ-FR-12). The
 * built-in templates (HOO, SHO, LRGB, OSC broadband, OSC dual-band) and the
 * user's own. User templates are created, edited and deleted here; a built-in
 * stays as shipped and "Duplicate to edit" starts a user copy. Applying a
 * template copies its values into a Project, where they stand alone and stay
 * editable, so editing or deleting a template changes no Project. Templates
 * are never filtered by rig.
 */
import { Copy, Pencil, Plus, Trash2, X } from "lucide-react"
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { ActionError } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { formatHours } from "@/domain/derive"
import { GOAL_CHANNELS, isGoalChannel } from "@/domain/labels"
import { BUILT_IN_GOAL_TEMPLATES } from "@/domain/templates"
import type { GoalTemplate, GoalTemplateValue } from "@/domain/types"
import { TextField, parseNumber } from "@/features/t1/components/form-field"
import { ReturnNotice } from "@/features/t1/settings/settings-layout"
import { plural } from "@/lib/format"
import { deleteGoalTemplate, saveGoalTemplate } from "@/store/actions/settings"
import { useStore } from "@/store/core"

/** Goal channels are chips from the band set plus OSC and Dual-band; nothing else is saved. */
const CHANNEL_SUGGESTIONS: string[] = GOAL_CHANNELS

function valueText(v: GoalTemplateValue): string {
  const parts = [v.integrationS ? formatHours(v.integrationS) : null, v.frameCount ? plural(v.frameCount, "frame") : null].filter(Boolean)
  return `${v.channel} ${parts.join(" + ")}`
}

interface RowDraft {
  key: number
  channel: string
  hours: string
  frames: string
}

interface Draft {
  id: string | null
  name: string
  rows: RowDraft[]
  /** Built-in this draft was duplicated from, for the dialog copy. */
  from: string | null
}

let rowKey = 0
const toRows = (values: GoalTemplateValue[]): RowDraft[] =>
  values.map((v) => ({ key: (rowKey += 1), channel: v.channel, hours: v.integrationS ? String(Number((v.integrationS / 3600).toFixed(2))) : "", frames: v.frameCount ? String(v.frameCount) : "" }))

function TemplateDialog({ draft, onClose, taken }: { draft: Draft | null; onClose: () => void; taken: string[] }) {
  const [values, setValues] = useState<Draft | null>(draft)
  const [errors, setErrors] = useState<{ name?: string; rows?: string }>({})
  const [failure, setFailure] = useState<string | null>(null)
  const nameId = useId()
  const listId = useId()
  useEffect(() => {
    setValues(draft)
    setErrors({})
    setFailure(null)
  }, [draft])
  if (!values) return null

  const patchRow = (key: number, patch: Partial<RowDraft>) => setValues({ ...values, rows: values.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!values) return
    const name = values.name.trim()
    const next: typeof errors = {}
    if (!name) next.name = "Name: enter a template name, for example HaRGB."
    else if (taken.some((t) => t.toLowerCase() === name.toLowerCase())) next.name = `Name: “${name}” is already a template. Choose another name.`
    const parsed: GoalTemplateValue[] = []
    const problems: string[] = []
    const channels = new Set<string>()
    for (const row of values.rows) {
      const channel = row.channel.trim()
      const hours = parseNumber(row.hours)
      const frames = parseNumber(row.frames)
      if (!channel) problems.push("every row needs a channel")
      else if (!isGoalChannel(channel)) problems.push(`${channel}: choose L, R, G, B, Ha, OIII, SII, OSC or Dual-band`)
      else if (channels.has(channel.toLowerCase())) problems.push(`${channel} is listed twice`)
      channels.add(channel.toLowerCase())
      const hoursOk = hours !== null && !Number.isNaN(hours) && hours > 0
      const framesOk = frames !== null && !Number.isNaN(frames) && frames > 0 && Number.isInteger(frames)
      if ((hours !== null && !hoursOk) || (frames !== null && !framesOk)) problems.push(`${channel || "a row"}: hours and frames must be greater than 0, frames whole`)
      else if (!hoursOk && !framesOk) problems.push(`${channel || "a row"} needs hours or a frame count`)
      if (isGoalChannel(channel)) parsed.push({ channel, integrationS: hoursOk ? Math.round(hours! * 3600) : null, frameCount: framesOk ? frames : null, qualityBar: null })
    }
    if (values.rows.length === 0) problems.push("add at least one channel")
    if (problems.length > 0) next.rows = `Goals: ${[...new Set(problems)].join("; ")}.`
    setErrors(next)
    if (next.name || next.rows) return
    const { result } = saveGoalTemplate({ id: values.id, name, values: parsed })
    if (result.ok) onClose()
    else setFailure(result.message)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate className="space-y-3">
          <DialogHeader>
            <DialogTitle>{values.id ? `Edit ${values.name}` : values.from ? `New template from ${values.from}` : "New goal template"}</DialogTitle>
            <DialogDescription>Each channel gets an integration goal, a frame-count goal or both. Projects that applied this template keep their own copy.</DialogDescription>
          </DialogHeader>
          <TextField id={nameId} label="Name" value={values.name} onChange={(name) => setValues({ ...values, name })} error={errors.name} />
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Goals per channel</legend>
            <datalist id={listId}>
              {CHANNEL_SUGGESTIONS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <div className="grid grid-cols-[minmax(0,1fr)_6rem_6rem_1.75rem] items-center gap-x-2 gap-y-1.5 text-[0.75rem] text-muted-foreground">
              <span>Channel</span>
              <span>Hours</span>
              <span>Frames</span>
              <span className="sr-only">Remove</span>
              {values.rows.map((row, index) => (
                <div key={row.key} className="contents">
                  <Input aria-label={`Channel ${index + 1}`} list={listId} value={row.channel} onChange={(event) => patchRow(row.key, { channel: event.target.value })} />
                  <Input aria-label={`Hours for ${row.channel || `channel ${index + 1}`}`} inputMode="decimal" value={row.hours} onChange={(event) => patchRow(row.key, { hours: event.target.value })} className="tabular-nums" />
                  <Input aria-label={`Frames for ${row.channel || `channel ${index + 1}`}`} inputMode="numeric" value={row.frames} onChange={(event) => patchRow(row.key, { frames: event.target.value })} className="tabular-nums" />
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${row.channel || `channel ${index + 1}`}`} onClick={() => setValues({ ...values, rows: values.rows.filter((r) => r.key !== row.key) })}>
                    <X aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => setValues({ ...values, rows: [...values.rows, { key: (rowKey += 1), channel: "", hours: "", frames: "" }] })}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              Add channel
            </Button>
            {errors.rows ? <ActionError message={errors.rows} /> : null}
          </fieldset>
          {failure ? <ActionError message={failure} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{failure ? "Retry" : "Save template"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TemplateTable({ templates, caption, actions }: { templates: GoalTemplate[]; caption: string; actions: (t: GoalTemplate) => ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-[color-mix(in_oklch,var(--chrome)_70%,var(--background))] text-[0.6875rem] text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="h-(--row-h) px-3 text-left font-medium">Template</th>
            <th scope="col" className="px-3 text-left font-medium">Goals per channel</th>
            <th scope="col" className="px-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.id} className="h-(--row-h) border-b border-border/50 last:border-0 even:bg-foreground/[0.022]">
              <th scope="row" className="px-3 text-left font-medium whitespace-nowrap">
                {t.name} {t.source === "built-in" ? <StatusBadge kind="source" value="built-in" className="ml-1.5" /> : null}
              </th>
              <td className="px-3 tabular-nums">{t.values.map(valueText).join(" · ")}</td>
              <td className="px-3 py-0.5 text-right whitespace-nowrap">{actions(t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function GoalTemplatesSettingsPage() {
  const user = useStore((s) => Object.values(s.catalog.goalTemplates).sort((a, b) => a.name.localeCompare(b.name)))
  const [draft, setDraft] = useState<Draft | null>(null)
  const [deleting, setDeleting] = useState<GoalTemplate | null>(null)
  const allNames = [...BUILT_IN_GOAL_TEMPLATES, ...user].map((t) => t.name)

  function duplicate(t: GoalTemplate) {
    let name = `${t.name} copy`
    for (let n = 2; allNames.some((x) => x.toLowerCase() === name.toLowerCase()); n += 1) name = `${t.name} copy ${n}`
    setDraft({ id: null, name, rows: toRows(t.values), from: t.name })
  }

  return (
    <div>
      <PageHeader
        level={2}
        title="Goal templates"
        description="Applying a template copies its goals into a Project, where they stand alone and stay editable. Templates are the same whichever rig a Project uses."
        actions={
          <Button onClick={() => setDraft({ id: null, name: "", rows: [{ key: (rowKey += 1), channel: "", hours: "", frames: "" }], from: null })}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            New template
          </Button>
        }
      />
      <PageBody>
        <ReturnNotice task="Goal templates" />
        <Section id="gt-built-in" title="Built-in" description="Shipped with PlateVault. Duplicate one to make an editable copy.">
          <TemplateTable
            templates={BUILT_IN_GOAL_TEMPLATES}
            caption="Built-in goal templates"
            actions={(t) => (
              <Button size="xs" variant="outline" onClick={() => duplicate(t)}>
                <Copy aria-hidden="true" data-icon="inline-start" />
                Duplicate to edit<span className="sr-only"> {t.name}</span>
              </Button>
            )}
          />
        </Section>
        <Section id="gt-user" title="Yours" description="Create, edit and delete your own templates. Editing one changes no Project that applied it.">
          {user.length === 0 ? (
            <p className="text-sm text-muted-foreground">No templates of your own yet. Use New template, or Duplicate to edit on a built-in.</p>
          ) : (
            <TemplateTable
              templates={user}
              caption="Your goal templates"
              actions={(t) => (
                <>
                  <Button size="xs" variant="ghost" onClick={() => setDraft({ id: t.id, name: t.name, rows: toRows(t.values), from: null })}>
                    <Pencil aria-hidden="true" data-icon="inline-start" />
                    Edit<span className="sr-only"> {t.name}</span>
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => duplicate(t)}>
                    <Copy aria-hidden="true" data-icon="inline-start" />
                    Duplicate<span className="sr-only"> {t.name}</span>
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setDeleting(t)}>
                    <Trash2 aria-hidden="true" data-icon="inline-start" />
                    Delete<span className="sr-only"> {t.name}</span>
                  </Button>
                </>
              )}
            />
          )}
        </Section>
        <p className="text-xs text-muted-foreground">
          OSC templates count toward the derived channels “OSC” (no filter or a broadband filter on an OSC camera) and “Dual-band” (a filter that passes two narrow bands).
        </p>
      </PageBody>
      <TemplateDialog draft={draft} onClose={() => setDraft(null)} taken={allNames.filter((n) => n !== (draft?.id ? user.find((u) => u.id === draft.id)?.name : undefined))} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete the goal template ${deleting?.name ?? ""}?`}
        description="The template leaves the list that New Project offers."
        changes={[`Deletes ${deleting?.name ?? ""}: ${deleting?.values.map(valueText).join(" · ") ?? ""}`]}
        unchanged={["Projects that applied it keep their copied goals", "Built-in templates and your other templates"]}
        confirmLabel={`Delete ${deleting?.name ?? "template"}`}
        tone="destructive"
        onConfirm={() => (deleting ? deleteGoalTemplate(deleting.id) : undefined)}
      />
    </div>
  )
}
