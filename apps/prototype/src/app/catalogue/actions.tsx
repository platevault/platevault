/**
 * Catalogue entry for the action components (design/R9-COMPOSITION-PLAN.md
 * §8.3): Button roles × sizes × states, ActionButton kinds, ActionBar,
 * ActionMenu, MenuItems, RowActions with RowContextMenu, and IconButton.
 * Every visible string comes from the message catalogue (catalogue_actions_*
 * for the reviewer captions). Key legends follow app/shortcuts.tsx. The demo
 * actions write nothing to the store: refusals and failures come back as
 * results, so those states can be triggered here.
 */
import { ChevronLeft, ChevronRight, Copy, Pencil, Play, RefreshCw, Trash2 } from "lucide-react"
import { useMessages } from "@/app/preferences"
import { MOD_LABEL } from "@/app/shortcuts"
import { ActionBar, ActionButton, ActionMenu, IconButton, MenuItems, useAction } from "@/components/app/actions"
import type { Action, MenuItem } from "@/components/app/contracts"
import { Section } from "@/components/app/page"
import { RowActions, RowContextMenu } from "@/components/app/row-actions"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu"
import { Spinner } from "@/components/ui/spinner"
import type { Messages } from "@/lib/i18n"
import type { CommitResult } from "@/store/core"
import { useStore } from "@/store/core"
import { Specimen } from "./specimen"

/** Each Button variant with the caption naming its role. */
const ROLES = [
  ["default", (m: Messages) => m.catalogue_actions_role_primary()],
  ["outline", (m: Messages) => m.catalogue_actions_role_standard()],
  ["ghost", (m: Messages) => m.catalogue_actions_role_quiet()],
  ["destructive", (m: Messages) => m.catalogue_actions_role_destructive()],
  ["link", (m: Messages) => m.catalogue_actions_role_link()],
] as const

const SIZES = ["sm", "default", "xs"] as const

const SPINNER_SIZE: Record<(typeof SIZES)[number], string | undefined> = { sm: "size-3.5", default: undefined, xs: "size-3" }

const done = (): CommitResult => ({ ok: true })

/** Settles after a moment, so the busy state can be seen. */
const slowly = (): Promise<CommitResult> => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 1500))

/** The demo set: every kind, a dialog opener, a confirm, an unavailable action, a refusal, a failure and a slow run. */
function demoActions(m: Messages, names: string[]) {
  const start: Action = { id: "start", label: m.startrun_title(), icon: Play, kind: "primary", run: slowly }
  const rename: Action = { id: "rename", label: m.run_rename(), icon: Pencil, opensDialog: true, shortcut: `${MOD_LABEL}R`, run: done }
  const rescan: Action = { id: "rescan", label: m.location_rescan(), icon: RefreshCw, run: slowly }
  const copyPath: Action = { id: "copy-path", label: m.session_copy_path(), icon: Copy, shortcut: `⇧${MOD_LABEL}C`, run: done }
  const duplicate: Action = { id: "duplicate", label: m.template_duplicate(), run: done }
  const archive: Action = {
    id: "archive",
    label: m.wrapup_archive_title(),
    run: done,
    unavailable: { action: m.sessions_cant_archive(), reason: m.sessions_in_a_project({ count: 2 }), blockers: names.slice(0, 2).map((label) => ({ label })) },
  }
  const remove: Action = {
    id: "remove",
    label: m.run_remove(),
    run: (): CommitResult => ({ ok: false, reason: "refused", message: m.project_refusal_remove_rig(), reasons: names }),
  }
  const fail: Action = {
    id: "rescan-fail",
    label: m.location_rescan(),
    run: (): CommitResult => ({ ok: false, reason: "write-failed", message: m.op_prep_write_removed({ folder: "/Volumes/Astro-T7/Captures" }) }),
  }
  const trash: Action = {
    id: "trash",
    label: m.run_move_to_trash(),
    icon: Trash2,
    run: done,
    confirm: {
      title: m.run_trash_title({ name: names[0] ?? "" }),
      groups: [{ label: m.nav_sessions(), rows: [{ file: "M31_L_300s_0001.fits", from: "/Volumes/Astro-T7/Captures", action: "trash", size: 33_554_432 }] }],
      confirm: { label: m.run_move_to_trash() },
    },
  }
  const destroy: Action = {
    id: "delete",
    label: m.template_delete(),
    kind: "destructive",
    run: done,
    confirm: { title: m.template_delete_title({ name: names[0] ?? "" }), groups: [{ label: m.nav_sessions(), rows: [] }], confirm: { label: m.template_delete(), kind: "destructive" } },
  }
  return { start, rename, rescan, copyPath, duplicate, archive, remove, fail, trash, delete: destroy }
}

