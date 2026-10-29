/**
 * S3 Project (`/projects/$projectId`; 065 PRJ-FR-07): one page per tab,
 * Sessions · Calibrate · View · Output · Wrap up. Every tab shares the
 * header: the path, the lifecycle badge, Apply… as the one primary while the
 * Project is open, and the Project ▾ menu (Edit…, Duplicate…). A Closing,
 * Closed or Archived Project is locked for good (PRJ-FR-32): Edit… stays in
 * the menu, unavailable with "Project closed · Duplicate ▸", the notice slot
 * names when it closed, and Duplicate… continues it on the current pins.
 *
 * Search keys: `?stage=` picks the tab (Sessions by default); Wrap up takes
 * `&step=`; `?apply=open` opens the Apply sheet on the View tab;
 * `?duplicate=open` opens Duplicate… once and leaves the URL;
 * `?issues=with-issues` is the status-bar counters' link and opens the tab
 * that holds the Project's issues.
 *
 * Moving to another Project remounts the page under its id, so no selection,
 * draft or open sheet carries from one Project to the next (astro-plan-409cm.9).
 */
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { Copy, FolderKanban, Pencil, RefreshCw } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Action } from "@/components/app/contracts"
import { DetailSkeleton, EmptyState, type PageNotice } from "@/components/app/feedback"
import type { PathItem } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import type { ObjectMenu, PageViews } from "@/components/templates/parts"
import { formatDateTime } from "@/lib/format"
import { CalibrateTab } from "./calibrate-tab"
import { DuplicateProjectDialog } from "./duplicate-dialog"
import { ProjectDetailsDialog } from "./details-dialog"
import { OutputTab } from "./output-tab"
import { closedSnapshotQuery, inputsQuery, isLocked, type ProjectHeader, useProjectHeader, useProjectRecord } from "./queries"
import { SessionsTab } from "./sessions-tab"
import { ViewTab } from "./view-tab"
import { WrapUpPage } from "./wrap-up"

export const PROJECT_TABS = ["sessions", "calibrate", "view", "output", "wrap-up"] as const
export type ProjectTabId = (typeof PROJECT_TABS)[number]

type Search = Record<string, string | undefined>

function tabOf(stage: string | undefined): ProjectTabId {
  return PROJECT_TABS.find((id) => id === stage) ?? "sessions"
}

/** The header every tab of the Project shares. */
export interface ProjectChrome {
  path: PathItem[]
  status: ReactNode
  actions: Action[]
  menu: ObjectMenu
  notice: PageNotice | null
  views: PageViews
}

/** What each tab body receives: the Project's header, the shared chrome and the page's search keys. */
export interface ProjectTabProps {
  header: ProjectHeader
  chrome: ProjectChrome
  search: Search
}

export function ProjectPage() {
  const { projectId = "" } = useParams({ strict: false }) as { projectId?: string }
  // Keyed by id: a different Project is a fresh page, never the last one's state (astro-plan-409cm.9).
  return <ProjectRoute key={projectId} projectId={projectId} />
}

function ProjectRoute({ projectId }: { projectId: string }) {
  const m = useMessages()
  const search = useSearch({ strict: false }) as Search
  const { header, error } = useProjectHeader(projectId)
  if (error) return <EmptyState icon={FolderKanban} title={m.projects_read_failed()} titleAs="h1" action={null} />
  if (header === undefined) return <DetailSkeleton label={m.common_loading()} />
  if (header === null) return <EmptyState icon={FolderKanban} title={m.project_missing_title()} titleAs="h1" action={null} />
  return <ProjectView header={header} search={search} />
}

function ProjectView({ header, search }: { header: ProjectHeader; search: Search }) {
  const navigate = useNavigate()
  const tab = tabOf(search.stage)
  const [editing, setEditing] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const tabChosen = useRef(false)
  const chrome = useProjectChrome(header, tab, {
    edit: () => setEditing(true),
    duplicate: () => setDuplicating(true),
    tabChosen: () => {
      tabChosen.current = true
    },
  })
  // Each tab is its own page, so a tab switch replaces the tab list the user just used: focus moves to the new list's
  // selected tab (WCAG 2.4.3).
  useEffect(() => {
    if (!tabChosen.current) return
    tabChosen.current = false
    selectedTab(chrome.views.label)?.focus()
  }, [tab, chrome.views.label])
  // `?duplicate=open` (the locked Edit…'s blocker link) opens Duplicate… once and leaves the URL.
  const duplicateLinked = search.duplicate === "open"
  useEffect(() => {
    if (!duplicateLinked) return
    setDuplicating(true)
    void navigate({ to: "/projects/$projectId", params: { projectId: header.id }, search: withoutKey(search, "duplicate"), replace: true })
  }, [duplicateLinked, header.id, navigate, search])

  const props: ProjectTabProps = { header, chrome, search }
  return (
    <>
      <TabBody tab={tab} {...props} />
      <ProjectDetailsDialog header={header} open={editing} onOpenChange={setEditing} />
      <DuplicateProjectDialog header={header} open={duplicating} onOpenChange={setDuplicating} />
    </>
  )
}

