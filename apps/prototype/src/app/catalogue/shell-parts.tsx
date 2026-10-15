/**
 * Catalogue entry (R9-COMPOSITION-PLAN §3.3 P14, §8.3): the shell parts.
 * NavList (sidebar, rail, Settings; current, holds, badge, menu row),
 * ChecklistRing (expanded, rail, with an unavailable step), IssueRow (open,
 * not dismissable, dismissed) and ThemePicker (form and menu). Component
 * content uses the real catalogue copy; the captions are reviewer labels.
 * Links lead to real routes.
 */
import { Activity, Crosshair, FolderKanban, History, House, Layers, Palette, Settings, SlidersHorizontal } from "lucide-react"
import { type ReactNode, useState } from "react"
import { useMessages } from "@/app/preferences"
import { type ChecklistSection, ChecklistRing } from "@/components/app/checklist"
import { IssueRow } from "@/components/app/issue-row"
import { type NavListGroup, NavList } from "@/components/app/nav-list"
import { ThemeMenuItems, ThemePicker } from "@/components/app/theme-picker"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { Issue } from "@/domain/issues"
import { useStore } from "@/store/core"
import { ComponentSection } from "./specimen"

function Row({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-3">
      <span className="pt-0.5 font-mono text-xs text-muted-foreground">{caption}</span>
      <div className="flex min-w-0 flex-wrap items-start gap-3">{children}</div>
    </div>
  )
}

/** A sidebar-coloured strip, so the sidebar rows show on their own surface. */
function Sidebar({ collapsed, children }: { collapsed?: boolean; children: ReactNode }) {
  return <div className={collapsed ? "flex w-12 flex-col rounded-lg border border-border bg-sidebar" : "flex w-60 flex-col rounded-lg border border-border bg-sidebar"}>{children}</div>
}

function useNavGroups(): NavListGroup[] {
  const m = useMessages()
  const projects = useStore((s) => Object.values(s.catalog.projects).slice(0, 3))
  return [
    {
      id: "primary",
      items: [
        { id: "home", label: m.nav_home(), icon: House, link: { to: "/" } },
        { id: "projects", label: m.nav_projects(), icon: FolderKanban, link: { to: "/projects" }, badge: { count: 1, label: m.shell_nav_projects_badge({ count: 1 }), tone: "danger" } },
        { id: "targets", label: m.nav_targets(), icon: Crosshair, link: { to: "/targets" } },
      ],
    },
    {
      id: "library",
      heading: m.nav_library(),
      items: [
        { id: "sessions", label: m.nav_sessions(), icon: Layers, link: { to: "/sessions" }, badge: { count: 3, label: m.shell_nav_sessions_badge({ count: 3 }) } },
        { id: "calibration", label: m.nav_calibration(), icon: SlidersHorizontal, link: { to: "/calibration" } },
      ],
    },
    {
      id: "recent",
      heading: m.shell_nav_recent(),
      items: [
        {
          id: "recent-projects",
          label: m.nav_projects(),
          icon: History,
          items: projects.map((project) => ({ id: `project:${project.id}`, label: project.name, icon: FolderKanban, link: { to: "/projects/$projectId", params: { projectId: project.id } } })),
        },
      ],
    },
  ]
}

function useUtilityGroups(): NavListGroup[] {
  const m = useMessages()
  return [
    {
      id: "utility",
      items: [
        { id: "activity", label: m.nav_activity(), icon: Activity, link: { to: "/activity" } },
        { id: "settings", label: m.nav_settings(), icon: Settings, link: { to: "/settings" } },
      ],
    },
  ]
}

function useSettingsGroups(): NavListGroup[] {
  const m = useMessages()
  return [
    { id: "general", heading: m.settings_group_general(), items: [{ id: "appearance", label: m.settings_appearance(), link: { to: "/settings/appearance" } }] },
    {
      id: "library",
      heading: m.nav_library(),
      items: [
        { id: "locations", label: m.common_locations(), link: { to: "/settings/locations" } },
        { id: "equipment", label: m.settings_equipment(), link: { to: "/settings/equipment" } },
        { id: "naming", label: m.settings_naming(), link: { to: "/settings/naming" } },
      ],
    },
  ]
}

function useChecklist(): ChecklistSection[] {
  const m = useMessages()
  return [
    {
      id: "steps",
      title: m.calibration_steps(),
      items: [
        { id: "locations", label: m.setup_set_up_locations(), done: true },
        { id: "import", label: m.onboarding_check_import(), done: true },
        { id: "targets", label: m.onboarding_check_targets(), done: false, action: { id: "review", label: m.verb_review(), run: () => undefined } },
        { id: "project", label: m.onboarding_check_project(), done: false, action: { id: "new-project", label: m.newproject_open_ellipsis(), run: () => undefined } },
        {
          id: "run",
          label: m.onboarding_check_run(),
          done: false,
          action: { id: "start-run", label: m.startrun_open_ellipsis(), run: () => undefined, unavailable: { action: m.startrun_open_ellipsis(), reason: m.onboarding_check_project(), blockers: [] } },
        },
      ],
    },
    {
      id: "goals",
      title: m.home_goals(),
      items: [
        { id: "goal-ha", label: m.catalogue_shell_goal({ target: "NGC 7000", channel: "Ha", hours: 10 }), done: true },
        { id: "goal-oiii", label: m.catalogue_shell_goal({ target: "NGC 7000", channel: "OIII", hours: 10 }), done: false },
      ],
    },
  ]
}

