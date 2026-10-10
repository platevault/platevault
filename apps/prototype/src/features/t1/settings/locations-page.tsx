/**
 * Settings › Locations (J19 S2-S3, S5, S7, S12-S13, S15; J28 S11-S13;
 * LIB-FR-01, -06, -07, -15; LIB-AC-04, -05, -11, -16; D11; P-ARC1).
 * Registered locations by role with access, online state and scan scope;
 * Index now, Rescan, Choose folder again, Retry, Locate or remap, Retire
 * location, Edit and Remove, in each row's More actions menu and on
 * right-click. Several archive locations may be registered; one carries the
 * Default pill (the Archive step's default destination) and the others offer
 * Make default. `?locationId=` opens one location, `?add=<role>` starts
 * adding one, `?return=` links back.
 */
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { MoreHorizontal, Play, Plus, RotateCw } from "lucide-react"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { KeyValueList, PathText } from "@/components/app/data"
import { ActionError, Notice } from "@/components/app/feedback"
import { OperationPanel } from "@/components/app/operation-panel"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { Pill } from "@/components/app/pill"
import { Refusal, type RefusalProps, refusalFrom } from "@/components/app/refusal"
import { ContextMenuArea, type MenuEntry } from "@/components/app/row-menu"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { defaultArchiveLocation } from "@/domain/derive"
import { locationAvailability } from "@/domain/library"
import type { Location, LocationRole } from "@/domain/types"
import { formatCount, formatDateTime } from "@/lib/format"
import { say } from "@/lib/i18n"
import { setDefaultArchiveLocation } from "@/store/actions/settings"
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

/** A count for a variant message: `count` selects the plural form, `n` is the formatted number. */
function count(message: (inputs: { count: number; n: string }) => string, value: number): string {
  return message({ count: value, n: formatCount(value) })
}

