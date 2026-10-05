/**
 * Settings › Locations (J19 S2-S3, S5, S7, S12-S13, S15; J28 S11-S13;
 * LIB-FR-01, -06, -07, -15; LIB-AC-04, -05, -11, -16; D11). Registered
 * locations by role with access, online state and scan scope; Index now,
 * Rescan, Choose folder again, Retry, Locate or remap, Retire location, Edit
 * and Remove. `?locationId=` opens one location, `?add=<role>` starts adding
 * one, `?return=` links back.
 */
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { MoreHorizontal, Play, RotateCw } from "lucide-react"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { KeyValueList, PathText } from "@/components/app/data"
import { ActionError, Notice } from "@/components/app/feedback"
import { OperationPanel } from "@/components/app/operation-panel"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { locationAvailability } from "@/domain/derive"
import type { Location, LocationRole } from "@/domain/types"
import { formatDateTime, plural } from "@/lib/format"
import { store, useStore } from "@/store/core"
import { isSettled } from "@/store/operations"
import { AddLocationFlow } from "../components/add-location-flow"
import { focusFirstInvalid, TextField } from "../components/form-field"
import { useLocationActions } from "../components/location-actions"
import { latestIndexRun, LocationRow } from "../components/location-row"
import {
  framesInLocation,
  type RetireReview,
  removeLocation,
  retireLocation,
  reviewRetire,
  ROLE_COPY,
  ROLE_ORDER,
  sessionsInLocation,
  updateLocation,
  validateLocation,
} from "../lib/locations"
import { ReturnNotice } from "./settings-layout"

const HREF = "/settings/locations"