const SAMPLE_ISSUES: Issue[] = [
  { id: "cat:needs-target", group: "sessions", kind: "needs-target", severity: "warning", count: 2, name: null, about: null, link: { to: "/sessions" } },
  { id: "cat:location-denied", group: "storage", kind: "location-denied", severity: "danger", count: 1, name: "Captures SSD", about: "loc", link: { to: "/settings/locations" } },
  { id: "cat:run-blocked", group: "runs", kind: "run-blocked", severity: "warning", count: 1, name: "NGC 7000 HOO RedCat", about: "run", link: { to: "/projects" } },
  { id: "cat:calibration-review", group: "calibration", kind: "calibration-review", severity: "warning", count: 3, name: "M 31 LRGB FRA400", about: "run", link: { to: "/calibration" } },
  { id: "cat:duplicates", group: "storage", kind: "duplicates", severity: "info", count: 4, bytes: 1_200_000_000, name: null, about: null, link: { to: "/settings/locations" } },
]

function IssueRows() {
  const [dismissed, setDismissed] = useState<string[]>(["cat:duplicates"])
  const open = SAMPLE_ISSUES.filter((issue) => !dismissed.includes(issue.id))
  const gone = SAMPLE_ISSUES.filter((issue) => dismissed.includes(issue.id))
  const dismiss = (issue: Issue) => setDismissed((ids) => [...ids, issue.id])
  const restore = (issue: Issue) => setDismissed((ids) => ids.filter((id) => id !== issue.id))
  return (
    <div className="w-88 rounded-lg border border-border bg-popover text-popover-foreground">
      <ul className="py-1" data-catalogue-issues="open">
        {open.map((issue) => (
          <IssueRow key={issue.id} issue={issue} onDismiss={dismiss} />
        ))}
      </ul>
      <ul className="border-t border-border py-1" data-catalogue-issues="dismissed">
        {gone.map((issue) => (
          <IssueRow key={issue.id} issue={issue} state="dismissed" onRestore={restore} refocus={(restored) => document.querySelector<HTMLElement>(`[data-catalogue-issues="open"] [data-issue="${CSS.escape(restored.id)}"] [data-dismiss]`)} />
        ))}
      </ul>
    </div>
  )
}

export function ShellPartsCatalogue() {
  const m = useMessages()
  const navGroups = useNavGroups()
  const utilityGroups = useUtilityGroups()
  const settingsGroups = useSettingsGroups()
  const checklist = useChecklist()
  const recentId = useStore((s) => {
    const first = Object.values(s.catalog.projects)[0]
    return first ? `project:${first.id}` : null
  })
  const [dismissedChecklist, setDismissedChecklist] = useState(false)
  return (
    <>
      <ComponentSection components={["NavList"]} description={m.catalogue_shell_nav_desc()}>
        <div className="space-y-3">
          <Row caption={m.catalogue_shell_sidebar_current()}>
            <Sidebar>
              <NavList label={m.shell_nav_main()} groups={navGroups} current="sessions" />
            </Sidebar>
          </Row>
          <Row caption={m.catalogue_shell_sidebar_recent()}>
            <Sidebar>
              <NavList label={m.shell_nav_main()} groups={navGroups} current={recentId} holds={["projects"]} />
            </Sidebar>
          </Row>
          <Row caption={m.catalogue_shell_rail_current()}>
            <Sidebar collapsed>
              <NavList label={m.shell_nav_main()} groups={navGroups} current="home" collapsed />
            </Sidebar>
          </Row>
          <Row caption={m.catalogue_shell_content_settings()}>
            <div className="w-56 rounded-lg border border-border">
              <NavList label={m.settings_sections()} groups={settingsGroups} current="appearance" surface="content" />
            </div>
          </Row>
        </div>
      </ComponentSection>

      <ComponentSection components={["ChecklistRing"]} description={m.catalogue_shell_checklist_desc()}>
        <div className="space-y-3">
          <Row caption={m.catalogue_shell_expanded()}>
            <Sidebar>
              <div className="flex flex-col gap-px p-2">
                {dismissedChecklist ? (
                  <Button variant="outline" size="sm" onClick={() => setDismissedChecklist(false)}>
                    {m.verb_restore()}
                  </Button>
                ) : (
                  <ChecklistRing title={m.onboarding_getting_started()} sections={checklist} onDismiss={() => setDismissedChecklist(true)} />
                )}
              </div>
              <NavList label={m.shell_nav_utilities()} groups={utilityGroups} current={null} />
            </Sidebar>
          </Row>
          <Row caption={m.catalogue_shell_rail()}>
            <Sidebar collapsed>
              <div className="flex flex-col gap-px p-2">
                <ChecklistRing title={m.onboarding_getting_started()} sections={checklist} collapsed />
              </div>
              <NavList label={m.shell_nav_utilities()} groups={utilityGroups} current={null} collapsed />
            </Sidebar>
          </Row>
        </div>
      </ComponentSection>

      <ComponentSection components={["IssueRow"]} description={m.catalogue_shell_issue_desc()}>
        <IssueRows />
      </ComponentSection>

      <ComponentSection components={["ThemePicker"]} description={m.catalogue_shell_theme_desc()}>
        <div className="space-y-3">
          <Row caption={m.catalogue_shell_form()}>
            <div className="w-full max-w-3xl">
              <ThemePicker />
            </div>
          </Row>
          <Row caption={m.catalogue_shell_menu_items()}>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                <Palette aria-hidden="true" data-icon="inline-start" />
                {m.theme_picker_theme()}
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-52">
                <ThemeMenuItems />
              </DropdownMenuContent>
            </DropdownMenu>
          </Row>
        </div>
      </ComponentSection>
    </>
  )
}
