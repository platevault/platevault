/**
 * S11 Sessions (LIB-FR-16 to LIB-FR-18): the Library's light sessions,
 * newest night first, as `library_list_sessions` lists them. The Status
 * facet picks one of the library's own filters (Needs a Target, Not in any
 * Project, Needs calibration, Trashed), each counted by
 * `library_session_filter_counts` where the library counts it; the search
 * narrows the rows read. `?filter=` and `?issues=with-issues` (the
 * status-bar counters' link) set them from a link.
 *
 * The empty state (W5, astro-plan-ceg4g): an empty library offers Import…
 * in place; with rows hidden by a filter or the search, it names what hides
 * them and adds no second reset, since the chip row already offers Clear.
 * The page has no Import button of its own: the window toolbar's Import…
 * is the one.
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { Layers } from "lucide-react"
import type { SessionSummary } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Column, Facet } from "@/components/app/contracts"
import { EmptyState } from "@/components/app/feedback"
import { useFollowLink } from "@/components/app/links"
import { StatusBadge } from "@/components/app/status"
import { ListPage } from "@/components/templates/list-page"
import { formatCount, formatExposure, formatNight } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { readError } from "./parts"
import { filterCountsQuery, issuesQuery, SESSION_PAGE, type SessionFilter, sessionsQuery } from "./queries"
import { keyParts, sessionLabel } from "./words"

/** The Status facet's values, as `?filter=` carries them. */
const FILTERS = { "needs-target": "needs_target", "not-in-project": "not_in_any_project", "needs-calibration": "needs_calibration", trashed: "trashed" } as const satisfies Record<string, SessionFilter>
type FilterParam = keyof typeof FILTERS | "all"

function filterOf(value: string | undefined): FilterParam {
  return value !== undefined && Object.hasOwn(FILTERS, value) ? (value as FilterParam) : "all"
}

function filterLabel(m: Messages, filter: FilterParam): string {
  switch (filter) {
    case "all":
      return m.sessions_filter_all()
    case "needs-target":
      return m.sessions_filter_needs_target()
    case "not-in-project":
      return m.sessions_filter_not_in_project()
    case "needs-calibration":
      return m.sessions_filter_needs_calibration()
    case "trashed":
      return m.status_trashed()
  }
}

function emptyTitle(m: Messages, filter: FilterParam): string {
  switch (filter) {
    case "all":
      return m.sessions_empty_all()
    case "needs-target":
      return m.sessions_empty_needs_target()
    case "not-in-project":
      return m.sessions_empty_not_in_project()
    case "needs-calibration":
      return m.sessions_empty_needs_calibration()
    case "trashed":
      return m.sessions_empty_trashed()
  }
}

type Search = { filter?: string; issues?: string; q?: string }

