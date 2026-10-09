/**
 * S12 Sessions (slice A): library light sessions only (D-W24); calibration
 * frames live in the Calibration library. Filters All, Needs a Target, Not in
 * any Project and Trashed, with counts (D-W25, D-W43; Trashed sessions show
 * only under Trashed). Row actions: Choose Target, Add to Project (also adds
 * the rig, with a visible note, D-W59) and Create Project (prefilled). After
 * an Import, `?import=<operation>` highlights the sessions it filled.
 */
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { Download, Layers } from "lucide-react"
import { useState } from "react"
import { openSheet } from "@/app/ui-state"
import { type Column, DataTable, TableToolbar } from "@/components/app/data-table"
import { EmptyState, Notice } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatHours } from "@/domain/derive"
import { formatCount, formatNight, plural } from "@/lib/format"
import type { SearchParams } from "@/routes"
import { useStore } from "@/store/core"
import type { ImportPayload } from "./import-run"
import { AddToProjectMenu, type AddedNotice } from "./parts"
import { FILTER_LABEL, filterCounts, matchesFilter, parseFilter, type SessionFilter, type SessionRow, sessionRows } from "./session-model"

const FILTERS: SessionFilter[] = ["all", "needs-target", "not-in-project", "trashed"]

const EMPTY_COPY: Record<SessionFilter, { title: string; description: string }> = {
  all: { title: "No light sessions yet", description: "Import from a card, folder or network share, or add an existing library folder to index it in place." },
  "needs-target": { title: "Every session has a Target", description: "A session needs a Target when its OBJECT and pointing do not settle one." },
  "not-in-project": { title: "Every session with a Target is in a Project", description: "A session is in a Project when its Target is a subject and its rig is one of the Project's rigs." },
  trashed: { title: "No Trashed sessions", description: "A session shows here when every frame of it went to the OS Trash from a Done / Archive sheet." },
}

export function SessionsPage() {
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const filter = parseFilter(search.filter)
  const query = search.q ?? ""
  const importId = search.import
  const rows = useStore(sessionRows)
  const importOp = useStore((s) => (importId ? s.operations[importId] : undefined))
  const [notice, setNotice] = useState<AddedNotice | null>(null)
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

  const columns: Column<SessionRow>[] = [
    {
      id: "session",
      header: "Session",
      rowHeader: true,
      sortValue: (r) => `${r.session.night}|${r.session.channel ?? ""}`,
      cell: (r) => (
        <span className="flex min-w-0 items-baseline gap-x-2 whitespace-nowrap">
          <Link to="/sessions/$sessionId" params={{ sessionId: r.session.id }} className="font-medium underline-offset-2 hover:underline" title={r.session.objectLabel ? `OBJECT ${r.session.objectLabel}` : "No OBJECT"}>
            {formatNight(r.session.night, true)} · {r.session.channel ?? "No filter"}
          </Link>
          {imported.has(r.session.id) ? <span className="text-xs font-medium text-link">Imported</span> : null}
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
    { id: "unreviewed", header: "Unreviewed", align: "right", sortValue: (r) => r.unreviewed, cell: (r) => (r.unreviewed > 0 ? <span className="tabular-nums">{formatCount(r.unreviewed)}</span> : <span className="text-muted-foreground">0</span>) },
    {
      id: "projects",
      header: "Projects · runs",
      sortValue: (r) => r.candidateOf.map((c) => c.project.name).join(","),
      cell: (r) =>
        r.trashed ? (
          <span className="text-muted-foreground">Trashed</span>
        ) : r.candidateOf.length > 0 ? (
          <span className="truncate" title={[...r.candidateOf.map((c) => c.project.name), ...r.runs.map((run) => `Run ${run.name}`)].join(", ")}>
            {r.candidateOf.map((c) => c.project.name).join(", ")}
            <span className="text-muted-foreground"> · {r.runs.length === 0 ? "no run" : plural(r.runs.length, "run")}</span>
          </span>
        ) : r.notInProject ? (
          <span className="-my-1 flex items-center gap-2 whitespace-nowrap">
            <span className="text-warning">Not in any Project</span>
            <AddToProjectMenu sessionId={r.session.id} size="xs" onAdded={setNotice} />
          </span>
        ) : (
          <span className="text-muted-foreground">Needs a Target first</span>
        ),
    },
  ]

  const importSummary = importOp && importOp.status !== "running" ? importOp.summary : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Sessions"
        description="Library light sessions. Calibration frames are in the Calibration library."
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
            title={importOp.status === "running" ? `${importOp.title}: running` : `${importOp.title}: ${plural(imported.size, "session")} highlighted`}
            actions={
              <Button size="xs" variant="ghost" onClick={() => setParams({ import: undefined })}>
                Clear highlight
              </Button>
            }
          >
            {importSummary ?? `${formatCount(importOp.progress.done)} of ${formatCount(importOp.progress.total)} frames copied so far.`}
          </Notice>
        ) : null}
        {notice ? (
          <Notice tone="info" title={notice.title} actions={<Button size="xs" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>}>
            {notice.note ?? "No rig was added: the Project already has it."}
          </Notice>
        ) : null}
        <TableToolbar
          search={{ label: "Search sessions", placeholder: "OBJECT, Target, rig, night", value: query, onChange: (value) => setParams({ q: value }) }}
          filters={
            <ToggleGroup aria-label="Filter sessions" size="sm" variant="outline" spacing={0} value={[filter]} onValueChange={(value) => value[0] && setParams({ filter: value[0] as string })}>
              {FILTERS.map((f) => (
                <ToggleGroupItem key={f} value={f} data-filter={f}>
                  {FILTER_LABEL[f]} <span className="text-muted-foreground tabular-nums">{formatCount(counts[f])}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          }
        />
        {filter === "trashed" && counts.trashed > 0 ? (
          <p className="text-xs text-muted-foreground">Trashed sessions stay for traceability only: they are hidden from pickers, candidates, goals and totals. Put back from the OS Trash plus a rescan restores the frames as Unusable.</p>
        ) : null}
        <DataTable
          label={`Sessions: ${FILTER_LABEL[filter]}`}
          rows={shown}
          columns={columns}
          getRowId={(r) => r.session.id}
          stickyFirstColumn
          initialSort={imported.size > 0 ? undefined : { columnId: "session", direction: "desc" }}
          rowClassName={(r) => (imported.has(r.session.id) ? "bg-link/[0.07]" : undefined)}
          empty={
            <EmptyState
              icon={Layers}
              title={needle ? "No session matches this search" : EMPTY_COPY[filter].title}
              description={needle ? `Nothing under ${FILTER_LABEL[filter]} mentions “${query}”.` : EMPTY_COPY[filter].description}
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
                    Show all sessions
                  </Button>
                )
              }
            />
          }
        />
      </PageBody>
    </div>
  )
}
