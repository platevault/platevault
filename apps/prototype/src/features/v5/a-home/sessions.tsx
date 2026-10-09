/**
 * S12 Sessions (slice A): library light sessions only (D-W24). Raw
 * calibration frames never show here: Import and indexing route them into a
 * calibration process (P-CAL3, the Calibration library). Filters All, Needs
 * a Target, Not in any Project and Trashed, with counts (D-W25, D-W43;
 * Trashed sessions show only under Trashed); the search is clearable. Row
 * actions: Choose Target, Review (the session detail's review region,
 * `?view=review`) and Add to Project (also adds the rig, D-W59); right click
 * opens the row's menu. After an Import, `?import=<operation>` highlights the
 * sessions it filled.
 */
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { Download, Eye, Layers, ListChecks, Target } from "lucide-react"
import { useState } from "react"
import { openSheet } from "@/app/ui-state"
import { type Column, DataTable, TableToolbar } from "@/components/app/data-table"
import { EmptyState, Notice } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { CountBadge, Pill } from "@/components/app/pill"
import type { MenuEntry } from "@/components/app/row-menu"
import { StatusBadge } from "@/components/app/status"
import { HelpTip } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatHours } from "@/domain/derive"
import { sessionLabel } from "@/domain/membership"
import { formatCount, formatNight, plural } from "@/lib/format"
import type { SearchParams } from "@/routes"
import { useStore } from "@/store/core"
import type { ImportPayload } from "./import-run"
import { AddToProjectDialog, AddToProjectMenu, type AddedNotice, addToProjectEntries, type PendingAdd } from "./parts"
import { FILTER_LABEL, filterCounts, matchesFilter, parseFilter, type SessionFilter, type SessionRow, sessionReviewSearch, sessionRows } from "./session-model"

const FILTERS: SessionFilter[] = ["all", "needs-target", "not-in-project", "trashed"]

const EMPTY_TITLE: Record<SessionFilter, string> = {
  all: "No light sessions",
  "needs-target": "None need a Target",
  "not-in-project": "All in a Project",
  trashed: "None trashed",
}

