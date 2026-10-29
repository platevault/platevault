/**
 * Settings › Naming (STO-FR naming templates; PRJ-FR group keywords): each
 * frame type's folder template beside its built-in default
 * (`naming_get`), and the GROUP and PANEL keyword names a new Project's View
 * folders use (the workflow settings' `keywords`).
 *
 * - Edit… previews the unsaved template against the frame type's built-in
 *   sample (`naming_preview`, which stores nothing) and saves it
 *   (`naming_save`); Use default saves the default, which stores no
 *   override. Restore defaults deletes every override.
 * - Group keywords Edit… saves the whole workflow settings document at the
 *   revision read, as Matching does.
 *
 * A refusal keeps the dialog open with the user's text.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil } from "lucide-react"
import { useState } from "react"
import { library, type NamingFrameType, type NamingTemplate, type WorkflowSettingsRecord_Serialize } from "@/api/ipc"
import { libraryQuery } from "@/api/query"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Column, MenuItem } from "@/components/app/contracts"
import { KeyValueList, PathText } from "@/components/app/data"
import { TextField } from "@/components/app/fields"
import { blockedByErrors, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { Section } from "@/components/app/page"
import { ListSection, SettingsPage } from "@/components/templates/settings-page"
import type { Messages } from "@/lib/i18n"
import { Read, readError } from "./parts"
import { namingQuery, settingsWrite, workflowQuery } from "./queries"

export function frameTypeText(m: Messages, type: NamingFrameType): string {
  const words: Record<NamingFrameType, string> = {
    light: m.naming_type_lights(),
    flat: m.naming_type_flats(),
    dark: m.naming_type_darks(),
    bias: m.naming_type_bias(),
    master_flat: m.import_type_master_flat(),
    master_dark: m.import_type_master_dark(),
    master_bias: m.calibration_caption_bias(),
  }
  return words[type]
}

function templateColumns(m: Messages): Column<NamingTemplate>[] {
  return [
    { id: "type", header: m.session_frame_type(), rowHeader: true, sortValue: (t) => t.frameType, cell: (t) => frameTypeText(m, t.frameType) },
    { id: "template", header: m.template_column_template(), truncate: true, sortValue: (t) => t.template, cell: (t) => <PathText path={t.template} truncate /> },
    { id: "default", header: m.settings_default(), sortValue: (t) => (t.overridden ? 1 : 0), cell: (t) => (t.overridden ? m.settings_default_named({ name: t.defaultTemplate }) : m.settings_default()) },
  ]
}

export function NamingPage() {
  const m = useMessages()
  const client = useQueryClient()
  const naming = useQuery(namingQuery())
  const workflow = useQuery(workflowQuery())
  const [editing, setEditing] = useState<NamingTemplate | null>(null)
  const [keywords, setKeywords] = useState(false)
  const overridden = naming.data?.some((t) => t.overridden) ?? false
  const restore = m.settings_restore_defaults()
  const rowActions = (t: NamingTemplate): MenuItem[] => [
    { id: "edit-template", label: m.settings_edit(), opensDialog: true, run: () => setEditing(t) },
    {
      id: "use-default",
      label: m.settings_use_default(),
      unavailable: t.overridden ? undefined : { action: m.settings_use_default(), reason: m.settings_at_defaults(), blockers: [] },
      run: () => settingsWrite(client, () => library.namingSave(t.frameType, t.defaultTemplate)),
    },
  ]
  return (
    <SettingsPage
      title={m.settings_naming()}
      actions={
        <ActionButton
          action={{
            id: "restore-naming",
            label: restore,
            unavailable: overridden ? undefined : { action: restore, reason: m.settings_at_defaults(), blockers: [] },
            confirm: { title: m.settings_restore_naming_title(), confirm: { label: restore } },
            run: () => settingsWrite(client, () => library.namingRestoreDefaults()),
          }}
        />
      }
    >
      <Read query={naming} label={m.naming_folder_templates()}>
        {(rows) => (
          <ListSection
            title={m.naming_folder_templates()}
            table={{ label: m.naming_folder_templates(), rows, columns: templateColumns(m), getRowId: (t) => t.frameType, rowLabel: (t) => frameTypeText(m, t.frameType), rowActions }}
          />
        )}
      </Read>
      <Section
        title={m.settings_label_group_keywords()}
        level={3}
        actions={workflow.data ? <ActionButton action={{ id: "edit-keywords", label: m.settings_edit(), icon: Pencil, opensDialog: true, run: () => setKeywords(true) }} /> : undefined}
      >
        <Read query={workflow} label={m.settings_label_group_keywords()}>
          {(record) => (
            <KeyValueList
              items={[
                { label: m.naming_keyword_group(), value: record.settings.keywords.group, mono: true },
                { label: m.targets_panel(), value: record.settings.keywords.panel, mono: true },
              ]}
            />
          )}
        </Read>
      </Section>
      {editing ? <TemplateDialog template={editing} open onOpenChange={(open) => !open && setEditing(null)} /> : null}
      {workflow.data ? <KeywordsDialog record={workflow.data} open={keywords} onOpenChange={setKeywords} /> : null}
    </SettingsPage>
  )
}

function TemplateDialog({ template, open, onOpenChange }: { template: NamingTemplate; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const { values, set, shown } = useDialogForm(open, () => ({ template: template.template }))
  const text = values.template.trim()
  const preview = useQuery({ ...libraryQuery("namingPreview", template.frameType, text, null), enabled: open && text !== "" })
  const label = m.settings_save()
  const errors = { template: text ? (preview.isError ? readError(m, preview.error) : undefined) : m.settings_template_required() }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.settings_edit_title({ name: frameTypeText(m, template.frameType) })}
      confirm={{ id: "save-template", label, kind: "primary", unavailable: blockedByErrors(m, label, errors), run: () => settingsWrite(client, () => library.namingSave(template.frameType, text)) }}
    >
      <TextField label={m.template_column_template()} mono value={values.template} onChange={(next) => set({ template: next })} error={shown(errors, "template")} autoFocus />
      <KeyValueList
        items={[
          { label: m.fields_template_preview(), value: preview.data ? <PathText path={preview.data.relativePath} /> : "–" },
          { label: m.settings_default(), value: <PathText path={template.defaultTemplate} /> },
        ]}
      />
    </FormDialog>
  )
}

const KEYWORD = /^[A-Za-z][A-Za-z0-9-]*$/

function KeywordsDialog({ record, open, onOpenChange }: { record: WorkflowSettingsRecord_Serialize; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const { values, set, shown } = useDialogForm(open, () => ({ group: record.settings.keywords.group, panel: record.settings.keywords.panel }))
  const label = m.settings_save()
  const check = (name: string) => (KEYWORD.test(name.trim()) ? undefined : m.settings_keyword_invalid({ name: name.trim() || "–" }))
  const errors = {
    group: check(values.group),
    panel: check(values.panel) ?? (values.panel.trim().toLowerCase() === values.group.trim().toLowerCase() ? m.settings_keyword_same({ kind: m.naming_keyword_group(), name: values.panel.trim() }) : undefined),
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.settings_label_group_keywords()}
      confirm={{
        id: "save-keywords",
        label,
        kind: "primary",
        unavailable: blockedByErrors(m, label, errors),
        run: () => settingsWrite(client, () => library.workflowSettingsSave({ ...record.settings, keywords: { group: values.group.trim(), panel: values.panel.trim() } }, record.revision)),
      }}
    >
      <TextField label={m.naming_keyword_group()} description={m.naming_keyword_group_help({ keyword: values.group.trim() || "–" })} mono value={values.group} onChange={(group) => set({ group })} error={shown(errors, "group")} autoFocus />
      <TextField label={m.targets_panel()} description={m.naming_keyword_panel_help({ keyword: values.panel.trim() || "–" })} mono value={values.panel} onChange={(panel) => set({ panel })} error={shown(errors, "panel")} />
    </FormDialog>
  )
}
