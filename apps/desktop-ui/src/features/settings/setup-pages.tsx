/**
 * First-run setup (LIB-FR-01, LIB-FR-27, LIB-FR-31; journey J19): Welcome,
 * Locations and Index, each a StepPage in the SetupFrame (no source list,
 * toolbar or status bar). The strip links every step and going back undoes
 * nothing; the order lives in each step's gate.
 *
 * - Welcome: the language select and what PlateVault does and never does.
 *   Continue opens Locations.
 * - Locations: one table per role. Continue needs a Captures location;
 *   Calibration and Results are optional. Folders come from the native
 *   picker (locations.tsx).
 * - Index: Home's planning criteria, with no value filled in (D-W170), and
 *   the locations to index. Start indexing stays unavailable until the
 *   criteria are whole and valid and a location is registered; it saves the
 *   criteria (`planning_save_home_criteria`) and then scans every location
 *   not scanned yet. Once the criteria are stored and every location was
 *   scanned, Open library finishes setup.
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
import { type ActionResult, library, type LocationRole, SCAN_PROGRESS_EVENT } from "@/api/ipc"
import { libraryKey } from "@/api/query"
import { useMessages } from "@/app/preferences"
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
import { formatCount } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { LanguageField } from "./language-field"
import { AddLocationDialog, isScanning, type LocationRow, locationColumns, ROLES, roleTitle, useLocationActions, useLocationRows } from "./locations"
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

function setupFlow(m: Messages, current: SetupStepId, step: SetupStep): StepFlow {
  const label: Record<SetupStepId, string> = { welcome: m.setup_step_welcome(), locations: m.common_locations(), index: m.setup_step_index() }
  const at = SETUP_STEPS.indexOf(current)
  const steps = SETUP_STEPS.map((id, index): FlowStep => {
    if (index < at) return { id, label: label[id], state: "finished" }
    if (index > at) return { id, label: label[id], state: "todo" }
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
  const flow = setupFlow(m, "welcome", {
    proceed: { id: "setup-welcome-continue", label: m.setup_continue_short(), run: () => undefined },
    next: { to: ROUTE.locations },
    skip: { id: "setup-later", label: m.setup_later(), run: exit },
  })
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
  const actions = useLocationActions()
  const [adding, setAdding] = useState<LocationRole | null>(null)
  const active = (rows ?? []).filter((r) => r.state.location.lifecycle === "active")
  const hasCaptures = active.some((r) => r.state.location.role === "captures")
  const flow = setupFlow(m, "locations", {
    proceed: { id: "setup-locations-continue", label: m.setup_continue_short(), run: () => undefined },
    next: { to: ROUTE.index },
    skip: { id: "setup-later", label: m.setup_later(), run: exit },
    gate: hasCaptures ? null : { reason: m.setup_continue_reason(), blockers: [] },
    summary: registeredSummary(m, active.length),
  })
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
                <Section key={role} id={`setup-${role}`} title={copy.title} description={`${required ? m.setup_required() : m.site_optional()} · ${copy.description}`} actions={<ActionBar actions={[add]} />}>
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

/** The newest scans' counts, summed over the locations (LIB-FR-03). */
function scanCounts(rows: LocationRow[]) {
  const scans = rows.flatMap((r) => (r.scan ? [r.scan] : []))
  const sum = (pick: (p: (typeof scans)[number]["progress"]) => number) => scans.reduce((total, scan) => total + pick(scan.progress), 0)
  return { scans: scans.length, discovered: sum((p) => p.discovered), read: sum((p) => p.metadataRead), unsupported: sum((p) => p.unsupported), unreadable: sum((p) => p.unreadable) }
}

/** The first failure of `results`, else the last success; nothing when there was nothing to run. */
function firstFailure(results: ActionResult<unknown>[]): ActionResult<unknown> | undefined {
  return results.find((result) => !result.ok) ?? results.at(-1)
}

export function SetupIndexPage() {
  const m = useMessages()
  const client = useQueryClient()
  const exit = useExitSetup()
  const { rows, error, retry } = useLocationRows()
  const actions = useLocationActions()
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
  const active = (rows ?? []).filter((r) => r.state.location.lifecycle === "active")
  const unscanned = active.filter((r) => !r.scan && !isScanning(r) && r.state.location.availability === "available")
  const running = active.some(isScanning)
  const criteriaStored = record?.criteria != null
  const finished = criteriaStored && active.length > 0 && unscanned.length === 0

  const start: Action = {
    id: "setup-start-indexing",
    label: m.setup_start_indexing(),
    icon: Play,
    run: async () => {
      if (!criteria || !record) return
      const saved = await settingsWrite(client, () => library.planningSaveHomeCriteria(criteria, record.revision))
      if (!saved.ok) return saved
      const scans: ActionResult<unknown>[] = []
      for (const row of unscanned) scans.push(await settingsWrite(client, () => library.libraryStartScan(row.state.location.id)))
      return firstFailure(scans) ?? saved
    },
  }
  const gate: FlowStep["gate"] =
    active.length === 0
      ? { reason: m.setup_no_locations(), blockers: [{ label: m.common_locations(), link: { to: ROUTE.locations } }] }
      : !valid
        ? { reason: m.setup_criteria_needed(), blockers: Object.values(errors).filter((e): e is string => Boolean(e)).map((label) => ({ label })) }
        : null
  const status = running ? m.setup_footer_running() : unscanned.length > 0 ? m.setup_footer_unindexed({ count: unscanned.length, n: formatCount(unscanned.length) }) : finished ? m.setup_footer_finished() : undefined
  const flow = finished
    ? setupFlow(m, "index", { proceed: { id: "setup-open-library", label: m.setup_open_library(), run: exit }, next: null, summary: status })
    : setupFlow(m, "index", { proceed: start, next: null, skip: { id: "setup-index-later", label: m.setup_index_later(), run: exit }, gate, summary: status })
  const counts = scanCounts(active)

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
              <Box id="index-counts" level={2} title={m.setup_scan()}>
                <KeyValueList
                  columns={2}
                  items={[
                    { label: m.setup_stat_discovered(), value: formatCount(counts.discovered) },
                    { label: m.setup_stat_read(), value: formatCount(counts.read) },
                    { label: m.setup_stat_unsupported(), value: formatCount(counts.unsupported) },
                    { label: m.setup_stat_unreadable(), value: formatCount(counts.unreadable) },
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
