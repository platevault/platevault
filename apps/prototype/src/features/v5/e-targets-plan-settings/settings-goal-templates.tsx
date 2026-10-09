/**
 * S16 Settings › Goal templates (slice E; D-W30, D-W47, PRJ-FR-12). The
 * built-in templates (HOO, SHO, LRGB, OSC broadband, OSC dual-band) and the
 * user's own. A template holds structured goals per channel: the channel is
 * a chip from the band set (plus OSC and Dual-band), and each channel has
 * the three goal kinds, integration time, frame count and a quality bar
 * (median FWHM limit and/or Usable only). The editor is slice B's goal
 * editor (`b-projects/goals.tsx`), so a template edits exactly like a
 * Project's goals. User templates are created, edited and deleted here; a
 * built-in stays as shipped and Duplicate starts a user copy. Applying a
 * template copies its values into a Project; templates record no Project.
 */
import { Copy, Pencil, Plus, Trash2 } from "lucide-react"
import { type FormEvent, useEffect, useId, useState } from "react"
import { Box } from "@/components/app/box"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { ActionError, EmptyState } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { CountBadge, Pill } from "@/components/app/pill"
import { ContextMenuArea, type MenuEntry, menuKey } from "@/components/app/row-menu"
import { HelpTip } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatHours } from "@/domain/derive"
import { qualityBarLabel } from "@/domain/labels"
import { BUILT_IN_GOAL_TEMPLATES } from "@/domain/templates"
import type { GoalTemplate, GoalTemplateValue } from "@/domain/types"
import { TextField } from "@/features/t1/components/form-field"
import { ReturnNotice } from "@/features/t1/settings/settings-layout"
import { GoalValuesEditor } from "@/features/v5/b-projects/goals"
import { plural } from "@/lib/format"
import { deleteGoalTemplate, saveGoalTemplate } from "@/store/actions/settings"
import { useStore } from "@/store/core"

/** "10 h · 20 frames", the quality bar as its own pill. */
function kindsText(v: GoalTemplateValue): string {
  return [v.integrationS ? formatHours(v.integrationS) : null, v.frameCount ? plural(v.frameCount, "frame") : null].filter(Boolean).join(" · ")
}

