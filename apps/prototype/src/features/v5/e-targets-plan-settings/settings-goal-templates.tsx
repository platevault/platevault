/**
 * S16 Settings › Goal templates (slice E; D-W30, D-W47, PRJ-FR-12, C7;
 * plan §4a). The built-in templates (HOO, SHO, LRGB, OSC broadband, OSC
 * dual-band) and the user's own, each a ListSection. A template holds one
 * goal per channel: the channel comes from the band set (plus OSC and
 * Dual-band), and each goal counts time or frames with an optional FWHM
 * quality bar; only Usable frames ever count (C7). It also holds the subject
 * conditions a Project copies when it applies the template: the mosaic panel
 * balance and the window rule (no deadline, a "Finish by" night, or the
 * season from the target's visibility). The goal editor is the one a
 * Project's goals use (`components/domain/goal-fields.tsx`). User templates
 * are created, edited and deleted here; a built-in stays as shipped and
 * Duplicate starts a user copy. Applying a template copies its values; the
 * template records no Project.
 */
import { Copy, Pencil, Trash2 } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { ActionError, EmptyState } from "@/components/app/feedback"
import { NumberField, SelectField, TextField } from "@/components/app/fields"
import { blockedByErrors, type FieldErrors, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { NightPicker } from "@/components/app/pickers"
import { goalKindsError, GoalValuesEditor, kindsLine } from "@/components/domain/goal-fields"
import { ListSection, SettingsPage } from "@/components/templates/settings-page"
import { nightOf } from "@/domain/indexing"
import { panelBalanceRef, windowRuleRef } from "@/domain/labels"
import { BUILT_IN_GOAL_TEMPLATES, DEFAULT_TEMPLATE_CONDITIONS, PANEL_BALANCE_LIMITS, templateConditions } from "@/domain/templates"
import type { GoalTemplate, GoalTemplateValue, WindowRule } from "@/domain/types"
import { type Messages, say } from "@/lib/i18n"
import { deleteGoalTemplate, saveGoalTemplate } from "@/store/actions/settings"
import { nowIso, useStore } from "@/store/core"

/** "Ha 10h · FWHM ≤ 2.5″, OIII 120 frames": every goal of a template on one line. */
function goalsLine(m: Messages, values: GoalTemplateValue[]): string {
  return values.map((v) => m.domain_goal_line({ channel: v.channel, amounts: kindsLine(m, v) })).join(", ") || m.projects_no_goals()
}

type WindowKind = "none" | WindowRule["kind"]

interface TemplateForm {
  name: string
  values: GoalTemplateValue[]
  panelBalancePct: number | null
  windowKind: WindowKind
  /** The "Finish by" night, kept while another rule is picked so switching back restores it. */
  finishBy: string
}

/** What the template dialog opens with: the template to edit (`id`), or a new one, blank or a duplicate. */
interface Draft {
  id: string | null
  name: string
  values: GoalTemplateValue[]
  conditions: NonNullable<GoalTemplate["conditions"]>
  title: string
}

function TemplateDialog({ draft, onClose, taken }: { draft: Draft | null; onClose: () => void; taken: string[] }) {
  const m = useMessages()
  const today = nightOf(nowIso())
  const open = draft !== null
  const { values, set, shown } = useDialogForm<TemplateForm>(open, () => {
    const window = draft?.conditions.window ?? null
    return {
      name: draft?.name ?? "",
      values: draft?.values ?? [],
      panelBalancePct: draft?.conditions.panelBalancePct ?? DEFAULT_TEMPLATE_CONDITIONS.panelBalancePct,
      windowKind: window?.kind ?? "none",
      finishBy: window?.kind === "finish-by" ? window.night : today,
    }
  })
  const name = values.name.trim()
  const unset = values.values.filter((v) => goalKindsError(m, v) !== undefined).map((v) => v.channel)
  const balance = values.panelBalancePct
  const errors: FieldErrors<keyof TemplateForm> = {
    name: !name ? m.settings_name_required() : taken.some((t) => t.toLowerCase() === name.toLowerCase()) ? m.import_name_taken() : undefined,
    values: values.values.length === 0 ? m.template_add_channel() : unset.length > 0 ? m.template_hours_or_frames({ channels: unset.join(", ") }) : undefined,
    panelBalancePct:
      balance !== null && balance >= PANEL_BALANCE_LIMITS.minPct && balance <= PANEL_BALANCE_LIMITS.maxPct ? undefined : m.template_balance_range({ min: String(PANEL_BALANCE_LIMITS.minPct), max: String(PANEL_BALANCE_LIMITS.maxPct) }),
  }
  const window: WindowRule | null = values.windowKind === "finish-by" ? { kind: "finish-by", night: values.finishBy } : values.windowKind === "season" ? { kind: "season" } : null
  const label = m.settings_save()
  const confirm: Action = {
    id: "template-save",
    label,
    kind: "primary",
    unavailable: blockedByErrors(label, errors),
    run: () => saveGoalTemplate({ id: draft?.id ?? null, name, values: values.values, conditions: { panelBalancePct: balance ?? DEFAULT_TEMPLATE_CONDITIONS.panelBalancePct, window } }).result,
  }
  return (
    <FormDialog open={open} onOpenChange={(next) => !next && onClose()} title={draft?.title ?? ""} size="lg" confirm={confirm}>
      <TextField label={m.site_name()} value={values.name} onChange={(next) => set({ name: next })} error={shown(errors, "name")} autoFocus />
      <GoalValuesEditor values={values.values} channels={[]} onChange={(next) => set({ values: next })} />
      {errors.values && shown(errors, "values") ? <ActionError message={errors.values} /> : null}
      <NumberField label={m.project_col_panel_balance()} unit={m.template_balance_unit()} min={PANEL_BALANCE_LIMITS.minPct} max={PANEL_BALANCE_LIMITS.maxPct} step={1} value={balance} onChange={(panelBalancePct) => set({ panelBalancePct })} error={shown(errors, "panelBalancePct")} />
      <SelectField<WindowKind>
        label={m.project_col_window()}
        value={values.windowKind}
        options={[
          { value: "none", label: m.domain_window_none() },
          { value: "finish-by", label: m.template_window_finish_by() },
          { value: "season", label: m.domain_window_rule_season() },
        ]}
        onChange={(windowKind) => set({ windowKind })}
      />
      {values.windowKind === "finish-by" ? <NightPicker value={values.finishBy} onChange={(finishBy) => set({ finishBy })} today={today} /> : null}
    </FormDialog>
  )
}

export function GoalTemplatesSettingsPage() {
  const m = useMessages()
  const user = useStore((s) => Object.values(s.catalog.goalTemplates))
  const [draft, setDraft] = useState<Draft | null>(null)
  const allNames = [...BUILT_IN_GOAL_TEMPLATES, ...user].map((t) => t.name)

  function duplicate(t: GoalTemplate) {
    let name = m.template_copy_name({ name: t.name })
    for (let n = 2; allNames.some((x) => x.toLowerCase() === name.toLowerCase()); n += 1) name = m.template_copy_name_numbered({ name: t.name, n: String(n) })
    setDraft({ id: null, name, values: structuredClone(t.values), conditions: structuredClone(templateConditions(t)), title: m.common_duplicate_title({ name: t.name }) })
  }
  const create: Action = { id: "new-template", label: m.template_new(), opensDialog: true, run: () => setDraft({ id: null, name: "", values: [], conditions: DEFAULT_TEMPLATE_CONDITIONS, title: m.template_new() }) }
  const duplicateAction = (t: GoalTemplate): Action => ({ id: "duplicate", label: m.template_duplicate(), icon: Copy, opensDialog: true, run: () => duplicate(t) })
  const columns: Column<GoalTemplate>[] = [
    { id: "name", header: m.template_column_template(), rowHeader: true, truncate: true, sortValue: (t) => t.name, cell: (t) => t.name },
    { id: "goals", header: m.template_goals(), truncate: true, sortValue: (t) => goalsLine(m, t.values), cell: (t) => goalsLine(m, t.values) },
    { id: "balance", header: m.project_col_panel_balance(), align: "right", sortValue: (t) => templateConditions(t).panelBalancePct, cell: (t) => say(m, panelBalanceRef(templateConditions(t).panelBalancePct)) },
    { id: "window", header: m.project_col_window(), sortValue: (t) => say(m, windowRuleRef(templateConditions(t).window)), cell: (t) => say(m, windowRuleRef(templateConditions(t).window)) },
  ]
  const table = (rows: GoalTemplate[]) => ({ rows, columns, getRowId: (t: GoalTemplate) => t.id, rowLabel: (t: GoalTemplate) => t.name, initialSort: { columnId: "name", direction: "asc" as const } })

  return (
    <SettingsPage title={m.settings_goal_templates()}>
      <ListSection<GoalTemplate> title={m.template_built_in()} table={{ ...table(BUILT_IN_GOAL_TEMPLATES), label: m.template_table_caption({ group: m.template_built_in() }), rowActions: (t: GoalTemplate): MenuItem[] => [duplicateAction(t)] }} />
      <ListSection<GoalTemplate>
        title={m.template_yours()}
        add={create}
        table={{
          ...table(user),
          label: m.template_table_caption({ group: m.template_yours() }),
          empty: <EmptyState icon={Copy} title={m.template_none_yours()} action={<ActionButton action={create} />} />,
          rowActions: (t: GoalTemplate): MenuItem[] => [
            { id: "edit", label: m.settings_edit(), icon: Pencil, opensDialog: true, run: () => setDraft({ id: t.id, name: t.name, values: structuredClone(t.values), conditions: structuredClone(templateConditions(t)), title: m.settings_edit_title({ name: t.name }) }) },
            duplicateAction(t),
            { separator: true },
            {
              id: "delete",
              label: m.template_delete(),
              icon: Trash2,
              kind: "destructive",
              confirm: { title: m.template_delete_title({ name: t.name }), summary: m.store_goal_template_deleted_detail(), confirm: { label: m.template_delete(), kind: "destructive" } },
              run: () => deleteGoalTemplate(t.id),
            },
          ],
        }}
      />
      <TemplateDialog draft={draft} onClose={() => setDraft(null)} taken={allNames.filter((n) => n !== (draft?.id ? user.find((u) => u.id === draft.id)?.name : undefined))} />
    </SettingsPage>
  )
}
