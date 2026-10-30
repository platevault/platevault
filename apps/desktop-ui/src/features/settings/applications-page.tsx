/**
 * Settings › Applications (PREP-FR-02, D04): the handoff profiles a
 * Project's View opens in (`prepare_profiles`). Add application… records a
 * profile with its kind, the executable the user locates through the native
 * file picker (`library_pick_file`; Cancel answers `null` and changes
 * nothing) and its launch arguments, where `{view}` stands for the
 * Project's View folder (`prepare_profile_create`). Edit… replaces a profile
 * at its revision (`prepare_profile_update`). A refusal keeps the dialog
 * open with the user's values.
 *
 * The library has no command that removes a profile, so none is offered.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { FileSearch, Plus } from "lucide-react"
import { useState } from "react"
import { library, type NativePathWire, type Profile, type ProfileInput, type ProfileKind } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { PathText } from "@/components/app/data"
import { ArgumentsField, FieldGroup, SelectField, TextField } from "@/components/app/fields"
import { blockedByErrors, type FieldPaths, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { ListSection, SettingsPage } from "@/components/templates/settings-page"
import type { Messages } from "@/lib/i18n"
import { Read } from "./parts"
import { profilesQuery, settingsWrite } from "./queries"

const KINDS: readonly ProfileKind[] = ["wbpp", "siril", "seti", "generic"]
const TOKENS = ["view"] as const

export function kindText(m: Messages, kind: ProfileKind): string {
  const words: Record<ProfileKind, string> = { wbpp: m.settings_app_kind_wbpp(), siril: m.settings_app_kind_siril(), seti: m.settings_app_kind_seti(), generic: m.apps_other() }
  return words[kind]
}

/**
 * Launch arguments as one line. Only an argument with whitespace or a quote,
 * or an empty one, is quoted, with its quotes and backslashes escaped; any
 * other argument, a Windows path included, reads as typed.
 */
export function argsText(args: readonly string[]): string {
  return args.map((arg) => (arg === "" || /[\s"]/.test(arg) ? `"${arg.replace(/["\\]/g, "\\$&")}"` : arg)).join(" ")
}

/**
 * One line of arguments split at spaces outside double quotes. Inside
 * quotes a backslash before a quote or a backslash keeps that character;
 * every other backslash is kept as typed. `parseArgs(argsText(args))` is
 * `args`.
 */
export function parseArgs(line: string): string[] {
  const args: string[] = []
  let current = ""
  let quoted = false
  let started = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i] as string
    const next = line[i + 1]
    if (quoted && char === "\\" && (next === '"' || next === "\\")) {
      current += next
      i++
    } else if (char === '"') {
      quoted = !quoted
      started = true
    } else if (/\s/.test(char) && !quoted) {
      if (started) args.push(current)
      current = ""
      started = false
    } else {
      current += char
      started = true
    }
  }
  if (started) args.push(current)
  return args
}

function columns(m: Messages): Column<Profile>[] {
  return [
    { id: "name", header: m.apps_name(), rowHeader: true, truncate: true, truncateMin: "name", sortValue: (p) => p.name, cell: (p) => p.name },
    { id: "kind", header: m.apps_col_application(), sortValue: (p) => p.kind, cell: (p) => kindText(m, p.kind) },
    { id: "path", header: m.apps_col_path(), truncate: true, sortValue: (p) => p.executable?.display ?? null, cell: (p) => (p.executable ? <PathText path={p.executable.display} truncate /> : m.apps_not_located()) },
    { id: "args", header: m.apps_col_arguments(), truncate: true, sortValue: (p) => argsText(p.args), cell: (p) => (p.args.length > 0 ? <PathText path={argsText(p.args)} truncate /> : "–") },
  ]
}

export function ApplicationsPage() {
  const m = useMessages()
  const profiles = useQuery(profilesQuery())
  // Only the id: the dialog reads the profile from the current read, so a Save after `conflict` names the revision read again.
  const [editing, setEditing] = useState<string | null>(null)
  const edited = editing && editing !== "new" ? profiles.data?.find((p) => p.id === editing) : undefined
  const rowActions = (p: Profile): MenuItem[] => [{ id: "edit-profile", label: m.settings_edit(), opensDialog: true, run: () => setEditing(p.id) }]
  return (
    <SettingsPage title={m.settings_applications()}>
      <Read query={profiles} label={m.apps_list_title()}>
        {(rows) => (
          <ListSection
            title={m.apps_list_title()}
            add={{ id: "add-profile", label: m.apps_add(), icon: Plus, opensDialog: true, run: () => setEditing("new") }}
            table={{ label: m.apps_list_title(), rows, columns: columns(m), getRowId: (p) => p.id, rowLabel: (p) => p.name, rowActions, stickyFirstColumn: true, empty: m.apps_none() }}
          />
        )}
      </Read>
      {editing === "new" || edited ? <ProfileDialog profile={edited ?? null} open onOpenChange={(open) => !open && setEditing(null)} /> : null}
    </SettingsPage>
  )
}

interface ProfileDraft {
  name: string
  kind: ProfileKind
  executable: NativePathWire | null
  args: string
}
const PROFILE_PATHS: FieldPaths<keyof ProfileDraft> = { name: "name", args: "args" }

function ProfileDialog({ profile, open, onOpenChange }: { profile: Profile | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const { values, set, shown, refusing } = useDialogForm<ProfileDraft>(open, () => ({ name: profile?.name ?? "", kind: profile?.kind ?? "wbpp", executable: profile?.executable ?? null, args: argsText(profile?.args ?? []) }))
  const label = m.settings_save()
  const errors = { name: values.name.trim() ? undefined : m.settings_name_required() }
  const locate: Action = {
    id: "locate-executable",
    label: values.executable ? m.apps_change_action() : m.apps_locate_action(),
    icon: FileSearch,
    run: async () => {
      const picked = await library.libraryPickFile()
      if (picked.ok && picked.data) set({ executable: picked.data })
      return picked
    },
  }
  const input = (): ProfileInput => ({
    name: values.name.trim(),
    kind: values.kind,
    executable: values.executable,
    args: parseArgs(values.args),
    // Editing the launch keeps the evidence the library recorded; a new profile starts with none.
    ...(profile ? { capabilityEvidence: profile.capabilityEvidence } : {}),
  })
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={profile ? m.settings_edit_title({ name: profile.name }) : m.apps_add()}
      confirm={{
        id: "save-profile",
        label,
        kind: "primary",
        unavailable: blockedByErrors(m, label, errors),
        run: () => refusing(settingsWrite(client, () => (profile ? library.prepareProfileUpdate(profile.id, profile.revision, input()) : library.prepareProfileCreate(input()))), PROFILE_PATHS),
      }}
    >
      <TextField label={m.apps_name()} value={values.name} onChange={(name) => set({ name })} error={shown(errors, "name")} autoFocus />
      <SelectField<ProfileKind> label={m.apps_col_application()} value={values.kind} options={KINDS.map((value) => ({ value, label: kindText(m, value) }))} onChange={(kind) => set({ kind })} />
      <FieldGroup label={m.apps_col_path()} action={<ActionButton action={locate} />}>
        {values.executable ? <PathText path={values.executable.display} /> : m.apps_not_located()}
      </FieldGroup>
      <ArgumentsField label={m.apps_launch_arguments()} value={values.args} onChange={(args) => set({ args })} tokens={TOKENS} placeholder={m.apps_launch_placeholder({ token: "{view}" })} error={shown({}, "args")} />
    </FormDialog>
  )
}
