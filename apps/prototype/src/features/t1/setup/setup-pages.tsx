/**
 * First-run setup screens (SetupShell): Welcome, Choose locations, Index your
 * captures. One task per screen, Back is never destructive, and progress lives
 * in the catalog so a reload resumes where the user was (HLD §6).
 */
import { Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, ArrowRight, Check, FlaskConical, FolderPlus, Play, X } from "lucide-react"
import { type ReactNode, useId, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Stat } from "@/components/app/data"
import { Notice } from "@/components/app/feedback"
import { OperationPanel } from "@/components/app/operation-panel"
import { PageHeader, StepIndicator } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { isLibraryEmpty } from "@/domain/derive"
import type { Location, LocationRole, OperationId } from "@/domain/types"
import { formatCount, plural } from "@/lib/format"
import { resetPrototype } from "@/store"
import { updateSlice, useStore } from "@/store/core"
import { isSettled, resumeOperation, startIndexing } from "@/store/operations"
import { AddLocationFlow } from "../components/add-location-flow"
import { useLocationActions } from "../components/location-actions"
import { LocationRow } from "../components/location-row"
import { framesInLocation, removeLocation, ROLE_COPY } from "../lib/locations"
import { completeOnboarding, setRoleDeferred } from "../lib/writes"

const STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "locations", label: "Locations" },
  { id: "indexing", label: "Index" },
]

function SetupHeader({ step, title, description }: { step: "welcome" | "locations" | "indexing"; title: string; description: ReactNode }) {
  const done = STEPS.slice(0, STEPS.findIndex((s) => s.id === step)).map((s) => s.id)
  return (
    <div className="space-y-4 px-6 pt-6">
      <StepIndicator steps={STEPS} current={step} completed={done} label="Setup progress" />
      <PageHeader title={title} description={description} className="border-b-0 px-0 py-0" />
    </div>
  )
}

function rememberRun(id: OperationId) {
  updateSlice("t1", (slice) => ({ ...slice, setupOperationIds: [...slice.setupOperationIds, id] }))
}

// ---------------------------------------------------------------------------
// /welcome
// ---------------------------------------------------------------------------

