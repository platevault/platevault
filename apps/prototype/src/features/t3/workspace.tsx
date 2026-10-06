/**
 * View workspace host (`/views/$viewId`, layout route): one persistent header
 * with the View name, Project, profile, status, membership summary, Save
 * View and Reopen, then links to the areas (no forced wizard, VSEL-FR-02). Owns the page
 * h1; areas render level-2 headers. Hosts T4 and T5 areas through <Outlet />.
 */
import { Link, Outlet, useNavigate, useParams, useRouterState } from "@tanstack/react-router"
import { FolderSearch, RefreshCw, Save } from "lucide-react"
import { createContext, type ReactNode, useContext, useId, useMemo, useState } from "react"
import { STAGE_LABEL, type StageId, viewPipeline } from "@/app/pipeline"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { ActionError, EmptyState, Notice, SaveState } from "@/components/app/feedback"
import { PageHeader } from "@/components/app/page"
import { NextActionBar, PipelineRail } from "@/components/app/pipeline"
import { STATUS, StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { viewStatus } from "@/domain/derive"
import type { MembershipContent, MembershipRevision, View } from "@/domain/types"
import { formatDateTime, formatDuration, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { type CommitResult, store, useStore } from "@/store/core"
import { discardDraft, editViewDetails, reopenView, resumeDraft, saveView, updateDraft, useRecoveredDraft } from "./actions"
import { SelectField } from "./fields"
import {
  contentOf,
  describeDiff,
  diffContent,
  emptyContent,
  framesSincePrepared,
  latestRevision,
  type ViewContext,
  viewContext,
  type ViewSummary,
  viewSummary,
} from "./model"

export interface Workspace {
  view: View
  /** Membership shown and edited: the draft, else the latest revision. A recovered draft shows the committed revision until resumed. */
  content: MembershipContent
  base: MembershipRevision | null
  ctx: ViewContext
  summary: ViewSummary
  /** Null when membership can be edited; otherwise the visible reason. */
  readOnlyReason: string | null
}

const WorkspaceContext = createContext<Workspace | null>(null)

export function useWorkspace(): Workspace {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error("useWorkspace outside the View workspace")
  return value
}

/**
 * Draft edits with the failure kept beside the control that caused it. Only a
 * failed catalog write offers Retry; a refusal (Complete View, recovered draft
 * not resumed) shows its reason, because retrying it is refused the same way.
 */
export function useDraftEditor(viewId: string) {
  const view = useStore((s) => s.catalog.views[viewId])
  const recovered = useRecoveredDraft(view)
  const [error, setError] = useState<{ message: string; retry: (() => void) | null } | null>(null)
  function edit(label: string, change: Parameters<typeof updateDraft>[2]): CommitResult {
    // The same preconditions updateDraft refuses on, read before the call.
    const refused = Boolean(store.getState().catalog.views[viewId]?.completedAt) || recovered
    const result = updateDraft(viewId, label, change)
    setError(result.ok ? null : { message: result.message, retry: refused ? null : () => edit(label, change) })
    return result
  }
  const errorNode = error ? <ActionError message={error.message} onRetry={error.retry ?? undefined} /> : null
  return { edit, errorNode }
}

function SummaryStrip({ summary, content }: { summary: ViewSummary; content: MembershipContent }) {
  const items: Array<{ label: string; value: ReactNode; tone?: "warning" }> = [
    { label: "Included", value: `${plural(summary.included.frames, "light")} · ${formatDuration(summary.included.seconds)}` },
    ...summary.byChannel.map((c) => ({ label: c.channel, value: `${c.included.frames} / ${formatDuration(c.included.seconds)}` })),
    { label: "Excluded", value: summary.excluded },
    { label: "Unresolved", value: summary.unresolved, tone: summary.unresolved > 0 ? ("warning" as const) : undefined },
    { label: "Unreviewed (included)", value: summary.unreviewed },
    { label: "Unusable", value: summary.excludedUnusable > 0 ? `${summary.unusable} included · ${summary.excludedUnusable} excluded` : `${summary.unusable} included` },
  ]
  if (summary.includedUnavailable > 0) {
    // Name why the members cannot be read: "208 Offline", "208 Retired" (D11, VSEL-AC-09).
    const value = summary.includedUnavailableBy.map((u) => `${u.frames} ${STATUS.availability[u.state].label}`).join(" · ")
    items.push({ label: "Unavailable now", value, tone: "warning" })
  }
  if (content.productInputs.length > 0) items.push({ label: "Result inputs", value: content.productInputs.length })
  return (
    <div className="border-b px-6 py-2">
      <h2 className="sr-only">Selection summary</h2>
      <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm tabular-nums">
        {items.map((item) => (
          <div key={item.label} className={cn("flex items-baseline gap-1.5", item.tone === "warning" && "text-warning")}>
            <dt className={cn("text-xs", item.tone === "warning" ? "" : "text-muted-foreground")}>{item.label}</dt>
            <dd className="font-medium">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * Harness V3: the View areas nav is C's pipeline rail (each area with its
 * gate), the area scrolls in its own pane, and the one Next action docks
 * under it. The pipeline is derived read-only (src/app/pipeline.ts).
 */
function PipelineFrame({ view, children }: { view: View; children: ReactNode }) {
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const decisions = useStore((s) => s.slices.t4.decisions)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const pipeline = useMemo(() => viewPipeline(catalog, disk, view, decisions), [catalog, disk, view, decisions])
  const area = pathname.split("/")[3]
  const active = (Object.keys(STAGE_LABEL) as StageId[]).find((id) => id === area) ?? null
  return (
    <>
      <PipelineRail viewId={view.id} pipeline={pipeline} active={active} />
      {/* `relative`: sr-only and other absolute descendants stay inside this pane's scroll, not the main pane's. */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      <NextActionBar pipeline={pipeline} />
    </>
  )
}

function EditDetailsDialog({ view, open, onOpenChange }: { view: View; open: boolean; onOpenChange: (open: boolean) => void }) {
  const projects = useStore((s) => Object.values(s.catalog.projects))
  const profiles = useStore((s) => Object.values(s.catalog.profiles))
  const [name, setName] = useState(view.name)
  const [projectId, setProjectId] = useState(view.projectId ?? "none")
  const [profileId, setProfileId] = useState(view.profileId ?? "none")
  const [nameError, setNameError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A stale refusal is resolved by loading the current details, never by re-submitting over them (D08).
  const [stale, setStale] = useState(false)
  const nameId = useId()
  const nameErrorId = useId()

  function submit() {
    if (name.trim() === "") {
      setNameError("Enter a View name.")
      document.getElementById(nameId)?.focus()
      return
    }
    const result = editViewDetails(view.id, { name: name.trim(), projectId: projectId === "none" ? null : projectId, profileId: profileId === "none" ? null : profileId }, view.revision)
    if (!result.ok) {
      setError(result.message)
      setStale(result.reason === "stale")
      return
    }
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setName(view.name)
          setProjectId(view.projectId ?? "none")
          setProfileId(view.profileId ?? "none")
          setNameError(null)
          setError(null)
          setStale(false)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit View details</DialogTitle>
          <DialogDescription>Membership and quality decisions stay as they are.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={nameId}>View name</Label>
            <Input
              id={nameId}
              value={name}
              required
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? nameErrorId : undefined}
              onChange={(event) => {
                setName(event.target.value)
                setNameError(null)
              }}
            />
            {nameError ? (
              <p id={nameErrorId} className="text-xs text-destructive">
                {nameError}
              </p>
            ) : null}
          </div>
          <SelectField
            label="Project"
            value={projectId}
            onChange={setProjectId}
            options={[{ value: "none", label: "No Project (standalone View)" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
          />
          <SelectField
            label="Application profile"
            value={profileId}
            onChange={setProfileId}
            description="Optional now; Prepare asks for it before handoff."
            options={[{ value: "none", label: "Not chosen" }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]}
          />
          {error ? (
            <ActionError
              message={error}
              retryLabel={stale ? "Use current details" : "Retry"}
              onRetry={
                stale
                  ? () => {
                      setName(view.name)
                      setProjectId(view.projectId ?? "none")
                      setProfileId(view.profileId ?? "none")
                      setError(null)
                      setStale(false)
                    }
                  : submit
              }
            />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save details</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type SaveFeedback = { state: "failed" | "stale"; message: string } | { state: "reviewed"; note: string } | null

export function ViewWorkspacePage() {
  const { viewId } = useParams({ strict: false }) as { viewId: string }
  const view = useStore((s) => s.catalog.views[viewId])
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const recovered = useRecoveredDraft(view)
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [reopenOpen, setReopenOpen] = useState(false)
  const navigate = useNavigate()

  if (!view) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center p-6">
        <EmptyState
          icon={FolderSearch}
          titleAs="h1"
          title="This View does not exist"
          description="It may have been a draft that was discarded. Your library is unchanged."
          action={
            <Button size="sm" render={<Link to="/views" />}>
              Go to Views
            </Button>
          }
        />
      </div>
    )
  }

  const base = latestRevision(view)
  const content = contentOf(recovered && base ? base : (view.draft ?? base ?? emptyContent()))
  const ctx = viewContext(catalog, view)
  const summary = viewSummary(disk, catalog, content)
  const status = viewStatus(catalog, view)
  const readOnlyReason = view.completedAt
    ? "Reopen View in the header to change membership."
    : recovered
      ? "Resume or discard the recovered changes before editing."
      : null
  const project = view.projectId ? catalog.projects[view.projectId] : undefined
  const target = view.targetId ? catalog.targets[view.targetId] : undefined
  const profile = view.profileId ? catalog.profiles[view.profileId] : undefined
  const hasDraft = view.draft !== null
  const diff = view.draft ? describeDiff(catalog, diffContent(base, view.draft)) : []
  const sincePrepared = framesSincePrepared(catalog, view, content)
  const saveBlocked = view.completedAt
    ? "Complete Views cannot be saved."
    : recovered
      ? "Resume the recovered changes first."
      : saveFeedback?.state === "stale"
        ? "Review the current revision first."
        : hasDraft
          ? null
          : "No unsaved changes."

  function save() {
    const draftBase = view!.draft?.baseRevision ?? null
    const result = saveView(viewId)
    if (result.ok) {
      setSaveFeedback(null)
      return
    }
    // Name the membership revisions the header shows, never the internal record revision.
    const current = store.getState().catalog.views[viewId]
    const latest = current ? (latestRevision(current)?.revision ?? null) : null
    const saved = latest === null ? "nothing is saved yet" : `revision ${latest} is the saved revision`
    if (result.reason === "stale") {
      setSaveFeedback({
        state: "stale",
        message:
          latest !== draftBase
            ? `Save View was refused: revision ${latest} was saved elsewhere after your draft started from ${draftBase === null ? "an unsaved View" : `revision ${draftBase}`}. Review current revision before saving again.`
            : `Save View was refused: this View's details changed elsewhere; ${saved}. Review current revision before saving again.`,
      })
      return
    }
    setSaveFeedback({
      state: "failed",
      message: current ? `Save View failed: the catalog write did not complete, so ${saved}. Your unsaved changes are kept; choose Save View to try again.` : result.message,
    })
  }

  /** After a stale refusal: say what changed elsewhere before Save View is offered again (D08, LIB-AC-08). */
  function reviewCurrent() {
    const draftBase = view!.draft?.baseRevision ?? null
    const latest = base?.revision ?? null
    const before = view!.revisions.find((r) => r.revision === draftBase) ?? null
    const draft = view!.draft ? describeDiff(catalog, diffContent(base, view!.draft)).join("; ") || "no member changes" : "no member changes"
    const note =
      base && draftBase !== latest
        ? `Saved membership moved from ${draftBase === null ? "nothing saved" : `revision ${draftBase}`} to revision ${latest} elsewhere: ${describeDiff(catalog, diffContent(before, base)).join("; ") || "no member changed"}. Your draft against revision ${latest}: ${draft}. Save View commits your draft as revision ${(latest ?? 0) + 1}.`
        : `Saved membership is unchanged (${latest === null ? "never saved" : `revision ${latest}`}); only the View's details changed elsewhere. Your draft against ${latest === null ? "an empty View" : `revision ${latest}`}: ${draft}. Save View commits it as revision ${(latest ?? 0) + 1}.`
    setSaveFeedback({ state: "reviewed", note })
    // The Review button unmounts with the stale state: focus goes to Save View, the next step (WCAG 2.4.3).
    requestAnimationFrame(() => document.getElementById(`${viewId}-save`)?.focus())
  }

  const saveState = saveFeedback?.state === "failed" || saveFeedback?.state === "stale" ? saveFeedback.state : hasDraft || !base ? "unsaved" : "saved"
  const saveError = saveFeedback?.state === "failed" || saveFeedback?.state === "stale" ? saveFeedback.message : null
  const workspace: Workspace = { view, content, base, ctx, summary, readOnlyReason }

  return (
    <WorkspaceContext.Provider value={workspace}>
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader
          title={view.name}
          // The title column keeps at least 20rem: when the actions (Reopen View on a Complete View) do not fit beside it, they wrap under the title instead of squeezing it.
          className="[&>:first-child]:basis-80"
          eyebrow={
            <span className="flex flex-wrap items-center gap-1">
              <Link to="/views" className="hover:text-foreground hover:underline">
                Views
              </Link>
              <span aria-hidden="true">›</span>
              {project ? (
                <Link to="/projects/$projectId" params={{ projectId: project.id }} className="hover:text-foreground hover:underline">
                  Project {project.name}
                </Link>
              ) : (
                <span>Standalone View</span>
              )}
            </span>
          }
          meta={status !== "saved" ? <StatusBadge kind="view" value={status} /> : null}
          description={
            <span className="tabular-nums">
              {base ? `Revision ${base.revision} saved ${formatDateTime(base.savedAt)}` : "Not saved yet"}
              {" · "}Profile {profile ? profile.name : "Not chosen"}
              {" · "}Target {target ? target.name : "None"}
            </span>
          }
          actions={
            <div className="flex flex-wrap items-start gap-2">
              <Button variant="outline" size="sm" onClick={() => setDetailsOpen(true)}>
                Edit details
              </Button>
              <Button variant="outline" size="sm" render={<Link to="/views/$viewId/refresh" params={{ viewId }} />}>
                <RefreshCw aria-hidden="true" data-icon="inline-start" />
                Refresh selection
              </Button>
              {hasDraft && !recovered ? (
                <Button variant="outline" size="sm" onClick={() => setDiscardOpen(true)}>
                  Discard…
                </Button>
              ) : null}
              {view.completedAt ? (
                <Button variant="outline" size="sm" onClick={() => setReopenOpen(true)}>
                  Reopen View…
                </Button>
              ) : null}
              <div className="flex flex-col items-end gap-1">
                {/* Directly under Save View: the state, and for a stale refusal the review it needs (D08); Save View itself retries a failed write.
                    Stacked rather than in the row, so the header row keeps its width for the View name. */}
                <div className="flex flex-col-reverse items-end gap-1">
                  <SaveState state={saveState} onReview={reviewCurrent} />
                  <Button
                    id={`${viewId}-save`}
                    size="sm"
                    onClick={save}
                    disabled={saveBlocked !== null}
                    focusableWhenDisabled
                    aria-describedby={saveError ? `${viewId}-save-error` : saveBlocked ? `${viewId}-save-reason` : undefined}
                    className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
                  >
                    <Save aria-hidden="true" data-icon="inline-start" />
                    Save View
                  </Button>
                </div>
                {saveError ? (
                  <ActionError id={`${viewId}-save-error`} message={saveError} className="max-w-sm justify-end text-right text-xs" />
                ) : saveBlocked ? (
                  <span id={`${viewId}-save-reason`} className="max-w-sm text-right text-xs text-muted-foreground">
                    {saveBlocked}
                  </span>
                ) : null}
              </div>
            </div>
          }
        />
        <SummaryStrip summary={summary} content={content} />
        <PipelineFrame view={view}>
        <div className="space-y-3 px-6 pt-4 empty:hidden">
          {saveFeedback?.state === "reviewed" ? (
            <Notice tone="info" title="Reviewed: the View changed elsewhere">
              {saveFeedback.note}
            </Notice>
          ) : null}
          {recovered ? (
            <Notice
              tone="warning"
              title="Recovered unsaved changes"
              actions={
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      resumeDraft(viewId)
                      // The notice unmounts: hand focus to the next step instead of the page body (WCAG 2.4.3).
                      requestAnimationFrame(() => document.getElementById(`${viewId}-save`)?.focus())
                    }}
                  >
                    Resume editing
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDiscardOpen(true)}>
                    Discard changes
                  </Button>
                </>
              }
            >
              {base
                ? `Saved revision ${base.revision} is shown. Changes made before PlateVault restarted are kept apart and are not applied: ${diff.join("; ")}.`
                : `This View was never saved. Its draft from before PlateVault restarted is shown read-only until you resume or discard it: ${diff.join("; ")}.`}
            </Notice>
          ) : null}
          {view.completedAt ? (
            <Notice tone="info" title={`Complete since ${formatDateTime(view.completedAt)}`}>
              Membership, calibration decisions and new preparations are read-only while the View is Complete. Reopen View in the header clears Complete;
              Results, cleanup records and preparations stay as they are.
            </Notice>
          ) : null}
          {sincePrepared && sincePrepared.added > 0 && !view.completedAt ? (
            <Notice
              tone="warning"
              title={`${plural(sincePrepared.added, "frame")} added since prepared revision ${sincePrepared.preparedRevision} need review`}
              actions={
                <>
                  <Button size="sm" variant="outline" render={<Link to="/views/$viewId/frames" params={{ viewId }} />}>
                    Review frames
                  </Button>
                  <Button size="sm" variant="outline" render={<Link to="/views/$viewId/calibration" params={{ viewId }} />}>
                    Review calibration
                  </Button>
                </>
              }
            >
              Prepared revision {sincePrepared.preparedRevision} and its {plural(sincePrepared.entryCount, "entry", "entries")} are unchanged; preparing this
              membership needs a new Review preparation.
            </Notice>
          ) : null}
        </div>
          <Outlet />
        </PipelineFrame>
      </div>
      <EditDetailsDialog view={view} open={detailsOpen} onOpenChange={setDetailsOpen} />
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        tone="destructive"
        title={base ? "Discard unsaved changes?" : "Discard this draft View?"}
        description={base ? `The View returns to saved revision ${base.revision}.` : "The View was never saved, so it is removed from Views."}
        changes={base ? diff : ["Remove the draft View and its unsaved selection"]}
        unchanged={["Sessions, frames and source files", "Library quality decisions", ...(base ? [`Saved revision ${base.revision}`] : []), "Other Views"]}
        confirmLabel={base ? "Discard changes" : "Discard draft View"}
        onConfirm={() => {
          const result = discardDraft(viewId)
          if (result.ok) {
            if (!base) void navigate({ to: "/views" })
            else requestAnimationFrame(() => document.getElementById(`${viewId}-save`)?.focus())
          }
          return result
        }}
      />
      {/* Mounted outside the header button so it survives the button unmounting when Complete clears. */}
      <ConfirmDialog
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        title={`Reopen ${view.name}?`}
        description="Reopen lets you change membership again."
        changes={["Clear Complete on this View"]}
        unchanged={["Accepted Results", "Cleanup records and files", "Prepared revisions and their entries", "Library quality decisions"]}
        confirmLabel="Reopen View"
        onConfirm={() => reopenView(viewId, view.revision)}
        focusAfterConfirm={() => document.getElementById(`${viewId}-save`)}
      />
    </WorkspaceContext.Provider>
  )
}
