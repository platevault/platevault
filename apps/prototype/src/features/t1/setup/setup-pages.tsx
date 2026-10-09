/**
 * First-run setup screens (SetupShell): Welcome, Choose locations, Index your
 * captures. One task per screen, Back is never destructive, and progress lives
 * in the catalog so a reload resumes where the user was (HLD §6).
 */
import { Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, ArrowRight, Check, FlaskConical, FolderPlus, Play, X } from "lucide-react"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Stat } from "@/components/app/data"
import { Notice } from "@/components/app/feedback"
import { OperationPanel } from "@/components/app/operation-panel"
import { PageHeader, StepIndicator } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { isLibraryEmpty } from "@/domain/library"
import type { Location, LocationRole, Operation, OperationId } from "@/domain/types"
import { formatCount } from "@/lib/format"
import { resetPrototype } from "@/store"
import { updateSlice, useStore } from "@/store/core"
import { isSettled, resumeOperation, startIndexing } from "@/store/operations"
import { AddLocationFlow } from "../components/add-location-flow"
import { useLocationActions } from "../components/location-actions"
import { latestIndexRun, LocationRow } from "../components/location-row"
import { framesInLocation, removeLocation, ROLE_COPY } from "../lib/locations"
import { completeOnboarding, setRoleDeferred } from "../lib/writes"

const STEP_IDS = ["welcome", "locations", "indexing"] as const

function SetupHeader({ step, title, description }: { step: (typeof STEP_IDS)[number]; title: string; description: ReactNode }) {
  const m = useMessages()
  const steps = [
    { id: "welcome", label: m.setup_step_welcome() },
    { id: "locations", label: m.common_locations() },
    { id: "indexing", label: m.setup_step_index() },
  ]
  const done = STEP_IDS.slice(0, STEP_IDS.indexOf(step))
  return (
    <div className="space-y-4 px-6 pt-6">
      <StepIndicator steps={steps} current={step} completed={[...done]} label={m.setup_progress()} />
      <PageHeader title={title} description={description} className="border-b-0 px-0 py-0" />
    </div>
  )
}

function rememberRun(id: OperationId) {
  updateSlice("e", (slice) => ({ ...slice, setupOperationIds: [...slice.setupOperationIds, id] }))
}

// ---------------------------------------------------------------------------
// /welcome
// ---------------------------------------------------------------------------

