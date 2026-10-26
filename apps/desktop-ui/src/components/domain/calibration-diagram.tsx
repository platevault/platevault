/**
 * CalibrationDiagram (L2-domain; F4 decision record §4 and §6, plan
 * "Calibration diagram"): the WBPP-style read-only picture of a Project's
 * calibration. Each group, then each night folder of the View, then each
 * light set with the flat, dark and bias it gets: the source's name and
 * version date, the evidence it was matched on, No flats/No darks/No bias, a
 * pin whose file changed or went missing, and the darks and bias that sit in
 * a night folder because the Project mixes versions with the same settings.
 *
 * It holds no control: no assignment, no policy switch, no better-match
 * action and no gate. Its links go where each thing is fixed: a light set to
 * its session, a master to its version in the Calibration library (a
 * MasterPreview), a raw set to its calibration session.
 *
 * The host maps a Project's calibration and its View plan into the groups,
 * so the night folders and the per-night darks are the ones Apply places. A
 * Closed Project reads its frozen calibration.
 */
import { type ReactNode, useId } from "react"
import { useMessages } from "@/app/preferences"
import { Box } from "@/components/app/box"
import { ActionError, TableSkeleton } from "@/components/app/feedback"
import { Pill } from "@/components/app/pill"
import type { StepLink } from "@/components/app/contracts"
import { MasterPreview, type MasterSummary, type MasterVersionSummary, PlaceLink } from "@/components/app/previews"
import { formatCount, formatNight } from "@/lib/format"
import { type MessageRef, joinRefs, msg, say } from "@/lib/i18n"
import { CalibrationChoiceBadge, type CalibrationChoiceBadgeProps, evidenceRef } from "./calibration-choices"
import { KIND_NAME, type MatchEvidence, type PinHealth, type PinKind } from "./calibration-model"

/** The kinds in the order a light set reads them: its night's flats first, then darks and bias. */
const DIAGRAM_KINDS: readonly PinKind[] = ["flat", "dark", "bias"]

/** What one light set gets for one kind. */
export interface DiagramCalibration {
  kind: PinKind
  choice: CalibrationChoiceBadgeProps["choice"]
  /** The source as a list names it ("masterDark_300s.xisf · 8 Sep", "18 Sep · Ha (raw)"); null while waiting or No. */
  source: MessageRef | null
  /** Where the source is fixed: the master in the Calibration library, or the raw calibration session. */
  link: StepLink | null
  /** A master pin or suggestion: the record and the dated version it names, for its preview. */
  master: { record: MasterSummary; version: MasterVersionSummary; age: MessageRef | null; usedBy: number } | null
  evidence: MatchEvidence | null
  health: PinHealth
  /** Darks or bias in this night's folder: the Project mixes versions with the same settings, so none of them stays shared. */
  mixed: boolean
}

/** One light session in a night folder. */
export interface DiagramLights {
  sessionId: string
  /** "18 Sep · Ha · 300 s". */
  session: MessageRef
  link: StepLink
  /** Frames the View places for it. */
  frames: number
  /** Frames no readable copy holds now: Apply can't place them. */
  offline: number
  /** One per kind, flat, dark, bias. */
  calibration: DiagramCalibration[]
}

export interface DiagramNight {
  /** The View folder: `NIGHT_2026-09-18`, or `NIGHT_2026-09-18-2` for a second flat set that night. */
  folder: string
  /** The observing night, `YYYY-MM-DD`. */
  night: string
  lights: DiagramLights[]
}

export interface DiagramGroup {
  id: string
  name: string
  panel: boolean
  /** `GROUP_<name>` or `PANEL_<name>` when the Project has several groups; null with one. */
  folder: string | null
  nights: DiagramNight[]
  /** Darks and bias the group's night folders carry because their versions mix. */
  mixed: SharedKind[]
}

/** The kinds that are shared unless their versions mix; flats always sit in a night folder. */
type SharedKind = Exclude<PinKind, "flat">

/** "Mixed dark versions", "Mixed bias versions". */
const MIXED_NAME: Record<SharedKind, MessageRef> = {
  dark: msg("calibration_diagram_mixed_darks"),
  bias: msg("calibration_diagram_mixed_bias"),
}

function CalibrationCell({ entry }: { entry: DiagramCalibration }) {
  const m = useMessages()
  const name = entry.source ? say(m, entry.source) : null
  return (
    <div className="flex min-w-0 flex-col items-start gap-1 border-l border-border pl-3 [overflow-wrap:anywhere]" data-diagram-kind={entry.kind}>
      <dt className="sr-only">{say(m, KIND_NAME[entry.kind])}</dt>
      <dd className="flex min-w-0 flex-col items-start gap-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <CalibrationChoiceBadge kind={entry.kind} choice={entry.choice} health={entry.health} />
          {entry.mixed ? <Pill tone="info">{m.calibration_diagram_in_night()}</Pill> : null}
        </span>
        {name && entry.master && entry.link ? (
          <MasterPreview label={name} link={entry.link} master={entry.master.record} version={entry.master.version} age={entry.master.age ? say(m, entry.master.age) : null} usedBy={entry.master.usedBy} />
        ) : name && entry.link ? (
          <PlaceLink link={entry.link}>{name}</PlaceLink>
        ) : null}
        {entry.evidence ? <span className="text-xs text-muted-foreground">{say(m, evidenceRef(entry.kind, entry.evidence))}</span> : null}
      </dd>
    </div>
  )
}

