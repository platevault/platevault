/**
 * First-run setup (LIB-FR-01, LIB-FR-27, LIB-FR-31; journey J19): Welcome,
 * Locations and Index. Windows Developer Mode links to the system settings
 * page, but remains non-blocking for setup.
 *
 * - Welcome: the language select and what PlateVault does and never does.
 *   Continue opens Locations.
 * - Locations: one table per role. Continue needs a Captures location;
 *   Calibration and Results are optional. Folders come from the native
 *   picker (locations.tsx). On Windows, the Developer Mode row checks the
 *   processing location for symlinks (`library_check_symlinks`) and never
 *   blocks setup; macOS and Linux show no such row.
 * - Index: Home's planning criteria, with no value filled in (D-W170), and
 *   the locations to index. Start indexing stays unavailable until the
 *   criteria are whole and valid and a Captures location is registered
 *   (LIB-FR-01); it saves the criteria (`planning_save_home_criteria`) and
 *   then scans every location not scanned yet. The counts name the
 *   locations they cover, the complete scope, and read provisional while a
 *   scan runs (LIB-FR-03). Once the criteria are stored and every location
 *   was scanned, Open library finishes setup, saving criteria the user
 *   changed here first. The strip's steps read finished from the library's
 *   state, not from the order they were visited.
 *
 * Every exit (Open library, Index later, Configure later) hands over to
 * Home and starts the orientation walk (walk.tsx). Index later and
 * Configure later leave the criteria unset, so Home keeps asking for them.
 * Opening setup at first launch and remembering that it finished need the
 * durable first-run state of astro-plan-ocyuc.9; until it lands, setup
 * opens from Settings › Help.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Aperture, FolderPlus, Play } from "lucide-react"
import { type ReactNode, useState } from "react"
import { useRefreshOnEvent } from "@/api/events"
import { type ActionResult, library, type LocationRole, type NativePathWire, type PlanCriteria, SCAN_PROGRESS_EVENT } from "@/api/ipc"
import { libraryKey, libraryQuery } from "@/api/query"
import { useMessages } from "@/app/preferences"
import { onWindows } from "@/app/shortcuts"
import { ActionBar } from "@/components/app/actions"
import { Box } from "@/components/app/box"
import type { Action, FlowStep, StepFlow, StepLink } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { DataTable } from "@/components/app/data-table"
import { ActionError } from "@/components/app/feedback"
import { useDialogForm } from "@/components/app/form-dialog"
import { Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { criteriaErrors, criteriaOf, type CriteriaDraft, draftOf, homeCriteriaQuery } from "@/components/domain/plan-criteria"
import { PlanCriteriaFields } from "@/components/domain/plan-criteria-fields"
import { SetupFrame } from "@/components/templates/app-frame"
import { StepPage } from "@/components/templates/step-page"
import { formatCount, formatList } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { LanguageField } from "./language-field"
import { AddLocationDialog, failureDetail, isScanning, type LocationRow, locationColumns, ROLES, roleTitle, useLocationActions, useLocationRows } from "./locations"
import { readError } from "./parts"
import { settingsWrite } from "./queries"
import { openWalk } from "./walk"

export const SETUP_STEPS = ["welcome", "locations", "index"] as const
type SetupStepId = (typeof SETUP_STEPS)[number]

const ROUTE: Record<SetupStepId, string> = { welcome: "/setup", locations: "/setup/locations", index: "/setup/index" }

interface SetupStep {
  proceed: Action
  /** Where Proceed goes once it succeeds; null stays on the step. */
  next: StepLink | null
  skip?: Action
  gate?: FlowStep["gate"]
  summary?: string
}

/** Which steps the library's state finishes: Locations with an active Captures location (LIB-FR-01), Index with the criteria stored and every location scanned. */
interface SetupProgress {
  hasCaptures: boolean
  indexed: boolean
}

/** Setup's progress as the library reads it now, for the step strip. */
function useSetupProgress(rows: LocationRow[] | null): SetupProgress {
  const stored = useQuery(homeCriteriaQuery())
  const active = activeRows(rows)
  return { hasCaptures: hasCaptures(active), indexed: stored.data?.criteria != null && active.length > 0 && active.every((r) => r.scan !== null || r.state.location.availability !== "available") }
}

const activeRows = (rows: LocationRow[] | null) => (rows ?? []).filter((r) => r.state.location.lifecycle === "active")
const hasCaptures = (active: LocationRow[]) => active.some((r) => r.state.location.role === "captures")

