/**
 * S2 Projects (`/projects`; ListPage, 065 PRJ-FR-18/32): one row per Project
 * from `project_rows`, with its subjects, rigs, goals, Next step, pending
 * changes and lifecycle; a Closing, Closed or Archived row reads "None" for
 * both, since it carries neither. The
 * State facet starts on Open, so closed Projects stay out of the way until
 * asked for; `?issues=with-issues` (the status-bar counters' link) narrows
 * to the Projects that hold an issue. A row opens its Project; its ⋯ menu
 * and right click hold Duplicate… and Wrap up, then Dismiss or Restore for
 * each issue on the row. New Project… is the page's primary.
 */
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { Copy, Eye, FolderKanban, PackageCheck, Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { failureOf, type ProjectLifecycle, type ProjectRow, type ProjectSummary } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Action, Column, Facet, MenuItem } from "@/components/app/contracts"
import { EmptyState } from "@/components/app/feedback"
import { type IssueFilter, issuesFacet, matchesIssueFilter, parseIssueFilter, withIssueItems } from "@/components/app/issue-actions"
import { ListPage } from "@/components/templates/list-page"
import { failureMessage } from "@/components/app/run-result"
import { StatusBadge, statusMeta } from "@/components/app/status"
import { projectNextStep, projectNextStepOrder } from "@/components/domain/project-next-step"
import { formatCount } from "@/lib/format"
import { DuplicateProjectDialog } from "./duplicate-dialog"
import { useProjectIssues } from "./issues"
import { NewProjectDialog } from "./new-project-dialog"
import { projectRowsQuery } from "./queries"

/** The State facet's values: Closing reads with Closed, since both are locked and wait on nothing the user does. */
const STATES = ["open", "closed", "archived"] as const
type StateFilter = (typeof STATES)[number] | ""

function stateOf(lifecycle: ProjectLifecycle): (typeof STATES)[number] {
  return lifecycle === "closing" ? "closed" : lifecycle
}

export function ProjectsPage() {
  const m = useMessages()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as Record<string, string | undefined>
  const list = useQuery(projectRowsQuery())
  const issues = useProjectIssues()
  const linkedIssues = parseIssueFilter(search.issues)
  const [query, setQuery] = useState("")
  // The counters' link asks for every Project with issues, closed ones too.
  const [state, setState] = useState<StateFilter>(linkedIssues ? "" : "open")
  const [issueFilter, setIssueFilter] = useState<IssueFilter | "">(linkedIssues)
  const [creating, setCreating] = useState(false)
  // `?new=open` (the palette's New Project…) opens the dialog once and leaves the URL.
  const newLinked = search.new === "open"
  useEffect(() => {
    if (!newLinked) return
    setCreating(true)
    const { new: _, ...rest } = search
    void navigate({ to: "/projects", search: rest, replace: true })
  }, [newLinked, navigate, search])
  const [duplicating, setDuplicating] = useState<ProjectSummary | null>(null)
  const rows = [...(list.data ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  const q = query.trim().toLocaleLowerCase()
  const shown = rows.filter(
    (p) => (state === "" || stateOf(p.lifecycle) === state) && matchesIssueFilter(issues.of(p.id), issueFilter) && (q === "" || [p.name, ...p.subjects].some((t) => t.toLocaleLowerCase().includes(q))),
  )
  const open = (p: ProjectSummary, extra: Record<string, string> = {}) => void navigate({ to: "/projects/$projectId", params: { projectId: p.id }, search: extra })
  const newProject: Action = { id: "new-project", label: m.newproject_title(), icon: Plus, kind: "primary", opensDialog: true, run: () => setCreating(true) }
  const columns: Column<ProjectRow>[] = [
    { id: "name", header: m.project_noun(), cell: (p) => p.name, sortValue: (p) => p.name, rowHeader: true, truncate: true, truncateMin: "name" },
    { id: "subjects", header: m.project_subjects(), cell: (p) => p.subjects.join(", ") || m.projects_no_subjects(), sortValue: (p) => p.subjects.length, truncate: true },
    { id: "rigs", header: m.project_rigs(), cell: (p) => formatCount(p.rigCount), sortValue: (p) => p.rigCount, align: "right" },
    { id: "goals", header: m.projects_col_goals(), cell: (p) => (p.goalCount === 0 ? m.projects_no_goals() : m.project_goals_count({ count: p.goalCount })), sortValue: (p) => p.goalCount },
    { id: "next-step", header: m.projects_col_next_step(), cell: (p) => (p.work ? projectNextStep(m, p.id, p.work.next).label : m.projects_none()), sortValue: (p) => projectNextStepOrder(p.work?.next ?? null) },
    { id: "pending-changes", header: m.project_pending_changes(), cell: (p) => (p.work ? formatCount(p.work.pendingChanges) : m.projects_none()), sortValue: (p) => p.work?.pendingChanges ?? -1, align: "right" },
    { id: "state", header: m.projects_col_state(), cell: (p) => <StatusBadge kind="project" value={p.lifecycle} />, sortValue: (p) => statusMeta("project", p.lifecycle).label },
  ]
  const rowActions = (p: ProjectSummary): MenuItem[] =>
    withIssueItems(
      m,
      [
        { id: "open", label: m.verb_open(), icon: Eye, run: () => open(p) },
        { separator: true },
        { id: "duplicate", label: m.project_duplicate(), icon: Copy, opensDialog: true, run: () => setDuplicating(p) },
        { id: "wrap-up", label: m.wrapup_action(), icon: PackageCheck, run: () => open(p, { stage: "wrap-up" }) },
      ],
      issues.of(p.id),
      issues.callbacks,
    )
  const facets: Facet[] = [
    {
      id: "state",
      label: m.projects_col_state(),
      kind: "single",
      value: state,
      options: STATES.map((value) => ({ value, label: statusMeta("project", value).label, count: rows.filter((p) => stateOf(p.lifecycle) === value).length })),
    },
    issuesFacet(m, rows.map((p) => issues.of(p.id)), issueFilter),
  ]
  const failure = list.error ? failureOf(list.error) : null
  return (
    <>
      <ListPage
        title={m.nav_projects()}
        summary={list.data ? m.projects_count({ count: rows.length }) : undefined}
        actions={[newProject]}
        table={{
          label: m.nav_projects(),
          rows: shown,
          columns,
          getRowId: (p) => p.id,
          onRowClick: (p) => open(p),
          rowLabel: (p) => p.name,
          rowActions,
          loading: list.isPending,
          error: list.error ? { message: failure ? failureMessage(m, failure) : m.projects_read_failed(), onRetry: () => void list.refetch() } : undefined,
          toolbar: {
            search: { label: m.projects_search(), placeholder: m.projects_search_placeholder(), value: query, onChange: setQuery },
            facets: {
              items: facets,
              onChange: (patch) => {
                if (typeof patch.state === "string") setState(STATES.find((s) => s === patch.state) ?? "")
                if ("issues" in patch) setIssueFilter(parseIssueFilter(patch.issues))
              },
            },
            matchCount: shown.length,
          },
          empty:
            rows.length === 0 ? (
              <EmptyState icon={FolderKanban} title={m.projects_empty()} action={<ActionButton action={newProject} />} />
            ) : (
              <EmptyState icon={FolderKanban} title={m.projects_no_match()} action={null} />
            ),
        }}
      />
      <NewProjectDialog open={creating} onOpenChange={setCreating} />
      {duplicating ? <DuplicateProjectDialog header={duplicating} open onOpenChange={(next) => !next && setDuplicating(null)} /> : null}
    </>
  )
}
