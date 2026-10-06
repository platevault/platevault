/**
 * Targets (`/targets`): the Target finder beside a library overview (harness
 * v4). The finder searches local Targets by name, alias or coordinates and
 * works with no account or network (J20 S1; LIB-FR-08, LIB-FR-10,
 * LIB-FR-13, LIB-AC-09); the overview names what the totals cover and what
 * needs attention. Opening a Target keeps the finder beside its detail.
 */
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { Crosshair } from "lucide-react"
import { useState } from "react"
import { Stat } from "@/components/app/data"
import { EmptyState, TableSkeleton } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { formatDuration, plural } from "@/lib/format"
import type { SearchParams } from "@/routes"
import { useStore } from "@/store/core"
import { activeIndexOperations, currentSessions, parseCoordinates, targetSummary } from "../model"
import { type LibraryNote, LibraryStatus } from "../parts"
import { TargetRecordDialog } from "../target-record-dialog"
import { TargetsLayout } from "../target-finder"

export function TargetsPage() {
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const query = search.q ?? ""
  const summaries = useStore((s) => Object.values(s.catalog.targets).map((t) => targetSummary(s, t)))
  const unresolved = useStore((s) => currentSessions(s.catalog, "light").filter((x) => x.target.status === "unresolved").length)
  const indexing = useStore((s) => activeIndexOperations(s).length > 0)
  const hasLocations = useStore((s) => Object.keys(s.catalog.locations).length > 0)
  const [addOpen, setAddOpen] = useState(false)

  const coords = parseCoordinates(query)
  const unresolvedNotes: LibraryNote[] =
    unresolved > 0
      ? [
          {
            id: "unresolved",
            summary: `${plural(unresolved, "session")} ${unresolved === 1 ? "has" : "have"} no Target yet`,
            detail: "Their headers have no OBJECT and not enough other evidence, so PlateVault does not guess. They are not counted for any Target.",
            action: (
              <Button size="sm" variant="outline" render={<Link to="/sessions" search={{ target: "unresolved" }} />}>
                Review in Sessions
              </Button>
            ),
          },
        ]
      : []

  const captured = summaries.reduce((sum, s) => sum + s.breakdown.captured.seconds, 0)
  const usable = summaries.reduce((sum, s) => sum + s.breakdown.usable.seconds, 0)
  const needsReview = summaries.filter((s) => s.needsReview > 0).length
  const header = (
    <PageHeader
      title="Targets"
      description="What your library holds for each sky subject. Search works offline, by name, alias or coordinates."
      actions={
        <Button variant="outline" onClick={() => setAddOpen(true)}>
          Add Target
        </Button>
      }
    />
  )
  const dialog = (
    <TargetRecordDialog
      open={addOpen}
      onOpenChange={setAddOpen}
      initialName={coords ? "" : query}
      onCreated={(targetId) => navigate({ to: "/targets/$targetId", params: { targetId } })}
    />
  )

  if (summaries.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <PageBody className="space-y-4">
          <LibraryStatus kind="light" notes={unresolvedNotes} />
          {indexing ? (
            <TableSkeleton label="Reading session metadata; Targets appear as sessions are read" columns={6} />
          ) : (
            <EmptyState
              icon={Crosshair}
              titleAs="h2"
              title="No Targets yet"
              description={
                hasLocations
                  ? "Targets appear when indexed sessions carry pointing or OBJECT evidence. You can also add one with Add Target."
                  : "Targets appear after a capture location is indexed. You can also add one with Add Target."
              }
              action={
                // One first-run next step across the library pages; Add Target stays in the header.
                hasLocations ? (
                  <Button size="sm" render={<Link to="/sessions" />}>
                    Go to Sessions
                  </Button>
                ) : (
                  <Button size="sm" render={<Link to="/settings/locations" />}>
                    Add a capture location
                  </Button>
                )
              }
            />
          )}
        </PageBody>
        {dialog}
      </div>
    )
  }

  return (
    <TargetsLayout activeId={null}>
      <div className="flex min-h-full flex-col">
        {header}
        <PageBody className="space-y-4">
          <LibraryStatus kind="light" notes={unresolvedNotes} />
          <div className="grid grid-cols-4 gap-x-6 gap-y-3 border-y border-separator py-3 max-md:grid-cols-2">
            <Stat label="Targets" value={summaries.length} />
            <Stat label="Captured" value={formatDuration(captured)} />
            <Stat label="Usable" value={formatDuration(usable)} hint="Library-scope quality decisions only" />
            <Stat label="Need review" value={plural(needsReview, "Target")} />
          </div>
          <p className="text-[0.75rem] text-muted-foreground">Choose a Target in the finder to see its coverage by channel, sessions, Projects, Views and Plan. ↑ and ↓ move through the list.</p>
        </PageBody>
      </div>
      {dialog}
    </TargetsLayout>
  )
}