function setupFlow(m: Messages, current: SetupStepId, step: SetupStep, progress: SetupProgress): StepFlow {
  const label: Record<SetupStepId, string> = { welcome: m.setup_step_welcome(), locations: m.common_locations(), index: m.setup_step_index() }
  // Welcome asks nothing, so it reads finished once the user is past it; the other steps read what the library holds.
  const done: Record<SetupStepId, boolean> = { welcome: current !== "welcome", locations: progress.hasCaptures, index: progress.indexed }
  const steps = SETUP_STEPS.map((id): FlowStep => {
    if (id !== current) return { id, label: label[id], state: done[id] ? "finished" : "todo" }
    return { id, label: label[id], state: step.gate ? "blocked" : "current", optional: step.skip !== undefined, gate: step.gate ?? null, summary: step.summary }
  })
  return { steps, current, ordered: false, proceed: step.proceed, next: step.next, skip: step.skip, linkFor: (id) => ({ to: ROUTE[id as SetupStepId] }) }
}

/** Leave setup for Home, where the orientation walk starts (LIB-FR-27). */
function useExitSetup(): () => void {
  const navigate = useNavigate()
  return () => {
    void navigate({ to: "/" })
    openWalk()
  }
}

function Frame({ children }: { children: ReactNode }) {
  const m = useMessages()
  return <SetupFrame brand={{ name: m.app_name(), icon: Aperture }}>{children}</SetupFrame>
}

function registeredSummary(m: Messages, count: number): string | undefined {
  return count > 0 ? m.setup_locations_registered({ count, n: formatCount(count) }) : undefined
}

// ---------------------------------------------------------------------------
// /setup
// ---------------------------------------------------------------------------

export function WelcomePage() {
  const m = useMessages()
  const exit = useExitSetup()
  const progress = useSetupProgress(useLocationRows().rows)
  const flow = setupFlow(m, "welcome", {
    proceed: { id: "setup-welcome-continue", label: m.setup_continue_short(), run: () => undefined },
    next: { to: ROUTE.locations },
    skip: { id: "setup-later", label: m.setup_later(), run: exit },
  }, progress)
  return (
    <Frame>
      <StepPage
        title={m.setup_welcome_title()}
        flow={flow}
        stepsLabel={m.setup_progress()}
        step={
          <>
            <LanguageField />
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
          </>
        }
      />
    </Frame>
  )
}

// ---------------------------------------------------------------------------
// /setup/locations
// ---------------------------------------------------------------------------

export function SetupLocationsPage() {
  const m = useMessages()
  const exit = useExitSetup()
  const { rows, error, retry } = useLocationRows()
  const actions = useLocationActions(rows)
  const progress = useSetupProgress(rows)
  const [adding, setAdding] = useState<LocationRole | null>(null)
  const active = activeRows(rows)
  const flow = setupFlow(m, "locations", {
    proceed: { id: "setup-locations-continue", label: m.setup_continue_short(), run: () => undefined },
    next: { to: ROUTE.index },
    skip: { id: "setup-later", label: m.setup_later(), run: exit },
    gate: progress.hasCaptures ? null : { reason: m.setup_continue_reason(), blockers: [] },
    summary: registeredSummary(m, active.length),
  }, progress)
  const columns = locationColumns(m, { role: false })
  return (
    <Frame>
      <StepPage
        title={m.setup_locations_title()}
        flow={flow}
        stepsLabel={m.setup_progress()}
        step={
          <>
            {error ? <ActionError message={readError(m, error)} onRetry={retry} /> : null}
            {ROLES.map((role) => {
              const copy = roleTitle(m, role)
              const required = role === "captures"
              const roleRows = active.filter((r) => r.state.location.role === role)
              const add: Action = { id: `add-${role}`, label: roleRows.length === 0 ? copy.add : m.setup_add_another(), icon: FolderPlus, opensDialog: true, run: () => setAdding(role) }
              return (
                <Section key={role} id={`setup-${role}`} title={copy.title} description={m.settings_joined({ first: required ? m.setup_required() : m.site_optional(), second: copy.description })} actions={<ActionBar actions={[add]} />}>
                  <DataTable
                    label={copy.list}
                    rows={roleRows}
                    columns={columns}
                    getRowId={(r) => r.state.location.id}
                    rowLabel={(r) => r.state.location.name}
                    rowActions={actions.rowActions}
                    loading={rows === null && !error}
                    scroll="none"
                    empty={required ? <StatusBadge kind="role" value="unset" label={m.setup_captures_needed()} /> : m.site_optional()}
                  />
                </Section>
              )
            })}
            {onWindows() ? <DeveloperModeCheck rows={active} /> : null}
            <AddLocationDialog role={adding} open={adding !== null} onOpenChange={(open) => !open && setAdding(null)} />
            {actions.dialogs}
          </>
        }
      />
    </Frame>
  )
}

