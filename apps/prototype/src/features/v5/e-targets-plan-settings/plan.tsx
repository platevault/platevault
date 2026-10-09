/**
 * S11 Plan (`/plan`, slice E): tonight at the planning site on one compact
 * night timeline (D-W16, D-W63, PLAN-FR-02/09/10/11).
 *
 * - The list: the Plan list (`planList`; add from the search, remove with ×
 *   or right-click), else My targets while the Plan list is empty. "Show
 *   all" lists My targets with the Plan list. A mosaic uses its centre and
 *   lists its panels under it (D-W63).
 * - Each row: best window, Img time and Moon separation beside the night
 *   (altitude curve, windows); it expands to one sub-row per filter, graded
 *   good tonight, with that filter's Moon-clear windows. Moon limits edit
 *   the per-filter constraint behind the grades.
 * - `?project=` (opened from a Project) scopes the page to that Project's
 *   subjects and shows each one's unmet goals.
 * - With no site: "Add site".
 */
import { useNavigate, useSearch, Link } from "@tanstack/react-router"
import { CalendarClock, Plus, X } from "lucide-react"
import { useMemo, useState } from "react"
import { useMessages, usePreferences } from "@/app/preferences"
import { openSheet } from "@/app/ui-state"
import { Box } from "@/components/app/box"
import { ActionError, EmptyState } from "@/components/app/feedback"
import { PageHeader } from "@/components/app/page"
import { CountBadge, Pill } from "@/components/app/pill"
import type { MenuEntry } from "@/components/app/row-menu"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Toggle } from "@/components/ui/toggle"
import { formatHours, goalProgress, myTargets, panelLabel, planList, subjectCentre, subjectName, type GoalProgress } from "@/domain/derive"
import type { Catalog, Project, Subject, Target } from "@/domain/types"
import { save } from "@/features/t1/lib/writes"
import { m, msg, say } from "@/lib/i18n"
import { formatNight } from "@/lib/format"
import type { SearchParams } from "@/routes"
import { addToPlan, removeFromPlan } from "@/store/actions/planning"
import { type CommitResult, useStore } from "@/store/core"
import { filtersTonight, limitText } from "./good-tonight"
import { MoonLimitsButton } from "./moon-limits"
import { type NightColumn, type NightRow, NightTable } from "./night-timeline"
import { AddSiteButton, clockRange, criteriaText, MoonLine, SiteLine, siteTimeRange, useSkyContext } from "./parts"
import { PlanAddSearch } from "./plan-add"
import { positionSky, type RowSky, selectionBands, zeroReasonText } from "./targets-model"

/** One subject, panel or Target before tonight's values. */
interface Seed {
  key: string
  name: string
  /** What the label shows: the name, or "Panel 2" under its mosaic. */
  short: string
  targetId: string | null
  ra: number | null
  dec: number | null
  projects: Project[]
  panel: boolean
  gaps: GoalProgress[]
  favourite: boolean
}

interface PlanRow extends NightRow, Seed {
  planned: boolean
  sky: RowSky
}

/** A subject's rows: one, or a mosaic centre with its panels under it (D-W63). */
function subjectSeeds(catalog: Catalog, project: Project, subject: Subject, gaps: GoalProgress[], projects: Project[]): Seed[] {
  const target = catalog.targets[subject.targetId]
  if (!subject.mosaic) {
    const name = target?.name ?? m.plan_unknown_target()
    return [{ key: subject.targetId, name, short: name, targetId: subject.targetId, ra: target?.ra ?? null, dec: target?.dec ?? null, projects, panel: false, gaps: gaps.filter((g) => g.goal.subjectId === subject.id), favourite: target?.favourite ?? false }]
  }
  const centre = subjectCentre(catalog, subject)
  const name = subjectName(m, catalog, subject)
  return [
    { key: `${project.id}:${subject.id}`, name, short: name, targetId: subject.targetId, ra: centre?.ra ?? null, dec: centre?.dec ?? null, projects, panel: false, gaps: gaps.filter((g) => g.goal.subjectId === subject.id && g.goal.panelId === null), favourite: target?.favourite ?? false },
    ...subject.mosaic.panels.map((panel) => ({
      key: `${project.id}:${subject.id}:${panel.id}`,
      name: `${name} ${panelLabel(m, panel)}`,
      short: panelLabel(m, panel),
      targetId: null,
      ra: panel.ra,
      dec: panel.dec,
      projects,
      panel: true,
      gaps: gaps.filter((g) => g.goal.subjectId === subject.id && g.goal.panelId === panel.id),
      favourite: false,
    })),
  ]
}

/** The scoped Project's subjects, each with its unmet goals. */
function scopeGroups(catalog: Catalog, scope: Project): Seed[][] {
  const gaps = goalProgress(catalog, scope).filter((g) => !g.met)
  return scope.subjects.map((subject) => subjectSeeds(catalog, scope, subject, gaps, [scope]))
}