export function WelcomePage() {
  const navigate = useNavigate()
  const empty = useStore((s) => isLibraryEmpty(s.catalog))
  const [confirmDemo, setConfirmDemo] = useState(false)
  const laterId = useId()

  return (
    <div className="pb-10">
      <SetupHeader
        step="welcome"
        title="Welcome to PlateVault"
        description="PlateVault catalogs your astrophotography captures where they already are, groups them into sessions and prepares exact inputs for PixInsight, Siril and other processing apps."
      />
      <div className="space-y-6 px-6 pt-6">
        <div className="grid grid-cols-2 gap-4">
          <section aria-labelledby="welcome-does" className="space-y-2 rounded-lg border bg-card p-4">
            <h2 id="welcome-does" className="text-sm font-semibold">
              What PlateVault does
            </h2>
            <ul className="space-y-1.5 text-sm">
              {["Indexes FITS and XISF folders in place", "Groups frames into sessions, one per filter, exposure and camera", "Shows Target coverage and optional Project goals", "Prepares reviewed Views for your processing app"].map((item) => (
                <li key={item} className="flex gap-2">
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                  {item}
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="welcome-never" className="space-y-2 rounded-lg border bg-card p-4">
            <h2 id="welcome-never" className="text-sm font-semibold">
              What it never does
            </h2>
            <ul className="space-y-1.5 text-sm">
              {["Moves, renames or deletes files without a reviewed operation", "Changes the headers of your source files", "Calibrates, stacks or stretches images", "Needs an account or a network connection"].map((item) => (
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
            {empty ? "Next, choose the folders that hold your captures. Only a Captures location is required." : "Your locations are registered. Continue to review them and start indexing."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button render={<Link to="/setup/locations" />}>
              {empty ? "Set up locations" : "Continue setup"}
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
              Set up later
            </Button>
            <span id={laterId} className="text-xs text-muted-foreground">
              Opens the library now. Add locations any time in Settings › Locations.
            </span>
          </div>
        </div>

        <Notice
          tone="info"
          title="Prototype: demo library"
          actions={
            <Button size="sm" variant="outline" onClick={() => setConfirmDemo(true)}>
              <FlaskConical aria-hidden="true" data-icon="inline-start" />
              Load demo library
            </Button>
          }
        >
          Skips setup and loads a realistic indexed library: M 31, NGC 7000, a mosaic Project and an offline drive. It replaces the prototype data in this browser.
        </Notice>
      </div>

      <ConfirmDialog
        open={confirmDemo}
        onOpenChange={setConfirmDemo}
        title="Load the demo library?"
        description="Prototype only. The demo replaces everything in this browser's prototype data."
        changes={["Replace locations, sessions, Projects and Views with the demo library", "Skip setup and open Targets"]}
        unchanged={["Theme and density", "No real files exist; nothing on your computer is touched"]}
        confirmLabel="Load demo library"
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
  const navigate = useNavigate()
  const locations = useStore((s) => Object.values(s.catalog.locations).sort((a, b) => a.registeredAt.localeCompare(b.registeredAt)))
  const deferred = useStore((s) => s.settings.onboarding.deferredRoles)
  const catalog = useStore((s) => s.catalog)
  const [adding, setAdding] = useState<LocationRole | null>(null)
  const [removing, setRemoving] = useState<Location | null>(null)
  const actions = useLocationActions({ href: "/setup/locations", onIndexStarted: rememberRun })
  const reasonId = useId()
  const hasCaptures = locations.some((l) => l.role === "captures")

  return (
    <div className="pb-10">
      <SetupHeader
        step="locations"
        title="Choose locations"
        description="Register the folders that already hold your files. Registering only records access and indexing intent; nothing is copied, renamed, moved or deleted."
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
                    <span className="rounded-md border px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{required ? "Required" : "Optional"}</span>
                  </h2>
                  <p className="text-sm text-muted-foreground">{copy.description}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!required && rows.length === 0 && !isDeferred ? (
                    <Button variant="ghost" onClick={() => setRoleDeferred(role, true)}>
                      Set up later
                    </Button>
                  ) : null}
                  <Button variant={required && rows.length === 0 ? "default" : "outline"} onClick={() => setAdding(role)}>
                    <FolderPlus aria-hidden="true" data-icon="inline-start" />
                    {rows.length === 0 ? copy.add : "Add another location"}
                  </Button>
                </div>
              </div>
              {rows.length === 0 ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  <StatusBadge kind="role" value="unset" />
                  {required
                    ? "Add at least one folder with light frames to continue."
                    : isDeferred
                      ? "You chose to set this up later. Add it any time in Settings › Locations."
                      : "Leave it unset if you do not keep these files in one place yet."}
                </div>
              ) : (
                <ul className="space-y-2" aria-label={`${copy.title} locations`}>
                  {rows.map((location) => (
                    <LocationRow
                      key={location.id}
                      location={location}
                      onChooseAgain={actions.chooseAgain}
                      onRetry={actions.retry}
                      feedback={actions.feedbackFor(location)}
                      actions={
                        framesInLocation(catalog, location.id) === 0 ? (
                          <Button size="sm" variant="ghost" onClick={() => setRemoving(location)} aria-label={`Remove ${location.displayName}`}>
                            Remove
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

        <Notice tone="info" title="Nothing else is needed now">
          View folders are chosen when you prepare a View. Setup asks for no workspace folder, processing app, Project or account.
        </Notice>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button variant="outline" render={<Link to="/welcome" />}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            Back
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            {hasCaptures ? null : (
              <span id={reasonId} className="text-sm text-muted-foreground">
                Add a capture location to continue. Captures is the only required role.
              </span>
            )}
            <Button disabled={!hasCaptures} aria-describedby={hasCaptures ? undefined : reasonId} onClick={() => void navigate({ to: "/setup/indexing" })}>
              Continue
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Button>
          </div>
        </div>
      </div>

      <AddLocationFlow role={adding} open={adding !== null} onClose={() => setAdding(null)} href="/setup/locations" roles={SETUP_ROLES} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.displayName ?? "location"}?`}
        description="Removes the registration only. Nothing was indexed from this folder yet."
        changes={[`Stop tracking ${removing?.path ?? ""}`]}
        unchanged={["The folder and every file in it"]}
        confirmLabel="Remove location"
        tone="destructive"
        onConfirm={() => (removing ? removeLocation(removing.id, "/setup/locations") : undefined)}
      />
      {actions.dialogs}
    </div>
  )
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
  const navigate = useNavigate()
  const locations = useStore((s) => Object.values(s.catalog.locations).sort((a, b) => a.registeredAt.localeCompare(b.registeredAt)))
  const runIds = useStore((s) => s.slices.t1.setupOperationIds)
  const operations = useStore((s) => s.operations)
  const library = useStore((s) => {
    const sessions = Object.values(s.catalog.sessions).filter((x) => !x.supersededBy && x.imageType === "light")
    const covered = Object.values(s.catalog.locations).filter((l) => framesInLocation(s.catalog, l.id) > 0).map((l) => l.displayName)
    return { sessions: sessions.length, provisional: sessions.some((x) => x.scope !== "complete"), frames: Object.keys(s.catalog.assets).length, covered }
  })
  const actions = useLocationActions({ href: "/setup/indexing", onIndexStarted: rememberRun })
  const indexLaterId = useId()

  const runs = runIds.map((id) => operations[id]).filter((op) => op !== undefined)
  const first = runs[0]
  const latest = runs.at(-1)
  const anyRunning = runs.some((op) => !isSettled(op.status))
  // The first run is the full setup scan; later runs retry single locations.
  const counts = first ? indexCounts(first.payload) : null
  const settledLocations = first ? first.items.filter((i) => i.status === "done" || i.status === "blocked" || i.status === "uncertain").length : 0

  function openLibrary() {
    completeOnboarding()
    void navigate({ to: "/targets" })
  }

  return (
    <div className="pb-10">
      <SetupHeader
        step="indexing"
        title="Index your captures"
        description="PlateVault reads metadata from each location. Files stay where they are and are never changed."
      />
      <div className="space-y-6 px-6 pt-6">
        {first ? (
          <section aria-labelledby="index-progress" className="space-y-4">
            <h2 id="index-progress" className="sr-only">
              Indexing progress
            </h2>
            {counts ? (
              <dl className="grid grid-cols-5 gap-4 rounded-lg border bg-card p-4">
                {[
                  { label: "Files discovered", value: formatCount(counts.discovered) },
                  { label: "Metadata read", value: formatCount(counts.read) },
                  { label: "Unsupported", value: formatCount(counts.unsupported), hint: counts.unsupported ? "Skipped, left as they are" : undefined },
                  { label: "Unreadable folders", value: formatCount(counts.unreadableFolders), hint: counts.unreadableFolders ? "Read Unknown, never missing" : undefined },
                  { label: "Completed scope", value: `${settledLocations} of ${first.items.length}`, hint: "locations" },
                ].map((stat) => (
                  <div key={stat.label}>
                    <dt className="sr-only">{stat.label}</dt>
                    <dd>
                      <Stat label={stat.label} value={stat.value} hint={stat.hint} />
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <p className="text-sm tabular-nums" aria-live="polite">
              Library so far: {plural(library.sessions, "light session")} · {plural(library.frames, "frame")}
              {library.covered.length ? ` · covers ${library.covered.join(", ")}` : ""}{" "}
              {library.provisional || anyRunning ? <StatusBadge kind="scanScope" value="provisional" /> : null}
            </p>
            {latest ? <OperationPanel operationId={latest.id} onRetry={latest.status === "interrupted" ? () => resumeOperation(latest.id) : undefined} /> : null}
          </section>
        ) : null}

        <section aria-labelledby="index-locations" className="space-y-3">
          <h2 id="index-locations" className="text-base font-semibold">
            {first ? "Locations" : `${plural(locations.length, "location")} to index`}
          </h2>
          {first ? null : <p className="text-sm text-muted-foreground">Every registered location is read. Calibration frames are indexed too; they never appear as light sessions.</p>}
          <ul className="space-y-2" aria-label="Registered locations">
            {locations.map((location) => (
              <LocationRow key={location.id} location={location} onChooseAgain={actions.chooseAgain} onRetry={actions.retry} feedback={actions.feedbackFor(location)} />
            ))}
          </ul>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button variant="outline" render={<Link to="/setup/locations" />}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            Back
          </Button>
          {first ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">{anyRunning ? "You can browse sessions already read while indexing continues." : "Indexing finished. Open the library to review sessions."}</span>
              <Button onClick={openLibrary}>
                Open library
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span id={indexLaterId} className="text-xs text-muted-foreground">
                Index later keeps the locations registered; start indexing from Settings › Locations.
              </span>
              <Button variant="ghost" aria-describedby={indexLaterId} onClick={openLibrary}>
                Index later
              </Button>
              <Button disabled={locations.length === 0} onClick={() => rememberRun(startIndexing(locations.map((l) => l.id)))}>
                <Play aria-hidden="true" data-icon="inline-start" />
                Start indexing
              </Button>
            </div>
          )}
        </div>
      </div>
      {actions.dialogs}
    </div>
  )
}
