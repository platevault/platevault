/**
 * Refresh selection (`/views/$viewId/refresh`, product flow G, VSEL-FR-12):
 * the saved criteria compared with the library now. Added and removed
 * sessions carry reasons; manual inclusions and explicit exclusions stay as
 * recorded; unobservable members read Unavailable, never removed. Nothing
 * changes until the user accepts a change, and accepted changes go to the
 * draft for Save View to commit as a new reviewed revision. Prepared entries
 * are never touched here (VSEL-AC-12, D09).
 */
import { Link, useNavigate } from "@tanstack/react-router"
import { GitCompareArrows, Save } from "lucide-react"
import { useId, useState } from "react"
import { KeyValueList } from "@/components/app/data"
import { EmptyState, Notice } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { Catalog } from "@/domain/types"
import { formatDuration, formatNight, plural } from "@/lib/format"
import { nowIso, useStore } from "@/store/core"
import { clearRefreshDecisions, setRefreshDecision } from "./actions"
import { effectiveExposureS, sessionLocationIds } from "@/domain/derive"
import { applyRefreshChanges, describeCriteria, type RefreshChange, refreshComparison, REASON_LABEL, sessionLabel } from "./model"
import { useDraftEditor, useWorkspace } from "./workspace"

const KIND_LABEL: Record<RefreshChange["kind"], string> = {
  "add-session": "Added session",
  "remove-session": "Removed session",
  "add-frames": "Added frames",
}

function changeTotals(catalog: Catalog, change: RefreshChange) {
  const session = catalog.sessions[change.sessionId]
  const ids = change.kind === "add-frames" ? change.assetIds : (session?.assetIds ?? [])
  const seconds = ids.reduce((sum, id) => {
    const asset = catalog.assets[id]
    return sum + (asset ? effectiveExposureS(catalog, asset) : 0)
  }, 0)
  const copies = ids.filter((id) => (catalog.assets[id]?.copies.length ?? 0) > 1).length
  const locations = session ? sessionLocationIds(catalog, session).map((id) => catalog.locations[id]?.displayName ?? "Unknown location") : []
  return { frames: ids.length, seconds, copies, locations }
}