/** Targets as rows; one that is a mosaic subject of an open Project lists its panels. */
function targetGroups(catalog: Catalog, targets: Target[]): Seed[][] {
  const projectsOf = new Map(myTargets(catalog).map((m) => [m.target.id, m.projects]))
  return targets.map((target) => {
    const projects = projectsOf.get(target.id) ?? []
    for (const project of projects) {
      const mosaic = project.subjects.find((s) => s.targetId === target.id && s.mosaic)
      if (mosaic) return subjectSeeds(catalog, project, mosaic, [], projects)
    }
    return [{ key: target.id, name: target.name, short: target.name, targetId: target.id, ra: target.ra, dec: target.dec, projects, panel: false, gaps: [], favourite: target.favourite }]
  })
}

type ListMode = "plan" | "all" | "fallback" | "scope"

export function PlanPage() {
  const m = useMessages()
  const { locale } = usePreferences()
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const constraints = useStore((s) => s.settings.moonConstraints)
  const sites = useStore((s) => s.catalog.sites)
  const planningSiteId = useStore((s) => s.settings.planningSiteId ?? s.settings.defaultSiteId)
  const ctx = useSkyContext()
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const scope = search.project ? catalog.projects[search.project] : undefined
  const showAll = search.all === "1"

  const plan = useMemo(() => planList(catalog), [catalog])
  const planned = useMemo(() => new Set(plan.map((t) => t.id)), [plan])
  const mode: ListMode = scope ? "scope" : plan.length === 0 ? "fallback" : showAll ? "all" : "plan"
  const bands = useMemo(() => selectionBands(catalog, Object.keys(catalog.opticalTrains)), [catalog])

  const rows = useMemo((): PlanRow[] => {
    let groups: Seed[][]
    if (scope) groups = scopeGroups(catalog, scope)
    else {
      const mine = myTargets(catalog).map((m) => m.target)
      const listed = mode === "plan" ? plan : [...plan, ...mine.filter((t) => !planned.has(t.id))]
      groups = targetGroups(catalog, listed)
    }
    const built = groups.map((group) =>
      group.map((seed): PlanRow => {
        const sky = positionSky(ctx, seed.key, seed.ra, seed.dec)
        return {
          ...seed,
          label: null,
          indent: seed.panel,
          altitudes: sky.status === "ok" ? sky.altitudes : null,
          windows: sky.status === "ok" ? sky.windows : [],
          note: sky.status === "no-coordinates" ? m.tonight_no_coordinates() : undefined,
          chips: sky.status === "ok" && ctx ? filtersTonight(ctx, { id: seed.key, ra: seed.ra, dec: seed.dec }, sky.altitudes, constraints, bands) : null,
          planned: seed.targetId !== null && !seed.panel && planned.has(seed.targetId),
          sky,
        }
      }),
    )
    // Groups with a window tonight first, by its start; the rest by name.
    const start = (r: PlanRow) => (r.sky.status === "ok" && r.sky.best ? Date.parse(r.sky.best.start) : Number.POSITIVE_INFINITY)
    return built.sort((a, b) => start(a[0]!) - start(b[0]!) || a[0]!.name.localeCompare(b[0]!.name, "en-GB", { numeric: true })).flat()
    // `locale`: the rows carry worded fallbacks ("Unknown Target", the no-coordinates note).
  }, [catalog, scope, mode, plan, planned, ctx, constraints, bands, locale])

  function act(run: () => CommitResult) {
    const result = run()
    setError(result.ok ? null : { message: result.message, retry: () => act(run) })
  }
  function chooseSite(siteId: string) {
    act(() => save({ label: msg("plan_site"), saved: msg("store_saved_planning_site", { name: sites[siteId]?.name ?? siteId }), href: "/plan" }, (s) => ({ ...s, settings: { ...s.settings, planningSiteId: siteId } })))
  }
  function setSearch(patch: SearchParams) {
    navigate({ to: "/plan", search: (previous: SearchParams) => {
      const next: SearchParams = { ...previous, ...patch }
      for (const key of Object.keys(next)) if (!next[key]) delete next[key]
      return next
    }, replace: true } as never)
  }
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const expandable = rows.filter((r) => r.chips !== null)
  const allOpen = expandable.length > 0 && expandable.every((r) => expanded.has(r.key))

  const header = (
    <PageHeader
      title={scope ? m.plan_title_scoped({ name: scope.name }) : m.nav_plan()}
      meta={ctx ? <Pill tone="muted">{formatNight(ctx.grid.night)}</Pill> : null}
      actions={
        ctx && Object.keys(sites).length > 1 ? (
          <Select items={Object.values(sites).map((s) => ({ value: s.id, label: s.name }))} value={planningSiteId ?? undefined} onValueChange={(value) => chooseSite(value as string)}>
            <SelectTrigger size="sm" aria-label={m.plan_site()} className="w-44">
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
        <div className="px-5 py-4">
          <EmptyState icon={CalendarClock} titleAs="h2" title={m.project_no_site()} description={null} action={<AddSiteButton returnTo={scope ? `/plan?project=${scope.id}` : "/plan"} />} />
        </div>
      </div>
    )
  }

  const { site, tonight, grid, criteria } = ctx
  const byKey = new Map(rows.map((r) => [r.key, r]))

  const columns: NightColumn<PlanRow>[] = [
    {
      id: "best",
      header: m.tonight_best(),
      width: "w-24",
      wide: true,
      cell: (r) => (r.sky.status === "ok" && r.sky.best ? clockRange(r.sky.best.start, r.sky.best.end, site) : "–"),
      filterCell: (_r, chip) => (chip.stretches[0] ? clockRange(chip.stretches[0].start, chip.stretches[0].end, site) : "–"),
    },
    {
      id: "img",
      header: m.tonight_img(),
      width: "w-12",
      align: "right",
      cell: (r) => {
        if (r.sky.status !== "ok") return "–"
        return r.sky.imgTimeS > 0 ? formatHours(r.sky.imgTimeS) : <span title={r.sky.zeroReason ? zeroReasonText(r.sky.zeroReason) : undefined}>{m.tonight_zero_hours()}</span>
      },
      filterCell: (_r, chip) => (chip.minutes > 0 ? formatHours(chip.minutes * 60) : "–"),
    },
    {
      id: "moon",
      header: m.tonight_moon(),
      width: "w-16",
      align: "right",
      cell: (r) => {
        if (r.sky.status !== "ok") return "–"
        const sep = Math.round(r.sky.best ? r.sky.best.moonSeparationDeg : r.sky.lunarDeg)
        return (
          <span title={r.sky.moonUp === null ? m.plan_moon_away({ separation: sep }) : r.sky.moonUp ? m.plan_moon_up_best({ separation: sep }) : m.plan_moon_down_best({ separation: sep })}>
            {sep}°{r.sky.moonUp ? <span className="ml-0.5 text-[0.625rem] text-muted-foreground">{m.plan_moon_up()}</span> : null}
          </span>
        )
      },
      filterCell: (_r, chip) => <span title={limitText(chip.limit)}>≥ {chip.limit.minSeparationDeg}°</span>,
    },
    ...(scope
      ? [
          {
            id: "goals",
            header: m.plan_goals(),
            width: "w-20",
            cell: (r: PlanRow) =>
              r.gaps.length === 0 ? (
                <Pill tone="success" className="h-4 px-1.5 text-[0.625rem]">
                  {m.status_met()}
                </Pill>
              ) : (
                <Pill tone="warning" title={r.gaps.map((g) => say(m, g.line)).join("\n")} className="h-4 px-1.5 text-[0.625rem]">
                  {m.plan_goals_short({ count: r.gaps.length })}
                </Pill>
              ),
          },
        ]
      : []),
  ]

  const label = (r: PlanRow) =>
    r.targetId && !r.panel ? (
      <>
        <Link to="/targets/$targetId" params={{ targetId: r.targetId }} className="truncate font-medium hover:underline">
          {r.name}
        </Link>
        {r.favourite ? (
          <span className="shrink-0 text-[0.625rem] text-muted-foreground" aria-label={m.plan_favourite()}>
            ★
          </span>
        ) : null}
      </>
    ) : (
      <span className="truncate text-muted-foreground">{r.short}</span>
    )
  const shown = rows.map((r) => ({ ...r, label: label(r) }))

  const menu = (key: string): MenuEntry[] => {
    const r = byKey.get(key)
    if (!r) return []
    const entries: MenuEntry[] = []
    if (r.targetId && !r.panel) entries.push({ label: m.verb_open(), onSelect: () => void navigate({ to: "/targets/$targetId", params: { targetId: r.targetId! } }) })
    if (r.chips) entries.push({ label: expanded.has(key) ? m.tonight_hide_filters() : m.tonight_show_filters(), onSelect: () => toggle(key) })
    if (r.targetId && !r.panel && !scope) entries.push(r.planned ? { label: m.targets_remove_from_plan(), onSelect: () => act(() => removeFromPlan(r.targetId!)) } : { label: m.targets_add_to_plan(), onSelect: () => act(() => addToPlan(r.targetId!)) })
    if (r.projects[0] || (r.targetId && !r.panel)) entries.push({ separator: true })
    if (r.projects[0]) entries.push({ label: m.target_open_project(), onSelect: () => void navigate({ to: "/projects/$projectId", params: { projectId: r.projects[0]!.id } }) })
    if (r.targetId && !r.panel) entries.push({ label: m.newproject_open(), onSelect: () => openSheet({ kind: "new-project", targetId: r.targetId! }) })
    return entries
  }

  const trailing = scope
    ? undefined
    : (r: PlanRow) =>
        !r.targetId || r.panel ? null : r.planned ? (
          <Button size="icon-xs" variant="ghost" aria-label={m.plan_remove_named({ name: r.name })} title={m.plan_remove()} onClick={() => act(() => removeFromPlan(r.targetId!))}>
            <X aria-hidden="true" />
          </Button>
        ) : (
          <Button size="icon-xs" variant="ghost" aria-label={m.plan_add_named({ name: r.name })} title={m.targets_add_to_plan()} onClick={() => act(() => addToPlan(r.targetId!))}>
            <Plus aria-hidden="true" />
          </Button>
        )

  const listTitle =
    mode === "scope" ? (
      scope!.name
    ) : mode === "plan" ? (
      <span className="inline-flex items-center gap-1.5">
        {m.plan_list()} <CountBadge count={plan.length} label={m.plan_targets_count({ count: plan.length })} />
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5">
        {mode === "fallback" ? m.project_search_my_targets() : m.plan_all_targets()} <CountBadge count={rows.filter((r) => !r.panel).length} label={m.plan_rows_count({ count: rows.filter((r) => !r.panel).length })} />
        {mode === "fallback" ? <Pill tone="muted" className="h-4 px-1.5 text-[0.625rem]">{m.plan_list_empty()}</Pill> : null}
      </span>
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div data-chrome className="flex flex-wrap items-center gap-2 border-b border-separator px-5 py-2">
        {scope ? (
          <span className="inline-flex items-center gap-1">
            <Pill tone="info" link={{ to: "/projects/$projectId", params: { projectId: scope.id } }}>
              {scope.name}
            </Pill>
            <Button size="icon-xs" variant="ghost" aria-label={m.plan_clear_scope_label()} title={m.plan_clear_scope()} onClick={() => setSearch({ project: undefined })}>
              <X aria-hidden="true" />
            </Button>
          </span>
        ) : (
          <>
            <Toggle variant="outline" size="sm" className="h-6" pressed={mode === "all" || mode === "fallback"} disabled={mode === "fallback"} title={mode === "fallback" ? m.plan_list_empty() : undefined} onPressedChange={(pressed) => setSearch({ all: pressed ? "1" : undefined })}>
              {m.plan_show_all()}
            </Toggle>
            <PlanAddSearch planned={planned} />
          </>
        )}
        <Toggle variant="outline" size="sm" className="h-6" pressed={allOpen} disabled={expandable.length === 0} onPressedChange={(pressed) => setExpanded(pressed ? new Set(expandable.map((r) => r.key)) : new Set())}>
          {m.plan_per_filter()}
        </Toggle>
        <MoonLimitsButton bands={bands} />
        <div className="flex-1" />
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
          <MoonLine ctx={ctx} />
          <span className="text-[0.75rem] text-muted-foreground tabular-nums">
            <span className="text-foreground">{m.plan_dark()}</span> {tonight.darkness ? siteTimeRange(tonight.darkness.start, tonight.darkness.end, site) : m.plan_dark_none()}
          </span>
          <SiteLine site={site} />
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-3">
        {error ? <ActionError message={error.message} onRetry={error.retry} /> : null}
        {search.project && !scope ? (
          <p className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{m.startrun_project_not_found()}</span>
            <Button size="xs" variant="outline" onClick={() => setSearch({ project: undefined })}>
              {m.plan_show_all()}
            </Button>
          </p>
        ) : null}
        {rows.length === 0 ? (
          <EmptyState icon={CalendarClock} title={m.plan_empty()} description={null} action={<Button size="sm" render={<Link to="/targets" search={{ mode: "browse", cat: "Messier" }} />}>{m.targets_browse_catalogues()}</Button>} />
        ) : (
          <Box title={listTitle} flush id="plan-list">
            <NightTable
              grid={grid}
              nowMs={ctx.nowMs}
              minAltitudeDeg={criteria.minAltitudeDeg}
              moonIlluminationPct={tonight.moon.illuminationPct}
              caption={m.plan_caption({ site: site.name })}
              labelHeader={m.tonight_target()}
              rows={shown}
              columns={columns}
              expanded={expanded}
              onToggle={toggle}
              trailing={trailing}
              menu={menu}
              note={[
                { label: m.tonight_night(), value: formatNight(grid.night, true) },
                { label: m.tonight_times(), value: site.timeZone },
                { label: m.tonight_criteria(), value: criteriaText(m, criteria) },
                { label: m.tonight_method(), value: m.tonight_method_value() },
              ]}
            />
          </Box>
        )}
      </div>
    </div>
  )
}