function EditLocationDialog({ location, onClose }: { location: Location | null; onClose: () => void }) {
  const m = useMessages()
  const [name, setName] = useState("")
  const [role, setRole] = useState<LocationRole>("captures")
  const [error, setError] = useState<string | undefined>()
  const [writeError, setWriteError] = useState<string | null>(null)
  const form = useRef<HTMLFormElement>(null)
  const ids = { name: useId(), role: useId() }

  useEffect(() => {
    if (!location) return
    setName(location.displayName)
    setRole(location.role)
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
    const result = updateLocation(location.id, { displayName: name, role }, HREF)
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
            <DialogTitle>{m.settings_edit_title({ name: location?.displayName ?? "" })}</DialogTitle>
          </DialogHeader>
          {location ? <PathText path={location.path} className="text-muted-foreground" /> : null}
          <TextField id={ids.name} label={m.location_display_name()} value={name} onChange={setName} error={error} autoFocus />
          <Field className="gap-1.5">
            <FieldLabel id={ids.role}>{m.location_role()}</FieldLabel>
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
          </Field>
          {writeError ? <ActionError message={writeError} onRetry={submit} /> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>{m.verb_cancel()}</DialogClose>
            <Button type="submit">{m.settings_save()}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LocationDetail({ location, onClose, actions }: { location: Location | null; onClose: () => void; actions: ReactNode }) {
  const m = useMessages()
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
                {ROLE_COPY[location.role].title} · {formatDateTime(location.registeredAt)}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 overflow-y-auto px-4 pb-4">
              <KeyValueList
                items={[
                  { label: m.location_path(), value: location.path, mono: true },
                  { label: m.location_volume(), value: volume ? m.location_volume_identity({ name: volume.name, uuid: volume.volumeUuid }) : m.location_volume_unknown() },
                  { label: m.location_availability(), value: <StatusBadge kind="availability" value={locationAvailability(disk, location)} /> },
                  { label: m.location_access(), value: <StatusBadge kind="access" value={location.access} /> },
                  { label: m.location_scan_scope(), value: <StatusBadge kind="scanScope" value={location.scanScope} /> },
                  { label: m.location_last_indexed(), value: location.lastIndexedAt ? formatDateTime(location.lastIndexedAt) : m.location_not_indexed_yet() },
                  { label: m.location_indexed_frames(), value: count(m.location_frames, framesInLocation(catalog, location.id)) },
                  { label: m.nav_sessions(), value: count(m.location_sessions_count, sessionsInLocation(catalog, location.id)) },
                  { label: m.session_os_trash(), value: volume ? <StatusBadge kind="trash" value={volume.trash} /> : m.status_unknown() },
                  {
                    label: m.location_links(),
                    value: volume
                      ? [volume.links.symlink && m.location_link_symlinks(), volume.links.hardlink && m.location_link_hardlinks(), volume.links.clone && m.location_link_clones()]
                          .filter(Boolean)
                          .join(", ") || m.location_links_none()
                      : m.status_unknown(),
                  },
                ]}
              />
              {location.unreadablePaths.length > 0 ? (
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">{m.location_unreadable_folders()}</h3>
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
  const m = useMessages()
  const headingId = useId()
  const refusalId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  const none = (list: string[]) => (list.length ? list.join(", ") : m.settings_none())
  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-lg border border-destructive/40 bg-background p-3">
      <h5 id={headingId} ref={heading} tabIndex={-1} className="text-sm font-semibold outline-none">
        {m.location_retire_review_title({ name: review.displayName })}
      </h5>
      <KeyValueList
        items={[
          { label: m.location_label(), value: review.displayName },
          { label: m.location_root(), value: review.path, mono: true },
          { label: m.location_availability_at_review(), value: <StatusBadge kind="availability" value={review.availability} /> },
          { label: m.location_copies(), value: count(m.location_copies_count, review.frames) },
          { label: m.nav_sessions(), value: review.sessions.length ? m.location_sessions_list({ count: review.sessions.length, list: review.sessions.join(", ") }) : m.settings_none() },
          { label: m.common_runs(), value: none(review.runs) },
          { label: m.nav_projects(), value: none(review.projects) },
          { label: m.status_role_results(), value: none(review.results) },
        ]}
      />
      <ul aria-label={m.location_changes()} className="flex flex-wrap gap-1">
        <li>
          <Pill tone="warning">{count(m.location_copies_read_retired, review.frames)}</Pill>
        </li>
        <li>
          <Pill tone="muted">{m.location_leaves_totals()}</Pill>
        </li>
        <li>
          <Pill tone="muted">{m.location_no_file_changes()}</Pill>
        </li>
      </ul>
      {refusal ? (
        <div id={refusalId}>
          <Notice tone="refusal" title={m.location_availability_changed()}>
            {refusal}
          </Notice>
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          {refusal ? m.location_close_review() : m.verb_cancel()}
        </Button>
        {/* Stays focusable once refused, so keyboard focus is not dropped to the page and the refusal is its description. */}
        <Button
          variant="destructive"
          size="sm"
          disabled={refusal !== null}
          focusableWhenDisabled
          aria-describedby={refusal ? refusalId : undefined}
          onClick={onConfirm}
        >
          {m.location_retire()}
        </Button>
      </div>
    </section>
  )
}

export function LocationsPage() {
  const m = useMessages()
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
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-location-id="${CSS.escape(id)}"] button[data-more-actions]`)?.focus())
  }

  const settings = useStore((s) => s.settings)
  const defaultArchiveId = defaultArchiveLocation({ catalog, settings })?.id ?? null
  const [defaultRefusal, setDefaultRefusal] = useState<RefusalProps | null>(null)

  function makeDefault(location: Location) {
    const result = setDefaultArchiveLocation(location.id)
    setDefaultRefusal(result.ok ? null : (refusalFrom(result, m.location_make_default_blocked()) ?? { action: m.location_make_default_not_saved(), reason: result.message, blockers: [] }))
  }

  /** Every action a location offers, for its More actions menu and its right-click menu. */
  function locationEntries(location: Location): MenuEntry[] {
    const frames = framesInLocation(catalog, location.id)
    const availability = locationAvailability(store.getState().disk, location)
    const run = latestIndexRun(store.getState().operations, location.id)
    const busy = run !== null && !isSettled(run.op.status) && run.op.status !== "interrupted"
    const details: MenuEntry = { label: m.settings_details(), onSelect: () => setDetail(location.id) }
    // A retired location is never reselected, rescanned or remapped (LIB-FR-15).
    if (availability === "retired") return [details]
    return [
      { label: location.scanScope === "never" ? m.location_index_now() : m.location_rescan(), disabled: busy || availability !== "online", onSelect: () => actions.retry(location) },
      ...(location.role === "archive" && defaultArchiveId !== location.id ? [{ label: m.settings_make_default(), onSelect: () => makeDefault(location) }] : []),
      details,
      { label: m.settings_edit(), onSelect: () => setEditing(location) },
      { label: m.location_locate_or_remap(), disabled: frames === 0, onSelect: () => actions.locate(location) },
      { label: m.location_choose_folder_again(), onSelect: () => actions.chooseAgain(location) },
      { separator: true },
      { label: m.location_retire(), disabled: frames === 0, onSelect: () => openRetire(location) },
      { label: frames > 0 ? count(m.location_remove_with_frames, frames) : m.settings_remove(), destructive: true, disabled: frames > 0, onSelect: () => setRemoving(location) },
    ]
  }

  function rowActions(location: Location) {
    const availability = locationAvailability(store.getState().disk, location)
    const run = latestIndexRun(store.getState().operations, location.id)
    const busy = run !== null && !isSettled(run.op.status) && run.op.status !== "interrupted"
    const never = location.scanScope === "never"
    const more = (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" data-more-actions aria-label={m.location_more_actions({ name: location.displayName })} />}>
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {locationEntries(location).map((entry, index) =>
            "separator" in entry ? (
              <DropdownMenuSeparator key={`sep-${index}`} />
            ) : "heading" in entry ? null : (
              <DropdownMenuItem key={entry.label} variant={entry.destructive ? "destructive" : "default"} disabled={entry.disabled} onClick={entry.onSelect}>
                {entry.label}
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
    if (availability === "retired") return more
    return (
      <>
        {location.role === "archive" && defaultArchiveId !== location.id ? (
          <Button size="sm" variant="ghost" onClick={() => makeDefault(location)} data-make-default={location.id}>
            {m.settings_make_default()}
            <span className="sr-only"> {location.displayName}</span>
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={busy || availability !== "online"}
          title={busy ? m.location_indexing() : availability !== "online" ? m.status_offline() : undefined}
          onClick={() => actions.retry(location)}
        >
          {never ? <Play aria-hidden="true" data-icon="inline-start" /> : <RotateCw aria-hidden="true" data-icon="inline-start" />}
          {never ? m.location_index_now() : m.location_rescan()}
        </Button>
        {more}
      </>
    )
  }

  const busyIndex = latestIndex && !isSettled(latestIndex.status)
  const detailActions = detail ? rowActions(detail) : null
  const menu = (id: string) => {
    const location = catalog.locations[id]
    return location ? locationEntries(location) : []
  }

  return (
    <div>
      <PageHeader level={2} title={m.common_locations()} />
      <PageBody>
        <ReturnNotice />
        {latestIndex ? (
          busyIndex ? (
            <OperationPanel operationId={latestIndex.id} />
          ) : (
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground tabular-nums">
              <span>{m.location_last_indexing()}</span>
              <StatusBadge kind="operation" value={latestIndex.status} />
              {/* One unit, so a wrap never leaves a separator at a line end. */}
              <span className="whitespace-nowrap">{[latestIndex.settledAt ? formatDateTime(latestIndex.settledAt) : "", latestIndex.summary ? say(m, latestIndex.summary) : ""].filter(Boolean).join(" · ")}</span>
              <Link to="/activity" className="ml-auto text-link underline-offset-4 hover:underline">
                {m.nav_activity()}
              </Link>
            </p>
          )
        ) : null}
        {defaultRefusal ? <Refusal {...defaultRefusal} /> : null}

        {ROLE_ORDER.map((role) => {
          const rows = locations.filter((l) => l.role === role)
          const copy = ROLE_COPY[role]
          return (
            <Section
              key={role}
              id={`locations-${role}`}
              level={3}
              title={copy.title}
              actions={
                <Button size="sm" variant="outline" aria-label={copy.add} onClick={() => setAdding({ role })}>
                  <Plus aria-hidden="true" data-icon="inline-start" />
                  {m.verb_add()}
                </Button>
              }
            >
              {rows.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">{m.settings_none()}</p>
              ) : (
                <ContextMenuArea menu={menu}>
                  <ul className="space-y-2" aria-label={copy.list}>
                    {rows.map((location) => (
                      <LocationRow
                        key={location.id}
                        headingLevel={4}
                        location={location}
                        current={highlight === location.id || search.locationId === location.id}
                        badges={role === "archive" && defaultArchiveId === location.id ? <Pill tone="info">{m.settings_default()}</Pill> : null}
                        actions={rowActions(location)}
                        // rowActions offers Rescan on every row that can still be indexed.
                        actionsIncludeRescan
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
                </ContextMenuArea>
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
        title={m.settings_remove_title({ name: removing?.displayName ?? "" })}
        description={null}
        changes={[m.location_remove_change({ path: removing?.path ?? "" })]}
        confirmLabel={m.location_remove_confirm()}
        tone="destructive"
        onConfirm={() => (removing ? removeLocation(removing.id, HREF) : undefined)}
      />
      {actions.dialogs}
    </div>
  )
}