export function SessionsPage() {
  const m = useMessages()
  const follow = useFollowLink()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as Search
  const filter = filterOf(search.filter)
  const withIssues = search.issues === "with-issues"
  const query = search.q ?? ""
  const sessions = useQuery(sessionsQuery(filter === "all" ? null : FILTERS[filter]))
  const counts = useQuery(filterCountsQuery())
  const issues = useQuery({ ...issuesQuery(), enabled: withIssues })
  const setParams = (patch: Partial<Search>) =>
    void navigate({ to: "/sessions", search: (prev: Search) => Object.fromEntries(Object.entries({ ...prev, ...patch }).filter(([, v]) => v !== undefined && v !== "")), replace: true })

  const withIssue = new Set((issues.data?.issues ?? []).flatMap((issue) => (issue.owner.kind === "session" ? [issue.owner.id] : [])))
  const needle = query.trim().toLowerCase()
  const rows = (sessions.data ?? []).filter((s) => (!withIssues || withIssue.has(s.session.id)) && (needle === "" || sessionLabel(m, s.session).toLowerCase().includes(needle) || s.session.key.toLowerCase().includes(needle)))
  const count = (f: FilterParam): number | undefined => {
    const c = counts.data
    if (!c) return undefined
    return f === "needs-target" ? c.needsTarget : f === "not-in-project" ? c.notInAnyProject : f === "needs-calibration" ? c.needsCalibration : undefined
  }
  const facets: Facet[] = [
    {
      id: "filter",
      label: m.sessions_facet_status(),
      kind: "single",
      value: filter === "all" ? "" : filter,
      options: (["needs-target", "not-in-project", "needs-calibration", "trashed"] as const).map((f) => ({ value: f, label: filterLabel(m, f), count: count(f) })),
    },
    { id: "issues", label: m.issues_title(), kind: "single", value: withIssues ? "with-issues" : "", options: [{ value: "with-issues", label: m.issues_filter_with_issues() }] },
  ]
  const night = (s: SessionSummary) => keyParts(s.session.key).night
  const columns: Column<SessionSummary>[] = [
    { id: "session", header: m.session_label(), rowHeader: true, truncate: true, truncateMin: "name", sortValue: (s) => sessionLabel(m, s.session), cell: (s) => sessionLabel(m, s.session) },
    { id: "night", header: m.session_observing_night(), sortValue: night, cell: (s) => (night(s) ? formatNight(night(s)!, true) : "–") },
    { id: "filter", header: m.run_field_filter(), sortValue: (s) => keyParts(s.session.key).filter, cell: (s) => keyParts(s.session.key).filter ?? "–" },
    { id: "exposure", header: m.run_field_exposure(), align: "right", sortValue: (s) => keyParts(s.session.key).exposure, cell: (s) => (keyParts(s.session.key).exposure !== null ? formatExposure(keyParts(s.session.key).exposure!) : "–") },
    { id: "frames", header: m.sessions_column_frames(), align: "right", sortValue: (s) => s.captureCount, cell: (s) => formatCount(s.captureCount) },
    {
      id: "availability",
      header: m.session_column_availability(),
      sortValue: (s) => s.availability,
      // Offline is not absence: the session stays listed, read as its last observation.
      cell: (s) => <StatusBadge kind="availability" value={s.availability === "available" ? "online" : s.availability === "retired" ? "retired" : s.availability === "missing" ? "absent" : s.availability === "offline" ? "offline" : "unreadable"} />,
    },
    { id: "provisional", header: m.status_provisional(), hideable: true, defaultHidden: true, sortValue: (s) => (s.provisional ? 1 : 0), cell: (s) => (s.provisional ? m.status_provisional() : "") },
  ]
  const filtered = needle !== "" || filter !== "all" || withIssues
  const emptyText = needle ? m.sessions_no_match_query({ query: query.trim() }) : withIssues ? m.issues_none() : emptyTitle(m, filter)
  const emptyAction = filtered ? null : <ActionButton action={{ id: "import", label: m.import_open(), opensDialog: true, run: () => follow({ to: "/import" }) }} />
  const listed = sessions.data?.length ?? 0
  return (
    <ListPage
      title={m.nav_sessions()}
      summary={sessions.data ? (listed >= SESSION_PAGE ? m.sessions_first_count({ count: listed }) : m.sessions_light_count({ count: listed })) : undefined}
      table={{
        label: m.sessions_table_label({ filter: filterLabel(m, filter) }),
        rows,
        columns,
        columnsId: "sessions",
        getRowId: (s) => s.session.id,
        rowLabel: (s) => sessionLabel(m, s.session),
        rowActions: (s) => [
          { id: "open", label: m.project_open_session(), run: () => follow({ to: "/sessions/$sessionId", params: { sessionId: s.session.id } }) },
          { id: "review", label: m.session_review_frames(), run: () => follow({ to: "/sessions/$sessionId", params: { sessionId: s.session.id }, search: { step: "review" } }) },
        ],
        onRowClick: (s) => follow({ to: "/sessions/$sessionId", params: { sessionId: s.session.id } }),
        loading: sessions.isPending,
        error: sessions.error ? { message: readError(m, sessions.error), onRetry: () => void sessions.refetch() } : undefined,
        toolbar: {
          search: { label: m.sessions_search(), placeholder: m.sessions_search_placeholder(), value: query, onChange: (q) => setParams({ q }) },
          facets: {
            items: facets,
            onChange: (patch) => {
              const next: Partial<Search> = {}
              if ("filter" in patch) next.filter = typeof patch.filter === "string" ? patch.filter : ""
              if ("issues" in patch) next.issues = typeof patch.issues === "string" ? patch.issues : ""
              setParams(next)
            },
          },
          matchCount: rows.length,
        },
        empty: <EmptyState icon={Layers} title={emptyText} action={emptyAction} />,
      }}
    />
  )
}