function GoalsCell({ values }: { values: GoalTemplateValue[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {values.map((v) => (
        <li key={v.channel} className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums">
          <Pill tone="info">{v.channel}</Pill>
          <span>{kindsText(v)}</span>
          {v.qualityBar ? <Pill tone="muted">{qualityBarLabel(v.qualityBar)}</Pill> : null}
        </li>
      ))}
    </ul>
  )
}

interface Draft {
  id: string | null
  name: string
  values: GoalTemplateValue[]
  /** Title of the dialog. */
  title: string
}

function TemplateDialog({ draft, onClose, taken }: { draft: Draft | null; onClose: () => void; taken: string[] }) {
  const [values, setValues] = useState<Draft | null>(draft)
  const [errors, setErrors] = useState<{ name?: string; goals?: string }>({})
  const [failure, setFailure] = useState<string | null>(null)
  const nameId = useId()
  useEffect(() => {
    setValues(draft)
    setErrors({})
    setFailure(null)
  }, [draft])
  if (!values) return null

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!values) return
    const name = values.name.trim()
    const next: typeof errors = {}
    if (!name) next.name = "Name required"
    else if (taken.some((t) => t.toLowerCase() === name.toLowerCase())) next.name = "Name taken"
    const empty = values.values.filter((v) => !(v.integrationS && v.integrationS > 0) && !(v.frameCount && v.frameCount > 0)).map((v) => v.channel)
    if (values.values.length === 0) next.goals = "Add a channel"
    else if (empty.length > 0) next.goals = `Hours or frames needed · ${empty.join(", ")}`
    setErrors(next)
    if (next.name || next.goals) return
    const { result } = saveGoalTemplate({ id: values.id, name, values: values.values })
    if (result.ok) onClose()
    else setFailure(result.message)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} noValidate className="space-y-3" data-goal-template-dialog>
          <DialogHeader>
            <DialogTitle>{values.title}</DialogTitle>
          </DialogHeader>
          <TextField id={nameId} label="Name" value={values.name} onChange={(name) => setValues({ ...values, name })} error={errors.name} />
          <fieldset className="space-y-1.5">
            <legend className="inline-flex items-center gap-1.5 text-sm font-medium">
              Goals
              <HelpTip label="About OSC and Dual-band">OSC: no filter or a broadband filter on an OSC camera. Dual-band: a filter passing two narrow bands.</HelpTip>
            </legend>
            <GoalValuesEditor values={values.values} channels={[]} onChange={(next) => setValues({ ...values, values: next })} />
            {errors.goals ? <ActionError message={errors.goals} /> : null}
          </fieldset>
          {failure ? <ActionError message={failure} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{failure ? "Retry" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface RowAction {
  label: string
  icon: typeof Copy
  run: () => void
  destructive?: boolean
}

function TemplateBox({ id, title, templates, actions }: { id: string; title: string; templates: GoalTemplate[]; actions: (t: GoalTemplate) => RowAction[] }) {
  const menu = (key: string): MenuEntry[] => {
    const template = templates.find((t) => t.id === key)
    return template ? actions(template).map((a) => ({ label: a.label, icon: a.icon, destructive: a.destructive, onSelect: a.run })) : []
  }
  return (
    <Box id={id} level={3} title={<span className="inline-flex items-center gap-1.5">{title} <CountBadge count={templates.length} /></span>} flush>
      <ContextMenuArea menu={menu}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{`${title} goal templates`}</caption>
            <thead className="text-[0.6875rem] text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className="h-(--row-h) px-3 text-left font-medium">
                  Template
                </th>
                <th scope="col" className="px-3 text-left font-medium">
                  Goals
                </th>
                <th scope="col" className="px-3 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} {...menuKey(t.id)} data-template={t.id} className="h-(--row-h) border-b border-border/50 last:border-0 even:bg-foreground/[0.022]">
                  <th scope="row" className="px-3 py-1 text-left font-medium whitespace-nowrap">
                    {t.name}
                  </th>
                  <td className="px-3 py-1">
                    <GoalsCell values={t.values} />
                  </td>
                  <td className="px-3 py-0.5 text-right whitespace-nowrap">
                    {actions(t).map((a) => (
                      <Button key={a.label} size="xs" variant="ghost" onClick={a.run}>
                        <a.icon aria-hidden="true" data-icon="inline-start" />
                        {a.label}
                        <span className="sr-only"> {t.name}</span>
                      </Button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ContextMenuArea>
    </Box>
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
    setDraft({ id: null, name, values: structuredClone(t.values), title: `Duplicate ${t.name}` })
  }
  const create = () => setDraft({ id: null, name: "", values: [], title: "New template" })

  return (
    <div>
      <PageHeader
        level={2}
        title="Goal templates"
        actions={
          <Button onClick={create}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            New template
          </Button>
        }
      />
      <PageBody>
        <ReturnNotice />
        <TemplateBox id="gt-built-in" title="Built-in" templates={BUILT_IN_GOAL_TEMPLATES} actions={(t) => [{ label: "Duplicate", icon: Copy, run: () => duplicate(t) }]} />
        {user.length === 0 ? (
          <EmptyState icon={Copy} title="No templates of yours" action={<Button variant="outline" onClick={create}>New template</Button>} />
        ) : (
          <TemplateBox
            id="gt-user"
            title="Yours"
            templates={user}
            actions={(t) => [
              { label: "Edit", icon: Pencil, run: () => setDraft({ id: t.id, name: t.name, values: structuredClone(t.values), title: `Edit ${t.name}` }) },
              { label: "Duplicate", icon: Copy, run: () => duplicate(t) },
              { label: "Delete", icon: Trash2, destructive: true, run: () => setDeleting(t) },
            ]}
          />
        )}
      </PageBody>
      <TemplateDialog draft={draft} onClose={() => setDraft(null)} taken={allNames.filter((n) => n !== (draft?.id ? user.find((u) => u.id === draft.id)?.name : undefined))} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "template"}?`}
        description={null}
        changes={[`Delete ${deleting?.name ?? ""}`]}
        confirmLabel="Delete"
        tone="destructive"
        onConfirm={() => (deleting ? deleteGoalTemplate(deleting.id) : undefined)}
      />
    </div>
  )
}
