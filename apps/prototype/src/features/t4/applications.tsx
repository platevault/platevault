/**
 * `/settings/applications` — Applications (PREP-FR-01, PREP-FR-02; J23 S8;
 * plan §4a, C AP1-AP7). One table of application profiles: the
 * application, whether its profile is verified, the located executable and
 * what PlateVault detects there, and its launch arguments, which every
 * application takes. A row's disclosure shows the profile's evidence. Locate
 * opens the OS chooser with the applications PlateVault detects on this
 * computer; Add application adds a generic profile. Run view holds the
 * default run view and, on Windows, the Developer Mode check symlinks need
 * (P-PREP3).
 */
import { AppWindow, Plus } from "lucide-react"
import { useState } from "react"
import { DeveloperModeStatus } from "@/app/developer-mode"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { KeyValueList, PathText } from "@/components/app/data"
import { EmptyState, useSaveState } from "@/components/app/feedback"
import { ArgumentsField, PathField, SegmentedField, SelectField, TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { SettingsSection } from "@/components/app/settings"
import { StatusBadge } from "@/components/app/status"
import { ListSection, SettingsPage } from "@/components/templates/settings-page"
import { MODE_NAME } from "@/domain/labels"
import type { ApplicationProfile, InputMode } from "@/domain/types"
import { type Messages, say } from "@/lib/i18n"
import { addApplicationProfile, checkExecutable, locateExecutable, removeApplicationProfile, setDefaultRunView, setLaunchArgs } from "@/store/actions/settings"
import { useStore } from "@/store/core"

const ORDER = ["pixinsight-wbpp", "siril", "seti-astro", "generic"]

/** The tokens launch arguments may use; PlateVault fills them in at launch. */
const ARGUMENT_TOKENS = ["viewFolder"] as const

const RUN_VIEWS: InputMode[] = ["symlink", "copy"]

/** The profile's evidence and what it does not support, under its row's disclosure (D04, PREP-FR-01). */
function ProfileDetails({ profile }: { profile: ApplicationProfile }) {
  const m = useMessages()
  const c = profile.capability
  return (
    <KeyValueList
      items={[
        { label: m.apps_evidence(), value: say(m, c.evidence) },
        { label: m.apps_corrected_values(), value: `${c.correctedMetadata === "configuration" ? m.apps_corrected_through() : m.apps_corrected_not_through()} · ${m.apps_rename_note()}` },
      ]}
    />
  )
}

/** The applications PlateVault detects on this computer, for the Detected choice. */
function useDetected(): { value: string; label: string }[] {
  const apps = useStore((s) => s.disk.apps)
  return apps.filter((app) => app.present).map((app) => ({ value: app.path, label: app.name }))
}

/** Where a profile's executable is: a detected application, or another one chosen in the OS chooser. */
function ExecutableFields({ path, onChange }: { path: string; onChange: (path: string) => void }) {
  const m = useMessages()
  const detected = useDetected()
  const OTHER = ""
  return (
    <>
      <SelectField
        label={m.apps_detected()}
        value={detected.some((d) => d.value === path) ? path : OTHER}
        options={[...detected, { value: OTHER, label: detected.length ? m.apps_other() : m.apps_none_detected(), disabled: true }]}
        onChange={onChange}
      />
      <PathField mode="executable" label={m.apps_col_path()} value={path || null} onChange={onChange} initialPath={path || null} />
    </>
  )
}

function LocateDialog({ profile, onClose }: { profile: ApplicationProfile | null; onClose: () => void }) {
  const m = useMessages()
  const detected = useDetected()
  const [path, setPath] = useState("")
  const [shownFor, setShownFor] = useState<ApplicationProfile | null>(null)
  if (profile !== shownFor) {
    setShownFor(profile)
    // A recorded path whose bundle is gone is not preselected: confirming it would record the missing path again.
    if (profile) setPath(detected.find((d) => d.value === profile.executablePath)?.value ?? detected.find((d) => d.label === profile.name.split(" /")[0])?.value ?? "")
  }
  const label = m.apps_use_this()
  const confirm: Action = {
    id: "locate",
    label,
    kind: "primary",
    unavailable: path ? undefined : { action: label, reason: m.apps_not_located(), blockers: [] },
    run: () => (profile ? locateExecutable(profile.id, path) : undefined),
  }
  return (
    <FormDialog open={profile !== null} onOpenChange={(open) => !open && onClose()} title={m.settings_locate_named({ name: profile?.name ?? "" })} confirm={confirm}>
      <ExecutableFields path={path} onChange={setPath} />
    </FormDialog>
  )
}

function ArgumentsDialog({ profile, onClose }: { profile: ApplicationProfile | null; onClose: () => void }) {
  const m = useMessages()
  const [args, setArgs] = useState("")
  const [shownFor, setShownFor] = useState<ApplicationProfile | null>(null)
  if (profile !== shownFor) {
    setShownFor(profile)
    if (profile) setArgs(profile.launchArgs)
  }
  const confirm: Action = { id: "save-arguments", label: m.apps_save_arguments(), kind: "primary", run: () => (profile ? setLaunchArgs(profile.id, args.trim()) : undefined) }
  return (
    <FormDialog open={profile !== null} onOpenChange={(open) => !open && onClose()} title={m.apps_arguments_title({ name: profile?.name ?? "" })} confirm={confirm}>
      <ArgumentsField label={m.apps_launch_arguments()} value={args} onChange={setArgs} tokens={ARGUMENT_TOKENS} placeholder={m.apps_launch_placeholder({ token: "{viewFolder}" })} />
    </FormDialog>
  )
}

function AddApplicationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const m = useMessages()
  const detected = useDetected()
  const [name, setName] = useState("")
  const [path, setPath] = useState("")
  const [args, setArgs] = useState("")
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName("")
      setPath("")
      setArgs("")
    }
  }
  const label = m.apps_add()
  const missing = [...(name.trim() ? [] : [{ label: m.settings_name_required() }]), ...(path ? [] : [{ label: m.apps_not_located() }])]
  const confirm: Action = {
    id: "add-application",
    label,
    kind: "primary",
    unavailable: missing.length ? { action: m.actions_blocked({ action: label }), reason: m.refusal_blockers({ count: missing.length }), blockers: missing } : undefined,
    run: () => addApplicationProfile({ name: name.trim(), executablePath: path, launchArgs: args.trim() }).result,
  }
  return (
    <FormDialog open={open} onOpenChange={(next) => !next && onClose()} title={label} confirm={confirm}>
      <ExecutableFields
        path={path}
        onChange={(next) => {
          setPath(next)
          // The detected application names the profile until the user types a name.
          if (!name.trim()) setName(detected.find((d) => d.value === next)?.label ?? "")
        }}
      />
      <TextField label={m.apps_name()} value={name} onChange={setName} autoFocus />
      <ArgumentsField label={m.apps_launch_arguments()} value={args} onChange={setArgs} tokens={ARGUMENT_TOKENS} placeholder={m.apps_launch_placeholder({ token: "{viewFolder}" })} />
    </FormDialog>
  )
}

