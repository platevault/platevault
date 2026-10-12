/**
 * Catalogue entry for the action components (design/R9-COMPOSITION-PLAN.md
 * §8.3): Button roles × sizes × states, ActionButton kinds, ActionBar,
 * ActionMenu, MenuItems, RowActions with RowContextMenu, and IconButton.
 * Component content is real catalogue copy; captions speak to the reviewer.
 * Every demo action runs against no store: refusals and failures are
 * returned as results, so the error states can be triggered here.
 */
import { ChevronLeft, ChevronRight, Copy, Pencil, Play, RefreshCw, Trash2 } from "lucide-react"
import { useMessages } from "@/app/preferences"
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

const ROLES = [
  ["default", "primary"],
  ["outline", "standard"],
  ["ghost", "quiet"],
  ["destructive", "destructive"],
  ["link", "link"],
] as const

const SIZES = ["sm", "default", "xs"] as const

const done = (): CommitResult => ({ ok: true })

/** Settles after a moment, so the busy state can be seen. */
const slowly = (): Promise<CommitResult> => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 1500))

/** The demo set: every kind, a dialog opener, a confirm, an unavailable action, a refusal, a failure and a slow run. */
function demoActions(m: Messages, names: string[]) {
  const start: Action = { id: "start", label: m.startrun_title(), icon: Play, kind: "primary", run: slowly }
  const rename: Action = { id: "rename", label: m.run_rename(), icon: Pencil, opensDialog: true, shortcut: "⌘R", run: done }
  const rescan: Action = { id: "rescan", label: m.location_rescan(), icon: RefreshCw, run: slowly }
  const copyPath: Action = { id: "copy-path", label: m.session_copy_path(), icon: Copy, shortcut: "⌥⌘C", run: done }
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
  const remove2: Action = {
    id: "delete",
    label: m.template_delete(),
    kind: "destructive",
    run: done,
    confirm: { title: m.template_delete_title({ name: names[0] ?? "" }), groups: [{ label: m.nav_sessions(), rows: [] }], confirm: { label: m.template_delete(), kind: "destructive" } },
  }
  return { start, rename, rescan, copyPath, duplicate, archive, remove, fail, trash, delete: remove2 }
}

function RoleMatrix() {
  const m = useMessages()
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Button roles</h3>
      <p className="text-xs text-muted-foreground">Variant × size × state. Point at, Tab to or press any button for hover, focus-visible and active. Disabled stays focusable.</p>
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        {SIZES.map((size) => (
          <div key={size} className="grid grid-cols-[auto_repeat(3,auto)] items-center gap-x-3 gap-y-2 text-xs">
            <span className="font-mono">{size}</span>
            <span className="text-muted-foreground">default</span>
            <span className="text-muted-foreground">disabled</span>
            <span className="text-muted-foreground">loading</span>
            {ROLES.map(([variant, role]) => (
              <div key={variant} className="contents">
                <span className="font-mono text-muted-foreground">
                  {variant} ({role})
                </span>
                <Button variant={variant} size={size}>
                  {m.startrun_title()}
                </Button>
                <Button variant={variant} size={size} disabled focusableWhenDisabled>
                  {m.startrun_title()}
                </Button>
                <Button variant={variant} size={size} aria-busy="true">
                  <Spinner aria-hidden="true" data-icon="inline-start" className={size === "xs" ? "size-3" : size === "sm" ? "size-3.5" : undefined} />
                  {m.startrun_title()}
                </Button>
              </div>
            ))}
          </div>
        ))}
        <div className="grid grid-cols-[auto_repeat(2,auto)] items-center gap-x-3 gap-y-2 text-xs">
          <span className="font-mono">icon-sm</span>
          <span className="text-muted-foreground">default</span>
          <span className="text-muted-foreground">disabled</span>
          <span className="font-mono text-muted-foreground">IconButton</span>
          <IconButton label={m.targets_night_previous()} icon={ChevronLeft} shortcut="⌥←" />
          <IconButton label={m.targets_night_next()} icon={ChevronRight} shortcut="⌥→" disabled focusableWhenDisabled />
        </div>
      </div>
    </div>
  )
}

