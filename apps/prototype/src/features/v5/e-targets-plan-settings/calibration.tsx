/**
 * S14 Calibration library (slice E; CAL-FR-01, CAL-FR-06, CAL-FR-07, P-CAL2,
 * P-CAL3). Runs are assigned masters only; raw calibration frames are input
 * to a calibration process. Two areas:
 *
 * - Process: one row per raw calibration session (or master imported from
 *   elsewhere) with its five steps, Stack → Detect → Import → Register →
 *   Raws, each with its state and reason. The row offers the one action that
 *   moves it on: Stack with a picked tool profile, Retry at the failed step,
 *   Cancel a watch, Trash raws. A failure reads as a terse Refusal.
 * - Masters: the library, grouped by kind in the keys its structured storage
 *   uses (flats by train, filter and night; darks by camera, exposure, gain,
 *   offset and temperature; bias by camera, gain and offset). The runs that
 *   use a master sit behind a disclosure. The Dismissed filter lists
 *   dismissed master offers with Restore (P-CAL2).
 *
 * Import masters files masters stacked elsewhere straight into structured
 * storage. `?process=<processId>` highlights one process; `?filter=dismissed`
 * opens the Dismissed filter.
 */
import { Link, useSearch } from "@tanstack/react-router"
import { FolderInput, SlidersHorizontal } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { StepGlyph, useFollowLink } from "@/app/run-ui"
import { Box } from "@/components/app/box"
import { ClearableInput } from "@/components/app/clearable-input"
import { announce, EmptyState } from "@/components/app/feedback"
import { FolderPicker } from "@/components/app/folder-picker"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { CountBadge, Pill, pillClass } from "@/components/app/pill"
import { Refusal, type RefusalProps, refusalFrom } from "@/components/app/refusal"
import { ContextMenuArea, type MenuEntry, menuKey } from "@/components/app/row-menu"
import { StatusBadge, type Tone } from "@/components/app/status"
import { NoteMarker } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { calibrationPlan, inputDrift, inputKey, KIND_LABEL } from "@/domain/calibration"
import { dismissedOffers } from "@/domain/calibration-library"
import { CALIBRATION_STEP_LABEL, CALIBRATION_STEPS, calibrationProcesses, type ProcessStatus, type ProcessView, stackProfiles } from "@/domain/calibration-process"
import { type GateState, rigName, runSetup, runStepLink, savedContent, type StepLink, workingContent } from "@/domain/derive"
import { filesUnder } from "@/domain/disk"
import type { CalibrationKind, CalibrationMaster, CalibrationStepState, Catalog, Disk, ProfileId, Run } from "@/domain/types"
import { fileName, formatDateTime, formatExposure, formatNight, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { detectMasters, discardRaws, importMaster, importMasterFile, keepRaws, restoreMasterOffer, startStack } from "@/store/actions/calibration"
import { type CommitResult, store, useStore } from "@/store/core"
import { cancelOperation, isSettled } from "@/store/operations"
import { masterNight } from "./calibration-model"

const TH = "h-(--row-h) px-3 text-left font-medium whitespace-nowrap"
const TD = "px-3 py-1"
const ROW = "h-(--row-h) border-b border-border/50 last:border-0 even:bg-foreground/[0.022] aria-[current=true]:bg-accent aria-[current=true]:shadow-[inset_2px_0_0_var(--primary)]"

/** Refusal props for any failed store result: a contract refusal lists its blockers; a failed write names its message. */
function outcomeOf(result: CommitResult, action: string, links: Record<string, StepLink> = {}): RefusalProps | null {
  if (result.ok) return null
  return refusalFrom(result, `${action} blocked`, links) ?? { action: `${action} not saved`, reason: result.message, blockers: [] }
}

// ---------------------------------------------------------------------------
// Process
// ---------------------------------------------------------------------------

const PROCESS_PILL: Record<ProcessStatus, { tone: Tone; word: string }> = {
  "awaiting-stack": { tone: "info", word: "To stack" },
  stacking: { tone: "info", word: "Stacking" },
  importing: { tone: "info", word: "Importing" },
  "trashing-raws": { tone: "info", word: "Trashing raws" },
  failed: { tone: "danger", word: "Failed" },
  done: { tone: "success", word: "Done" },
}

const STEP_GATE: Record<CalibrationStepState, GateState> = { todo: "idle", running: "running", done: "done", failed: "blocked", skipped: "idle" }
const STEP_WORD: Record<CalibrationStepState, string> = { todo: "To do", running: "Running", done: "Done", failed: "Failed", skipped: "Skipped" }

/** Stack → Detect → Import → Register → Raws, each with its state and reason (in its tooltip and screen-reader text). */
function ProcessSteps({ view }: { view: ProcessView }) {
  const here = view.failure?.step ?? view.current
  return (
    <ol aria-label={`${view.name} steps`} className="flex items-center gap-x-0.5 whitespace-nowrap">
      {CALIBRATION_STEPS.map((id, index) => {
        const record = view.process.steps[id]
        const current = id === here
        const gate: GateState = current && record.state === "todo" ? "ready" : STEP_GATE[record.state]
        const kept = id === "raws" && record.state === "done" ? (view.process.raws === "kept" ? "Kept" : "Trashed") : null
        const tip = [STEP_WORD[record.state], kept, record.reason, record.at ? formatDateTime(record.at) : null].filter(Boolean).join(" · ")
        return (
          <li
            key={id}
            aria-current={current ? "step" : undefined}
            title={`${CALIBRATION_STEP_LABEL[id]}: ${tip}`}
            data-step={id}
            data-step-state={record.state}
            className={cn(
              "inline-flex h-5 items-center gap-1 rounded-[0.3125rem] px-1 text-[0.6875rem]",
              current ? "bg-foreground/[0.08] font-medium text-foreground" : "text-muted-foreground",
              record.state === "skipped" && "line-through",
            )}
          >
            <StepGlyph state={gate} />
            {/* Below 1280 px only the current step keeps its word, as a compact StepRail does; the glyph and tooltip stay. */}
            <span className={cn(!current && "max-xl:sr-only")}>{CALIBRATION_STEP_LABEL[id]}</span>
            <span className="sr-only">: {tip}</span>
            {index < CALIBRATION_STEPS.length - 1 ? <span aria-hidden="true" className="ml-0.5 h-px w-1.5 bg-border" /> : null}
          </li>
        )
      })}
    </ol>
  )
}

interface ProcessAction {
  label: string
  run: () => CommitResult
}

/** The actions a process offers now, the one that moves it on first. */
function processActions(view: ProcessView, profileId: ProfileId | null): ProcessAction[] {
  const { process, failure, status } = view
  const out: ProcessAction[] = []
  const stack = (label: string) => ({ label, run: () => startStack(process.sessionId!, profileId).result })
  if (status === "awaiting-stack" && process.sessionId) out.push(stack("Stack"))
  if (failure) {
    if (failure.step === "stack" && process.sessionId) out.push(stack("Retry"))
    if (failure.step === "detect") out.push({ label: "Retry", run: () => detectMasters(process.id) })
    if (failure.step === "import" || failure.step === "register") out.push({ label: "Retry", run: () => importMaster(process.id) })
    if (failure.step === "raws") out.push({ label: "Retry", run: () => discardRaws(process.id) }, { label: "Keep raws", run: () => keepRaws(process.id) })
    if (failure.step === "detect" && process.sessionId) out.push(stack("Stack again"))
  }
  const watch = process.operationId ? store.getState().operations[process.operationId] : undefined
  if (status === "stacking") {
    out.push({ label: "Detect now", run: () => detectMasters(process.id) })
    if (watch && !isSettled(watch.status) && watch.canCancel) {
      out.push({
        label: "Cancel",
        run: () => {
          cancelOperation(watch.id)
          return { ok: true }
        },
      })
    }
  }
  if (status === "done" && process.raws === "kept" && view.frames > 0) out.push({ label: "Trash raws", run: () => discardRaws(process.id) })
  return out
}

function ProcessesBox({ catalog, highlight }: { catalog: Catalog; highlight: string | null }) {
  const processes = calibrationProcesses(catalog)
  const profiles = stackProfiles(catalog)
  const fallbackProfile = (profiles.find((p) => p.executableState === "found") ?? profiles[0])?.id ?? null
  const [picked, setPicked] = useState<Record<string, ProfileId>>({})
  const [refused, setRefused] = useState<{ id: string; props: RefusalProps } | null>(null)
  const profileOf = (view: ProcessView) => picked[view.process.id] ?? view.process.profileId ?? fallbackProfile
  const links: Record<string, StepLink> = Object.fromEntries(profiles.map((p) => [`${p.name} not set up`, { to: "/settings/applications" }]))
  links["no tool profile"] = { to: "/settings/applications" }
  links["no output folder"] = { to: "/settings/locations" }

  function act(view: ProcessView, action: ProcessAction) {
    const props = outcomeOf(action.run(), action.label === "Retry" ? `${CALIBRATION_STEP_LABEL[view.failure?.step ?? "stack"]}` : action.label, links)
    setRefused(props ? { id: view.process.id, props } : null)
    if (!props) announce(`${view.name}: ${action.label}`)
  }

  const follow = useFollowLink()
  const menu = (id: string): MenuEntry[] => {
    const view = processes.find((p) => p.process.id === id)
    if (!view) return []
    const entries: MenuEntry[] = processActions(view, profileOf(view)).map((a) => ({ label: a.label, onSelect: () => act(view, a) }))
    const open: MenuEntry[] = []
    if (view.session) open.push({ label: "Open session", onSelect: () => follow({ to: "/sessions/$sessionId", params: { sessionId: view.session!.id } }) })
    if (view.master) open.push({ label: "Show master", onSelect: () => document.querySelector<HTMLElement>(`[data-master="${CSS.escape(view.master!.id)}"]`)?.scrollIntoView({ block: "center" }) })
    return entries.length > 0 && open.length > 0 ? [...entries, { separator: true }, ...open] : [...entries, ...open]
  }

  return (
    <Box id="cal-process" level={2} title={<span className="inline-flex items-center gap-1.5">Process <CountBadge count={processes.length} /></span>} flush>
      {processes.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">No raw sessions</p>
      ) : (
        <ContextMenuArea menu={menu}>
          <div className="overflow-x-auto">
            {/* Under 1280 px the cells tighten so the five steps stay on one line beside the state and action. */}
            <table className="w-full text-sm max-xl:[&_td]:px-2 max-xl:[&_th]:px-2">
              <caption className="sr-only">Calibration processes</caption>
              <thead className="text-[0.6875rem] text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className={TH}>
                    Session
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Frames
                  </th>
                  <th scope="col" className={TH}>
                    Tool
                  </th>
                  <th scope="col" className={TH}>
                    Steps
                  </th>
                  <th scope="col" className={TH}>
                    State
                  </th>
                  <th scope="col" className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {processes.map((view) => {
                  const id = view.process.id
                  const profileId = profileOf(view)
                  const actions = processActions(view, profileId)
                  const primary = actions[0]
                  const pill = PROCESS_PILL[view.status]
                  const own = refused?.id === id ? refused.props : null
                  const failure: RefusalProps | null = view.failure
                    ? {
                        action: `${CALIBRATION_STEP_LABEL[view.failure.step]} failed`,
                        reason: view.failure.reason,
                        blockers: view.failure.step === "detect" && view.process.outputFolder ? [{ label: fileName(view.process.outputFolder) }] : [],
                      }
                    : null
                  const notes = [
                    view.process.outputFolder ? { label: "Output", value: <span className="font-mono">{view.process.outputFolder}</span> } : null,
                    view.process.detected ? { label: "Detected", value: `${fileName(view.process.detected.path)}${view.process.detected.ncombine ? ` · NCOMBINE ${view.process.detected.ncombine}` : ""}` } : null,
                    view.process.storagePath ? { label: "Stored", value: <span className="font-mono">{view.process.storagePath}</span> } : null,
                  ].filter((n) => n !== null)
                  const detail = own ?? failure
                  return (
                    <ProcessRows key={id} id={id} current={highlight === id} detail={detail ? <Refusal {...detail} /> : null}>
                      <th scope="row" className={`${TD} text-left font-normal whitespace-nowrap`}>
                        <span className="inline-flex items-center gap-1">
                          {view.session ? (
                            <Link to="/sessions/$sessionId" params={{ sessionId: view.session.id }} className="font-medium hover:underline">
                              {view.name}
                            </Link>
                          ) : (
                            <span className="font-medium">{view.name}</span>
                          )}
                          {notes.length > 0 ? <NoteMarker label={`${view.name} folders`} rows={notes} /> : null}
                        </span>
                      </th>
                      <td className={`${TD} text-right tabular-nums`}>{view.frames > 0 ? view.frames : "–"}</td>
                      <td className={TD}>
                        {view.status === "awaiting-stack" || view.failure?.step === "detect" ? (
                          <Select
                            items={profiles.map((p) => ({ value: p.id, label: p.name }))}
                            value={profileId ?? ""}
                            onValueChange={(value) => setPicked((prev) => ({ ...prev, [id]: String(value) as ProfileId }))}
                          >
                            <SelectTrigger size="sm" aria-label={`Tool for ${view.name}`} className="w-32 text-xs">
                              <SelectValue className="block truncate" />
                            </SelectTrigger>
                            <SelectContent>
                              {profiles.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="whitespace-nowrap">{view.process.profileId ? (catalog.profiles[view.process.profileId]?.name ?? "–") : "–"}</span>
                        )}
                      </td>
                      <td className={TD}>
                        <ProcessSteps view={view} />
                      </td>
                      <td className={TD}>
                        <Pill tone={pill.tone}>{pill.word}</Pill>
                      </td>
                      <td className={`${TD} text-right whitespace-nowrap`}>
                        {primary ? (
                          <Button size="xs" variant="outline" onClick={() => act(view, primary)}>
                            {primary.label}
                            <span className="sr-only"> {view.name}</span>
                          </Button>
                        ) : null}
                      </td>
                    </ProcessRows>
                  )
                })}
              </tbody>
            </table>
          </div>
        </ContextMenuArea>
      )}
    </Box>
  )
}

/** A process row, plus a row below it for its failure or refusal. */
function ProcessRows({ id, current, detail, children }: { id: string; current: boolean; detail: ReactNode; children: ReactNode }) {
  return (
    <>
      <tr {...menuKey(id)} data-process={id} aria-current={current ? "true" : undefined} className={cn(ROW, detail && "border-b-0")}>
        {children}
      </tr>
      {detail ? (
        <tr {...menuKey(id)} aria-current={current ? "true" : undefined} className={ROW}>
          <td colSpan={6} className="px-3 pb-1.5">
            {detail}
          </td>
        </tr>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// Masters
// ---------------------------------------------------------------------------

interface Usage {
  run: Run
  /** Light sessions of the run this master calibrates. */
  sessions: number
}

/** Which runs hand off each master, keyed by master id. */
function usageByMaster(catalog: Catalog, disk: Disk): Map<string, Usage[]> {
  const out = new Map<string, Usage[]>()
  for (const run of Object.values(catalog.runs)) {
    if (run.trashedAt) continue
    const plan = calibrationPlan(catalog, disk, run, runSetup(catalog, run).calibrationPolicy, savedContent(run) ?? workingContent(run))
    for (const row of plan.rows) {
      if (!row.input || (row.state !== "automatic" && row.state !== "accepted" && row.state !== "exception")) continue
      const key = inputKey(row.input)
      const list = out.get(key) ?? []
      const usage = list.find((u) => u.run.id === run.id)
      if (usage) usage.sessions += 1
      else list.push({ run, sessions: 1 })
      out.set(key, list)
    }
  }
  return out
}

const KIND_ORDER: CalibrationKind[] = ["flat", "dark", "bias", "dark-flat"]
const KIND_HEADING: Record<CalibrationKind, string> = { flat: "Flats", dark: "Darks", bias: "Bias", "dark-flat": "Dark flats" }

interface StorageKey {
  id: string
  header: string
  value: (m: CalibrationMaster, catalog: Catalog) => string | null
  align?: "right"
}

const KEY = {
  train: { id: "train", header: "Train", value: (m, c) => (m.opticalTrainId ? rigName(c, m.opticalTrainId) : null) },
  filter: { id: "filter", header: "Filter", value: (m) => m.channel },
  night: { id: "night", header: "Night", value: (m, c) => masterNight(c, m) },
  camera: { id: "camera", header: "Camera", value: (m) => m.cameraName },
  exposure: { id: "exposure", header: "Exposure", align: "right", value: (m) => (m.exposureS === null ? null : formatExposure(m.exposureS)) },
  gain: { id: "gain", header: "Gain", align: "right", value: (m) => (m.gain === null ? null : String(m.gain)) },
  offset: { id: "offset", header: "Offset", align: "right", value: (m) => (m.offset === null ? null : String(m.offset)) },
  temp: { id: "temp", header: "Temp", align: "right", value: (m) => (m.ccdTempC === null ? null : `${Math.round(m.ccdTempC)} °C`) },
} satisfies Record<string, StorageKey>

/** Structured storage keys per kind (P-CAL3): flats are night-specific, darks and bias are long-lived libraries. */
const STORAGE_KEYS: Record<CalibrationKind, StorageKey[]> = {
  flat: [KEY.train, KEY.filter, KEY.night],
  dark: [KEY.camera, KEY.exposure, KEY.gain, KEY.offset, KEY.temp],
  bias: [KEY.camera, KEY.gain, KEY.offset],
  "dark-flat": [KEY.camera, KEY.exposure, KEY.gain, KEY.offset, KEY.temp],
}

const ORIGIN_WORD: Record<CalibrationMaster["origin"]["kind"], string> = { library: "Indexed", generated: "Run Results", stacked: "Stacked", imported: "Imported" }

function sortKey(m: CalibrationMaster, catalog: Catalog): string {
  return STORAGE_KEYS[m.kind]
    .map((k) => {
      const v = k.id === "exposure" ? String(m.exposureS ?? 0).padStart(12, "0") : (k.value(m, catalog) ?? "")
      // Newest night first within a filter.
      return k.id === "night" ? String(99999999 - Number(v.replaceAll("-", ""))) : v
    })
    .join("|")
}

function UsedBy({ usage, catalog }: { usage: Usage[] | undefined; catalog: Catalog }) {
  if (!usage || usage.length === 0) return <span className="text-muted-foreground">–</span>
  return (
    <details className="group/used text-xs" data-used-by>
      <summary className={cn(pillClass("neutral", true), "cursor-default list-none [&::-webkit-details-marker]:hidden")}>
        {plural(usage.length, "run")}
        <span aria-hidden="true" className="transition-transform group-open/used:rotate-90 motion-reduce:transition-none">
          ▸
        </span>
      </summary>
      <ul className="mt-1 space-y-0.5">
        {usage.map((u) => {
          const link = runStepLink(u.run, "calibrate")
          return (
            <li key={u.run.id} className="whitespace-nowrap">
              <Link to={link.to as never} params={link.params as never} className="text-link hover:underline">
                {u.run.name}
              </Link>
              <span className="text-muted-foreground">
                {" "}
                · {catalog.projects[u.run.projectId]?.name ?? "Project"} · {plural(u.sessions, "session")}
              </span>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

function MasterBox({ kind, masters, catalog, disk, usage }: { kind: CalibrationKind; masters: CalibrationMaster[]; catalog: Catalog; disk: Disk; usage: Map<string, Usage[]> }) {
  const keys = STORAGE_KEYS[kind]
  const offerRun = (masterId: string) => Object.values(catalog.runs).find((r) => r.masterOffers.some((o) => o.masterId === masterId && o.state === "pending"))
  const follow = useFollowLink()
  const menu = (id: string): MenuEntry[] => {
    const master = catalog.masters[id]
    if (!master) return []
    const entries: MenuEntry[] = []
    const run = master.state === "candidate" ? offerRun(id) : undefined
    if (run) entries.push({ label: "Open offer", onSelect: () => follow(runStepLink(run, "calibrate")) })
    const used = usage.get(id) ?? []
    if (used.length > 0) entries.push({ heading: "Used by" }, ...used.map((u) => ({ label: u.run.name, onSelect: () => follow(runStepLink(u.run, "calibrate")) })))
    const session = master.origin.sessionId ? catalog.sessions[master.origin.sessionId] : undefined
    if (session) entries.push(...(entries.length > 0 ? [{ separator: true } as const] : []), { label: "Open raw session", onSelect: () => follow({ to: "/sessions/$sessionId", params: { sessionId: session.id } }) })
    return entries
  }
  return (
    <Box id={`cal-${kind}`} title={<span className="inline-flex items-center gap-1.5">{KIND_HEADING[kind]} <CountBadge count={masters.length} /></span>} flush>
      <ContextMenuArea menu={menu}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{`Master ${KIND_HEADING[kind].toLowerCase()}`}</caption>
            <thead className="text-[0.6875rem] text-muted-foreground">
              <tr className="border-b">
                {keys.map((k) => (
                  <th key={k.id} scope="col" className={cn(TH, k.align === "right" && "text-right")}>
                    {k.header}
                  </th>
                ))}
                <th scope="col" className={`${TH} text-right`}>
                  Frames
                </th>
                <th scope="col" className={TH}>
                  State
                </th>
                <th scope="col" className={TH}>
                  Used by
                </th>
              </tr>
            </thead>
            <tbody>
              {masters.map((m) => {
                const drift = m.state === "adopted" ? inputDrift(catalog, disk, { type: "master", masterId: m.id }) : null
                const run = m.state === "candidate" ? offerRun(m.id) : undefined
                const lineage = m.origin.sessionId ? catalog.sessions[m.origin.sessionId] : undefined
                return (
                  <tr key={m.id} {...menuKey(m.id)} data-master={m.id} className={cn(ROW, "align-top")}>
                    {keys.map((k, index) => {
                      const value = k.value(m, catalog)
                      const shown = value === null ? "–" : k.id === "night" ? formatNight(value, true) : value
                      if (index > 0) {
                        return (
                          <td key={k.id} className={cn(TD, "whitespace-nowrap tabular-nums", k.align === "right" && "text-right")}>
                            {k.id === "filter" && value ? <Pill tone="muted">{value}</Pill> : shown}
                          </td>
                        )
                      }
                      return (
                        <th key={k.id} scope="row" className={`${TD} text-left font-normal whitespace-nowrap`}>
                          <span className="inline-flex items-center gap-1">
                            {shown}
                            <NoteMarker
                              label={`${shown} master: storage`}
                              rows={[
                                { label: "Stored", value: <span className="font-mono [overflow-wrap:anywhere]">{m.path}</span> },
                                { label: "Origin", value: lineage ? `${ORIGIN_WORD[m.origin.kind]} · ${formatNight(lineage.night)}` : ORIGIN_WORD[m.origin.kind] },
                                ...(m.adoption ? [{ label: "Adopted", value: formatDateTime(m.adoption.adoptedAt) }] : []),
                              ]}
                            />
                          </span>
                        </th>
                      )
                    })}
                    <td className={`${TD} text-right tabular-nums`}>{m.frameCount ?? "–"}</td>
                    <td className={TD}>
                      <span className="flex flex-wrap items-center gap-1">
                        <StatusBadge kind="master" value={m.state} />
                        {drift ? (
                          <span title={drift}>
                            <StatusBadge kind="content" value="drifted" />
                          </span>
                        ) : null}
                        {run ? (
                          <Pill tone="info" link={runStepLink(run, "calibrate")} title={`Offered in ${run.name}`}>
                            Offered
                          </Pill>
                        ) : null}
                      </span>
                    </td>
                    <td className={TD}>
                      <UsedBy usage={usage.get(m.id)} catalog={catalog} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </ContextMenuArea>
    </Box>
  )
}

function DismissedBox({ catalog, query }: { catalog: Catalog; query: string }) {
  const offers = dismissedOffers(catalog).filter((d) => matches(d.master, catalog, query) || d.run.name.toLowerCase().includes(query))
  const [refused, setRefused] = useState<RefusalProps | null>(null)
  const restore = (runId: string, masterId: string) => {
    const props = outcomeOf(restoreMasterOffer(runId, masterId), "Restore")
    setRefused(props)
    if (!props) announce("Offer restored")
  }
  const follow = useFollowLink()
  const menu = (key: string): MenuEntry[] => {
    const found = offers.find((d) => `${d.run.id}:${d.master.id}` === key)
    if (!found) return []
    return [
      { label: "Restore", onSelect: () => restore(found.run.id, found.master.id) },
      { label: "Open run", onSelect: () => follow(runStepLink(found.run, "calibrate")) },
    ]
  }
  return (
    <Box id="cal-dismissed" title={<span className="inline-flex items-center gap-1.5">Dismissed <CountBadge count={offers.length} /></span>} flush>
      {refused ? <Refusal {...refused} className="border-b border-border px-3 py-2" /> : null}
      {offers.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">No dismissed offers</p>
      ) : (
        <ContextMenuArea menu={menu}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Dismissed master offers</caption>
              <thead className="text-[0.6875rem] text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className={TH}>
                    Master
                  </th>
                  <th scope="col" className={TH}>
                    Run
                  </th>
                  <th scope="col" className={TH}>
                    Dismissed
                  </th>
                  <th scope="col" className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {offers.map((d) => {
                  const link = runStepLink(d.run, "calibrate")
                  const name = masterLabel(d.master)
                  return (
                    <tr key={`${d.run.id}:${d.master.id}`} {...menuKey(`${d.run.id}:${d.master.id}`)} data-dismissed={d.master.id} className={ROW}>
                      <th scope="row" className={`${TD} text-left font-normal whitespace-nowrap`}>
                        <span className="inline-flex items-center gap-1">
                          {name}
                          <NoteMarker label={`${name}: file`} rows={[{ label: "File", value: <span className="font-mono [overflow-wrap:anywhere]">{d.master.path}</span> }]} />
                        </span>
                      </th>
                      <td className={`${TD} whitespace-nowrap`}>
                        <Link to={link.to as never} params={link.params as never} className="text-link hover:underline">
                          {d.run.name}
                        </Link>
                        <span className="text-muted-foreground"> · {catalog.projects[d.run.projectId]?.name ?? "Project"}</span>
                      </td>
                      <td className={`${TD} whitespace-nowrap tabular-nums`}>{formatDateTime(d.offer.at)}</td>
                      <td className={`${TD} text-right`}>
                        <Button size="xs" variant="outline" onClick={() => restore(d.run.id, d.master.id)}>
                          Restore<span className="sr-only"> {name}</span>
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </ContextMenuArea>
      )}
    </Box>
  )
}

/** "Dark 120 s · ZWO ASI2600MM Pro", "Flat Ha · RedCat 51". */
function masterLabel(m: CalibrationMaster): string {
  const detail = m.kind === "flat" ? m.channel : m.kind === "bias" || m.exposureS === null ? null : formatExposure(m.exposureS)
  return [`${KIND_LABEL[m.kind]}${detail ? ` ${detail}` : ""}`, m.cameraName].filter(Boolean).join(" · ")
}

function matches(m: CalibrationMaster, catalog: Catalog, query: string): boolean {
  if (!query) return true
  const haystack = [KIND_LABEL[m.kind], m.channel, m.cameraName, m.opticalTrainId ? rigName(catalog, m.opticalTrainId) : null, m.path].filter(Boolean).join(" ").toLowerCase()
  return haystack.includes(query)
}

type MasterFilter = "all" | "dismissed"

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={pillClass(active ? "info" : "muted", true)} data-filter-chip>
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Import masters
// ---------------------------------------------------------------------------

interface ImportOutcome {
  imported: number
  refusal: RefusalProps | null
}

/** Import every master file under a folder straight into structured storage; refused files become blocker chips. */
function importFolder(folder: string): ImportOutcome {
  const files = filesUnder(store.getState().disk, folder).filter((f) => f.header?.imageType.startsWith("master-"))
  if (files.length === 0) return { imported: 0, refusal: { action: "Import blocked", reason: "no masters", blockers: [{ label: fileName(folder) }] } }
  let imported = 0
  const refused: Array<{ file: string; reason: string }> = []
  for (const file of files) {
    const { result } = importMasterFile(file.path)
    if (result.ok) imported += 1
    else refused.push({ file: fileName(file.path), reason: result.reason === "refused" ? (result.reasons[0] ?? "refused") : result.message })
  }
  if (refused.length === 0) return { imported, refusal: null }
  const reasons = new Set(refused.map((r) => r.reason))
  return {
    imported,
    refusal: {
      action: "Import blocked",
      reason: reasons.size === 1 ? `${refused.length} ${[...reasons][0]}` : plural(refused.length, "master"),
      blockers: refused.map((r) => ({ label: reasons.size === 1 ? r.file : `${r.file} · ${r.reason}` })),
    },
  }
}

export function CalibrationPage() {
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const search = useSearch({ strict: false }) as Record<string, string | undefined>
  const usage = useMemo(() => usageByMaster(catalog, disk), [catalog, disk])
  const [filter, setFilter] = useState<MasterFilter>(search.filter === "dismissed" ? "dismissed" : "all")
  const [query, setQuery] = useState("")
  const [picking, setPicking] = useState(false)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const needle = query.trim().toLowerCase()

  // Links into the library follow the search while the page stays mounted.
  useEffect(() => {
    if (search.filter === "dismissed") setFilter("dismissed")
  }, [search.filter])
  useEffect(() => {
    if (!search.process) return
    requestAnimationFrame(() => document.querySelector(`[data-process="${CSS.escape(search.process!)}"]`)?.scrollIntoView({ block: "center" }))
  }, [search.process])

  const all = Object.values(catalog.masters)
  const shown = all.filter((m) => matches(m, catalog, needle))
  const byKind = KIND_ORDER.map((kind) => ({ kind, masters: shown.filter((m) => m.kind === kind).sort((a, b) => sortKey(a, catalog).localeCompare(sortKey(b, catalog))) })).filter((g) => g.masters.length > 0)
  const dismissed = dismissedOffers(catalog).length
  const importButton = (
    <Button variant="outline" onClick={() => setPicking(true)}>
      <FolderInput aria-hidden="true" data-icon="inline-start" />
      Import masters
    </Button>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Calibration"
        actions={
          <>
            <Button variant="ghost" render={<Link to="/settings/calibration" search={{ return: "/calibration" }} />}>
              Settings
            </Button>
            {importButton}
          </>
        }
      />
      <PageBody>
        {outcome ? (
          <div className="flex flex-wrap items-start gap-2" data-import-outcome>
            {outcome.imported > 0 ? <Pill tone="success">{`${plural(outcome.imported, "master")} imported`}</Pill> : null}
            {outcome.refusal ? <Refusal {...outcome.refusal} /> : null}
          </div>
        ) : null}

        <ProcessesBox catalog={catalog} highlight={search.process ?? null} />

        <Section
          id="cal-masters"
          title="Masters"
          actions={
            <>
              <div role="group" aria-label="Show" className="flex items-center gap-1">
                <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
                  All <CountBadge count={all.length} />
                </FilterChip>
                <FilterChip active={filter === "dismissed"} onClick={() => setFilter("dismissed")}>
                  Dismissed <CountBadge count={dismissed} />
                </FilterChip>
              </div>
              <ClearableInput search aria-label="Filter masters" placeholder="Filter" value={query} onValueChange={setQuery} wrapperClassName="w-48" className="h-7" />
            </>
          }
        >
          {filter === "dismissed" ? (
            <DismissedBox catalog={catalog} query={needle} />
          ) : all.length === 0 ? (
            <EmptyState icon={SlidersHorizontal} title="No masters" action={importButton} />
          ) : byKind.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              No match
              <Button size="xs" variant="outline" onClick={() => setQuery("")}>
                Clear
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {byKind.map((g) => (
                <MasterBox key={g.kind} kind={g.kind} masters={g.masters} catalog={catalog} disk={disk} usage={usage} />
              ))}
            </div>
          )}
        </Section>
      </PageBody>

      <FolderPicker
        open={picking}
        onOpenChange={setPicking}
        title="Import masters"
        initialPath={store.getState().settings.lastOutputParent}
        chooseVerb="Import"
        onChoose={(folder) => {
          setPicking(false)
          const next = importFolder(folder)
          setOutcome(next)
          announce(next.imported > 0 ? `${plural(next.imported, "master")} imported` : "Import blocked")
        }}
      />
    </div>
  )
}