function profileColumns(m: Messages): Column<ApplicationProfile>[] {
  return [
    { id: "application", header: m.apps_col_application(), rowHeader: true, truncate: true, sortValue: (p) => p.name, cell: (p) => p.name },
    { id: "profile", header: m.apps_col_profile(), sortValue: (p) => (p.capability.verified ? 0 : 1), cell: (p) => <StatusBadge kind="profile" value={p.capability.verified ? "verified" : "unverified"} /> },
    { id: "path", header: m.apps_col_path(), truncate: true, sortValue: (p) => p.executablePath, cell: (p) => (p.executablePath ? <PathText path={p.executablePath} truncate /> : m.apps_not_located()) },
    { id: "detected", header: m.apps_col_detected(), sortValue: (p) => p.executableState, cell: (p) => <StatusBadge kind="executable" value={p.executableState} /> },
    { id: "arguments", header: m.apps_col_arguments(), truncate: true, sortValue: (p) => p.launchArgs, cell: (p) => p.launchArgs || "–" },
  ]
}

export function SettingsApplicationsPage() {
  const m = useMessages()
  const profiles = useStore((s) => s.catalog.profiles)
  const view = useStore((s) => s.settings.defaultRunView)
  const [locating, setLocating] = useState<ApplicationProfile | null>(null)
  const [editingArgs, setEditingArgs] = useState<ApplicationProfile | null>(null)
  const [adding, setAdding] = useState(false)
  const { save, indicator } = useSaveState()
  const rows = Object.values(profiles).sort((a, b) => ORDER.indexOf(a.application) - ORDER.indexOf(b.application))

  function locate(profile: ApplicationProfile): Action {
    return { id: "locate", label: profile.executablePath ? m.apps_change_action() : m.apps_locate_action(), opensDialog: true, run: () => setLocating(profile) }
  }

  function rowActions(profile: ApplicationProfile): MenuItem[] {
    return [
      locate(profile),
      ...(profile.executablePath ? [{ id: "check", label: m.apps_check_again(), run: () => checkExecutable(profile.id) }] : []),
      { id: "arguments", label: m.apps_edit_arguments(), opensDialog: true, run: () => setEditingArgs(profile) },
      ...(profile.application === "generic"
        ? [
            { separator: true } as const,
            {
              id: "remove",
              label: m.settings_remove(),
              kind: "destructive" as const,
              opensDialog: true,
              confirm: { title: m.settings_remove_title({ name: profile.name }), confirm: { label: m.apps_remove(), kind: "destructive" as const } },
              run: () => removeApplicationProfile(profile.id),
            },
          ]
        : []),
    ]
  }

  const add: Action = { id: "add-application", label: m.apps_add(), icon: Plus, opensDialog: true, run: () => setAdding(true) }

  return (
    <SettingsPage title={m.settings_applications()}>
      <SettingsSection title={m.run_check_mode()} actions={indicator}>
        <SegmentedField
          label={m.settings_default_run_view()}
          value={view}
          options={RUN_VIEWS.map((mode) => ({ value: mode, label: say(m, MODE_NAME[mode]) }))}
          onChange={(mode) => save(() => setDefaultRunView(mode))}
        />
        <DeveloperModeStatus />
      </SettingsSection>

      <ListSection<ApplicationProfile>
        title={m.apps_list_title()}
        add={add}
        table={{
          label: m.settings_applications(),
          rows,
          columns: profileColumns(m),
          getRowId: (p) => p.id,
          rowLabel: (p) => p.name,
          empty: <EmptyState icon={AppWindow} title={m.apps_none()} action={<ActionButton action={add} />} />,
          primaryRowAction: (p) => (p.executableState === "found" ? null : locate(p)),
          rowActions,
          expand: { render: (p) => <ProfileDetails profile={p} /> },
        }}
      />

      <LocateDialog profile={locating} onClose={() => setLocating(null)} />
      <ArgumentsDialog profile={editingArgs} onClose={() => setEditingArgs(null)} />
      <AddApplicationDialog open={adding} onClose={() => setAdding(false)} />
    </SettingsPage>
  )
}