function EditLocationDialog({ location, onClose }: { location: Location | null; onClose: () => void }) {
  const [name, setName] = useState("")
  const [role, setRole] = useState<LocationRole>("captures")
  const [managed, setManaged] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [writeError, setWriteError] = useState<string | null>(null)
  const form = useRef<HTMLFormElement>(null)
  const ids = { name: useId(), role: useId(), managed: useId() }

  useEffect(() => {
    if (!location) return
    setName(location.displayName)
    setRole(location.role)
    setManaged(location.managed)
    setError(undefined)
    setWriteError(null)
  }, [location])

  function submit() {
    if (!location) return
    const errors = validateLocation(store.getState().catalog, { path: location.path, displayName: name, role }, location.id)
    setError(errors.displayName)
    if (errors.displayName) {
      focusFirstInvalid(form.current)
      return
    }
    const result = updateLocation(location.id, { displayName: name, role, managed }, HREF)
    if (!result.ok) {
      setWriteError(result.message)
      return
    }
    onClose()
  }

  return (
    <Dialog open={location !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          ref={form}
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit {location?.displayName}</DialogTitle>
            <DialogDescription>Changes the catalog record only. The folder and its files stay as they are.</DialogDescription>
          </DialogHeader>
          {location ? <PathText path={location.path} className="text-muted-foreground" /> : null}
          <TextField id={ids.name} label="Display name" value={name} onChange={setName} error={error} autoFocus />
          <Field className="gap-1.5">
            <FieldLabel id={ids.role}>Role</FieldLabel>
            <Select items={ROLE_ORDER.map((r) => ({ value: r, label: ROLE_COPY[r].title }))} value={role} onValueChange={(value) => setRole(value as LocationRole)}>
              <SelectTrigger aria-labelledby={ids.role} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_ORDER.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_COPY[r].title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{ROLE_COPY[role].description}</p>
          </Field>
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <label htmlFor={ids.managed} className="text-sm font-medium">
                Accepts reviewed filing
              </label>
              <p id={`${ids.managed}-hint`} className="text-xs text-muted-foreground">
                File into library may copy reviewed sessions here. Nothing is filed without your review.
              </p>
            </div>
            <Switch id={ids.managed} aria-describedby={`${ids.managed}-hint`} checked={managed} onCheckedChange={(checked) => setManaged(checked)} />
          </div>
          {writeError ? <ActionError message={writeError} onRetry={submit} /> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit">Save changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LocationDetail({ location, onClose, actions }: { location: Location | null; onClose: () => void; actions: ReactNode }) {
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const volume = location ? disk.volumes[location.volumeId] : undefined
  return (
    <Sheet open={location !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[30rem] sm:max-w-[30rem]">
        {location ? (
          <>
            <SheetHeader>
              <SheetTitle>{location.displayName}</SheetTitle>
              <SheetDescription>
                {ROLE_COPY[location.role].title} location, registered {formatDateTime(location.registeredAt)}.
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 overflow-y-auto px-4 pb-4">
              <KeyValueList
                items={[
                  { label: "Path", value: location.path, mono: true },
                  { label: "Volume", value: volume ? `${volume.name} · identity ${volume.volumeUuid}` : "Unknown volume" },
                  { label: "Availability", value: <StatusBadge kind="availability" value={locationAvailability(disk, location)} /> },
                  { label: "Access", value: <StatusBadge kind="access" value={location.access} /> },
                  { label: "Scan scope", value: <StatusBadge kind="scanScope" value={location.scanScope} /> },
                  { label: "Last indexed", value: location.lastIndexedAt ? formatDateTime(location.lastIndexedAt) : "Not indexed yet" },
                  { label: "Indexed frames", value: plural(framesInLocation(catalog, location.id), "frame") },
                  { label: "Sessions", value: plural(sessionsInLocation(catalog, location.id), "session") },
                  { label: "Reviewed filing", value: location.managed ? "Accepts reviewed filing" : "Not a filing destination" },
                  { label: "OS Trash", value: volume ? <StatusBadge kind="trash" value={volume.trash} /> : "Unknown" },
                  {
                    label: "Links",
                    value: volume
                      ? [volume.links.symlink && "Symlinks", volume.links.hardlink && "Hardlinks", volume.links.clone && "Clones"].filter(Boolean).join(", ") || "Not supported"
                      : "Unknown",
                  },
                ]}
              />
              {location.unreadablePaths.length > 0 ? (
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">Unreadable folders at the last scan</h3>
                  <ul className="space-y-0.5">
                    {location.unreadablePaths.map((path) => (
                      <li key={path}>
                        <PathText path={path} className="text-muted-foreground" />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">{actions}</div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

/**
 * Inline review for Retire location (LIB-FR-15). Inline rather than modal, so
 * the volume can be reconnected while it is open and confirming refuses the
 * stale review (J28 S11a).
 */
function RetireReviewPanel({
  review,
  refusal,
  onConfirm,
  onClose,
}: {
  review: RetireReview
  refusal: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  const none = (list: string[]) => (list.length ? list.join(", ") : "None")
  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-lg border border-destructive/40 bg-background p-3">
      <h5 id={headingId} ref={heading} tabIndex={-1} className="text-sm font-semibold outline-none">
        Review: retire {review.displayName}
      </h5>
      <KeyValueList
        items={[
          { label: "Location", value: review.displayName },
          { label: "Root", value: review.path, mono: true },
          { label: "Availability at review", value: <StatusBadge kind="availability" value={review.availability} /> },
          { label: "Copies", value: plural(review.frames, "copy", "copies") },
          { label: "Sessions", value: review.sessions.length ? `${review.sessions.length}: ${review.sessions.join(", ")}` : "None" },
          { label: "Views", value: none(review.views) },
          { label: "Projects", value: none(review.projects) },
          { label: "Results", value: none(review.results) },
        ]}
      />
      <p className="text-sm text-pretty">
        Retiring deletes, moves or modifies no file. These copies will read Retired, leave integration totals and stay named unresolved in fixed Views. A retired
        location is never reselected, rescanned or remapped.
      </p>
      {refusal ? (
        <Notice tone="refusal" title="Availability changed since this review">
          {refusal}
        </Notice>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          {refusal ? "Close review" : "Cancel"}
        </Button>
        <Button variant="destructive" size="sm" disabled={refusal !== null} onClick={onConfirm}>
          Retire location
        </Button>
      </div>
    </section>
  )
}

export function LocationsPage() {
  const search = useSearch({ strict: false }) as Record<string, string | undefined>
  const navigate = useNavigate()
  const locations = useStore((s) => Object.values(s.catalog.locations).sort((a, b) => a.displayName.localeCompare(b.displayName)))
  const catalog = useStore((s) => s.catalog)
  const latestIndex = useStore((s) =>
    Object.values(s.operations)
      .filter((op) => op.kind === "index")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],
  )
  const [adding, setAdding] = useState<{ role: LocationRole | null } | null>(null)
  // The palette command and the checklist link set ?add= while this page may already be open; the route stays mounted, so follow the search.
  useEffect(() => {
    if (search.add && (ROLE_ORDER as string[]).includes(search.add)) setAdding({ role: search.add as LocationRole })
  }, [search.add])
  const [editing, setEditing] = useState<Location | null>(null)
  const [removing, setRemoving] = useState<Location | null>(null)
  const [retiring, setRetiring] = useState<{ review: RetireReview; refusal: string | null } | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const actions = useLocationActions({ href: HREF })
  const detail = search.locationId ? (catalog.locations[search.locationId] ?? null) : null

  function setDetail(id: string | null) {
    void navigate({ to: "/settings/locations", search: (prev: Record<string, string | undefined>) => ({ ...prev, locationId: id ?? undefined }), replace: true })
  }

  // Bring a location opened by link into view.
  useEffect(() => {
    if (!search.locationId) return
    document.querySelector(`[data-location-id="${CSS.escape(search.locationId)}"]`)?.scrollIntoView({ block: "nearest" })
  }, [search.locationId])

  function openRetire(location: Location) {
    const review = reviewRetire(store.getState(), location.id)
    if (review) setRetiring({ review, refusal: null })
  }

  function confirmRetire() {
    if (!retiring) return
    const result = retireLocation(retiring.review, HREF)
    if (!result.ok) {
      setRetiring({ ...retiring, refusal: result.message })
      return
    }
    const id = retiring.review.locationId
    setRetiring(null)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-location-id="${CSS.escape(id)}"] button[aria-label^="More actions"]`)?.focus())
  }

  function rowActions(location: Location) {
    const frames = framesInLocation(catalog, location.id)
    const availability = locationAvailability(store.getState().disk, location)
    const online = availability === "online"
    const run = latestIndexRun(store.getState().operations, location.id)
    const busy = run !== null && !isSettled(run.op.status) && run.op.status !== "interrupted"
    const never = location.scanScope === "never"
    // A retired location is never reselected, rescanned or remapped (LIB-FR-15).
    if (availability === "retired") {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`More actions for ${location.displayName}`} />}>
            <MoreHorizontal aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onClick={() => setDetail(location.id)}>Details</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
    return (
      <>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !online}
          title={busy ? "Indexing is in progress" : !online ? "Offline: reconnect the volume to index it" : undefined}
          onClick={() => actions.retry(location)}
        >
          {never ? <Play aria-hidden="true" data-icon="inline-start" /> : <RotateCw aria-hidden="true" data-icon="inline-start" />}
          {never ? "Index now" : "Rescan"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`More actions for ${location.displayName}`} />}>
            <MoreHorizontal aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onClick={() => setDetail(location.id)}>Details</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setEditing(location)}>Edit</DropdownMenuItem>
            <DropdownMenuItem disabled={frames === 0} onClick={() => actions.locate(location)}>
              {frames === 0 ? "Locate or remap (nothing indexed yet)" : "Locate or remap"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.chooseAgain(location)}>Choose folder again</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={frames === 0} onClick={() => openRetire(location)}>
              {frames === 0 ? "Retire location (nothing indexed; use Remove)" : "Retire location"}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" disabled={frames > 0} onClick={() => setRemoving(location)} className={frames > 0 ? "flex-col items-start gap-0.5" : undefined}>
              Remove
              {frames > 0 ? <span className="text-xs text-muted-foreground">Holds {plural(frames, "indexed frame")}. Use Locate or remap, or Retire location.</span> : null}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    )
  }

  const busyIndex = latestIndex && !isSettled(latestIndex.status)
  const detailActions = detail ? rowActions(detail) : null

  return (
    <div>
      <PageHeader
        level={2}
        title="Locations"
        description="Folders PlateVault indexes in place, by role. Registering or indexing a location never changes its files."
      />
      <PageBody>
        <ReturnNotice task="Locations" />
        {latestIndex ? (
          busyIndex ? (
            <OperationPanel operationId={latestIndex.id} />
          ) : (
            <p className="text-sm text-muted-foreground tabular-nums">
              Last indexing: <StatusBadge kind="operation" value={latestIndex.status} /> {latestIndex.settledAt ? formatDateTime(latestIndex.settledAt) : ""}
              {latestIndex.summary ? ` · ${latestIndex.summary}` : ""} ·{" "}
              <Link to="/activity" className="text-primary underline-offset-4 hover:underline">
                Activity
              </Link>
            </p>
          )
        ) : null}

        {ROLE_ORDER.map((role) => {
          const rows = locations.filter((l) => l.role === role)
          const copy = ROLE_COPY[role]
          return (
            <Section
              key={role}
              id={`locations-${role}`}
              level={3}
              title={copy.title}
              description={copy.description}
              actions={
                <Button size="sm" variant="outline" onClick={() => setAdding({ role })}>
                  {rows.length === 0 ? copy.add : "Add another location"}
                </Button>
              }
            >
              {rows.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  <StatusBadge kind="role" value="unset" /> No {copy.noun} location yet.
                </div>
              ) : (
                <ul className="space-y-2" aria-label={`${copy.title} locations`}>
                  {rows.map((location) => (
                    <LocationRow
                      key={location.id}
                      headingLevel={4}
                      location={location}
                      current={highlight === location.id || search.locationId === location.id}
                      actions={rowActions(location)}
                      onChooseAgain={actions.chooseAgain}
                      onRetry={actions.retry}
                      onLocate={actions.locate}
                      // While its review is open, the review's own button is the only "Retire location" on the row.
                      onRetire={retiring?.review.locationId === location.id ? undefined : openRetire}
                      feedback={
                        retiring?.review.locationId === location.id ? (
                          <RetireReviewPanel review={retiring.review} refusal={retiring.refusal} onConfirm={confirmRetire} onClose={() => setRetiring(null)} />
                        ) : (
                          actions.feedbackFor(location)
                        )
                      }
                    />
                  ))}
                </ul>
              )}
            </Section>
          )
        })}
      </PageBody>

      <AddLocationFlow
        role={adding?.role ?? null}
        open={adding !== null}
        onClose={() => {
          setAdding(null)
          if (search.add) void navigate({ to: "/settings/locations", search: (prev: Record<string, string | undefined>) => ({ ...prev, add: undefined }), replace: true })
        }}
        onAdded={(id) => setHighlight(id)}
        href={HREF}
      />
      <EditLocationDialog location={editing} onClose={() => setEditing(null)} />
      <LocationDetail location={detail} onClose={() => setDetail(null)} actions={detailActions} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.displayName ?? "location"}?`}
        description="PlateVault stops indexing this folder. Nothing was indexed from it, so no frame loses a copy."
        changes={[`Remove the registration for ${removing?.path ?? ""}`]}
        unchanged={["The folder and every file in it", "Other locations, sessions and decisions"]}
        confirmLabel="Remove location"
        tone="destructive"
        onConfirm={() => (removing ? removeLocation(removing.id, HREF) : undefined)}
      />
      {actions.dialogs}
    </div>
  )
}