export function SessionsPage() {
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const filter = parseFilter(search.filter)
  const query = search.q ?? ""
  const importId = search.import
  const rows = useStore(sessionRows)
  const catalog = useStore((s) => s.catalog)
  const importOp = useStore((s) => (importId ? s.operations[importId] : undefined))
  const [notice, setNotice] = useState<AddedNotice | null>(null)
  const [adding, setAdding] = useState<PendingAdd | null>(null)
  const imported = new Set(importOp ? (importOp.payload as unknown as ImportPayload).sessionIds : [])
  const counts = filterCounts(rows)

  const setParams = (patch: SearchParams) =>
    void navigate({
      to: "/sessions",
      search: (prev: SearchParams) => {
        const next: SearchParams = { ...prev, ...patch }
        for (const key of Object.keys(next)) if (!next[key] || next[key] === "all") delete next[key]
        return next
      },
      replace: true,
    })

  const needle = query.trim().toLowerCase()
  const shown = rows.filter((r) => {
    if (!matchesFilter(r, filter)) return false
    if (!needle) return true
    return [r.session.objectLabel, r.targetName, r.rigName, r.session.channel, formatNight(r.session.night, true), r.session.cameraName].some((v) => v?.toLowerCase().includes(needle))
  })
  // Imported sessions first while their highlight is on.
  if (imported.size > 0) shown.sort((a, b) => Number(imported.has(b.session.id)) - Number(imported.has(a.session.id)))

  const open = (r: SessionRow, extra?: { hash?: string; search?: Record<string, string> }) => void navigate({ to: "/sessions/$sessionId", params: { sessionId: r.session.id }, hash: extra?.hash, search: extra?.search ?? {} })
  const review = (r: SessionRow) => open(r, { search: sessionReviewSearch(r.unreviewed) })

  const columns: Column<SessionRow>[] = [
    {
      id: "session",
      header: "Session",
      rowHeader: true,
      sortValue: (r) => `${r.session.night}|${r.session.channel ?? ""}`,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-x-2 whitespace-nowrap">
          <Link to="/sessions/$sessionId" params={{ sessionId: r.session.id }} className="font-medium underline-offset-2 hover:underline" title={r.session.objectLabel ? `OBJECT ${r.session.objectLabel}` : "No OBJECT"}>
            {formatNight(r.session.night, true)} · {r.session.channel ?? "No filter"}
          </Link>
          {imported.has(r.session.id) ? <Pill tone="info">New</Pill> : null}
        </span>
      ),
    },
    {
      id: "target",
      header: "Target",
      sortValue: (r) => r.targetName ?? "",
      cell: (r) =>
        r.targetName ? (
          <span className="truncate">{r.targetName}</span>
        ) : (
          <span className="-my-1 flex items-center gap-2 whitespace-nowrap" title={r.session.objectLabel ? `OBJECT ${r.session.objectLabel}` : "No OBJECT"}>
            <StatusBadge kind="association" value={r.session.target.status === "needs-review" ? "needs-review" : "unresolved"} label="Needs a Target" />
            {r.trashed ? null : (
              <Button size="xs" variant="outline" render={<Link to="/sessions/$sessionId" params={{ sessionId: r.session.id }} hash="target" />}>
                Choose
              </Button>
            )}
          </span>
        ),
    },
    { id: "rig", header: "Rig", sortValue: (r) => r.rigName ?? "", truncate: true, className: "max-w-44", cell: (r) => r.rigName ?? <StatusBadge kind="association" value={r.session.equipment.status === "needs-review" ? "needs-review" : "unresolved"} label="Rig needs review" /> },
    {
      id: "frames",
      header: "Frames",
      align: "right",
      sortValue: (r) => r.seconds,
      cell: (r) => (
        <span className="tabular-nums">
          {formatCount(r.frames)} <span className="text-muted-foreground">· {formatHours(r.seconds)}</span>
        </span>
      ),
    },
    {
      id: "review",
      header: "Review",
      sortValue: (r) => r.unreviewed,
      cell: (r) =>
        r.trashed ? (
          <span className="text-muted-foreground">–</span>
        ) : (
          <Button size="xs" variant="outline" className="-my-1" onClick={() => review(r)} data-review-session={r.session.id}>
            Review
            {r.unreviewed > 0 ? <CountBadge count={r.unreviewed} tone="warning" label={`${plural(r.unreviewed, "frame")} unreviewed`} /> : null}
            <span className="sr-only"> {sessionLabel(r.session)}</span>
          </Button>
        ),
    },
    {
      id: "projects",
      header: "Projects · runs",
      sortValue: (r) => r.candidateOf.map((c) => c.project.name).join(","),
      cell: (r) =>
        r.trashed ? (
          <Pill tone="muted">Trashed</Pill>
        ) : r.candidateOf.length > 0 ? (
          <span className="truncate" title={[...r.candidateOf.map((c) => c.project.name), ...r.runs.map((run) => `Run ${run.name}`)].join(", ")}>
            {r.candidateOf.map((c) => c.project.name).join(", ")}
            <span className="text-muted-foreground"> · {r.runs.length === 0 ? "no run" : plural(r.runs.length, "run")}</span>
          </span>
        ) : r.notInProject ? (
          <span className="-my-1 flex items-center gap-2 whitespace-nowrap">
            <Pill tone="warning">No Project</Pill>
            <AddToProjectMenu sessionId={r.session.id} size="xs" onAdded={setNotice} />
          </span>
        ) : (
          <span className="text-muted-foreground">–</span>
        ),
    },
  ]

  const menu = (r: SessionRow): MenuEntry[] => [
    { heading: sessionLabel(r.session) },
    { label: "Open", icon: Eye, onSelect: () => open(r) },
    ...(r.trashed
      ? []
      : [
          { label: "Review frames", icon: ListChecks, onSelect: () => review(r) },
          { separator: true } as const,
          ...(r.needsTarget ? [{ label: "Choose Target", icon: Target, onSelect: () => open(r, { hash: "target" }) }] : addToProjectEntries(catalog, r.session.id, setAdding)),
        ]),
  ]

  const importSummary = importOp && importOp.status !== "running" ? importOp.summary : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Sessions"
        meta={<CountBadge count={counts.all} label={plural(counts.all, "light session")} />}
        actions={
          <Button size="sm" variant="outline" onClick={() => openSheet({ kind: "import" })}>
            <Download data-icon="inline-start" aria-hidden="true" />
            Import…
          </Button>
        }
      />
      <PageBody className="space-y-3">
        {importOp ? (
          <Notice
            tone="info"
            title={importOp.status === "running" ? `${importOp.title} · running` : `${importOp.title} · ${plural(imported.size, "session")}`}
            actions={
              <Button size="xs" variant="ghost" onClick={() => setParams({ import: undefined })}>
                Clear
              </Button>
            }
          >
            {importSummary ?? `${formatCount(importOp.progress.done)} of ${formatCount(importOp.progress.total)} frames`}
          </Notice>
        ) : null}
        {notice ? (
          <Notice tone="info" title={notice.title} actions={<Button size="xs" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>}>
            {notice.note}
          </Notice>
        ) : null}
        <TableToolbar
          search={{ label: "Search sessions", placeholder: "OBJECT, Target, rig, night", value: query, onChange: (value) => setParams({ q: value }) }}
          filters={
            <>
              <ToggleGroup aria-label="Filter sessions" size="sm" variant="outline" spacing={0} value={[filter]} onValueChange={(value) => value[0] && setParams({ filter: value[0] as string })}>
                {FILTERS.map((f) => (
                  <ToggleGroupItem key={f} value={f} data-filter={f} className="gap-1.5">
                    {FILTER_LABEL[f]}
                    <CountBadge count={counts[f]} tone={counts[f] > 0 && (f === "needs-target" || f === "not-in-project") ? "warning" : "neutral"} />
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {filter === "trashed" ? <HelpTip label="About Trashed sessions">Kept for traceability; hidden from pickers, candidates, goals and totals. Put back from the OS Trash and rescan to restore them as Unusable.</HelpTip> : null}
            </>
          }
        />
        <DataTable
          label={`Sessions: ${FILTER_LABEL[filter]}`}
          rows={shown}
          columns={columns}
          getRowId={(r) => r.session.id}
          stickyFirstColumn
          contextMenu={menu}
          initialSort={imported.size > 0 ? undefined : { columnId: "session", direction: "desc" }}
          rowClassName={(r) => (imported.has(r.session.id) ? "bg-link/[0.07]" : undefined)}
          empty={
            <EmptyState
              icon={Layers}
              title={needle ? "No match" : EMPTY_TITLE[filter]}
              description={null}
              className="m-3"
              action={
                needle ? (
                  <Button size="sm" variant="outline" onClick={() => setParams({ q: undefined })}>
                    Clear search
                  </Button>
                ) : filter === "all" ? (
                  <Button size="sm" variant="outline" onClick={() => openSheet({ kind: "import" })}>
                    Import…
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setParams({ filter: undefined })}>
                    Show all
                  </Button>
                )
              }
            />
          }
        />
      </PageBody>
      <AddToProjectDialog pending={adding} onClose={() => setAdding(null)} onAdded={setNotice} />
    </div>
  )
}
