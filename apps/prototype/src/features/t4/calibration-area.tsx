/**
 * `/views/$viewId/calibration` — Calibration for this View (flow E1-E2,
 * J23 S1-S7). Suggestions are preselected per group and stay visibly distinct
 * from accepted assignments until the user accepts them (CAL-FR-02).
 */
import { Link } from "@tanstack/react-router"
import { ArrowRight, Ellipsis, FolderSearch } from "lucide-react"
import { useMemo, useState } from "react"
import { type Column, DataTable } from "@/components/app/data-table"
import { ActionError, EmptyState, Notice } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { CommitResult } from "@/store/core"
import { useStore } from "@/store/core"
import { formatCount, formatNight, plural } from "@/lib/format"
import { acceptSuggestions, decideRow, updatePrep } from "./actions"
import { KIND_LABEL, type RequirementRow, sameInput, sessionLabel, summaryText } from "./domain"
import { useCalibrationPlan, useRouteView } from "./hooks"
import { ResolveDialog } from "./resolve-dialog"
import { WhyThisMatchSheet } from "./why-sheet"

export function ViewNotFound() {
  return (
    <PageBody>
      <EmptyState
        icon={FolderSearch}
        titleAs="h2"
        title="This View does not exist"
        description="It may have been removed, or the link is from another library."
        action={<Button render={<Link to="/views" />}>Go to Views</Button>}
      />
    </PageBody>
  )
}

function InputCell({ row }: { row: RequirementRow }) {
  const kind = KIND_LABEL[row.kind].toLowerCase()
  if (row.state === "excluded") return <span className="text-muted-foreground">Not handed off</span>
  if (row.state === "deferred") return <span className="text-muted-foreground">Decision deferred</span>
  if (!row.source) {
    return (
      <span className="block whitespace-normal">
        <span className="block">No compatible {kind}</span>
        {row.closest ? (
          <span className="block text-xs text-muted-foreground">
            Closest: {row.closest.source.name} ({summaryText(row.closest.criteria).toLowerCase()})
          </span>
        ) : null}
      </span>
    )
  }
  const others = row.candidates.filter((c) => c.summary.allCompatible && !sameInput(c.source.input, row.input)).length
  return (
    <span className="block whitespace-normal">
      <span className="block [overflow-wrap:anywhere]">{row.source.name}</span>
      <span className="block text-xs text-muted-foreground">
        {row.source.isMaster ? "Library master" : `Raw set · ${plural(row.source.frameCount ?? 0, "frame")}`}
        {others > 0 && row.state !== "suggested" && !row.pending ? ` · ${plural(others, "compatible alternative")}` : ""}
      </span>
      {row.drift ? <span className="block text-xs text-pretty">{row.drift} Not handed off until its accepted bytes return.</span> : null}
      {row.pending ? (
        <span className="block text-xs text-pretty text-muted-foreground [overflow-wrap:anywhere]">
          Suggested instead: {row.pending.source.name}, a newly adopted master. This decision stands until you accept it.
        </span>
      ) : null}
    </span>
  )
}