function TabBody({ tab, ...props }: ProjectTabProps & { tab: ProjectTabId }) {
  switch (tab) {
    case "calibrate":
      return <CalibrateTab {...props} />
    case "view":
      return <ViewTab {...props} />
    case "output":
      return <OutputTab {...props} />
    case "wrap-up":
      return <WrapUpPage {...props} />
    case "sessions":
      return <SessionsTab {...props} />
  }
}

function withoutKey(search: Search, key: string): Search {
  const { [key]: _, ...rest } = search
  return rest
}

/** The selected tab of the tab list named `label`. */
function selectedTab(label: string): HTMLElement | null {
  const list = [...document.querySelectorAll<HTMLElement>('[role="tablist"]')].find((l) => l.getAttribute("aria-label") === label)
  return list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? null
}

function useProjectChrome(header: ProjectHeader, tab: ProjectTabId, dialogs: { edit: () => void; duplicate: () => void; tabChosen: () => void }): ProjectChrome {
  const m = useMessages()
  const navigate = useNavigate()
  const record = useProjectRecord(header.id)
  const locked = isLocked(header.lifecycle)
  const inputs = useQuery(inputsQuery(header.id))
  const snapshot = useQuery({ ...closedSnapshotQuery(header.id), enabled: locked })
  const duplicateLink = { to: "/projects/$projectId", params: { projectId: header.id }, search: { duplicate: "open" } }
  const editLabel = m.project_edit()
  const edit: Action = {
    id: "edit",
    label: editLabel,
    icon: Pencil,
    opensDialog: true,
    unavailable: locked
      ? { action: m.actions_blocked({ action: editLabel }), reason: m.project_closed(), blockers: [{ label: m.project_duplicate(), link: duplicateLink }] }
      : record.state === "unavailable"
        ? { action: m.actions_blocked({ action: editLabel }), reason: m.project_record_unavailable(), blockers: [] }
        : undefined,
    run: dialogs.edit,
  }
  const duplicate: Action = { id: "duplicate", label: m.project_duplicate(), icon: Copy, opensDialog: true, run: dialogs.duplicate }
  const apply: Action = {
    id: "apply",
    label: m.project_apply(),
    icon: RefreshCw,
    kind: "primary",
    opensDialog: true,
    run: () => void navigate({ to: "/projects/$projectId", params: { projectId: header.id }, search: { stage: "view", apply: "open" } }),
  }
  const closedAt = snapshot.data?.takenAt ?? null
  const desired = inputs.data?.desired
  const tabs: PageViews["items"] = [
    { id: "sessions", label: m.project_tab_sessions(), count: desired?.sessions.length },
    { id: "calibrate", label: m.project_tab_calibrate() },
    { id: "view", label: m.project_tab_view(), count: inputs.data && inputs.data.pending.length > 0 ? inputs.data.pending.length : undefined },
    { id: "output", label: m.project_tab_output() },
    { id: "wrap-up", label: m.wrapup_action() },
  ]
  return {
    path: [{ label: m.nav_projects(), link: { to: "/projects" } }],
    status: <StatusBadge kind="project" value={header.lifecycle} />,
    actions: locked ? [] : [apply],
    menu: { label: m.project_noun(), items: [edit, duplicate] },
    notice: locked
      ? {
          tone: "info",
          title: closedAt ? m.project_closed_notice({ date: formatDateTime(closedAt) }) : m.project_closed(),
          actions: <ActionButton action={duplicate} />,
        }
      : null,
    views: {
      label: m.project_views(),
      value: tab,
      items: tabs,
      onChange: (id) => {
        dialogs.tabChosen()
        void navigate({ to: "/projects/$projectId", params: { projectId: header.id }, search: id === "sessions" ? {} : { stage: id } })
      },
    },
  }
}