type DemoActions = ReturnType<typeof demoActions>

/** A sub-heading and its one-line reviewer caption. */
function Part({ heading, caption }: { heading: string; caption: string }) {
  return (
    <>
      <h3 className="text-sm font-semibold">{heading}</h3>
      <p className="text-xs text-pretty text-muted-foreground">{caption}</p>
    </>
  )
}

function RoleMatrix() {
  const m = useMessages()
  const states = [m.catalogue_actions_state_default(), m.catalogue_actions_state_disabled(), m.catalogue_actions_state_loading()]
  return (
    <div className="space-y-2">
      <Part heading={m.catalogue_actions_roles_heading()} caption={m.catalogue_actions_roles_caption()} />
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        {SIZES.map((size) => (
          <div key={size} className="grid grid-cols-[auto_repeat(3,auto)] items-center gap-x-3 gap-y-2 text-xs">
            <span className="font-medium">{m.catalogue_actions_size({ size })}</span>
            {states.map((state) => (
              <span key={state} className="text-muted-foreground">
                {state}
              </span>
            ))}
            {ROLES.map(([variant, role]) => (
              <div key={variant} className="contents">
                <span className="text-muted-foreground">{role(m)}</span>
                <Button variant={variant} size={size}>
                  {m.startrun_title()}
                </Button>
                <Button variant={variant} size={size} disabled focusableWhenDisabled>
                  {m.startrun_title()}
                </Button>
                <Button variant={variant} size={size} aria-busy="true">
                  <Spinner aria-hidden="true" data-icon="inline-start" className={SPINNER_SIZE[size]} />
                  {m.startrun_title()}
                </Button>
              </div>
            ))}
          </div>
        ))}
        <div className="grid grid-cols-[auto_repeat(2,auto)] items-center gap-x-3 gap-y-2 text-xs">
          <span className="font-medium">{m.catalogue_actions_size({ size: "icon-sm" })}</span>
          <span className="text-muted-foreground">{states[0]}</span>
          <span className="text-muted-foreground">{states[1]}</span>
          <span className="text-muted-foreground">{m.catalogue_actions_role_icon()}</span>
          <IconButton label={m.targets_night_previous()} icon={ChevronLeft} shortcut={`${MOD_LABEL}←`} />
          <IconButton label={m.targets_night_next()} icon={ChevronRight} shortcut={`${MOD_LABEL}→`} disabled focusableWhenDisabled />
        </div>
      </div>
    </div>
  )
}

function KindMatrix({ actions }: { actions: DemoActions }) {
  const m = useMessages()
  const caption = m.catalogue_actions_button_caption({
    archive: actions.archive.label,
    start: actions.start.label,
    rescan: actions.rescan.label,
    remove: actions.remove.label,
    retry: m.verb_retry(),
  })
  return (
    <div className="space-y-2">
      <Part heading={m.catalogue_actions_button_heading()} caption={caption} />
      {SIZES.map((size) => (
        <Specimen key={size} caption={m.catalogue_actions_size({ size })}>
          <ActionButton action={actions.start} size={size} />
          <ActionButton action={actions.rescan} size={size} />
          <ActionButton action={actions.delete} size={size} />
          <ActionButton action={actions.archive} size={size} />
          <ActionButton action={actions.remove} size={size} />
          <ActionButton action={actions.fail} size={size} />
        </Specimen>
      ))}
    </div>
  )
}