function LightsRow({ lights }: { lights: DiagramLights }) {
  const m = useMessages()
  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <dl className="grid grid-cols-4 gap-3">
        <div className="flex min-w-0 flex-col items-start gap-1 [overflow-wrap:anywhere]">
          <dt className="sr-only">{m.calibration_diagram_lights()}</dt>
          <dd className="flex min-w-0 flex-col items-start gap-1">
            <PlaceLink link={lights.link}>{say(m, lights.session)}</PlaceLink>
            <span className="text-xs text-muted-foreground">
              {m.project_frames_count({ count: lights.frames, n: formatCount(lights.frames) })}
              {lights.offline > 0 ? ` · ${m.calibration_diagram_offline({ count: lights.offline, n: formatCount(lights.offline) })}` : ""}
            </span>
          </dd>
        </div>
        {lights.calibration.map((entry) => (
          <CalibrationCell key={entry.kind} entry={entry} />
        ))}
      </dl>
    </li>
  )
}

function NightBlock({ night, level }: { night: DiagramNight; level: 4 | 5 }) {
  // Subscribes to the language: the night's date is worded in it.
  useMessages()
  const id = useId()
  const Heading = `h${level}` as const
  return (
    <div className="space-y-1.5" data-diagram-night={night.folder}>
      <Heading id={id} className="flex flex-wrap items-baseline gap-2 text-xs font-semibold">
        <span className="font-mono">{night.folder}</span>
        <span className="font-normal text-muted-foreground">{formatNight(night.night, true)}</span>
      </Heading>
      <ul aria-labelledby={id} className="divide-y divide-border">
        {night.lights.map((lights) => (
          <LightsRow key={lights.sessionId} lights={lights} />
        ))}
      </ul>
    </div>
  )
}

function GroupBox({ group, level }: { group: DiagramGroup; level: 3 | 4 }) {
  const m = useMessages()
  const columns = [m.calibration_diagram_lights(), ...DIAGRAM_KINDS.map((kind) => say(m, KIND_NAME[kind]))]
  return (
    <Box
      level={level}
      title={group.name}
      actions={
        <>
          {group.mixed.map((kind) => (
            <Pill key={kind} tone="info">
              {say(m, MIXED_NAME[kind])}
            </Pill>
          ))}
          {group.panel ? <Pill tone="neutral">{m.common_mosaic_panel()}</Pill> : null}
          {group.folder ? <span className="font-mono text-xs text-muted-foreground">{group.folder}</span> : null}
        </>
      }
    >
      {group.nights.length === 0 ? (
        <p className="text-muted-foreground">{m.calibration_diagram_group_empty()}</p>
      ) : (
        <div className="space-y-3">
          <div aria-hidden="true" className="grid grid-cols-4 gap-3 text-xs text-muted-foreground">
            {columns.map((column, i) => (
              <span key={column} className={i > 0 ? "pl-3" : undefined}>
                {column}
              </span>
            ))}
          </div>
          {group.nights.map((night) => (
            <NightBlock key={night.folder} night={night} level={level === 3 ? 4 : 5} />
          ))}
        </div>
      )}
      {group.mixed.length > 0 ? (
        <p className="pt-2 text-xs text-muted-foreground">{m.calibration_diagram_mixed_note({ kinds: say(m, joinRefs(group.mixed.map((kind) => KIND_NAME[kind]), ", ")) })}</p>
      ) : null}
    </Box>
  )
}

export interface CalibrationDiagramProps {
  /** The Project's groups in order, each night folder the next Apply builds, and what each held session gets. */
  groups: DiagramGroup[]
  /** Heading level of each group's title; 3 inside a page section (default), 4 inside a sub-section. */
  level?: 3 | 4
  loading?: boolean
  /** The diagram could not be read: the error with Retry, in its place. */
  error?: { message: string; onRetry: () => void }
  /** Shown when no group holds a session; default "No sessions yet…". */
  empty?: ReactNode
}

export function CalibrationDiagram({ groups, level = 3, loading = false, error, empty }: CalibrationDiagramProps) {
  const m = useMessages()
  if (loading) return <TableSkeleton rows={3} columns={4} label={m.calibration_diagram_loading()} />
  if (error) return <ActionError message={error.message} onRetry={error.onRetry} />
  if (groups.every((g) => g.nights.length === 0)) return <p className="text-muted-foreground">{empty ?? m.calibration_diagram_empty()}</p>
  return (
    <div className="space-y-3" data-calibration-diagram="">
      {groups.map((group) => (
        <GroupBox key={group.id} group={group} level={level} />
      ))}
    </div>
  )
}
