/**
 * S14 Calibration library (slice E; CAL-FR-01, CAL-FR-06, CAL-FR-07, D-W5,
 * D-W55, P-CAL3), carried over from v4's T4 library to the v5 run model.
 * Masters, each naming the runs that use it: a run uses a master when its
 * calibration plan hands it off (automatic, accepted or an exception) for
 * the run's saved membership. A generated master found in a run's Results is
 * a candidate until adopted; the run's Calibrate step offers it once (slice C
 * owns that decision), so the library links there instead of adopting on its
 * own. Raw sessions are listed by their calibration process (P-CAL3) with the
 * one action that moves each on.
 */
import { Link } from "@tanstack/react-router"
import { SlidersHorizontal } from "lucide-react"
import { useMemo, useState } from "react"
import { EmptyState, UnknownValue } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { Pill } from "@/components/app/pill"
import { Refusal, refusalFrom } from "@/components/app/refusal"
import { StatusBadge, type Tone } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { calibrationPlan, inputDrift, inputKey, KIND_LABEL, masterSource, type CalSource } from "@/domain/calibration"
import { CALIBRATION_STEP_LABEL, calibrationProcesses, type ProcessStatus, type ProcessView, stackProfiles } from "@/domain/calibration-process"
import { rigName, runSetup, runStepLink, savedContent, workingContent } from "@/domain/derive"
import type { Catalog, Disk, Run } from "@/domain/types"
import { formatExposure, plural } from "@/lib/format"
import { detectMasters, discardRaws, importMaster, keepRaws, startStack } from "@/store/actions/calibration"
import type { CommitResult } from "@/store/core"
import { useStore } from "@/store/core"

interface Usage {
  run: Run
  /** Light sessions of the run this input calibrates. */
  sessions: number
  kinds: Set<string>
}

/** Which runs hand off each master, keyed by master id. */
function usageByInput(catalog: Catalog, disk: Disk): Map<string, Usage[]> {
  const out = new Map<string, Usage[]>()
  for (const run of Object.values(catalog.runs)) {
    if (run.trashedAt) continue
    const plan = calibrationPlan(catalog, disk, run, runSetup(catalog, run).calibrationPolicy, savedContent(run) ?? workingContent(run))
    for (const row of plan.rows) {
      if (!row.input || (row.state !== "automatic" && row.state !== "accepted" && row.state !== "exception")) continue
      const key = inputKey(row.input)
      const list = out.get(key) ?? []
      let usage = list.find((u) => u.run.id === run.id)
      if (!usage) {
        usage = { run, sessions: 0, kinds: new Set() }
        list.push(usage)
      }
      usage.sessions += 1
      usage.kinds.add(row.kind)
      out.set(key, list)
    }
  }
  return out
}

function describe(source: CalSource): string {
  const parts = [KIND_LABEL[source.kind]]
  if (source.channel) parts.push(source.channel)
  if (source.exposureS !== null && source.kind !== "flat") parts.push(formatExposure(source.exposureS))
  if (source.cameraName) parts.push(source.cameraName)
  return parts.join(" · ")
}

