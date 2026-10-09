/**
 * S11 Plan (`/plan`, slice E): Tonight at the planning site and the night
 * timeline (D-W16, D-W63, PLAN-FR-02/09/10/11).
 *
 * - Tonight: the best window per open-Project subject and ★ favourite, the
 *   Moon (illumination, phase, rise, set), the darkness window, and the site
 *   with its time zone. A mosaic uses its centre; its panels are listed under
 *   it (D-W63).
 * - Night timeline: twilight bands, a Moon band, an altitude curve per row and
 *   window blocks, on one axis in the site's zone.
 * - `?project=` (opened from a Project) scopes the page to that Project's
 *   subjects and shows each one's goal gaps ("in project" and "captured").
 * - With no site: "Add an observing site in Settings".
 */
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { CalendarClock, X } from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"
import { KeyValueList } from "@/components/app/data"
import { ActionError, EmptyState, Notice } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatHours, goalProgress, myTargets, panelLabel, subjectCentre, subjectName, type GoalProgress } from "@/domain/derive"
import { criteriaSummary } from "@/domain/planning"
import type { Catalog, Project } from "@/domain/types"
import { save } from "@/features/t1/lib/writes"
import { formatNight, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { SearchParams } from "@/routes"
import { useStore } from "@/store/core"
import { NightTimeline, type TimelineRow } from "./night-timeline"
import { AddSiteButton, ProjectBadge, siteTime, siteTimeRange, useSkyContext } from "./parts"
import { positionSky, type RowSky } from "./targets-model"

interface PlanRow {
  key: string
  name: string
  /** The Target page this row opens, when it is a Target. */
  targetId: string | null
  ra: number | null
  dec: number | null
  projects: Project[]
  /** Panel rows sit under their mosaic. */
  panelOf: string | null
  /** Unmet goals of the scoped Project for this subject or panel. */
  gaps: GoalProgress[]
  favourite: boolean
}

function planRows(catalog: Catalog, scope: Project | undefined): PlanRow[] {
  const rows: PlanRow[] = []
  const projects = scope ? [scope] : Object.values(catalog.projects).filter((p) => p.state === "open")
  const seen = new Map<string, PlanRow>()
  for (const project of projects) {
    const progress = scope ? goalProgress(catalog, project).filter((g) => !g.met) : []
    for (const subject of project.subjects) {
      const target = catalog.targets[subject.targetId]
      if (subject.mosaic) {
        const centre = subjectCentre(catalog, subject)
        rows.push({
          key: `${project.id}:${subject.id}`,
          name: `${subjectName(catalog, subject)} (centre)`,
          targetId: subject.targetId,
          ra: centre?.ra ?? null,
          dec: centre?.dec ?? null,
          projects: [project],
          panelOf: null,
          gaps: progress.filter((g) => g.goal.subjectId === subject.id && g.goal.panelId === null),
          favourite: target?.favourite ?? false,
        })
        for (const panel of subject.mosaic.panels) {
          rows.push({
            key: `${project.id}:${subject.id}:${panel.id}`,
            name: panelLabel(panel),
            targetId: null,
            ra: panel.ra,
            dec: panel.dec,
            projects: [project],
            panelOf: subjectName(catalog, subject),
            gaps: progress.filter((g) => g.goal.subjectId === subject.id && g.goal.panelId === panel.id),
            favourite: false,
          })
        }
        continue
      }
      const existing = seen.get(subject.targetId)
      if (existing) {
        existing.projects.push(project)
        continue
      }
      const row: PlanRow = {
        key: subject.targetId,
        name: target?.name ?? "Unknown Target",
        targetId: subject.targetId,
        ra: target?.ra ?? null,
        dec: target?.dec ?? null,
        projects: [project],
        panelOf: null,
        gaps: progress.filter((g) => g.goal.subjectId === subject.id),
        favourite: target?.favourite ?? false,
      }
      seen.set(subject.targetId, row)
      rows.push(row)
    }
  }
  if (!scope) {
    for (const { target } of myTargets(catalog)) {
      if (!target.favourite || seen.has(target.id)) continue
      rows.push({ key: target.id, name: target.name, targetId: target.id, ra: target.ra, dec: target.dec, projects: [], panelOf: null, gaps: [], favourite: true })
    }
  }
  return rows
}

export function PlanPage() {
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const sites = useStore((s) => s.catalog.sites)
  const planningSiteId = useStore((s) => s.settings.planningSiteId ?? s.settings.defaultSiteId)
  const ctx = useSkyContext()
  const [siteError, setSiteError] = useState<{ message: string; retry: () => void } | null>(null)
  const scope = search.project ? catalog.projects[search.project] : undefined
  const rows = useMemo(() => planRows(catalog, scope), [catalog, scope])
  const skies = useMemo(() => new Map<string, RowSky>(rows.map((r) => [r.key, positionSky(ctx, r.key, r.ra, r.dec)])), [rows, ctx])

  function chooseSite(siteId: string) {
    const attempt = () => {
      const site = sites[siteId]
      const result = save(
        { label: "Planning site", saved: `Planning site: ${site?.name ?? siteId}`, detail: "Projects, runs and session sites are unchanged.", href: "/plan" },
        (s) => ({ ...s, settings: { ...s.settings, planningSiteId: siteId } }),
      )
      setSiteError(result.ok ? null : { message: result.message, retry: attempt })
    }
    attempt()
  }

  const header = (
    <PageHeader
      title={scope ? `Plan: ${scope.name}` : "Plan"}
      description={scope ? "Tonight for this Project's subjects and their goal gaps." : "Tonight at the planning site: the best window per open-Project subject and ★ favourite."}
      actions={
        ctx && Object.keys(sites).length > 1 ? (
          <Select items={Object.values(sites).map((s) => ({ value: s.id, label: s.name }))} value={planningSiteId ?? undefined} onValueChange={(value) => chooseSite(value as string)}>
            <SelectTrigger size="sm" aria-label="Planning site" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(sites).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null
      }
    />
  )

  if (!ctx) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <PageBody>
          <EmptyState
            icon={CalendarClock}
            titleAs="h2"
            title="Add an observing site in Settings"
            description="Tonight's windows, the Moon and darkness are computed for a planning site. Targets, sessions and Projects work without one."
            action={<AddSiteButton returnTo={scope ? `/plan?project=${scope.id}` : "/plan"} />}
          />
        </PageBody>
      </div>
    )
  }

  const { site, tonight, grid, criteria } = ctx
  const withWindow = rows.filter((r) => {
    const sky = skies.get(r.key)!
    return sky.status === "ok" && sky.best !== null
  })
  const without = rows.filter((r) => !withWindow.includes(r))
  const timelineRows: TimelineRow[] = rows.map((r) => {
    const sky = skies.get(r.key)!
    return {
      key: r.key,
      name: r.panelOf ? `${r.panelOf} ${r.name}` : r.name,
      indent: r.panelOf !== null,
      label: r.targetId && !r.panelOf ? (
        <Link to="/targets/$targetId" params={{ targetId: r.targetId }} className="truncate hover:underline">
          {r.name}
        </Link>
      ) : (
        <span className="truncate">{r.name}</span>
      ),
      altitudes: sky.status === "ok" ? sky.altitudes : null,
      windows: sky.status === "ok" ? sky.windows : [],
      note: sky.status === "no-coordinates" ? sky.reason : undefined,
    }
  })

  const reason = (sky: RowSky): string => (sky.status === "no-coordinates" ? sky.reason : sky.status === "ok" ? (sky.zeroReason ?? "No window tonight") : "No site")
  const nameCell = (r: PlanRow): ReactNode => (
    <span className={cn("flex min-w-0 items-center gap-1.5", r.panelOf && "pl-4")}>
      {r.targetId && !r.panelOf ? (
        <Link to="/targets/$targetId" params={{ targetId: r.targetId }} className="font-medium hover:underline">
          {r.name}
        </Link>
      ) : (
        <span className={cn(r.panelOf ? "text-muted-foreground" : "font-medium")}>
          {r.panelOf ? <span className="sr-only">{r.panelOf} </span> : null}
          {r.name}
        </span>
      )}
      {r.favourite ? <span className="text-xs text-muted-foreground" aria-label="favourite">★</span> : null}
      {!scope && !r.panelOf ? r.projects.map((p) => <ProjectBadge key={p.id} project={p} />) : null}
    </span>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <PageBody>
        {siteError ? <ActionError message={siteError.message} onRetry={siteError.retry} /> : null}
        {search.project && !scope ? (
          <Notice tone="warning" title="That Project no longer exists" actions={<Button size="sm" variant="outline" onClick={() => navigate({ to: "/plan" })}>Show every subject</Button>}>
            Showing every open-Project subject and favourite instead.
          </Notice>
        ) : null}
        {scope ? (
          <Notice
            tone="info"
            title={`Scoped to ${scope.name}: ${plural(scope.subjects.length, "subject")}`}
            actions={
              <>
                <Button size="sm" variant="outline" onClick={() => navigate({ to: "/plan" })}>
                  <X aria-hidden="true" data-icon="inline-start" />
                  Clear scope
                </Button>
                <Button size="sm" variant="outline" render={<Link to="/targets" search={{ project: scope.id }} />}>
                  Open in Targets
                </Button>
                <Button size="sm" variant="outline" render={<Link to="/projects/$projectId" params={{ projectId: scope.id }} />}>
                  Open {scope.name}
                </Button>
              </>
            }
          >
            Each subject shows the goals it still misses, in project and captured.
          </Notice>
        ) : null}

        <Section id="plan-tonight" title={`Tonight · ${site.name}`} description={`Night of ${formatNight(grid.night, true)}. Times in ${site.timeZone}. Criteria: ${criteriaSummary(criteria)}.`}>
          <KeyValueList
            columns={2}
            items={[
              { label: "Site", value: `${site.name} · ${site.latitude.toFixed(2)}°, ${site.longitude.toFixed(2)}°`, source: site.timeZone },
              { label: "Darkness", value: tonight.darkness ? siteTimeRange(tonight.darkness.start, tonight.darkness.end, site) : `None: the Sun stays above ${grid.sunLimit}°`, source: site.twilight === "astronomical" ? "Astronomical" : "Nautical" },
              { label: "Moon", value: `${tonight.moon.illuminationPct}% illuminated · ${tonight.moon.phase}` },
              { label: "Moonrise / set", value: `${tonight.moon.rise ? siteTime(tonight.moon.rise, site) : "No rise"} / ${tonight.moon.set ? siteTime(tonight.moon.set, site) : "No set"}` },
            ]}
          />
        </Section>

        <Section id="plan-windows" title="Best windows tonight" description="One row per subject and favourite with a window tonight; a mosaic uses its centre and lists its panels.">
          {withWindow.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing has a window tonight under these criteria.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <caption className="sr-only">Best window per subject tonight</caption>
                <thead className="bg-[color-mix(in_oklch,var(--chrome)_70%,var(--background))] text-[0.6875rem] text-muted-foreground">
                  <tr className="border-b">
                    <th scope="col" className="h-(--row-h) px-3 text-left font-medium">Subject</th>
                    <th scope="col" className="px-3 text-left font-medium">Best window</th>
                    <th scope="col" className="px-3 text-right font-medium">Peak</th>
                    <th scope="col" className="px-3 text-right font-medium">Img time</th>
                    <th scope="col" className="px-3 text-right font-medium">Moon</th>
                    {scope ? <th scope="col" className="px-3 text-left font-medium">Goal gaps</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {withWindow.map((r) => {
                    const sky = skies.get(r.key) as Extract<RowSky, { status: "ok" }>
                    return (
                      <tr key={r.key} className="h-(--row-h) border-b border-border/50 align-top last:border-0 even:bg-foreground/[0.022]">
                        <th scope="row" className="px-3 py-1 text-left font-normal whitespace-nowrap">
                          {nameCell(r)}
                        </th>
                        <td className="px-3 py-1 whitespace-nowrap tabular-nums">{siteTimeRange(sky.best!.start, sky.best!.end, site)}</td>
                        <td className="px-3 py-1 text-right tabular-nums">{Math.round(sky.best!.maxAltitudeDeg)}°</td>
                        <td className="px-3 py-1 text-right tabular-nums">{formatHours(sky.imgTimeS)}</td>
                        <td className="px-3 py-1 text-right tabular-nums">
                          {Math.round(sky.best!.moonSeparationDeg)}° {sky.moonUp ? <span className="text-xs text-muted-foreground">up</span> : <span className="text-xs text-muted-foreground">down</span>}
                        </td>
                        {scope ? (
                          <td className="px-3 py-1 text-xs">
                            {r.gaps.length === 0 ? <span className="text-muted-foreground">No unmet goals</span> : r.gaps.map((g) => <div key={g.goal.id} className="whitespace-nowrap tabular-nums">{g.line}</div>)}
                          </td>
                        ) : null}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {without.length > 0 ? (
            <div className="space-y-1">
              <h3 className="text-[0.75rem] font-medium text-muted-foreground">No window tonight</h3>
              <ul className="space-y-0.5 text-sm">
                {without.map((r) => (
                  <li key={r.key} className="flex flex-wrap items-baseline gap-x-2">
                    {nameCell(r)}
                    <span className="text-xs text-muted-foreground">{reason(skies.get(r.key)!)}</span>
                    {scope && r.gaps.length > 0 ? <span className="text-xs">{r.gaps.map((g) => g.line).join("; ")}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>

        <Section id="plan-timeline" title="Night timeline" description="Sunset to sunrise. The curve is altitude; filled blocks are windows that meet every criterion.">
          {rows.length === 0 ? (
            <EmptyState icon={CalendarClock} title="Nothing to plan yet" description="★ a Target or add a subject to an open Project and it appears here." action={<Button size="sm" render={<Link to="/targets" search={{ mode: "browse", cat: "Messier" }} />}>Browse catalogues</Button>} />
          ) : (
            <NightTimeline grid={grid} rows={timelineRows} minAltitudeDeg={criteria.minAltitudeDeg} nowMs={ctx.nowMs} moonIlluminationPct={tonight.moon.illuminationPct} caption={`Night timeline at ${site.name}`} />
          )}
        </Section>
      </PageBody>
    </div>
  )
}
