/**
 * First-run setup, steps 2-4 (SetupShell): Welcome, Locations and Index. Each
 * is a StepPage on the one setup flow (`setup-flow.ts`), as the Language step
 * is: the strip under the title, one step region, and the footer with Skip and
 * Proceed. Progress lives in the catalog, so a reload resumes where the user
 * was (HLD §6). On Windows, Locations shows the Developer Mode check symlinks
 * need (P-PREP3); it never blocks setup.
 *
 * - Welcome: what PlateVault does and never does, and the demo library.
 *   Continue opens Locations; Set up later ends setup on Home.
 * - Locations: one table per role. Continue needs a capture location; the
 *   optional roles can be set up later.
 * - Index: Start indexing is the step's operation (F2); once it runs, Open
 *   library ends setup on Home, where the orientation walk begins (Round 6).
 *   Index later ends setup without indexing.
 */
import { useNavigate } from "@tanstack/react-router"
import { FlaskConical, FolderPlus, FolderSearch, Play, RotateCw } from "lucide-react"
import { type ReactNode, useState } from "react"
import { DeveloperModeStatus } from "@/app/developer-mode"
import { useMessages } from "@/app/preferences"
import { ActionBar, ActionButton } from "@/components/app/actions"
import { Box } from "@/components/app/box"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { DataTable, type DataTableExpand } from "@/components/app/data-table"
import { OperationPanel } from "@/components/app/operation-panel"
import { Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { StepPage } from "@/components/templates/step-page"
import { locationAvailability } from "@/domain/library"
import type { Availability, Location, LocationRole, Operation, OperationId } from "@/domain/types"
import { formatCount } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { resetPrototype } from "@/store"
import { updateSlice, useStore } from "@/store/core"
import { isSettled, resumeOperation, startIndexing } from "@/store/operations"
import { AddLocationFlow } from "../components/add-location-flow"
import { useLocationActions } from "../components/location-actions"
import { framesInLocation, removeLocation, ROLE_COPY, ROLE_ORDER } from "../lib/locations"
import { completeOnboarding, setRoleDeferred } from "../lib/writes"
import { setupFlow } from "./setup-flow"

function rememberRun(id: OperationId) {
  updateSlice("e", (slice) => ({ ...slice, setupOperationIds: [...slice.setupOperationIds, id] }))
}

/** "{n} locations registered", or nothing before the first one. */
function registeredSummary(m: Messages, count: number): string | undefined {
  return count > 0 ? m.setup_locations_registered({ count, n: formatCount(count) }) : undefined
}

// ---------------------------------------------------------------------------
// Location rows (the Locations and Index tables)
// ---------------------------------------------------------------------------

interface LocationRow {
  location: Location
  availability: Availability
  frames: number
  /** Waiting in or being read by an unsettled index run: it cannot be removed from under it (J19 S5). */
  indexing: boolean
}

/** The locations of unsettled index runs that are still waiting or being read. */
function indexingIds(operations: Record<string, Operation>): ReadonlySet<string> {
  return new Set(
    Object.values(operations)
      .filter((op) => op.kind === "index" && !isSettled(op.status) && op.status !== "interrupted")
      .flatMap((op) => op.items.filter((item) => item.status === "running" || item.status === "pending").map((item) => item.id)),
  )
}

/** The registered locations, oldest first. */
function useLocationRows(): LocationRow[] {
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const operations = useStore((s) => s.operations)
  const indexing = indexingIds(operations)
  return Object.values(catalog.locations)
    .sort((a, b) => a.registeredAt.localeCompare(b.registeredAt))
    .map((location) => ({ location, availability: locationAvailability(disk, location), frames: framesInLocation(catalog, location.id), indexing: indexing.has(location.id) }))
}

const SCOPE_RANK: Record<Location["scanScope"], number> = { incomplete: 3, never: 4, complete: 5 }

/**
 * The one state that matters most, and its order, as Settings › Locations ranks them: availability, a denied
 * folder, indexing, then the scan scope. Access not checked yet reads as its scope (Not indexed).
 */
function locationState(m: Messages, row: LocationRow): { rank: number; badge: ReactNode } {
  if (row.availability !== "online") return { rank: 0, badge: <StatusBadge kind="availability" value={row.availability} /> }
  if (row.location.access === "denied") return { rank: 1, badge: <StatusBadge kind="access" value="denied" /> }
  if (row.indexing) return { rank: 2, badge: <StatusBadge kind="operation" value="running" label={m.location_indexing()} /> }
  return { rank: SCOPE_RANK[row.location.scanScope], badge: <StatusBadge kind="scanScope" value={row.location.scanScope} /> }
}

/** Name, Path and State; the Index table adds Role and Frames. */
function locationColumns(m: Messages, all: boolean): Column<LocationRow>[] {
  return [
    { id: "name", header: m.location_col_name(), rowHeader: true, truncate: true, sortValue: (r) => r.location.displayName, cell: (r) => r.location.displayName },
    ...(all
      ? [{ id: "role", header: m.location_role(), sortValue: (r: LocationRow) => ROLE_ORDER.indexOf(r.location.role), cell: (r: LocationRow) => <StatusBadge kind="role" value={r.location.role} /> }]
      : []),
    { id: "path", header: m.location_path(), truncate: true, sortValue: (r) => r.location.path, cell: (r) => <code>{r.location.path}</code> },
    { id: "state", header: m.location_col_state(), sortValue: (r) => locationState(m, r).rank, cell: (r) => locationState(m, r).badge },
    ...(all ? [{ id: "frames", header: m.location_col_frames(), align: "right" as const, sortValue: (r: LocationRow) => r.frames, cell: (r: LocationRow) => formatCount(r.frames) }] : []),
  ]
}

/** An incomplete scan lists the folders it could not read under the row. */
function unreadableFolders(m: Messages): DataTableExpand<LocationRow> {
  return {
    isExpandable: (r) => r.location.unreadablePaths.length > 0,
    render: (r) => (
      <KeyValueList
        items={[
          {
            label: m.location_unreadable_folders(),
            value: (
              <ul>
                {r.location.unreadablePaths.map((path) => (
                  <li key={path}>
                    <code>{path}</code>
                  </li>
                ))}
              </ul>
            ),
          },
        ]}
      />
    ),
  }
}

type LocationActions = ReturnType<typeof useLocationActions>

/** Recovery for a row (LIB-FR-07): Choose folder again and Retry for a denied folder, Rescan for an incomplete scan. */
function recoveryItems(m: Messages, row: LocationRow, actions: LocationActions): MenuItem[] {
  const { location } = row
  const denied = location.access === "denied"
  if (!denied && location.scanScope !== "incomplete") return []
  const label = denied ? m.verb_retry() : m.location_rescan()
  const retry: Action = {
    id: "retry",
    label,
    icon: RotateCw,
    unavailable: row.indexing ? { action: label, reason: m.location_indexing(), blockers: [] } : undefined,
    run: () => actions.retry(location),
  }
  return denied ? [{ id: "choose-again", label: m.location_choose_folder_again(), icon: FolderSearch, opensDialog: true, run: () => actions.chooseAgain(location) }, retry] : [retry]
}

/** Remove only unregisters a folder nothing was indexed from yet (J19 S5). */
function removeItem(m: Messages, row: LocationRow, href: string): Action {
  const label = m.settings_remove()
  const reason = row.frames > 0 ? m.location_frames({ count: row.frames, n: formatCount(row.frames) }) : row.indexing ? m.location_indexing() : null
  return {
    id: "remove",
    label,
    kind: "destructive",
    unavailable: reason ? { action: label, reason, blockers: [] } : undefined,
    confirm: {
      title: m.settings_remove_title({ name: row.location.displayName }),
      summary: m.location_remove_change({ path: row.location.path }),
      confirm: { label: m.location_remove_confirm(), kind: "destructive" },
    },
    run: () => removeLocation(row.location.id, href),
  }
}

// ---------------------------------------------------------------------------
// /welcome
// ---------------------------------------------------------------------------

export function WelcomePage() {
  const m = useMessages()
  const navigate = useNavigate()
  const registered = useStore((s) => Object.keys(s.catalog.locations).length)

  // Set up later leaves setup for Home, so each action opens its own route.
  const flow = setupFlow(m, "welcome", {
    proceed: { id: "setup-welcome-continue", label: m.setup_continue_short(), run: () => void navigate({ to: "/setup/locations" }) },
    next: null,
    skip: {
      id: "setup-later",
      label: m.setup_later(),
      run: () => {
        completeOnboarding()
        void navigate({ to: "/" })
      },
    },
    summary: registeredSummary(m, registered),
  })
  const demo: Action = {
    id: "load-demo",
    label: m.setup_demo_load(),
    icon: FlaskConical,
    confirm: { title: m.setup_demo_confirm_title(), summary: m.setup_demo_summary(), confirm: { label: m.setup_demo_load() } },
    run: () => {
      resetPrototype("demo")
      void navigate({ to: "/" })
    },
  }

  return (
    <StepPage
      title={m.setup_welcome_title()}
      flow={flow}
      stepsLabel={m.setup_progress()}
      step={
        <>
          <Box id="welcome-does" level={2} title={m.setup_does_title()}>
            <ul>
              {[m.setup_does_index(), m.setup_does_sessions(), m.setup_does_coverage(), m.setup_does_views()].map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Box>
          <Box id="welcome-never" level={2} title={m.setup_never_title()}>
            <ul>
              {[m.setup_never_move(), m.setup_never_headers(), m.setup_never_process(), m.setup_never_account()].map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Box>
          <Box id="welcome-demo" level={2} title={m.setup_demo_title()} actions={<ActionButton action={demo} />}>
            {m.setup_demo_body()}
          </Box>
        </>
      }
    />
  )
}

// ---------------------------------------------------------------------------
// /setup/locations
// ---------------------------------------------------------------------------

const SETUP_ROLES: LocationRole[] = ["captures", "calibration", "results"]
const LOCATIONS_HREF = "/setup/locations"

export function SetupLocationsPage() {
  const m = useMessages()
  const rows = useLocationRows()
  const deferred = useStore((s) => s.settings.onboarding.deferredRoles)
  const [adding, setAdding] = useState<LocationRole | null>(null)
  const actions = useLocationActions({ href: LOCATIONS_HREF, onIndexStarted: rememberRun, notify: "runner" })
  const hasCaptures = rows.some((r) => r.location.role === "captures")

  const flow = setupFlow(m, "locations", {
    proceed: { id: "setup-locations-continue", label: m.setup_continue_short(), run: () => undefined },
    next: { to: "/setup/indexing" },
    gate: hasCaptures ? null : { reason: m.setup_continue_reason(), blockers: [] },
    summary: registeredSummary(m, rows.length),
  })
  const columns = locationColumns(m, false)
  const expand = unreadableFolders(m)
  const rowActions = (r: LocationRow): MenuItem[] => [...recoveryItems(m, r, actions), removeItem(m, r, LOCATIONS_HREF)]

  return (
    <StepPage
      title={m.setup_locations_title()}
      flow={flow}
      stepsLabel={m.setup_progress()}
      step={
        <>
          {SETUP_ROLES.map((role) => {
            const copy = ROLE_COPY[role]
            const required = role === "captures"
            const roleRows = rows.filter((r) => r.location.role === role)
            const isDeferred = deferred.includes(role)
            const sectionActions: Action[] = [
              ...(!required && roleRows.length === 0 && !isDeferred ? [{ id: `later-${role}`, label: m.setup_later(), run: () => setRoleDeferred(role, true) }] : []),
              { id: `add-${role}`, label: roleRows.length === 0 ? copy.add : m.setup_add_another(), icon: FolderPlus, opensDialog: true, run: () => setAdding(role) },
            ]
            return (
              <Section
                key={role}
                id={`setup-${role}`}
                title={copy.title}
                description={`${required ? m.setup_required() : m.site_optional()} · ${copy.description}`}
                actions={<ActionBar actions={sectionActions} />}
              >
                <DataTable
                  label={copy.list}
                  rows={roleRows}
                  columns={columns}
                  getRowId={(r) => r.location.id}
                  rowLabel={(r) => r.location.displayName}
                  rowActions={rowActions}
                  expand={expand}
                  scroll="none"
                  empty={<StatusBadge kind="role" value="unset" label={required ? m.setup_captures_needed() : isDeferred ? m.setup_deferred() : undefined} />}
                />
              </Section>
            )
          })}
          <DeveloperModeStatus />
          <AddLocationFlow role={adding} open={adding !== null} onClose={() => setAdding(null)} href={LOCATIONS_HREF} roles={SETUP_ROLES} />
          {actions.dialogs}
        </>
      }
    />
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

/** A count, with what it means once it is not zero. */
function countWithHint(count: number, hint: string): string {
  return count > 0 ? `${formatCount(count)} · ${hint}` : formatCount(count)
}

const INDEXING_HREF = "/setup/indexing"

export function SetupIndexingPage() {
  const m = useMessages()
  const navigate = useNavigate()
  const rows = useLocationRows()
  const runIds = useStore((s) => s.slices.e.setupOperationIds)
  const operations = useStore((s) => s.operations)
  const library = useStore((s) => {
    const sessions = Object.values(s.catalog.sessions).filter((x) => !x.supersededBy && x.imageType === "light")
    const covered = Object.values(s.catalog.locations).filter((l) => framesInLocation(s.catalog, l.id) > 0).map((l) => l.displayName)
    return { sessions: sessions.length, provisional: sessions.some((x) => x.scope !== "complete"), frames: Object.keys(s.catalog.assets).length, covered }
  })
  const actions = useLocationActions({ href: INDEXING_HREF, onIndexStarted: rememberRun, notify: "runner" })

  const runs = runIds.map((id) => operations[id]).filter((op) => op !== undefined)
  const first = runs[0]
  const latest = runs.at(-1)
  const anyRunning = runs.some((op) => op.status === "running" || op.status === "paused")
  // The counts follow the run shown below them; a Retry is its own run (J19 S7).
  const counts = latest ? indexCounts(latest.payload) : null
  // Complete scope is current catalog state, so a retried location counts once it is complete (LIB-FR-03).
  const completeLocations = rows.filter((r) => r.location.access !== "denied" && r.location.scanScope === "complete").length
  // Registered after the last run (Back, Add another location) or never reached: still indexable here.
  const unindexed = rows.filter((r) => r.location.scanScope === "never" && !r.indexing)
  const status = anyRunning
    ? m.setup_footer_running()
    : latest?.status === "interrupted"
      ? m.setup_footer_interrupted()
      : latest?.status === "canceled"
        ? m.setup_footer_canceled()
        : unindexed.length > 0
          ? m.setup_footer_unindexed({ count: unindexed.length, n: formatCount(unindexed.length) })
          : m.setup_footer_finished()

  // Before the first run the step's operation is Start indexing (F2), and Index later ends setup without it. Once a run
  // started, Open library ends setup on Home, the start page (D-W39), where the orientation walk begins (Round 6).
  const flow = first
    ? setupFlow(m, "indexing", { proceed: { id: "setup-open-library", label: m.setup_open_library(), run: completeOnboarding }, next: { to: "/" }, summary: status })
    : setupFlow(m, "indexing", {
        proceed: { id: "setup-start-indexing", label: m.setup_start_indexing(), icon: Play, run: () => rememberRun(startIndexing(rows.map((r) => r.location.id))) },
        next: null,
        skip: {
          id: "setup-index-later",
          label: m.setup_index_later(),
          run: () => {
            completeOnboarding()
            void navigate({ to: "/" })
          },
        },
        gate: rows.length === 0 ? { reason: m.setup_no_locations(), blockers: [{ label: m.common_locations(), link: { to: LOCATIONS_HREF } }] } : null,
      })
  const indexNew: Action = {
    id: "index-new",
    label: m.setup_index_new({ count: unindexed.length, n: formatCount(unindexed.length) }),
    icon: Play,
    run: () => rememberRun(startIndexing(unindexed.map((r) => r.location.id))),
  }

  return (
    <StepPage
      title={m.setup_indexing_title()}
      flow={flow}
      stepsLabel={m.setup_progress()}
      step={
        <>
          {counts && latest ? (
            <Box id="index-counts" level={2} title={runs.length > 1 ? m.setup_latest_run({ title: say(m, latest.title) }) : m.setup_scan()}>
              <KeyValueList
                columns={2}
                items={[
                  { label: m.setup_stat_discovered(), value: formatCount(counts.discovered) },
                  { label: m.setup_stat_read(), value: formatCount(counts.read) },
                  { label: m.setup_stat_unsupported(), value: countWithHint(counts.unsupported, m.setup_stat_unsupported_hint()) },
                  { label: m.setup_stat_unreadable(), value: countWithHint(counts.unreadableFolders, m.setup_stat_unreadable_hint()) },
                  { label: m.status_complete_scope(), value: m.setup_stat_complete_value({ done: formatCount(completeLocations), total: formatCount(rows.length) }) },
                ]}
              />
            </Box>
          ) : null}
          {first ? (
            <p aria-live="polite">
              {m.setup_library_so_far({
                sessions: m.about_count_light_sessions({ count: library.sessions, n: formatCount(library.sessions) }),
                frames: m.about_count_frames({ count: library.frames, n: formatCount(library.frames) }),
              })}
              {library.covered.length ? m.setup_library_covers({ names: library.covered.join(", ") }) : ""}{" "}
              {library.provisional || anyRunning ? <StatusBadge kind="scanScope" value="provisional" /> : null}
            </p>
          ) : null}
          {latest ? <OperationPanel operationId={latest.id} headingLevel={2} onRetry={latest.status === "interrupted" ? () => resumeOperation(latest.id) : undefined} /> : null}
          <Section
            id="index-locations"
            title={first ? m.common_locations() : m.setup_locations_to_index({ count: rows.length, n: formatCount(rows.length) })}
            description={first ? undefined : m.setup_index_all_hint()}
            actions={first && unindexed.length > 0 ? <ActionBar actions={[indexNew]} /> : undefined}
          >
            <DataTable
              label={m.setup_registered_locations()}
              rows={rows}
              columns={locationColumns(m, true)}
              getRowId={(r) => r.location.id}
              rowLabel={(r) => r.location.displayName}
              rowActions={(r) => recoveryItems(m, r, actions)}
              expand={unreadableFolders(m)}
              scroll="none"
              empty={<StatusBadge kind="role" value="unset" label={m.setup_no_locations()} />}
            />
          </Section>
          {actions.dialogs}
        </>
      }
    />
  )
}