export function WelcomePage() {
  const m = useMessages()
  const navigate = useNavigate()
  const empty = useStore((s) => isLibraryEmpty(s.catalog))
  const [confirmDemo, setConfirmDemo] = useState(false)
  const laterId = useId()

  return (
    <div className="pb-10">
      <SetupHeader
        step="welcome"
        title={m.setup_welcome_title()}
        description={m.setup_welcome_description()}
      />
      <div className="space-y-6 px-6 pt-6">
        <div className="grid grid-cols-2 gap-4">
          <section aria-labelledby="welcome-does" className="space-y-2 rounded-lg border bg-card p-4">
            <h2 id="welcome-does" className="text-sm font-semibold">
              {m.setup_does_title()}
            </h2>
            <ul className="space-y-1.5 text-sm">
              {[m.setup_does_index(), m.setup_does_sessions(), m.setup_does_coverage(), m.setup_does_views()].map((item) => (
                <li key={item} className="flex gap-2">
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                  {item}
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="welcome-never" className="space-y-2 rounded-lg border bg-card p-4">
            <h2 id="welcome-never" className="text-sm font-semibold">
              {m.setup_never_title()}
            </h2>
            <ul className="space-y-1.5 text-sm">
              {[m.setup_never_move(), m.setup_never_headers(), m.setup_never_process(), m.setup_never_account()].map((item) => (
                <li key={item} className="flex gap-2">
                  <X aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="space-y-3">
          <p className="text-sm">
            {empty ? m.setup_next_empty() : m.setup_next_registered()}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button render={<Link to="/setup/locations" />}>
              {empty ? m.setup_set_up_locations() : m.setup_continue()}
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Button>
            <Button
              variant="ghost"
              aria-describedby={laterId}
              onClick={() => {
                completeOnboarding()
                void navigate({ to: "/targets" })
              }}
            >
              {m.setup_later()}
            </Button>
            <span id={laterId} className="text-xs text-muted-foreground">
              {m.setup_later_hint()}
            </span>
          </div>
        </div>

        <Notice
          tone="info"
          title={m.setup_demo_title()}
          actions={
            <Button size="sm" variant="outline" onClick={() => setConfirmDemo(true)}>
              <FlaskConical aria-hidden="true" data-icon="inline-start" />
              {m.setup_demo_load()}
            </Button>
          }
        >
          {m.setup_demo_body()}
        </Notice>
      </div>

      <ConfirmDialog
        open={confirmDemo}
        onOpenChange={setConfirmDemo}
        title={m.setup_demo_confirm_title()}
        description={m.setup_demo_confirm_description()}
        changes={[m.setup_demo_change_replace(), m.setup_demo_change_skip()]}
        unchanged={[m.setup_demo_unchanged_appearance(), m.setup_demo_unchanged_files()]}
        confirmLabel={m.setup_demo_load()}
        onConfirm={() => {
          resetPrototype("demo")
          void navigate({ to: "/targets" })
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// /setup/locations
// ---------------------------------------------------------------------------

const SETUP_ROLES: LocationRole[] = ["captures", "calibration", "results"]

export function SetupLocationsPage() {
  const m = useMessages()
  const navigate = useNavigate()
  const locations = useStore((s) => Object.values(s.catalog.locations).sort((a, b) => a.registeredAt.localeCompare(b.registeredAt)))
  const deferred = useStore((s) => s.settings.onboarding.deferredRoles)
  const catalog = useStore((s) => s.catalog)
  const operations = useStore((s) => s.operations)
  const [adding, setAdding] = useState<LocationRole | null>(null)
  const [removing, setRemoving] = useState<Location | null>(null)
  const actions = useLocationActions({ href: "/setup/locations", onIndexStarted: rememberRun })
  const reasonId = useId()
  const hasCaptures = locations.some((l) => l.role === "captures")

  return (
    <div className="pb-10">
      <SetupHeader
        step="locations"
        title={m.setup_locations_title()}
        description={m.setup_locations_description()}
      />
      <div className="space-y-6 px-6 pt-6">
        {SETUP_ROLES.map((role) => {
          const rows = locations.filter((l) => l.role === role)
          const copy = ROLE_COPY[role]
          const required = role === "captures"
          const isDeferred = deferred.includes(role)
          return (
            <section key={role} aria-labelledby={`setup-${role}`} className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="space-y-0.5">
                  <h2 id={`setup-${role}`} className="flex items-center gap-2 text-base font-semibold">
                    {copy.title}
                    <span className="rounded-md border px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{required ? m.setup_required() : m.site_optional()}</span>
                  </h2>
                  <p className="text-sm text-muted-foreground">{copy.description}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!required && rows.length === 0 && !isDeferred ? (
                    <Button variant="ghost" onClick={() => setRoleDeferred(role, true)}>
                      {m.setup_later()}
                    </Button>
                  ) : null}
                  <Button variant={required && rows.length === 0 ? "default" : "outline"} onClick={() => setAdding(role)}>
                    <FolderPlus aria-hidden="true" data-icon="inline-start" />
                    {rows.length === 0 ? copy.add : m.setup_add_another()}
                  </Button>
                </div>
              </div>
              {rows.length === 0 ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  <StatusBadge kind="role" value="unset" />
                  {required
                    ? m.setup_captures_needed()
                    : isDeferred
                      ? m.setup_deferred()
                      : m.setup_optional_unset()}
                </div>
              ) : (
                <ul className="space-y-2" aria-label={copy.list}>
                  {rows.map((location) => (
                    <LocationRow
                      key={location.id}
                      location={location}
                      onChooseAgain={actions.chooseAgain}
                      onRetry={actions.retry}
                      feedback={actions.feedbackFor(location)}
                      actions={
                        framesInLocation(catalog, location.id) === 0 && !queuedOrRunning(operations, location.id) ? (
                          <Button size="sm" variant="ghost" onClick={() => setRemoving(location)} aria-label={m.project_remove_named({ name: location.displayName })}>
                            {m.settings_remove()}
                          </Button>
                        ) : null
                      }
                    />
                  ))}
                </ul>
              )}
            </section>
          )
        })}

        <Notice tone="info" title={m.setup_nothing_else_title()}>
          {m.setup_nothing_else_body()}
        </Notice>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button variant="outline" render={<Link to="/welcome" />}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            {m.history_back()}
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            {hasCaptures ? null : (
              <span id={reasonId} className="text-sm text-muted-foreground">
                {m.setup_continue_reason()}
              </span>
            )}
            <Button disabled={!hasCaptures} aria-describedby={hasCaptures ? undefined : reasonId} onClick={() => void navigate({ to: "/setup/indexing" })}>
              {m.setup_continue_short()}
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Button>
          </div>
        </div>
      </div>

      <AddLocationFlow role={adding} open={adding !== null} onClose={() => setAdding(null)} href="/setup/locations" roles={SETUP_ROLES} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={m.settings_remove_title({ name: removing?.displayName ?? "" })}
        description={m.setup_remove_description()}
        changes={[m.setup_remove_change({ path: removing?.path ?? "" })]}
        unchanged={[m.setup_remove_unchanged()]}
        confirmLabel={m.location_remove_confirm()}
        tone="destructive"
        onConfirm={() => (removing ? removeLocation(removing.id, "/setup/locations") : undefined)}
      />
      {actions.dialogs}
    </div>
  )
}

/** A location waiting in or being read by an unsettled run cannot be removed from under it (J19 S5). */
function queuedOrRunning(operations: Record<string, Operation>, locationId: string): boolean {
  const run = latestIndexRun(operations, locationId)
  return run !== null && !isSettled(run.op.status) && run.op.status !== "interrupted" && (run.item?.status === "pending" || run.item?.status === "running")
}

// ---------------------------------------------------------------------------
// /setup/indexing
// ---------------------------------------------------------------------------

interface IndexCounts {
  discovered: number
  read: number
  unsupported: number
  unreadableFolders: number
}

/** Reads the foundation `index` payload counts (operations.ts IndexPayload), checking each field. */
function indexCounts(payload: Record<string, unknown>): IndexCounts | null {
  const counts = payload.counts
  if (!counts || typeof counts !== "object") return null
  const { discovered, read, unsupported, unreadableFolders }: Record<string, unknown> = { ...counts }
  if (typeof discovered !== "number" || typeof read !== "number" || typeof unsupported !== "number" || typeof unreadableFolders !== "number") return null
  return { discovered, read, unsupported, unreadableFolders }
}

export function SetupIndexingPage() {
  const m = useMessages()
  const navigate = useNavigate()
  const locations = useStore((s) => Object.values(s.catalog.locations).sort((a, b) => a.registeredAt.localeCompare(b.registeredAt)))
  const runIds = useStore((s) => s.slices.e.setupOperationIds)
  const operations = useStore((s) => s.operations)
  const library = useStore((s) => {
    const sessions = Object.values(s.catalog.sessions).filter((x) => !x.supersededBy && x.imageType === "light")
    const covered = Object.values(s.catalog.locations).filter((l) => framesInLocation(s.catalog, l.id) > 0).map((l) => l.displayName)
    return { sessions: sessions.length, provisional: sessions.some((x) => x.scope !== "complete"), frames: Object.keys(s.catalog.assets).length, covered }
  })
  const actions = useLocationActions({ href: "/setup/indexing", onIndexStarted: rememberRun })
  const indexLaterId = useId()
  const openLibraryButton = useRef<HTMLButtonElement>(null)
  const [focusOpenLibrary, setFocusOpenLibrary] = useState(false)

  const runs = runIds.map((id) => operations[id]).filter((op) => op !== undefined)
  const first = runs[0]
  const latest = runs.at(-1)
  const anyRunning = runs.some((op) => op.status === "running" || op.status === "paused")
  // The grid counts the run shown below it; a Retry is its own run, so the counts follow it (J19 S7).
  const counts = latest ? indexCounts(latest.payload) : null
  // Complete scope is current catalog state, so a retried location counts once it is complete (LIB-FR-03).
  const completeLocations = locations.filter((l) => l.access !== "denied" && l.scanScope === "complete").length
  // Registered after the last run (Back, Add another location) or never reached: still indexable here.
  const unindexed = locations.filter((l) => l.scanScope === "never" && !queuedOrRunning(operations, l.id))
  const footer = anyRunning
    ? m.setup_footer_running()
    : latest?.status === "interrupted"
      ? m.setup_footer_interrupted()
      : latest?.status === "canceled"
        ? m.setup_footer_canceled()
        : unindexed.length > 0
          ? m.setup_footer_unindexed({ count: unindexed.length, n: formatCount(unindexed.length) })
          : m.setup_footer_finished()

  // Start indexing unmounts its own button; hand focus to Open library, which takes its place in the footer.
  useEffect(() => {
    if (!focusOpenLibrary || !first) return
    openLibraryButton.current?.focus()
    setFocusOpenLibrary(false)
  }, [focusOpenLibrary, first])

  function openLibrary() {
    completeOnboarding()
    void navigate({ to: "/targets" })
  }

  return (
    <div className="pb-10">
      <SetupHeader
        step="indexing"
        title={m.setup_indexing_title()}
        description={m.setup_indexing_description()}
      />
      <div className="space-y-6 px-6 pt-6">
        {first ? (
          <section aria-labelledby="index-progress" className="space-y-4">
            <h2 id="index-progress" className="sr-only">
              {m.setup_indexing_progress()}
            </h2>
            {counts && latest ? (
              <div className="space-y-3 rounded-lg border bg-card p-4">
                <p className="text-xs text-muted-foreground">{runs.length > 1 ? m.setup_latest_run({ title: latest.title }) : m.setup_scan()}</p>
                <div className="grid grid-cols-5 gap-4">
                  <Stat label={m.setup_stat_discovered()} value={formatCount(counts.discovered)} />
                  <Stat label={m.setup_stat_read()} value={formatCount(counts.read)} />
                  <Stat label={m.setup_stat_unsupported()} value={formatCount(counts.unsupported)} hint={counts.unsupported ? m.setup_stat_unsupported_hint() : undefined} />
                  <Stat label={m.setup_stat_unreadable()} value={formatCount(counts.unreadableFolders)} hint={counts.unreadableFolders ? m.setup_stat_unreadable_hint() : undefined} />
                  <Stat
                    label={m.status_complete_scope()}
                    value={m.setup_stat_complete_value({ done: formatCount(completeLocations), total: formatCount(locations.length) })}
                    hint={m.setup_stat_complete_hint()}
                  />
                </div>
              </div>
            ) : null}
            <p className="text-sm tabular-nums" aria-live="polite">
              {m.setup_library_so_far({
                sessions: m.about_count_light_sessions({ count: library.sessions, n: formatCount(library.sessions) }),
                frames: m.about_count_frames({ count: library.frames, n: formatCount(library.frames) }),
              })}
              {library.covered.length ? m.setup_library_covers({ names: library.covered.join(", ") }) : ""}{" "}
              {library.provisional || anyRunning ? <StatusBadge kind="scanScope" value="provisional" /> : null}
            </p>
            {latest ? <OperationPanel operationId={latest.id} onRetry={latest.status === "interrupted" ? () => resumeOperation(latest.id) : undefined} /> : null}
          </section>
        ) : null}

        <section aria-labelledby="index-locations" className="space-y-3">
          <h2 id="index-locations" className="text-base font-semibold">
            {first ? m.common_locations() : m.setup_locations_to_index({ count: locations.length, n: formatCount(locations.length) })}
          </h2>
          {first ? null : <p className="text-sm text-muted-foreground">{m.setup_index_all_hint()}</p>}
          <ul className="space-y-2" aria-label={m.setup_registered_locations()}>
            {locations.map((location) => (
              <LocationRow key={location.id} location={location} onChooseAgain={actions.chooseAgain} onRetry={actions.retry} feedback={actions.feedbackFor(location)} />
            ))}
          </ul>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button variant="outline" render={<Link to="/setup/locations" />}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            {m.history_back()}
          </Button>
          {first ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">{footer}</span>
              {unindexed.length > 0 ? (
                <Button variant="outline" onClick={() => rememberRun(startIndexing(unindexed.map((l) => l.id)))}>
                  <Play aria-hidden="true" data-icon="inline-start" />
                  {m.setup_index_new({ count: unindexed.length, n: formatCount(unindexed.length) })}
                </Button>
              ) : null}
              <Button ref={openLibraryButton} onClick={openLibrary}>
                {m.setup_open_library()}
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span id={indexLaterId} className="text-xs text-muted-foreground">
                {m.setup_index_later_hint()}
              </span>
              <Button variant="ghost" aria-describedby={indexLaterId} onClick={openLibrary}>
                {m.setup_index_later()}
              </Button>
              <Button
                disabled={locations.length === 0}
                onClick={() => {
                  rememberRun(startIndexing(locations.map((l) => l.id)))
                  setFocusOpenLibrary(true)
                }}
              >
                <Play aria-hidden="true" data-icon="inline-start" />
                {m.setup_start_indexing()}
              </Button>
            </div>
          )}
        </div>
      </div>
      {actions.dialogs}
    </div>
  )
}
