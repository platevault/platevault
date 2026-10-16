/**
 * A calibration process as a staged flow, `/calibration/processes/$processId/$step`
 * (plan §4a, §5; P-CAL3): StepPage on U11's `calibrationFlow`, Stack →
 * Detect → Import → Register → Raws. Proceed in the footer runs the current
 * step; Raws is optional (Finish calibration moves the raws to the OS Trash,
 * Skip keeps them). Each step's region shows what the step works on, and the
 * page follows the flow when a step settles.
 */
import { Link, useParams } from "@tanstack/react-router"
import { SearchX } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { useFollowLink } from "@/components/app/links"
import { ActionBar, ActionButton } from "@/components/app/actions"
import { Box } from "@/components/app/box"
import type { Action, MenuItem } from "@/components/app/contracts"
import { KeyValueList, type KeyValueItem } from "@/components/app/data"
import { EmptyState } from "@/components/app/feedback"
import { SelectField } from "@/components/app/fields"
import { OperationLine } from "@/components/app/operation-panel"
import { PageHeader, Section } from "@/components/app/page"
import { Pill } from "@/components/app/pill"
import { StepPage } from "@/components/templates/step-page"
import { masterVersion } from "@/domain/calibration"
import { CALIBRATION_STEP_NAME, CALIBRATION_STEPS, processView, stackOutputFolder, stackProfiles } from "@/domain/calibration-process"
import type { CalibrationProcess, CalibrationStepId, ProfileId } from "@/domain/types"
import { fileName, formatCount, formatNight } from "@/lib/format"
import { say } from "@/lib/i18n"
import { startStack } from "@/store/actions/calibration"
import { calibrationFlow } from "@/store/actions/flows"
import { useStore } from "@/store/core"
import { masterLabel, PROCESS_STATUS } from "./calibration-model"

const LIBRARY = { to: "/calibration" }
const PROCESSES = { to: "/calibration", search: { view: "processes" } }

function isStep(step: string): step is CalibrationStepId {
  return (CALIBRATION_STEPS as string[]).includes(step)
}

export function CalibrationProcessPage() {
  const { processId = "", step = "" } = useParams({ strict: false }) as { processId?: string; step?: string }
  const process = useStore((s) => s.catalog.calibrationProcesses[processId])
  if (!process) return <ProcessMissing />
  return <ProcessFlow key={process.id} process={process} viewing={isStep(step) ? step : null} />
}

/** The route names no recorded process: say so and lead back to the library. */
function ProcessMissing() {
  const m = useMessages()
  const follow = useFollowLink()
  const back: Action = { id: "open-library", label: m.import_route_masters(), run: () => follow(PROCESSES) }
  return (
    <>
      <PageHeader title={m.calibration_process_title()} path={[{ label: m.nav_calibration(), link: LIBRARY }]} />
      <EmptyState icon={SearchX} title={m.calibration_process_gone()} description={m.store_cal_process_missing()} action={<ActionButton action={back} />} titleAs="h2" />
    </>
  )
}

function ProcessFlow({ process, viewing }: { process: CalibrationProcess; viewing: CalibrationStepId | null }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const follow = useFollowLink()
  const profiles = stackProfiles(state.catalog)
  const [picked, setPicked] = useState<ProfileId | null>(null)
  const profileId = picked ?? process.profileId ?? profiles.find((p) => p.executableState === "found")?.id ?? profiles[0]?.id ?? null
  const flow = calibrationFlow(state, process, profileId, m)
  const shown = viewing ?? (flow.current as CalibrationStepId)
  const view = processView(state.catalog, process)
  const name = say(m, view.name)

  // The page follows the flow: when the step on screen settles, the next current step opens.
  const last = useRef(flow.current)
  useEffect(() => {
    if (last.current === flow.current) return
    const was = last.current
    last.current = flow.current
    if (shown === was && flow.linkFor) follow(flow.linkFor(flow.current))
  }, [flow, shown, follow])

  const menu: MenuItem[] = []
  if (view.session) menu.push({ id: "open-session", label: m.calibration_open_raw_session(), run: () => follow({ to: "/sessions/$sessionId", params: { sessionId: view.session!.id } }) })
  if (view.master) menu.push({ id: "open-master", label: m.calibration_open_master(), run: () => follow({ to: "/calibration", search: { master: view.master!.id } }) })
  const status = PROCESS_STATUS[view.status]

  return (
    <StepPage
      path={[
        { label: m.nav_calibration(), link: LIBRARY },
        { label: m.calibration_processes(), link: PROCESSES },
      ]}
      title={name}
      status={<Pill tone={status.tone}>{say(m, status.word)}</Pill>}
      menu={{ label: m.calibration_process_title(), items: menu }}
      flow={flow}
      viewing={shown}
      stepsLabel={m.calibration_steps_of({ name })}
      step={<StepBody process={process} step={shown} editable={shown === flow.current && flow.proceed !== null} profileId={profileId} onPickProfile={setPicked} />}
    />
  )
}

