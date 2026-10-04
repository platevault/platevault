/**
 * Settings › Locations (J19 S2-S3, S5, S7, S12-S13, S15; LIB-FR-01, -06, -07;
 * LIB-AC-04, -05, -11; D11). Registered locations by role with access, online
 * state and scan scope; Index now, Rescan, Choose folder again, Retry,
 * Locate or remap, Edit and Remove. `?locationId=` opens one location,
 * `?add=<role>` starts adding one, `?return=` links back.
 */
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { FolderPlus, MoreHorizontal, Play, RotateCw } from "lucide-react"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { KeyValueList, PathText } from "@/components/app/data"
import { ActionError } from "@/components/app/feedback"
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
import { framesInLocation, removeLocation, ROLE_COPY, ROLE_ORDER, sessionsInLocation, updateLocation, validateLocation } from "../lib/locations"
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
  const [adding, setAdding] = useState<{ role: LocationRole | null } | null>(
    search.add && (ROLE_ORDER as string[]).includes(search.add) ? { role: search.add as LocationRole } : null,
  )
  const [editing, setEditing] = useState<Location | null>(null)
  const [removing, setRemoving] = useState<Location | null>(null)
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

  function rowActions(location: Location) {
    const frames = framesInLocation(catalog, location.id)
    const online = locationAvailability(store.getState().disk, location) === "online"
    const run = latestIndexRun(store.getState().operations, location.id)
    const busy = run !== null && !isSettled(run.op.status) && run.op.status !== "interrupted"
    const never = location.scanScope === "never"
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
            <DropdownMenuItem variant="destructive" disabled={frames > 0} onClick={() => setRemoving(location)}>
              {frames > 0 ? `Remove (holds ${plural(frames, "frame")})` : "Remove"}
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
        actions={
          <Button onClick={() => setAdding({ role: null })}>
            <FolderPlus aria-hidden="true" data-icon="inline-start" />
            Add location
          </Button>
        }
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
                      location={location}
                      current={highlight === location.id || search.locationId === location.id}
                      actions={rowActions(location)}
                      onChooseAgain={actions.chooseAgain}
                      onRetry={actions.retry}
                      onLocate={actions.locate}
                      feedback={actions.feedbackFor(location)}
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