export function ViewCalibrationArea() {
  const { viewId, view } = useRouteView()
  const plan = useCalibrationPlan(view)
  const profileName = useStore((s) => (view?.profileId ? (s.catalog.profiles[view.profileId]?.name ?? null) : null))
  const [deselected, setDeselected] = useState<string[]>([])
  const [whyKey, setWhyKey] = useState<string | null>(null)
  const [resolve, setResolve] = useState<{ key: string; exception: boolean } | null>(null)
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null)
  const [announcement, setAnnouncement] = useState("")

  const offerKeys = useMemo(() => plan?.rows.filter((r) => r.state === "suggested" || r.pending).map((r) => r.key) ?? [], [plan])
  const selected = offerKeys.filter((key) => !deselected.includes(key))

  if (!view || !plan) return <ViewNotFound />
  const complete = Boolean(view.completedAt)
  const whyRow = plan.rows.find((r) => r.key === whyKey) ?? null
  const resolveRow = plan.rows.find((r) => r.key === resolve?.key) ?? null

  function run(action: () => CommitResult, success: string) {
    const result = action()
    if (!result.ok) {
      setError({ message: result.message, retry: () => run(action, success) })
      return false
    }
    setError(null)
    setAnnouncement(success)
    return true
  }

  function acceptSelected() {
    if (!view || !plan) return
    const rows = plan.rows.filter((r) => selected.includes(r.key))
    if (run(() => acceptSuggestions(view, rows), `${plural(rows.length, "suggestion")} accepted.`)) {
      setDeselected([])
      // The Accept button unmounts once nothing is left to accept; keep focus on the next step (WCAG 2.4.3).
      requestAnimationFrame(() => document.getElementById("cal-review-preparation")?.focus())
    }
  }

  const columns: Column<RequirementRow>[] = [
    {
      id: "session",
      header: "Light session",
      rowHeader: true,
      cell: (row) => (
        <span className="block">
          {/* Channel and settings are in the group heading; the night and frame count identify the session. */}
          <span className="block">{formatNight(row.member.session.night)}</span>
          <span className="block text-xs text-muted-foreground">{plural(row.member.included.length, "frame")}</span>
        </span>
      ),
      sortValue: (row) => row.member.session.night,
    },
    { id: "kind", header: "Kind", cell: (row) => KIND_LABEL[row.kind] },
    { id: "input", header: "Input", cell: (row) => <InputCell row={row} />, className: "min-w-40" },
    {
      id: "match",
      header: "Why this match",
      cell: (row) => {
        const name = `${KIND_LABEL[row.kind].toLowerCase()} for ${formatNight(row.member.session.night)} ${row.member.session.channel ?? ""}`.trim()
        // Visible summary first, so the accessible name contains the visible label (WCAG 2.5.3).
        return (
          <Button size="sm" variant="link" className="h-auto max-w-48 justify-start px-0 text-left text-xs whitespace-normal" onClick={() => setWhyKey(row.key)}>
            {row.criteria.length > 0 ? summaryText(row.criteria) : row.candidates.length > 0 ? `${plural(row.candidates.length, "candidate")} considered` : "No candidate"}
            <span className="sr-only">: why this match, {name}</span>
          </Button>
        )
      },
    },
    {
      id: "state",
      header: "State",
      cell: (row) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge kind="assignment" value={row.state} />
          {row.drift ? <StatusBadge kind="content" value="drifted" /> : null}
          {row.pending ? <StatusBadge kind="assignment" value="suggested" /> : null}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: (row) => {
        const kind = KIND_LABEL[row.kind].toLowerCase()
        const name = `${kind} for ${formatNight(row.member.session.night)} ${row.member.session.channel ?? ""}`.trim()
        return (
          <span className="flex items-center gap-1">
            <DropdownMenu>
              {/* Icon trigger with a full accessible name keeps every row action inside the 1024 px frame. */}
              <DropdownMenuTrigger render={<Button size="icon-sm" variant="outline" disabled={complete} aria-label={`Change ${name}`} />}>
                <Ellipsis aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {row.state === "suggested" || row.pending ? (
                  <DropdownMenuItem onClick={() => run(() => acceptSuggestions(view, [row]), `Accepted ${(row.pending ?? row.suggestion)?.source.name ?? kind}.`)}>
                    Accept suggestion
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={() => setResolve({ key: row.key, exception: false })}>Choose another input…</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setResolve({ key: row.key, exception: true })}>Record exception…</DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => run(() => decideRow(view, row, { state: "deferred", input: null, criteria: [] }, `Defer ${name}`), `Deferred the ${name}.`)}
                >
                  Defer
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => run(() => decideRow(view, row, { state: "excluded", input: null, criteria: [] }, `Hand off without a ${kind}`), `The ${name} will not be handed off.`)}
                >
                  Hand off without a {kind}
                </DropdownMenuItem>
                {row.assignment ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => run(() => decideRow(view, row, null, `Clear ${name}`), `Cleared the ${name} decision.`)}>Clear decision</DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        )
      },
    },
  ]

  const blockingCount = plan.blocking.length
  const pendingCount = plan.rows.filter((r) => r.pending).length
  const unsavedDraft = Boolean(view.draft)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        level={2}
        title="Calibration for this View"
        description="Suggestions are never handed off until you accept them. Why this match lists every criterion."
        meta={
          <span className="flex flex-wrap gap-1.5" aria-live="polite">
            {plan.counts.accepted ? <StatusBadge kind="assignment" value="accepted" label={`${formatCount(plan.counts.accepted)} Accepted`} /> : null}
            {plan.counts.exception ? <StatusBadge kind="assignment" value="exception" label={`${formatCount(plan.counts.exception)} Exception`} /> : null}
            {plan.counts.suggested + pendingCount ? <StatusBadge kind="assignment" value="suggested" label={`${formatCount(plan.counts.suggested + pendingCount)} Suggested`} /> : null}
            {plan.counts.unresolved ? <StatusBadge kind="assignment" value="unresolved" label={`${formatCount(plan.counts.unresolved)} Unresolved`} /> : null}
            {plan.counts.deferred ? <StatusBadge kind="assignment" value="deferred" label={`${formatCount(plan.counts.deferred)} Deferred`} /> : null}
            {plan.counts.excluded ? <StatusBadge kind="assignment" value="excluded" label={`${formatCount(plan.counts.excluded)} Excluded`} /> : null}
            {plan.drifted ? <StatusBadge kind="content" value="drifted" label={`${formatCount(plan.drifted)} Drifted`} /> : null}
          </span>
        }
        actions={
          <>
            <Button
              id="cal-review-preparation"
              variant={offerKeys.length > 0 && !complete ? "outline" : "default"}
              onClick={() => updatePrep(viewId, { reviewing: true })}
              render={<Link to="/views/$viewId/prepare" params={{ viewId }} />}
            >
              Review preparation
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Button>
            {offerKeys.length > 0 && !complete ? (
              <>
                {selected.length === 0 ? (
                  <span id="accept-reason" className="text-xs text-muted-foreground">
                    Select at least one suggestion.
                  </span>
                ) : null}
                <Button disabled={selected.length === 0} aria-describedby={selected.length === 0 ? "accept-reason" : undefined} onClick={acceptSelected}>
                  Accept {plural(selected.length, "suggestion")}
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <PageBody>
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
        {error ? <ActionError message={error.message} onRetry={error.retry} /> : null}
        {complete ? (
          <Notice tone="info" title="This View is Complete">
            Calibration decisions are read-only. Reopen the View in its header to change them.
          </Notice>
        ) : null}
        {unsavedDraft ? (
          <Notice tone="info" title="Following the unsaved selection">
            These requirements follow this View's unsaved changes. Save View before Review preparation; decisions made here are kept.
          </Notice>
        ) : null}
        {plan.rows.length === 0 ? (
          <EmptyState
            icon={FolderSearch}
            titleAs="h3"
            title="This View has no light sessions yet"
            description="Calibration requirements appear once the View includes light frames."
            action={<Button render={<Link to="/views/$viewId/sessions" params={{ viewId }} />}>Select sessions</Button>}
          />
        ) : (
          <>
            {blockingCount > 0 ? (
              <Notice tone="warning" title={`${plural(blockingCount, "requirement")} not resolved`}>
                Review preparation stays blocked until each is accepted, resolved with an exception or another input, or handed off without that kind. Deferred items also block
                {plan.drifted ? ", and so does an input whose bytes changed since it was accepted" : ""}.
              </Notice>
            ) : (
              <Notice tone="info" title="Every requirement is decided">
                Accepted inputs and exceptions are handed off with this View's preparation.
              </Notice>
            )}
            {plan.groups.map((group) => (
              <section key={group.key} aria-label={group.label} className="space-y-2">
                <h3 className="text-sm font-semibold text-balance">{group.label}</h3>
                <DataTable
                  label={`Calibration requirements: ${group.label}`}
                  rows={group.rows}
                  columns={columns}
                  getRowId={(row) => row.key}
                  scroll="none"
                  selection={{
                    selected: selected.filter((key) => group.rows.some((r) => r.key === key)),
                    onChange: (ids) => {
                      const groupOffers = group.rows.filter((r) => offerKeys.includes(r.key)).map((r) => r.key)
                      setDeselected((current) => [...current.filter((key) => !groupOffers.includes(key)), ...groupOffers.filter((key) => !ids.includes(key))])
                    },
                    // The shared table prefixes "Select" and disables decided rows; the name says why, matching the State column.
                    rowLabel: (row) =>
                      row.state === "suggested"
                        ? `${KIND_LABEL[row.kind].toLowerCase()} suggestion for ${sessionLabel(row.member.session)}`
                        : row.pending
                          ? `${KIND_LABEL[row.kind].toLowerCase()} replacement suggestion for ${sessionLabel(row.member.session)} (the ${row.state} decision stays until you accept it)`
                          : `${KIND_LABEL[row.kind].toLowerCase()} for ${sessionLabel(row.member.session)} (${row.state}, nothing to accept)`,
                    isSelectable: (row) => offerKeys.includes(row.key) && !complete,
                  }}
                />
              </section>
            ))}
          </>
        )}
      </PageBody>
      <WhyThisMatchSheet
        row={whyRow}
        viewId={viewId}
        applicationName={profileName}
        canAccept={!complete}
        onOpenChange={(open) => !open && setWhyKey(null)}
        onAccept={(row) => {
          if (run(() => acceptSuggestions(view, [row]), `Accepted ${row.suggestion?.source.name ?? "the suggestion"}.`)) setWhyKey(null)
        }}
        onChoose={(row) => {
          setWhyKey(null)
          setResolve({ key: row.key, exception: row.state === "unresolved" })
        }}
      />
      <ResolveDialog view={view} row={resolveRow} preferException={resolve?.exception ?? false} onOpenChange={(open) => !open && setResolve(null)} />
    </div>
  )
}