interface StepBodyProps {
  process: CalibrationProcess
  step: CalibrationStepId
  editable: boolean
  profileId: ProfileId | null
  onPickProfile: (id: ProfileId) => void
}

/** The facts the step on screen works on, its own operations beside its heading. */
function StepBody({ process, step, editable, profileId, onPickProfile }: StepBodyProps) {
  const m = useMessages()
  const state = useStore((s) => s)
  const view = processView(state.catalog, process)
  const profiles = stackProfiles(state.catalog)
  const none = "–"
  const record = process.steps[step]
  const reason = record.state === "failed" && record.reason ? say(m, record.reason) : null
  const output = process.outputFolder ?? stackOutputFolder(state.catalog, state.settings, process)
  const session = view.session
  /** The dated version Register added to the master (CAL-FR-14). */
  const registered = process.versionId ? masterVersion(view.master ?? undefined, process.versionId) : undefined

  const facts: Record<CalibrationStepId, KeyValueItem[]> = {
    stack: [
      {
        label: m.calibration_session(),
        value: session ? (
          <Link to="/sessions/$sessionId" params={{ sessionId: session.id }} className="text-link hover:underline">
            {formatNight(session.night, true)}
          </Link>
        ) : (
          none
        ),
      },
      { label: m.calibration_frames(), value: formatCount(view.frames) },
      { label: m.calibration_output(), value: output ?? none, mono: true },
    ],
    detect: [
      { label: m.calibration_output(), value: output ?? none, mono: true },
      { label: m.calibration_detected(), value: process.detected ? fileName(process.detected.path) : none, mono: true },
      { label: m.calibration_frames(), value: process.detected?.ncombine ? m.calibration_ncombine({ count: process.detected.ncombine }) : none },
    ],
    import: [
      { label: m.calibration_detected(), value: process.detected?.path ?? none, mono: true },
      { label: m.calibration_stored(), value: process.storagePath ?? none, mono: true },
    ],
    register: [
      { label: m.calibration_stored(), value: process.storagePath ?? none, mono: true },
      {
        label: m.calibration_master(),
        value: view.master ? (
          <Link to="/calibration" search={{ master: view.master.id }} className="text-link hover:underline">
            {registered ? fileName(registered.path) : masterLabel(m, view.master)}
          </Link>
        ) : (
          none
        ),
      },
    ],
    raws: [
      { label: m.settings_raw_frames(), value: formatCount(view.frames) },
      { label: m.calibration_state(), value: process.raws === "kept" ? m.calibration_raws_kept() : process.raws === "trashed" ? m.session_in_os_trash() : none },
      { label: m.settings_keep_raws(), value: state.settings.keepRawCalibration ? m.calibration_on() : m.calibration_off() },
    ],
  }
  if (reason) facts[step].push({ label: m.status_failed(), value: reason })

  const actions: Action[] = []
  if (step === "detect" && record.state === "failed" && process.sessionId) {
    const sessionId = process.sessionId
    actions.push({ id: "stack-again", label: m.calibration_stack_again(), run: () => startStack(sessionId, profileId).result })
  }

  let picker: ReactNode = null
  if (step === "stack" && profiles.length > 0) {
    picker = (
      <SelectField
        label={m.calibration_tool()}
        value={profileId ?? ""}
        options={profiles.map((p) => ({ value: p.id, label: p.name }))}
        onChange={(id) => onPickProfile(id as ProfileId)}
        disabled={!editable}
      />
    )
  }
  const running = process.operationId && state.operations[process.operationId] && (step === "detect" || step === "raws") && record.state === "running" ? process.operationId : null

  return (
    <Section title={say(m, CALIBRATION_STEP_NAME[step])} actions={actions.length > 0 ? <ActionBar actions={actions} /> : undefined}>
      {picker ? <Box>{picker}</Box> : null}
      {running ? <OperationLine operationId={running} /> : null}
      <Box>
        <KeyValueList items={facts[step]} />
      </Box>
    </Section>
  )
}
