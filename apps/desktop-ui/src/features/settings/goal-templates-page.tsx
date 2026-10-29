/**
 * Settings › Goal templates (PRJ-FR-03, PRJ-FR-04): the built-in templates,
 * then the user's own (`goal_template_list`). A template is a list of
 * goals; a Project copies its values when it applies one and keeps them
 * when the template changes or goes.
 *
 * - New template… and Duplicate open the editor; Edit… changes one of the
 *   user's templates over its revision (`goal_template_save`). Built-in
 *   templates are read-only.
 * - Delete removes one of the user's templates at its revision
 *   (`goal_template_delete`) after a confirmation.
 *
 * The editor holds one goal per channel (time or frames) and a FWHM limit;
 * the library keeps that limit as the template's one quality bar, so every
 * goal of the template reads it back. A goal with no channel is kept as it
 * was and is not edited here.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"
import { type GoalSpec, type GoalTemplate, library, type QualityCriterion } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import type { Column, MenuItem } from "@/components/app/contracts"
import { TextField } from "@/components/app/fields"
import { blockedByErrors, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { type GoalChannel, GOAL_CHANNELS, type GoalTemplateValue, fwhmBar, goalKindsError, GoalValuesEditor, qualityBarFor } from "@/components/domain/goal-fields"
import { ListSection, SettingsPage } from "@/components/templates/settings-page"
import { formatCount, formatHours, numberText } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { Read } from "./parts"
import { goalTemplatesQuery, settingsWrite } from "./queries"

function specText(m: Messages, spec: GoalSpec): string {
  if (spec.kind === "integration") return m.domain_goal_line({ channel: spec.channel ?? "–", amounts: formatHours(spec.goalSeconds) })
  if (spec.kind === "frame_count") return m.domain_goal_line({ channel: spec.channel ?? "–", amounts: m.target_goal_frames({ count: formatCount(spec.goalFrames) }) })
  return spec.criterion.criterion === "usable_only" ? m.goal_usable_frames() : m.domain_quality_max_fwhm({ arcsec: spec.criterion.maxArcsec === null ? "–" : numberText(spec.criterion.maxArcsec) })
}

function columns(m: Messages): Column<GoalTemplate>[] {
  return [
    { id: "name", header: m.site_name(), rowHeader: true, truncate: true, truncateMin: "name", sortValue: (t) => t.name, cell: (t) => t.name },
    { id: "goals", header: m.template_goals(), truncate: true, sortValue: (t) => t.goals.length, cell: (t) => (t.goals.length > 0 ? t.goals.map((g) => specText(m, g)).join(" · ") : m.projects_no_goals()) },
  ]
}

const isChannel = (value: string | null): value is GoalChannel => value !== null && (GOAL_CHANNELS as readonly string[]).includes(value)

/** The editor's rows of a template's goals; the goals it cannot edit are kept apart. */
function editorValues(goals: GoalSpec[]): { values: GoalTemplateValue[]; kept: GoalSpec[] } {
  const bar = goals.find((g): g is Extract<GoalSpec, { kind: "quality_bar" }> => g.kind === "quality_bar")
  const fwhm = bar?.criterion.criterion === "max_fwhm_median" ? bar.criterion.maxArcsec : null
  const values: GoalTemplateValue[] = []
  const kept: GoalSpec[] = []
  for (const goal of goals) {
    if (goal.kind === "quality_bar") continue
    if (!isChannel(goal.channel) || values.some((v) => v.channel === goal.channel)) {
      kept.push(goal)
      continue
    }
    values.push({
      channel: goal.channel,
      integrationS: goal.kind === "integration" ? goal.goalSeconds : null,
      frameCount: goal.kind === "frame_count" ? goal.goalFrames : null,
      qualityBar: qualityBarFor(fwhm),
    })
  }
  return { values, kept }
}

/** The goals a save sends: one per channel row, the kept ones, then the FWHM limit as the template's quality bar. */
function goalsOf(values: GoalTemplateValue[], kept: GoalSpec[]): GoalSpec[] {
  const goals: GoalSpec[] = values.map((v) =>
    v.integrationS !== null ? { kind: "integration", channel: v.channel, goalSeconds: v.integrationS } : { kind: "frame_count", channel: v.channel, goalFrames: v.frameCount ?? 0 },
  )
  const maxArcsec = values.map((v) => fwhmBar(v.qualityBar)).find((limit) => limit !== null) ?? null
  const criterion: QualityCriterion = maxArcsec !== null ? { criterion: "max_fwhm_median", maxArcsec } : { criterion: "usable_only" }
  return [...goals, ...kept, ...(values.length > 0 ? [{ kind: "quality_bar" as const, criterion }] : [])]
}

