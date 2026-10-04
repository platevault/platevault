/**
 * View workspace host (`/views/$viewId`, layout route): one persistent header
 * with the View name, Project, profile, status, membership summary and Save
 * View, then links to the areas (no forced wizard, VSEL-FR-02). Owns the page
 * h1; areas render level-2 headers. Hosts T4 and T5 areas through <Outlet />.
 */
import { Link, Outlet, useParams } from "@tanstack/react-router"
import { FolderSearch, RefreshCw, Save } from "lucide-react"
import { createContext, type ReactNode, useContext, useId, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { ActionError, EmptyState, Notice, SaveState } from "@/components/app/feedback"
import { PageHeader } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { viewStatus } from "@/domain/derive"
import type { MembershipContent, MembershipRevision, View } from "@/domain/types"
import { formatDateTime, formatDuration, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { type CommitResult, useStore } from "@/store/core"
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

/** Draft edits with the failure kept beside the control that caused it. */
export function useDraftEditor(viewId: string) {
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null)
  function edit(label: string, change: Parameters<typeof updateDraft>[2]): CommitResult {
    const result = updateDraft(viewId, label, change)
    setError(result.ok ? null : { message: result.message, retry: () => edit(label, change) })
    return result
  }
  const errorNode = error ? <ActionError message={error.message} onRetry={error.retry} /> : null
  return { edit, errorNode }
}

const AREAS = [
  { to: "/views/$viewId/sessions", label: "Sessions" },
  { to: "/views/$viewId/frames", label: "Frames" },
  { to: "/views/$viewId/calibration", label: "Calibration" },
  { to: "/views/$viewId/prepare", label: "Prepare" },
  { to: "/views/$viewId/results", label: "Results" },
  { to: "/views/$viewId/cleanup", label: "Cleanup" },
] as const

function SummaryStrip({ summary, content }: { summary: ViewSummary; content: MembershipContent }) {
  const items: Array<{ label: string; value: ReactNode; tone?: "warning" }> = [
    { label: "Included", value: `${plural(summary.included.frames, "light")} · ${formatDuration(summary.included.seconds)}` },
    ...summary.byChannel.map((c) => ({ label: c.channel, value: `${c.included.frames} / ${formatDuration(c.included.seconds)}` })),
    { label: "Excluded", value: summary.excluded },
    { label: "Unresolved", value: summary.unresolved, tone: summary.unresolved > 0 ? ("warning" as const) : undefined },
    { label: "Unreviewed", value: summary.unreviewed },
    { label: "Unusable", value: summary.unusable },
  ]
  if (summary.includedUnavailable > 0) items.push({ label: "Unavailable now", value: summary.includedUnavailable, tone: "warning" })
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

function AreaNav({ viewId }: { viewId: string }) {
  return (
    <nav aria-label="View areas" className="border-b px-4">
      <ul className="-mb-px flex flex-wrap gap-1">
        {AREAS.map((area) => (
          <li key={area.to}>
            <Link
              to={area.to}
              params={{ viewId }}
              className={cn(
                "inline-flex h-9 items-center border-b-2 border-transparent px-2.5 text-sm text-muted-foreground hover:text-foreground",
                "data-[status=active]:border-primary data-[status=active]:font-medium data-[status=active]:text-foreground",
              )}
            >
              {area.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
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
          {error ? <ActionError message={error} onRetry={submit} /> : null}
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

type SaveFeedback = { state: "failed" | "stale"; message: string } | { state: "reviewed"; revision: number } | null

export function ViewWorkspacePage() {
  const { viewId } = useParams({ strict: false }) as { viewId: string }
  const view = useStore((s) => s.catalog.views[viewId])
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const recovered = useRecoveredDraft(view)
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)

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
    ? "This View is Complete. Reopen it to change membership."
    : recovered
      ? "Resume or discard the recovered changes before editing."
      : null
  const project = view.projectId ? catalog.projects[view.projectId] : undefined
  const target = view.targetId ? catalog.targets[view.targetId] : undefined
  const profile = view.profileId ? catalog.profiles[view.profileId] : undefined
  const hasDraft = view.draft !== null
  const diff = view.draft ? describeDiff(catalog, diffContent(base, view.draft)) : []
  const sincePrepared = framesSincePrepared(catalog, view, content)
  const saveBlocked = view.completedAt ? "Complete Views cannot be saved." : recovered ? "Resume the recovered changes first." : hasDraft ? null : "No unsaved changes."

  function save() {
    const result = saveView(viewId)
    setSaveFeedback(result.ok ? null : result.reason === "stale" ? { state: "stale", message: result.message } : { state: "failed", message: result.message })
  }

  const saveState = saveFeedback?.state === "failed" || saveFeedback?.state === "stale" ? saveFeedback.state : hasDraft || !base ? "unsaved" : "saved"
  const workspace: Workspace = { view, content, base, ctx, summary, readOnlyReason }

  return (
    <WorkspaceContext.Provider value={workspace}>
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader
          title={view.name}
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
          meta={
            <>
              {status !== "saved" ? <StatusBadge kind="view" value={status} /> : null}
              <SaveState
                state={saveState}
                message={saveFeedback && "message" in saveFeedback ? saveFeedback.message : undefined}
                onRetry={save}
                onReview={() => setSaveFeedback({ state: "reviewed", revision: view.revision })}
              />
            </>
          }
          description={
            <span className="tabular-nums">
              {base ? `Revision ${base.revision} saved ${formatDateTime(base.savedAt)}` : "Not saved yet"}
              {" · "}Profile {profile ? profile.name : "Not chosen"}
              {" · "}Target {target ? target.name : "None"}
            </span>
          }
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => setDetailsOpen(true)}>
                Edit details
              </Button>
              <Button variant="outline" size="sm" render={<Link to="/views/$viewId/refresh" params={{ viewId }} />}>
                <RefreshCw aria-hidden="true" data-icon="inline-start" />
                Refresh selection
              </Button>
              <div className="flex flex-col items-end gap-0.5">
                <Button
                  size="sm"
                  onClick={save}
                  disabled={saveBlocked !== null}
                  focusableWhenDisabled
                  aria-describedby={saveBlocked ? `${viewId}-save-reason` : undefined}
                  className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
                >
                  <Save aria-hidden="true" data-icon="inline-start" />
                  Save View
                </Button>
                {saveBlocked ? (
                  <span id={`${viewId}-save-reason`} className="text-xs text-muted-foreground">
                    {saveBlocked}
                  </span>
                ) : null}
              </div>
            </>
          }
        />
        <SummaryStrip summary={summary} content={content} />
        <AreaNav viewId={viewId} />
        <div className="space-y-3 px-6 pt-4 empty:hidden">
          {saveFeedback?.state === "reviewed" ? (
            <Notice tone="info" title="You are now working on the current version">
              The View changed elsewhere since you opened it. Your unsaved changes are kept; choose Save View to commit them on top of the current version.
            </Notice>
          ) : null}
          {recovered ? (
            <Notice
              tone="warning"
              title="Recovered unsaved changes"
              actions={
                <>
                  <Button size="sm" variant="outline" onClick={() => resumeDraft(viewId)}>
                    Resume editing
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDiscardOpen(true)}>
                    Discard changes
                  </Button>
                </>
              }
            >
              {base ? `Saved revision ${base.revision} is shown. ` : "This View was never saved. "}
              Changes made before PlateVault restarted are kept apart and are not applied: {diff.join("; ")}.
            </Notice>
          ) : null}
          {view.completedAt ? (
            <Notice tone="info" title={`Complete since ${formatDateTime(view.completedAt)}`} actions={<ReopenButton view={view} />}>
              Membership edits are refused while the View is Complete. Results, cleanup records and preparations are unchanged by Reopen.
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
        onConfirm={() => discardDraft(viewId)}
      />
    </WorkspaceContext.Provider>
  )
}

function ReopenButton({ view }: { view: View }) {
  return (
    <ConfirmDialog
      trigger={<Button size="sm" variant="outline" />}
      title={`Reopen ${view.name}?`}
      description="Reopen lets you change membership again."
      changes={["Clear Complete on this View"]}
      unchanged={["Accepted Results", "Cleanup records and files", "Prepared revisions and their entries", "Library quality decisions"]}
      confirmLabel="Reopen View"
      onConfirm={() => reopenView(view.id, view.revision)}
    />
  )
}