// ---------------------------------------------------------------------------
// /setup/index
// ---------------------------------------------------------------------------

/** The newest scans' counts, summed over the locations, and the locations they cover (LIB-FR-03). */
function scanCounts(rows: LocationRow[]) {
  const scanned = rows.filter((r) => r.scan !== null)
  const scans = scanned.flatMap((r) => (r.scan ? [r.scan] : []))
  const sum = (pick: (p: (typeof scans)[number]["progress"]) => number) => scans.reduce((total, scan) => total + pick(scan.progress), 0)
  return {
    scans: scans.length,
    discovered: sum((p) => p.discovered),
    read: sum((p) => p.metadataRead),
    unsupported: sum((p) => p.unsupported),
    unreadable: sum((p) => p.unreadable),
    // A location's scope is complete once its newest scan completed; partial, failed or running scans leave it provisional.
    complete: scanned.filter((r) => r.scan?.state === "completed").length,
    covered: scanned.map((r) => r.state.location.name),
  }
}

/** The first failure of `results`, else the last success; nothing when there was nothing to run. */
function firstFailure(results: ActionResult<unknown>[]): ActionResult<unknown> | undefined {
  return results.find((result) => !result.ok) ?? results.at(-1)
}

/** Whether the draft differs from the stored criteria. */
function criteriaChanged(draft: PlanCriteria | null, stored: PlanCriteria | null): boolean {
  return JSON.stringify(draft) !== JSON.stringify(stored)
}

export function SetupIndexPage() {
  const m = useMessages()
  const client = useQueryClient()
  const exit = useExitSetup()
  const { rows, error, retry } = useLocationRows()
  const actions = useLocationActions(rows)
  const progress = useSetupProgress(rows)
  const stored = useQuery(homeCriteriaQuery())
  // A scan that starts or settles changes the rows: SetupFrame mounts no status bar, so the step listens itself.
  useRefreshOnEvent(SCAN_PROGRESS_EVENT, libraryKey("libraryListOperations"))
  useRefreshOnEvent(SCAN_PROGRESS_EVENT, libraryKey("libraryListLocations"))
  const record = stored.data
  // The draft starts from what is stored, which is nothing until the user sets the criteria (D-W170).
  const { values, set, shown } = useDialogForm<CriteriaDraft>(record !== undefined, () => draftOf(record?.criteria ?? null))
  const errors = criteriaErrors(m, values)
  const criteria = criteriaOf(values)
  const valid = criteria !== null && !Object.values(errors).some(Boolean)
  const active = activeRows(rows)
  const unscanned = active.filter((r) => !r.scan && !isScanning(r) && r.state.location.availability === "available")
  const running = active.some(isScanning)
  const finished = progress.hasCaptures && progress.indexed
  const changed = record !== undefined && criteriaChanged(criteria, record.criteria)
  const blockers = Object.values(errors).filter((e): e is string => Boolean(e)).map((label) => ({ label }))
  const saveCriteria = (next: PlanCriteria, revision: number) => settingsWrite(client, () => library.planningSaveHomeCriteria(next, revision))

  const start: Action = {
    id: "setup-start-indexing",
    label: m.setup_start_indexing(),
    icon: Play,
    run: async () => {
      if (!criteria || !record) return
      const saved = await saveCriteria(criteria, record.revision)
      if (!saved.ok) return saved
      const scans: ActionResult<unknown>[] = []
      for (const row of unscanned) scans.push(await settingsWrite(client, () => library.libraryStartScan(row.state.location.id)))
      return firstFailure(scans) ?? saved
    },
  }
  // Once setup is finished, Open library saves criteria the user changed here before it hands over, so no edit is lost.
  const openLibrary: Action = {
    id: "setup-open-library",
    label: m.setup_open_library(),
    run: async () => {
      if (changed && criteria && record) {
        const saved = await saveCriteria(criteria, record.revision)
        if (!saved.ok) return saved
      }
      exit()
    },
  }
  const gate: FlowStep["gate"] = !progress.hasCaptures
    ? { reason: m.setup_continue_reason(), blockers: [{ label: m.common_locations(), link: { to: ROUTE.locations } }] }
    : !valid
      ? { reason: m.setup_criteria_needed(), blockers }
      : null
  const status = running ? m.setup_footer_running() : unscanned.length > 0 ? m.setup_footer_unindexed({ count: unscanned.length, n: formatCount(unscanned.length) }) : finished ? m.setup_footer_finished() : undefined
  const flow = finished
    ? setupFlow(m, "index", { proceed: openLibrary, next: null, gate: valid ? null : { reason: m.setup_criteria_needed(), blockers }, summary: status }, progress)
    : setupFlow(m, "index", { proceed: start, next: null, skip: { id: "setup-index-later", label: m.setup_index_later(), run: exit }, gate, summary: status }, progress)
  const counts = scanCounts(active)
  const provisional = running || counts.complete < counts.scans

  return (
    <Frame>
      <StepPage
        title={m.setup_indexing_title()}
        flow={flow}
        stepsLabel={m.setup_progress()}
        step={
          <>
            <Section id="index-criteria" title={m.home_criteria_title()} description={m.setup_criteria_note()}>
              {record ? (
                <PlanCriteriaFields values={values} set={set} errorOf={(field) => shown(errors, field)} />
              ) : stored.isError ? (
                <ActionError message={readError(m, stored.error)} onRetry={() => void stored.refetch()} />
              ) : null}
            </Section>
            {counts.scans > 0 ? (
              <Box id="index-counts" level={2} title={m.setup_scan()} actions={provisional ? <StatusBadge kind="scanScope" value="provisional" /> : undefined}>
                <KeyValueList
                  columns={2}
                  items={[
                    { label: m.setup_stat_discovered(), value: formatCount(counts.discovered) },
                    { label: m.setup_stat_read(), value: formatCount(counts.read) },
                    { label: m.setup_stat_unsupported(), value: formatCount(counts.unsupported) },
                    { label: m.setup_stat_unreadable(), value: formatCount(counts.unreadable) },
                    { label: m.status_complete_scope(), value: m.setup_stat_complete_value({ done: formatCount(counts.complete), total: formatCount(active.length) }) },
                    { label: m.common_locations(), value: formatList(counts.covered) },
                  ]}
                />
              </Box>
            ) : null}
            {error ? <ActionError message={readError(m, error)} onRetry={retry} /> : null}
            <Section id="index-locations" title={m.setup_locations_to_index({ count: active.length, n: formatCount(active.length) })} description={m.setup_index_all_hint()}>
              <DataTable
                label={m.setup_registered_locations()}
                rows={active}
                columns={locationColumns(m, { role: true })}
                getRowId={(r) => r.state.location.id}
                rowLabel={(r) => r.state.location.name}
                rowActions={actions.rowActions}
                expand={failureDetail}
                loading={rows === null && !error}
                scroll="none"
                empty={<StatusBadge kind="role" value="unset" label={m.setup_no_locations()} />}
              />
            </Section>
            {actions.dialogs}
          </>
        }
      />
    </Frame>
  )
}

