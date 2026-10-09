/**
 * S14 Calibration library (slice E; CAL-FR-01, CAL-FR-06, CAL-FR-07, D-W5,
 * D-W55), carried over from v4's T4 library to the v5 run model. Two read
 * lists, masters and raw sets, each naming the runs that use the input:
 * a run uses a master or raw set when its calibration plan hands it off
 * (automatic, accepted or an exception) for the run's saved membership.
 * A generated master found in a run's Results is a candidate until adopted;
 * the run's Calibrate step offers it once (slice C owns that decision), so
 * the library links there instead of adopting on its own.
 */
import { Link } from "@tanstack/react-router"
import { SlidersHorizontal } from "lucide-react"
import { useMemo } from "react"
import { EmptyState, UnknownValue } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { calibrationPlan, inputDrift, inputKey, KIND_LABEL, masterSource, rawSetSource, type CalSource } from "@/domain/calibration"
import { rigName, runSetup, runStepLink, savedContent, workingContent } from "@/domain/derive"
import type { Catalog, Disk, Run, Session } from "@/domain/types"
import { formatExposure, formatNight, plural } from "@/lib/format"
import { useStore } from "@/store/core"

interface Usage {
  run: Run
  /** Light sessions of the run this input calibrates. */
  sessions: number
  kinds: Set<string>
}

/** Which runs hand off each input, keyed by master id or raw-set session id. */
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

export function CalibrationPage() {
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const usage = useMemo(() => usageByInput(catalog, disk), [catalog, disk])
  const masters = Object.values(catalog.masters).sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path))
  const rawSets = Object.values(catalog.sessions)
    .filter((s): s is Session => !s.supersededBy && ["dark", "flat", "bias", "dark-flat"].includes(s.imageType))
    .map((s) => ({ session: s, source: rawSetSource(catalog, s) }))
    .filter((x): x is { session: Session; source: CalSource } => x.source !== null)
    .sort((a, b) => a.source.kind.localeCompare(b.source.kind) || b.session.night.localeCompare(a.session.night))
  const offerRun = (masterId: string) => Object.values(catalog.runs).find((r) => r.masterOffers.some((o) => o.masterId === masterId))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Calibration"
        description="Reusable calibration inputs: adopted masters and raw sets, and the runs that use each. Runs match them automatically; only rows without a compatible input need review."
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

        <Section id="cal-raw" title={`Raw sets · ${rawSets.length}`} description="Indexed darks, flats and bias frames grouped by session. A run integrates a raw set when no compatible master exists.">
          {rawSets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No raw calibration sets are indexed.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <caption className="sr-only">Raw calibration sets</caption>
                <thead className="bg-[color-mix(in_oklch,var(--chrome)_70%,var(--background))] text-[0.6875rem] text-muted-foreground">
                  <tr className="border-b">
                    <th scope="col" className={TH}>Raw set</th>
                    <th scope="col" className={TH}>Night</th>
                    <th scope="col" className={`${TH} text-right`}>Frames</th>
                    <th scope="col" className={TH}>Rig</th>
                    <th scope="col" className={TH}>Used by</th>
                  </tr>
                </thead>
                <tbody>
                  {rawSets.map(({ session, source }) => (
                    <tr key={session.id} className="border-b border-border/50 last:border-0 even:bg-foreground/[0.022]">
                      <th scope="row" className={`${TD} text-left font-normal`}>
                        <span className="block font-medium">{describe(source)}</span>
                        <span className="block max-w-80 truncate font-mono text-xs text-muted-foreground" title={source.path}>
                          {source.path}
                        </span>
                      </th>
                      <td className={TD}>{formatNight(session.night, true)}</td>
                      <td className={`${TD} text-right tabular-nums`}>{source.frameCount ?? session.assetIds.length}</td>
                      <td className={TD}>{source.opticalTrainId ? rigName(catalog, source.opticalTrainId) : <span className="text-xs text-muted-foreground">Any rig with this camera</span>}</td>
                      <td className={TD}>
                        <UsedBy usage={usage.get(session.id)} catalog={catalog} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </PageBody>
    </div>
  )
}