function ChangeRow({ change, decision, declinedEarlier, inDraft, editable, viewId }: {
  change: RefreshChange
  decision: "accept" | "decline" | undefined
  declinedEarlier: boolean
  inDraft: boolean
  editable: boolean
  viewId: string
}) {
  const catalog = useStore((s) => s.catalog)
  const legendId = useId()
  const session = catalog.sessions[change.sessionId]
  const totals = changeTotals(catalog, change)
  return (
    <li className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="min-w-0 space-y-1">
        <p id={legendId} className="font-medium">
          {KIND_LABEL[change.kind]}: {session ? sessionLabel(session) : "a session no longer in the library"}
          <span className="font-normal text-muted-foreground tabular-nums">
            {" "}
            · {plural(totals.frames, "frame")} · {formatDuration(totals.seconds)}
          </span>
        </p>
        <p className="text-sm text-pretty text-muted-foreground">{change.detail}.</p>
        {totals.copies > 0 ? (
          <p className="text-xs text-muted-foreground">
            {plural(totals.copies, "frame")} with a second physical copy ({totals.locations.join(", ")}): each enters the View once.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {declinedEarlier ? <StatusBadge kind="assignment" value="deferred" label="Declined earlier" /> : null}
          {inDraft ? <StatusBadge kind="save" value="unsaved" label="Accepted, in the unsaved draft" /> : null}
        </div>
      </div>
      {inDraft ? null : (
        <RadioGroup
          aria-labelledby={legendId}
          value={decision ?? null}
          onValueChange={(value) => setRefreshDecision(viewId, change.id, value as "accept" | "decline")}
          className="flex gap-4"
          disabled={!editable}
        >
          {(["accept", "decline"] as const).map((value) => (
            <div key={value} className="flex items-center gap-2">
              <RadioGroupItem value={value} id={`${change.id}-${value}`} />
              <Label htmlFor={`${change.id}-${value}`} className="font-normal">
                {value === "accept" ? "Accept" : "Decline"}
              </Label>
            </div>
          ))}
        </RadioGroup>
      )}
    </li>
  )
}

export function RefreshArea() {
  const { view, content, ctx, readOnlyReason } = useWorkspace()
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const ui = useStore((s) => s.slices.t3.refresh[view.id]) ?? { decisions: {}, declined: [] }
  const navigate = useNavigate()
  const { edit, errorNode } = useDraftEditor(view.id)
  const [applied, setApplied] = useState<number | null>(null)
  const comparison = refreshComparison(disk, catalog, view, ctx)
  const prepared = Object.values(catalog.preparations)
    .filter((p) => p.viewId === view.id && (p.state === "prepared" || p.state === "partial"))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1)
  const editable = readOnlyReason === null

  if (!comparison) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader level={2} title="Refresh selection" />
        <PageBody>
          <EmptyState
            icon={GitCompareArrows}
            titleAs="h3"
            title="Save the View before refreshing"
            description="Refresh compares the saved criteria and reviewed membership with the library now."
            action={
              <Button size="sm" render={<Link to="/views/$viewId/sessions" params={{ viewId: view.id }} />}>
                Go to Sessions
              </Button>
            }
          />
        </PageBody>
      </div>
    )
  }

  const criteria = describeCriteria(catalog, comparison.criteria)
  const inDraft = (change: RefreshChange) => {
    const member = content.sessions.some((s) => s.sessionId === change.sessionId)
    return change.kind === "remove-session" ? !member : change.kind === "add-session" ? member : change.assetIds.every((id) => content.included.includes(id) || content.excluded.includes(id) || content.unresolved.includes(id))
  }
  const pending = comparison.changes.filter((c) => !inDraft(c))
  const accepted = pending.filter((c) => ui.decisions[c.id] === "accept")
  const declined = pending.filter((c) => ui.decisions[c.id] === "decline").map((c) => c.id)
  const undecided = pending.length - accepted.length - declined.length

  function apply() {
    const result = edit(`Apply ${plural(accepted.length, "refresh change")}`, (current, state) => applyRefreshChanges(state.disk, state.catalog, current, accepted, formatNight(nowIso().slice(0, 10))))
    if (!result.ok) return
    clearRefreshDecisions(view.id, declined)
    setApplied(accepted.length)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        level={2}
        title="Refresh selection"
        description="Compare the saved criteria with the library now. Nothing changes until you accept a change and save the View."
      />
      <PageBody className="max-w-5xl">
        {prepared ? (
          <Notice tone="info" title={`Prepared revision ${prepared.membershipRevision} stays unchanged`}>
            Its {plural(prepared.entryCount, "entry", "entries")} at {prepared.viewPath} are what an external application reads. Accepting changes saves a new membership
            revision only; preparing it needs its own Review preparation.
          </Notice>
        ) : null}
        {applied !== null ? (
          <Notice
            tone="info"
            title={`${plural(applied, "change")} applied to the draft`}
            actions={<span className="inline-flex items-center gap-1 text-sm"><Save aria-hidden="true" className="size-4" /> Choose Save View above to commit them as revision {comparison.baseRevision.revision + 1}.</span>}
          >
            Review the frames and calibration of the changed inputs before you prepare again.
          </Notice>
        ) : null}
        {readOnlyReason ? <p className="text-sm text-muted-foreground">{readOnlyReason}</p> : null}

        <Section title="Saved criteria" level={3} description={`Saved with revision ${comparison.baseRevision.revision}. Manual inclusions are not criteria.`}>
          <div className="rounded-lg border p-4">
            <KeyValueList
              items={[
                { label: "Target", value: criteria.target },
                { label: "Geometry", value: criteria.geometry },
                { label: "Equipment", value: criteria.equipment },
                { label: "Channels", value: criteria.channels },
                { label: "Exposures", value: criteria.exposures },
              ]}
            />
          </div>
        </Section>

        <Section title={`Proposed changes (${comparison.changes.length})`} level={3} description="Accept or decline each change. Membership is unchanged until you accept one and save.">
          {comparison.changes.length === 0 ? (
            <EmptyState
              icon={GitCompareArrows}
              title="No changes against the saved criteria"
              description="No new session matches, and every member is still recorded as reviewed."
              action={
                <Button size="sm" variant="outline" render={<Link to="/views/$viewId/sessions" params={{ viewId: view.id }} />}>
                  Back to Sessions
                </Button>
              }
            />
          ) : (
            <ul className="divide-y rounded-lg border">
              {comparison.changes.map((change) => (
                <ChangeRow
                  key={change.id}
                  change={change}
                  decision={ui.decisions[change.id]}
                  declinedEarlier={ui.declined.includes(change.id)}
                  inDraft={inDraft(change)}
                  editable={editable}
                  viewId={view.id}
                />
              ))}
            </ul>
          )}
        </Section>

        <Section title="Kept as recorded" level={3}>
          <ul className="space-y-1 text-sm">
            {comparison.manual.length > 0 ? (
              comparison.manual.map(({ session, reason }) => (
                <li key={session.id}>
                  <span className="font-medium">{sessionLabel(session)}</span>: {REASON_LABEL[reason.kind]} outside these criteria; kept.
                </li>
              ))
            ) : (
              <li className="text-muted-foreground">No manual inclusions.</li>
            )}
            {comparison.exclusions.length > 0 ? (
              comparison.exclusions.map(({ session, count }) => (
                <li key={session.id}>
                  Explicit exclusions kept: {plural(count, "frame")} in <span className="font-medium">{sessionLabel(session)}</span>.
                </li>
              ))
            ) : (
              <li className="text-muted-foreground">No explicit exclusions.</li>
            )}
          </ul>
        </Section>

        <Section title="Unavailable, not removed" level={3} description="Members that cannot be observed now stay in the View; Refresh never removes them.">
          {comparison.unavailable.length > 0 ? (
            <ul className="space-y-1.5 text-sm">
              {comparison.unavailable.map(({ session, members, state }) => (
                <li key={session.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{sessionLabel(session)}</span>
                  <StatusBadge kind="availability" value={state} label={`Unavailable: ${state === "offline" ? "Offline" : state === "unreadable" ? "Unreadable" : "Not found"}`} />
                  <span className="text-muted-foreground">{plural(members, "member")} kept as recorded. Path repair after a move is separate from refresh.</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Every member can be read now.</p>
          )}
        </Section>

        <div className="space-y-2 border-t pt-4">
          {errorNode}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                clearRefreshDecisions(view.id)
                void navigate({ to: "/views/$viewId/sessions", params: { viewId: view.id } })
              }}
            >
              Leave without applying
            </Button>
            <Button onClick={apply} disabled={!editable || accepted.length === 0} aria-describedby={`${view.id}-apply-hint`}>
              Apply {plural(accepted.length, "accepted change")}
            </Button>
            <span id={`${view.id}-apply-hint`} className="text-sm text-muted-foreground">
              {pending.length === 0
                ? "No change is waiting for a decision."
                : accepted.length === 0
                  ? "Accept at least one change to apply it."
                  : `${plural(declined.length, "change")} declined, ${undecided} undecided. Declined changes are remembered for the next refresh.`}
            </span>
          </div>
        </div>
      </PageBody>
    </div>
  )
}