function KindMatrix({ actions }: { actions: ReturnType<typeof demoActions> }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">ActionButton</h3>
      <p className="text-xs text-muted-foreground">
        The kind picks the variant. In a table cell (xs) a primary stays outline. Unavailable: focusable, reason as its description. Start run and Rescan run slowly (busy); Remove is refused;
        the second Rescan fails with Retry.
      </p>
      {(["sm", "default", "xs"] as const).map((size) => (
        <div key={size} className="flex flex-wrap items-center gap-2">
          <span className="w-16 font-mono text-xs">{size}</span>
          <ActionButton action={actions.start} size={size} />
          <ActionButton action={actions.rescan} size={size} />
          <ActionButton action={actions.delete} size={size} />
          <ActionButton action={actions.archive} size={size} />
          <ActionButton action={actions.remove} size={size} />
          <ActionButton action={actions.fail} size={size} />
        </div>
      ))}
    </div>
  )
}

function Bars({ actions }: { actions: ReturnType<typeof demoActions> }) {
  const m = useMessages()
  const { start, rename, rescan, copyPath, duplicate, archive, remove, trash } = actions
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">ActionBar</h3>
      <p className="text-xs text-muted-foreground">
        Up to three standard buttons, the named menu, then the one primary trailing. A fourth standard action, destructive actions and the overflow go to the menu (More by default, or an object menu).
        Feedback appears under the bar.
      </p>
      <div className="flex flex-col items-end gap-4 rounded-lg border p-3">
        <ActionBar actions={[rename, rescan, copyPath, duplicate, start, actions.delete]} overflow={[archive, trash, remove]} />
        <ActionBar actions={[rename, start]} overflow={[archive, trash, actions.delete]} menuLabel={m.project_noun()} />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          Empty (no actions) renders nothing:
          <ActionBar actions={[]} />
        </div>
      </div>
    </div>
  )
}

function Menus({ actions }: { actions: ReturnType<typeof demoActions> }) {
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
      <h3 className="text-sm font-semibold">ActionMenu · MenuItems</h3>
      <p className="text-xs text-muted-foreground">
        The items are given out of order, with Delete first and doubled separators: every menu shows Delete last after one separator, a heading group, a submenu, shortcuts and an unavailable item
        with its reason. Right-click the box for the same list as a context menu.
      </p>
      <div className="flex flex-wrap items-start gap-3">
        <ActionMenu label={m.calibration_run()} items={items} />
        <ContextMenuDemo items={items} />
        <span className="text-xs text-muted-foreground">
          Without an action the menu renders nothing:
          <ActionMenu label={m.calibration_run()} items={[{ heading: m.calibration_run() }, { separator: true }]} />
        </span>
      </div>
    </div>
  )
}

function ContextMenuDemo({ items }: { items: MenuItem[] }) {
  const runner = useAction()
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger className="flex h-16 w-64 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">Right-click here</ContextMenuTrigger>
        <ContextMenuContent aria-label="Context menu sample">
          <MenuItems items={items} runner={runner} />
        </ContextMenuContent>
      </ContextMenu>
      {runner.feedback}
      {runner.dialog}
    </>
  )
}

function Rows({ actions, names }: { actions: ReturnType<typeof demoActions>; names: string[] }) {
  const runner = useAction()
  const items: MenuItem[] = [actions.rename, actions.copyPath, actions.archive, actions.delete, actions.remove]
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">RowActions · RowContextMenu</h3>
      <p className="text-xs text-muted-foreground">
        Each row: a ⋯ in the Tab order, and the same items on right click, Shift+F10 or the Menu key (on the row or its ⋯). One runner per list, so its feedback appears under the list.
      </p>
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
          <span>Row without actions: no ⋯</span>
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
    <Section
      title="Actions"
      description="One Action descriptor renders as a header button, a named menu item, a row ⋯ item, a context-menu item and a palette command, with the same label, shortcut and unavailable reason."
    >
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