function UsedBy({ usage, catalog }: { usage: Usage[] | undefined; catalog: Catalog }) {
  if (!usage || usage.length === 0) return <span className="text-xs text-muted-foreground">No run uses it</span>
  return (
    <ul className="min-w-72 space-y-0.5 text-xs">
      {usage.map((u) => {
        const link = runStepLink(u.run, "calibrate")
        return (
          <li key={u.run.id} className="whitespace-nowrap">
            <Link to={link.to} params={link.params as never} className="text-link hover:underline">
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
  )
}

const TH = "h-(--row-h) px-3 text-left font-medium"
const TD = "px-3 py-1 align-top"

const PROCESS_TONE: Record<ProcessStatus, Tone> = { "awaiting-stack": "info", stacking: "info", importing: "info", "trashing-raws": "info", failed: "danger", done: "success" }
const PROCESS_WORD: Record<ProcessStatus, string> = { "awaiting-stack": "To stack", stacking: "Stacking", importing: "Importing", "trashing-raws": "Trashing raws", failed: "Failed", done: "Done" }

/** The one action that moves a process on, with its label. */
function processAction(view: ProcessView, catalog: Catalog): { label: string; run: () => CommitResult } | null {
  const { process, failure, status } = view
  const profile = stackProfiles(catalog).find((p) => p.executableState === "found") ?? null
  const stack = { label: "Stack", run: () => startStack(process.sessionId!, profile?.id ?? null).result }
  if (status === "awaiting-stack" && process.sessionId) return stack
  if (failure?.step === "detect" && process.sessionId) return { label: "Detect", run: () => detectMasters(process.id) }
  if (failure?.step === "import" || failure?.step === "register") return { label: "Import", run: () => importMaster(process.id) }
  if (failure?.step === "raws") return { label: "Keep raws", run: () => keepRaws(process.id) }
  if (status === "done" && process.raws === "kept") return { label: "Trash raws", run: () => discardRaws(process.id) }
  return null
}

function ProcessesSection({ catalog }: { catalog: Catalog }) {
  const processes = calibrationProcesses(catalog)
  const [refused, setRefused] = useState<{ id: string; action: string; result: CommitResult } | null>(null)
  const shown = refused ? refusalFrom(refused.result, `${refused.action} blocked`) : null
  return (
    <Section id="cal-raw" title={`Raw sessions · ${processes.length}`}>
      {shown ? <Refusal {...shown} className="mb-2" /> : null}
      {processes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No raw sessions</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <caption className="sr-only">Calibration processes</caption>
            <thead className="bg-[color-mix(in_oklch,var(--chrome)_70%,var(--background))] text-[0.6875rem] text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className={TH}>Raw session</th>
                <th scope="col" className={`${TH} text-right`}>Frames</th>
                <th scope="col" className={TH}>Tool</th>
                <th scope="col" className={TH}>State</th>
                <th scope="col" className={TH}>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {processes.map((view) => {
                const action = processAction(view, catalog)
                const step = view.failure?.step ?? view.current
                return (
                  <tr key={view.process.id} data-process={view.process.id} className="border-b border-border/50 last:border-0 even:bg-foreground/[0.022]">
                    <th scope="row" className={`${TD} text-left font-normal`}>
                      <span className="block font-medium">{view.name}</span>
                      {view.master ? (
                        <span className="block max-w-80 truncate font-mono text-xs text-muted-foreground" title={view.master.path}>
                          {view.master.path}
                        </span>
                      ) : null}
                    </th>
                    <td className={`${TD} text-right tabular-nums`}>{view.frames > 0 ? view.frames : "–"}</td>
                    <td className={TD}>{view.process.profileId ? (catalog.profiles[view.process.profileId]?.name ?? "–") : "–"}</td>
                    <td className={TD}>
                      <span className="flex flex-wrap items-center gap-1">
                        <Pill tone={PROCESS_TONE[view.status]}>{PROCESS_WORD[view.status]}</Pill>
                        {step && view.status !== "awaiting-stack" ? <span className="text-xs text-muted-foreground">{CALIBRATION_STEP_LABEL[step]}</span> : null}
                        {view.failure ? <span className="text-xs text-destructive">· {view.failure.reason}</span> : null}
                        {view.status === "done" ? <span className="text-xs text-muted-foreground">· Raws {view.process.raws === "kept" ? "kept" : "trashed"}</span> : null}
                      </span>
                    </td>
                    <td className={`${TD} text-right`}>
                      {action ? (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => {
                            const result = action.run()
                            setRefused(result.ok ? null : { id: view.process.id, action: action.label, result })
                          }}
                        >
                          {action.label}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

export function CalibrationPage() {
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const usage = useMemo(() => usageByInput(catalog, disk), [catalog, disk])
  const masters = Object.values(catalog.masters).sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path))
  const offerRun = (masterId: string) => Object.values(catalog.runs).find((r) => r.masterOffers.some((o) => o.masterId === masterId))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Calibration"
        description="Reusable masters and the runs that use each. Runs match them automatically; only rows without a compatible input need review."
        actions={
          <Button variant="outline" render={<Link to="/settings/locations" search={{ return: "/calibration" }} />}>
            Calibration locations
          </Button>
        }
      />
      <PageBody>
        <Section id="cal-masters" title={`Masters · ${masters.length}`} description="Adopted masters are reusable. A candidate came out of a run's Results and is offered once in that run's Calibrate step.">
          {masters.length === 0 ? (
            <EmptyState icon={SlidersHorizontal} title="No masters yet" description="Masters appear when a Calibration location is indexed or a run's Results hold one." action={<Button size="sm" render={<Link to="/settings/locations" />}>Add a Calibration location</Button>} />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <caption className="sr-only">Calibration masters</caption>
                <thead className="bg-[color-mix(in_oklch,var(--chrome)_70%,var(--background))] text-[0.6875rem] text-muted-foreground">
                  <tr className="border-b">
                    <th scope="col" className={TH}>Master</th>
                    <th scope="col" className={TH}>Rig</th>
                    <th scope="col" className={`${TH} text-right`}>Frames</th>
                    <th scope="col" className={TH}>State</th>
                    <th scope="col" className={TH}>Used by</th>
                  </tr>
                </thead>
                <tbody>
                  {masters.map((m) => {
                    const source = masterSource(catalog, m.id)
                    const drift = m.state === "adopted" ? inputDrift(catalog, disk, { type: "master", masterId: m.id }) : null
                    const run = m.state === "candidate" ? offerRun(m.id) : undefined
                    const link = run ? runStepLink(run, "calibrate") : null
                    return (
                      <tr key={m.id} className="border-b border-border/50 last:border-0 even:bg-foreground/[0.022]">
                        <th scope="row" className={`${TD} text-left font-normal`}>
                          <span className="block font-medium">{source ? describe(source) : KIND_LABEL[m.kind]}</span>
                          <span className="block max-w-80 truncate font-mono text-xs text-muted-foreground" title={m.path}>
                            {m.path}
                          </span>
                        </th>
                        <td className={TD}>{m.opticalTrainId ? rigName(catalog, m.opticalTrainId) : <UnknownValue label="Rig unknown" reason="No optical train evidence in the header" />}</td>
                        <td className={`${TD} text-right tabular-nums`}>{m.frameCount ?? "–"}</td>
                        <td className={TD}>
                          <span className="flex flex-col gap-0.5">
                            <StatusBadge kind="master" value={m.state} />
                            {drift ? <StatusBadge kind="content" value="drifted" label="Changed since adoption" /> : null}
                            {m.state === "candidate" && run && link ? (
                              <span className="text-xs text-muted-foreground">
                                From {run.name}.{" "}
                                <Link to={link.to} params={link.params as never} className="text-link hover:underline">
                                  Review the offer in Calibrate
                                </Link>
                              </span>
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
          )}
        </Section>

        <ProcessesSection catalog={catalog} />
      </PageBody>
    </div>
  )
}