/**
 * Windows Developer Mode (J18 S1, PREP-AC-08): whether PlateVault can make
 * the symlinks a Symlinks View needs, checked on the registered processing
 * location (`library_check_symlinks`): the Results location, else the
 * Captures one. The row shows on Windows only and reads On or Off by
 * itself; Check again reads it again. Copies always work, so setup never
 * waits for it. When Off, Open Windows settings starts the OS settings page.
 */
function DeveloperModeCheck({ rows }: { rows: LocationRow[] }) {
  const m = useMessages()
  const target = rows.find((r) => r.state.location.role === "results") ?? rows.find((r) => r.state.location.role === "captures")
  const path = target?.state.location.path ?? null
  const checked = useQuery({ ...libraryQuery("libraryCheckSymlinks", path as NativePathWire), enabled: path !== null })
  const again: Action = { id: "check-symlinks", label: m.apps_check_again(), run: () => void checked.refetch() }
  const openSettings: Action = {
    id: "open-windows-settings",
    label: m.settings_open_windows_settings(),
    run: () => library.libraryOpenDeveloperSettings(),
  }
  const result = checked.data
  const value =
    path === null
      ? m.setup_no_locations()
      : result === "available"
        ? <StatusBadge kind="developerMode" value="on" />
        : result === "developer_mode_off"
          ? <StatusBadge kind="developerMode" value="off" />
          : result === "unsupported"
            ? m.location_links_none()
            : checked.isError
              ? readError(m, checked.error)
              : m.common_loading()
  const actions = path === null ? [] : result === "developer_mode_off" ? [again, openSettings] : [again]
  return (
    <Section id="setup-developer-mode" title={m.settings_developer_mode()} description={m.settings_symlinks_note()} actions={actions.length > 0 ? <ActionBar actions={actions} /> : undefined}>
      <KeyValueList items={[{ label: target ? m.settings_symlinks_in({ name: target.state.location.name }) : m.location_link_symlinks(), value }]} />
    </Section>
  )
}