function Bars({ actions }: { actions: DemoActions }) {
  const m = useMessages()
  const { start, rename, rescan, copyPath, duplicate, archive, remove, trash } = actions
  return (
    <div className="space-y-3">
      <Part heading={m.catalogue_actions_bar_heading()} caption={m.catalogue_actions_bar_caption({ more: m.common_more() })} />
      <div className="flex flex-col items-end gap-4 rounded-lg border p-3">
        <ActionBar actions={[rename, rescan, copyPath, duplicate, start, actions.delete]} overflow={[archive, trash, remove]} />
        <ActionBar actions={[rename, start]} overflow={[archive, trash, actions.delete]} menuLabel={m.project_noun()} />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {m.catalogue_actions_bar_empty()}
          <ActionBar actions={[]} />
        </div>
      </div>
    </div>
  )
}

function Menus({ actions }: { actions: DemoActions }) {
  const m = useMessages()
  const { rename, rescan, copyPath, archive, remove, trash } = actions
  const items: MenuItem[] = [
    actions.delete,
    { heading: m.calibration_run() },
    rename,
    copyPath,
    { submenu: m.verb_open(), items: [{ id: "pixinsight", label: m.run_open_in({ app: "PixInsight" }), run: done }, { id: "siril", label: m.run_open_in({ app: "Siril" }), run: done }] },
    { separator: true },
    { separator: true },
    rescan,
    archive,
    trash,
    remove,
    { separator: true },
  ]
  return (
    <div className="space-y-2">
      <Part heading={m.catalogue_actions_menu_heading()} caption={m.catalogue_actions_menu_caption({ delete: actions.delete.label })} />
      <div className="flex flex-wrap items-start gap-3">
        <ActionMenu label={m.calibration_run()} items={items} />
        <ContextMenuDemo items={items} />
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {m.catalogue_actions_menu_empty()}
          <ActionMenu label={m.calibration_run()} items={[{ heading: m.calibration_run() }, { separator: true }]} />
        </span>
      </div>
    </div>
  )
}

function ContextMenuDemo({ items }: { items: MenuItem[] }) {
  const m = useMessages()
  const runner = useAction()
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger className="flex h-16 w-64 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">{m.catalogue_actions_context_target()}</ContextMenuTrigger>
        <ContextMenuContent aria-label={m.catalogue_actions_context_name()}>
          <MenuItems items={items} runner={runner} />
        </ContextMenuContent>
      </ContextMenu>
      {runner.feedback}
      {runner.dialog}
    </>
  )
}

function Rows({ actions, names }: { actions: DemoActions; names: string[] }) {
  const m = useMessages()
  const runner = useAction()
  const items: MenuItem[] = [actions.rename, actions.copyPath, actions.archive, actions.delete, actions.remove]
  return (
    <div className="space-y-2">
      <Part heading={m.catalogue_actions_rows_heading()} caption={m.catalogue_actions_rows_caption()} />
      <ul className="w-96 divide-y rounded-lg border">
        {names.map((name) => (
          <RowContextMenu key={name} name={name} items={items} runner={runner}>
            <li tabIndex={0} aria-label={name} className="flex items-center justify-between gap-2 px-3 py-1 text-sm outline-offset-[-2px]">
              <span className="min-w-0 truncate">{name}</span>
              <RowActions name={name} items={items} runner={runner} />
            </li>
          </RowContextMenu>
        ))}
        <li className="flex items-center justify-between gap-2 px-3 py-1 text-sm text-muted-foreground">
          <span>{m.catalogue_actions_rows_none()}</span>
          <RowActions name="—" items={[{ separator: true }]} />
        </li>
      </ul>
      {runner.feedback}
      {runner.dialog}
    </div>
  )
}

export function ActionsCatalogue() {
  const m = useMessages()
  const targets = useStore((s) => s.catalog.targets)
  const names = Object.values(targets)
    .slice(0, 3)
    .map((target) => target.name)
  const actions = demoActions(m, names)
  return (
    <Section title={m.catalogue_actions_heading()} description={m.catalogue_actions_summary()}>
      <div className="space-y-6">
        <RoleMatrix />
        <KindMatrix actions={actions} />
        <Bars actions={actions} />
        <Menus actions={actions} />
        <Rows actions={actions} names={names} />
      </div>
    </Section>
  )
}