type Editing = { template: GoalTemplate | null; name: string; goals: GoalSpec[] } | null

export function GoalTemplatesPage() {
  const m = useMessages()
  const client = useQueryClient()
  const templates = useQuery(goalTemplatesQuery())
  const [editing, setEditing] = useState<Editing>(null)
  const duplicate = (t: GoalTemplate): MenuItem => ({ id: "duplicate-template", label: m.template_duplicate(), opensDialog: true, run: () => setEditing({ template: null, name: m.template_copy_name({ name: t.name }), goals: t.goals }) })
  const builtinActions = (t: GoalTemplate): MenuItem[] => [duplicate(t)]
  const ownActions = (t: GoalTemplate): MenuItem[] => [
    { id: "edit-template", label: m.settings_edit(), opensDialog: true, run: () => setEditing({ template: t, name: t.name, goals: t.goals }) },
    duplicate(t),
    { separator: true },
    {
      id: "delete-template",
      label: m.template_delete(),
      kind: "destructive",
      confirm: { title: m.template_delete_title({ name: t.name }), summary: m.template_delete_change({ name: t.name }), confirm: { label: m.template_delete(), kind: "destructive" } },
      run: () => settingsWrite(client, () => library.goalTemplateDelete(t.id, t.revision)),
    },
  ]
  return (
    <SettingsPage title={m.settings_goal_templates()}>
      <Read query={templates} label={m.settings_goal_templates()}>
        {(all) => (
          <>
            <ListSection
              title={m.template_built_in()}
              table={{ label: m.template_table_caption_built_in(), rows: all.filter((t) => t.builtin), columns: columns(m), getRowId: (t) => t.id, rowLabel: (t) => t.name, rowActions: builtinActions }}
            />
            <ListSection
              title={m.template_yours()}
              add={{ id: "new-template", label: m.template_new(), icon: Plus, opensDialog: true, run: () => setEditing({ template: null, name: "", goals: [] }) }}
              table={{ label: m.template_table_caption_yours(), rows: all.filter((t) => !t.builtin), columns: columns(m), getRowId: (t) => t.id, rowLabel: (t) => t.name, rowActions: ownActions, empty: m.template_none_yours() }}
            />
          </>
        )}
      </Read>
      {editing ? <TemplateDialog editing={editing} taken={(templates.data ?? []).filter((t) => t.id !== editing.template?.id).map((t) => t.name)} open onOpenChange={(open) => !open && setEditing(null)} /> : null}
    </SettingsPage>
  )
}

function TemplateDialog({ editing, taken, open, onOpenChange }: { editing: NonNullable<Editing>; taken: string[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const start = editorValues(editing.goals)
  const { values, set, shown } = useDialogForm(open, () => ({ name: editing.name, goals: start.values }))
  const label = m.settings_save()
  const name = values.name.trim()
  const goalError = values.goals.map((goal) => goalKindsError(m, goal)).find(Boolean)
  const errors = {
    name: !name ? m.settings_name_required() : taken.some((other) => other.toLowerCase() === name.toLowerCase()) ? m.settings_name_taken() : undefined,
    goals: goalError,
  }
  const template = editing.template
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={template ? m.settings_edit_title({ name: template.name }) : m.template_new()}
      confirm={{
        id: "save-goal-template",
        label,
        kind: "primary",
        unavailable: blockedByErrors(m, label, errors),
        run: () => settingsWrite(client, () => library.goalTemplateSave(template?.id ?? null, name, goalsOf(values.goals, start.kept), template?.revision ?? null)),
      }}
    >
      <TextField label={m.site_name()} value={values.name} onChange={(next) => set({ name: next })} error={shown(errors, "name")} autoFocus />
      <GoalValuesEditor values={values.goals} channels={[]} onChange={(goals) => set({ goals })} />
    </FormDialog>
  )
}
