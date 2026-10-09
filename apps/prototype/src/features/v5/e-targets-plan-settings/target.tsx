/**
 * S10 Target detail (`/targets/$targetId`, slice E): v4's finder list beside
 * the Target. The detail holds, in boxes: tonight at the planning site
 * (values and a one-row night timeline whose filter sub-rows are open),
 * identity, Fit on every rig, the Projects that use it with their goal
 * lines, and captured time per channel with its sessions. The header adds
 * it to the Plan list, adds it to an open Project (previewed first) or
 * opens New Project with this Target as the subject.
 */
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { ChevronDown, Star } from "lucide-react"
import { useMemo, useState } from "react"
import { MissingRecord } from "@/app/missing-record"
import { useMessages } from "@/app/preferences"
import { openSheet } from "@/app/ui-state"
import { Box } from "@/components/app/box"
import { ClearableInput } from "@/components/app/clearable-input"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { KeyValueList } from "@/components/app/data"
import { ActionError, UnknownValue } from "@/components/app/feedback"
import { ListDetail, PageBody, PageHeader } from "@/components/app/page"
import { CountBadge, Pill } from "@/components/app/pill"
import { ContextMenuArea, type MenuEntry, menuKey } from "@/components/app/row-menu"
import type { Tone } from "@/components/app/status"
import { HelpTip, NoteMarker } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { formatHours, goalProgress, liveLightSessions, planList, projectGoalSet, projectStatus, rigFieldOfView, sessionRigId, sessionTargetId, subjectName, rigName } from "@/domain/derive"
import { matchesQuery } from "@/domain/sky"
import type { Project } from "@/domain/types"
import { formatDec, formatDegrees, formatNight, formatRa } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { SearchParams } from "@/routes"
import { setFavourite } from "@/store/actions/library"
import { addToPlan, removeFromPlan } from "@/store/actions/planning"
import { addSubject } from "@/store/actions/projects"
import { type CommitResult, useStore } from "@/store/core"
import { limitText } from "./good-tonight"
import { type NightColumn, type NightRow, NightTable } from "./night-timeline"
import { AddSiteButton, clockRange, criteriaText, FitCell, MoonLine, SiteLine, useSkyContext } from "./parts"
import { allRows, rowView, sessionCountsByTarget, type TargetRow, zeroReasonText } from "./targets-model"
import { keepSearch } from "./targets"

function coordinateSource(m: Messages, source: string): string {
  return source === "catalog" ? m.target_source_catalogue() : source === "user" ? m.target_source_user() : source === "resolver" ? m.target_source_resolver() : m.status_unknown()
}

function statusPill(m: Messages, status: ReturnType<typeof projectStatus>): { tone: Tone; label: string } {
  if (status === "done") return { tone: "success", label: m.status_done() }
  if (status === "archived") return { tone: "muted", label: m.status_archived() }
  return { tone: "info", label: m.status_open() }
}

/** Runs a write and keeps its failure for Retry. */
function useWrite() {
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null)
  function run(action: () => CommitResult) {
    const result = action()
    setError(result.ok ? null : { message: result.message, retry: () => run(action) })
  }
  return { error, run }
}

/** v4's finder: My targets (or the search), one dense row each, beside the detail. */
function TargetFinder({ activeId }: { activeId: string }) {
  const m = useMessages()
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const { error, run } = useWrite()
  const rows = useMemo(() => allRows(catalog).filter((r) => r.target), [catalog])
  const planned = useMemo(() => new Set(planList(catalog).map((t) => t.id)), [catalog])
  // Local while typing; the URL keeps it for the way back to the table.
  const [query, setQuery] = useState(search.q ?? "")
  const shown = (query ? rows.filter((r) => matchesQuery([r.designation, ...r.aliases], query)) : rows.filter((r) => r.mine)).sort((a, b) => a.designation.localeCompare(b.designation, "en-GB", { numeric: true }))
  const keep = keepSearch(search)

  function menu(key: string): MenuEntry[] {
    const target = catalog.targets[key]
    if (!target) return []
    return [
      { label: m.verb_open(), onSelect: () => void navigate({ to: "/targets/$targetId", params: { targetId: key }, search: keep }) },
      { label: target.favourite ? m.targets_unstar() : m.targets_star(), onSelect: () => run(() => setFavourite(key, !target.favourite)) },
      planned.has(key) ? { label: m.targets_remove_from_plan(), onSelect: () => run(() => removeFromPlan(key)) } : { label: m.targets_add_to_plan(), onSelect: () => run(() => addToPlan(key)) },
      { separator: true },
      { label: m.newproject_open(), onSelect: () => openSheet({ kind: "new-project", targetId: key }) },
    ]
  }

  return (
    <div className="flex min-h-full flex-col" data-chrome>
      <div className="sticky top-0 z-10 space-y-1.5 border-b border-separator bg-background px-2 py-2">
        <ClearableInput
          search
          aria-label={m.target_find()}
          placeholder={m.target_find_placeholder()}
          value={query}
          onValueChange={(value) => {
            setQuery(value)
            navigate({ to: "/targets/$targetId", params: { targetId: activeId }, search: { ...keep, q: value || undefined }, replace: true } as never)
          }}
        />
        <p className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground tabular-nums">
          {query ? m.plan_matches() : m.project_search_my_targets()}
          <CountBadge count={shown.length} tone="muted" label={query ? m.target_matching_count({ count: shown.length }) : m.target_targets_count({ count: shown.length })} />
        </p>
        {error ? <ActionError message={error.message} onRetry={error.retry} /> : null}
      </div>
      <ContextMenuArea menu={menu}>
        <ul
          aria-label={m.nav_targets()}
          className="py-1"
          onKeyDown={(event) => {
            const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>("a[data-finder-row]"))
            const at = links.indexOf(document.activeElement as HTMLAnchorElement)
            const to = event.key === "ArrowDown" ? at + 1 : event.key === "ArrowUp" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? links.length - 1 : null
            if (to === null || at === -1) return
            event.preventDefault()
            links[Math.max(0, Math.min(links.length - 1, to))]?.focus()
          }}
        >
          {shown.map((r) => {
            const active = r.target!.id === activeId
            return (
              <li key={r.key} {...menuKey(r.target!.id)}>
                <Link
                  data-finder-row
                  to="/targets/$targetId"
                  params={{ targetId: r.target!.id }}
                  search={keep}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "mx-1 flex h-(--row-h) items-center gap-1.5 rounded-[0.3125rem] px-2 text-sm hover:bg-foreground/[0.06]",
                    active && "bg-selected text-selected-foreground hover:bg-selected [&_.text-muted-foreground]:text-selected-foreground [&_svg]:text-selected-foreground",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{r.designation}</span>
                    {r.aliases[0] ? <span className="ml-1 text-xs text-muted-foreground">{r.aliases[0]}</span> : null}
                  </span>
                  {r.target!.favourite ? (
                    <>
                      <Star aria-hidden="true" className="size-3 shrink-0 fill-current text-muted-foreground" />
                      <span className="sr-only">{m.target_favourite_sr()}</span>
                    </>
                  ) : null}
                  {r.projects.length > 0 ? <CountBadge count={r.projects.length} tone="muted" label={m.target_projects_count({ count: r.projects.length })} /> : null}
                </Link>
              </li>
            )
          })}
        </ul>
      </ContextMenuArea>
      <div className="mt-auto border-t border-separator px-3 py-2">
        <Link to="/targets" search={keep} className="text-xs text-link hover:underline">
          {m.target_table_link()}
        </Link>
      </div>
    </div>
  )
}

export function TargetPage() {
  const m = useMessages()
  const { targetId = "" } = useParams({ strict: false }) as { targetId?: string }
  const exists = useStore((s) => Boolean(s.catalog.targets[targetId]))
  if (!exists) return <MissingRecord noun="Target" backTo="/targets" backLabel={m.target_open_targets()} />
  return (
    <ListDetail listLabel={m.target_finder()} list={<TargetFinder activeId={targetId} />} detail={<TargetDetail key={targetId} targetId={targetId} />} className="grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]" />
  )
}

function TargetDetail({ targetId }: { targetId: string }) {
  const m = useMessages()
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const constraints = useStore((s) => s.settings.moonConstraints)
  const ctx = useSkyContext()
  const { error, run } = useWrite()
  const [adding, setAdding] = useState<Project | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([targetId]))
  const target = catalog.targets[targetId]!
  const row = useMemo(() => allRows(catalog).find((r) => r.key === targetId) as TargetRow, [catalog, targetId])
  const rigIds = Object.keys(catalog.opticalTrains)
  const view = useMemo(() => rowView(catalog, disk, ctx, row, rigIds, sessionCountsByTarget(catalog), constraints), [catalog, disk, ctx, row, constraints])
  const inPlan = catalog.plans[targetId]?.planned ?? false
  const projects = Object.values(catalog.projects).filter((p) => p.subjects.some((s) => s.targetId === targetId))
  const openWithout = Object.values(catalog.projects).filter((p) => p.state === "open" && !p.subjects.some((s) => s.targetId === targetId))
  const sessions = liveLightSessions(catalog)
    .filter((s) => sessionTargetId(s) === targetId)
    .sort((a, b) => b.night.localeCompare(a.night))

  const sky = view.sky
  const addingGoals = adding ? projectGoalSet(adding) : []

  const toggleFilters = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const tonightBox = (() => {
    if (!ctx)
      return (
        <div className="flex items-center gap-2 p-3 text-sm">
          <span className="text-muted-foreground">{m.project_no_site()}</span>
          <AddSiteButton returnTo={`/targets/${targetId}`} />
        </div>
      )
    if (sky.status !== "ok") return <p className="p-3 text-sm text-muted-foreground">{m.target_no_coordinates()}</p>
    const night: NightRow = { key: target.id, name: target.name, label: <span className="truncate font-medium">{target.name}</span>, altitudes: sky.altitudes, windows: sky.windows, chips: view.tonight }
    const columns: NightColumn<NightRow>[] = [
      {
        id: "best",
        header: m.tonight_best(),
        width: "w-24",
        wide: true,
        cell: () => (sky.best ? clockRange(sky.best.start, sky.best.end, ctx.site) : "–"),
        filterCell: (_r, chip) => (chip.stretches[0] ? clockRange(chip.stretches[0].start, chip.stretches[0].end, ctx.site) : "–"),
      },
      { id: "img", header: m.tonight_img(), width: "w-12", align: "right", cell: () => (sky.imgTimeS > 0 ? formatHours(sky.imgTimeS) : m.tonight_zero_hours()), filterCell: (_r, chip) => (chip.minutes > 0 ? formatHours(chip.minutes * 60) : "–") },
      { id: "moon", header: m.tonight_moon(), width: "w-16", align: "right", cell: () => `${Math.round(sky.best ? sky.best.moonSeparationDeg : sky.lunarDeg)}°`, filterCell: (_r, chip) => <span title={limitText(chip.limit)}>≥ {chip.limit.minSeparationDeg}°</span> },
    ]
    const zeroTitle = sky.zeroReason ? zeroReasonText(sky.zeroReason) : undefined
    const facts = [
      { label: m.tonight_best(), value: sky.best ? `${clockRange(sky.best.start, sky.best.end, ctx.site)} · ${Math.round(sky.best.maxAltitudeDeg)}°` : <span title={zeroTitle}>{m.target_best_none()}</span> },
      { label: m.tonight_img_time(), value: sky.imgTimeS > 0 ? formatHours(sky.imgTimeS) : <span title={zeroTitle}>{m.tonight_zero_hours()}</span> },
      { label: m.tonight_max_alt(), value: sky.peakDeg === null ? <UnknownValue label="–" reason={m.tonight_no_darkness()} /> : `${Math.round(sky.peakDeg)}°`.replace("-", "−") },
      { label: m.tonight_lunar(), value: `${Math.round(sky.lunarDeg)}°` },
      { label: m.tonight_opposition(), value: view.opposition ? formatNight(view.opposition, true) : "–" },
    ]
    return (
      <>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-border px-3 py-2">
          <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm tabular-nums">
            {facts.map((f) => (
              <div key={f.label} className="flex items-baseline gap-1.5">
                <dt className="text-xs text-muted-foreground">{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
          <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <MoonLine ctx={ctx} />
            <SiteLine site={ctx.site} />
          </span>
        </div>
        <NightTable
          grid={ctx.grid}
          nowMs={ctx.nowMs}
          minAltitudeDeg={ctx.criteria.minAltitudeDeg}
          moonIlluminationPct={ctx.tonight.moon.illuminationPct}
          caption={m.target_caption({ name: target.name, site: ctx.site.name })}
          labelHeader={m.tonight_target()}
          rows={[night]}
          columns={columns}
          expanded={expanded}
          onToggle={toggleFilters}
          menu={() => [
            { label: expanded.has(targetId) ? m.tonight_hide_filters() : m.tonight_show_filters(), onSelect: () => toggleFilters(targetId) },
            inPlan ? { label: m.targets_remove_from_plan(), onSelect: () => run(() => removeFromPlan(targetId)) } : { label: m.targets_add_to_plan(), onSelect: () => run(() => addToPlan(targetId)) },
            { label: m.targets_open_plan(), onSelect: () => void navigate({ to: "/plan" }) },
          ]}
          note={[
            { label: m.tonight_night(), value: formatNight(ctx.grid.night, true) },
            { label: m.tonight_times(), value: ctx.site.timeZone },
            { label: m.tonight_criteria(), value: criteriaText(m, ctx.criteria) },
            { label: m.tonight_method(), value: m.tonight_method_value() },
          ]}
        />
      </>
    )
  })()

  const projectMenu = (key: string): MenuEntry[] => {
    const p = catalog.projects[key]
    if (!p) return []
    return [
      { label: m.target_open_project(), onSelect: () => void navigate({ to: "/projects/$projectId", params: { projectId: p.id } }) },
      ...(p.state === "open" ? [{ label: m.target_open_planner(), onSelect: () => void navigate({ to: "/targets", search: { project: p.id } }) }, { label: m.target_plan_tonight(), onSelect: () => void navigate({ to: "/plan", search: { project: p.id } }) }] : []),
    ]
  }
  const sessionMenu = (key: string): MenuEntry[] => [{ label: m.project_open_session(), onSelect: () => void navigate({ to: "/sessions/$sessionId", params: { sessionId: key } }) }]
  const rigMenu = (key: string): MenuEntry[] => [{ label: m.target_open_equipment(), onSelect: () => void navigate({ to: "/settings/equipment", search: { rig: key } }) }]

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title={target.name}
        eyebrow={
          <Link to="/targets" search={keepSearch(search)}>
            {m.nav_targets()}
          </Link>
        }
        description={row.aliases.length > 0 ? row.aliases.slice(0, 3).join(" · ") : undefined}
        meta={
          <>
            {row.objectType ? <Pill tone="muted">{row.objectType}</Pill> : null}
            <Button size="xs" variant="ghost" aria-pressed={target.favourite} onClick={() => run(() => setFavourite(targetId, !target.favourite))}>
              <Star aria-hidden="true" data-icon="inline-start" className={cn(target.favourite && "fill-warning text-warning")} />
              {target.favourite ? m.targets_favourite() : m.targets_star()}
            </Button>
          </>
        }
        actions={
          <>
            <Button variant="outline" aria-pressed={inPlan} onClick={() => run(() => (inPlan ? removeFromPlan(targetId) : addToPlan(targetId)))}>
              {inPlan ? m.targets_remove_from_plan() : m.targets_add_to_plan()}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" disabled={openWithout.length === 0} title={openWithout.length === 0 ? m.target_in_every_project() : undefined} />}>
                {m.session_add_to_project()}
                <ChevronDown aria-hidden="true" data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{m.project_back_to_projects()}</DropdownMenuLabel>
                  {openWithout.map((p) => (
                    <DropdownMenuItem key={p.id} onClick={() => setAdding(p)}>
                      {p.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => openSheet({ kind: "new-project", targetId })}>{m.newproject_open()}</Button>
          </>
        }
      />
      <PageBody className="space-y-4">
        {error ? <ActionError message={error.message} onRetry={error.retry} /> : null}

        <Box
          id="tgt-tonight"
          title={m.target_tonight()}
          flush
          actions={
            ctx ? (
              <Button size="xs" variant="ghost" render={<Link to="/plan" />}>
                {m.targets_open_plan()}
              </Button>
            ) : null
          }
        >
          {tonightBox}
        </Box>

        <div className="grid gap-4 min-[90rem]:grid-cols-2">
          <Box id="tgt-identity" title={m.target_identity()}>
            <KeyValueList
              columns={2}
              items={[
                { label: m.targets_designation(), value: target.name },
                { label: m.target_aliases(), value: row.aliases.length > 0 ? row.aliases.join(", ") : "–" },
                {
                  label: m.targets_type(),
                  value: row.objectType ? (
                    <span className="inline-flex items-center gap-1">
                      {row.objectType}
                      <NoteMarker rows={[{ label: m.targets_source(), value: row.entry ? m.target_source_catalogue() : (target.resolver?.provider ?? m.status_unknown()) }]} />
                    </span>
                  ) : (
                    <UnknownValue label="–" reason={m.target_type_unresolved()} />
                  ),
                },
                {
                  label: m.targets_catalogues(),
                  value: row.entry ? (
                    <span className="flex flex-wrap gap-1">
                      {row.entry.catalogues.map((c) => (
                        <Pill key={c} tone="muted">
                          {c}
                        </Pill>
                      ))}
                    </span>
                  ) : (
                    "–"
                  ),
                },
                {
                  label: m.target_coordinates(),
                  value:
                    target.ra !== null && target.dec !== null ? (
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        {formatRa(target.ra)} {formatDec(target.dec)}
                        <NoteMarker rows={[{ label: m.targets_source(), value: coordinateSource(m, target.coordinateSource) }]} />
                      </span>
                    ) : (
                      <UnknownValue label="–" reason={m.tonight_no_coordinates()} />
                    ),
                },
                { label: m.target_angular_size(), value: row.sizeDeg ? `${formatDegrees(row.sizeDeg.width, 2)} × ${formatDegrees(row.sizeDeg.height, 2)}` : <UnknownValue label="–" reason={m.target_size_unknown()} /> },
              ]}
            />
          </Box>

          <Box
            id="tgt-fit"
            title={
              <span className="inline-flex items-center gap-1">
                {m.targets_fit()} <HelpTip label={m.target_about_fit()}>{m.target_fit_help()}</HelpTip>
              </span>
            }
            flush
          >
            <ContextMenuArea menu={rigMenu}>
              <table className="w-full text-sm">
                <caption className="sr-only">{m.targets_fit_per_rig()}</caption>
                <thead className="text-[0.6875rem] text-muted-foreground">
                  <tr className="border-b">
                    <th scope="col" className="h-(--row-h) px-3 text-left font-medium">
                      {m.targets_rig()}
                    </th>
                    <th scope="col" className="px-3 text-left font-medium">
                      {m.target_field()}
                    </th>
                    <th scope="col" className="px-3 text-left font-medium">
                      {m.targets_fit()}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.fits.map((f) => {
                    const rig = catalog.opticalTrains[f.rigId]!
                    const fov = rigFieldOfView(catalog, rig)
                    return (
                      <tr key={f.rigId} {...menuKey(f.rigId)} className="h-(--row-h) border-b border-border/50 last:border-0">
                        <th scope="row" className="px-3 text-left font-normal">
                          <Link to="/settings/equipment" search={{ rig: f.rigId }} className="hover:underline">
                            {f.rigName}
                          </Link>
                        </th>
                        <td className="px-3 tabular-nums">{fov ? `${formatDegrees(fov.widthDeg, 2)} × ${formatDegrees(fov.heightDeg, 2)}` : <UnknownValue label="–" reason={m.target_fov_unknown()} />}</td>
                        <td className="px-3">
                          <FitCell fits={[f]} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </ContextMenuArea>
          </Box>

          <Box id="tgt-projects" title={m.nav_projects()} flush>
            {projects.length === 0 ? (
              <div className="flex items-center gap-2 p-3 text-sm">
                <span className="text-muted-foreground">{m.sessions_no_project()}</span>
                <Button size="xs" variant="outline" onClick={() => openSheet({ kind: "new-project", targetId })}>
                  {m.newproject_open()}
                </Button>
              </div>
            ) : (
              <ContextMenuArea menu={projectMenu}>
                <ul className="divide-y divide-border">
                  {projects.map((p) => {
                    const subjects = p.subjects.filter((s) => s.targetId === targetId)
                    const lines = goalProgress(catalog, p).filter((g) => subjects.some((s) => s.id === g.goal.subjectId))
                    const status = statusPill(m, projectStatus(p))
                    return (
                      <li key={p.id} {...menuKey(p.id)} className="space-y-1 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link to="/projects/$projectId" params={{ projectId: p.id }} className="font-medium text-link hover:underline">
                            {p.name}
                          </Link>
                          <Pill tone={status.tone}>{status.label}</Pill>
                          {subjects
                            .filter((s) => s.mosaic)
                            .map((s) => (
                              <Pill key={s.id} tone="muted">
                                {m.target_mosaic_panels({ name: subjectName(catalog, s), count: s.mosaic!.panels.length })}
                              </Pill>
                            ))}
                          {p.state === "open" ? (
                            <Link to="/targets" search={{ project: p.id }} className="ml-auto text-xs text-link hover:underline">
                              {m.target_planner()}
                            </Link>
                          ) : null}
                        </div>
                        {lines.length > 0 ? (
                          <ul className="space-y-0.5 text-xs tabular-nums">
                            {lines.map((g) => (
                              <li key={g.goal.id} className={cn("flex flex-wrap items-center gap-1.5", g.met ? "text-muted-foreground" : "text-foreground")}>
                                {g.goal.panelId ? (
                                  <Pill tone="muted" className="h-4 px-1.5 text-[0.625rem]">
                                    {m.target_panel({ number: subjects.flatMap((s) => s.mosaic?.panels ?? []).find((x) => x.id === g.goal.panelId)?.n ?? "?" })}
                                  </Pill>
                                ) : null}
                                {g.line}
                                {g.met ? (
                                  <Pill tone="success" className="h-4 px-1.5 text-[0.625rem]">
                                    {m.status_met()}
                                  </Pill>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-muted-foreground">{m.projects_no_goals()}</p>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </ContextMenuArea>
            )}
          </Box>

          <Box id="tgt-captured" title={m.coverage_captured()} flush>
            <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
              {view.captured.length === 0 ? (
                <span className="text-sm text-muted-foreground">–</span>
              ) : (
                view.captured.map((c) => (
                  <Pill key={c.channel} tone="neutral">
                    {`${c.channel} ${formatHours(c.seconds)}`}
                  </Pill>
                ))
              )}
            </div>
            {sessions.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">{m.run_cal_no_sessions()}</p>
            ) : (
              <ContextMenuArea menu={sessionMenu}>
                <table className="w-full text-sm">
                  <caption className="sr-only">{m.target_sessions_caption({ name: target.name })}</caption>
                  <thead className="text-[0.6875rem] text-muted-foreground">
                    <tr className="border-b">
                      <th scope="col" className="h-(--row-h) px-3 text-left font-medium">
                        {m.tonight_night()}
                      </th>
                      <th scope="col" className="px-3 text-left font-medium">
                        {m.target_channel()}
                      </th>
                      <th scope="col" className="px-3 text-right font-medium">
                        {m.calibration_frames()}
                      </th>
                      <th scope="col" className="px-3 text-left font-medium">
                        {m.targets_rig()}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr key={s.id} {...menuKey(s.id)} className="h-(--row-h) border-b border-border/50 last:border-0 even:bg-foreground/[0.022]">
                        <th scope="row" className="px-3 text-left font-normal">
                          <Link to="/sessions/$sessionId" params={{ sessionId: s.id }} className="text-link hover:underline">
                            {formatNight(s.night, true)}
                          </Link>
                        </th>
                        <td className="px-3">{s.channel ?? "–"}</td>
                        <td className="px-3 text-right tabular-nums">{s.assetIds.filter((id) => !catalog.assets[id]?.trashed).length}</td>
                        <td className="px-3">{rigName(catalog, sessionRigId(s))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ContextMenuArea>
            )}
          </Box>
        </div>
      </PageBody>

      <ConfirmDialog
        open={adding !== null}
        onOpenChange={(open) => !open && setAdding(null)}
        title={m.target_add_to_title({ target: target.name, project: adding?.name ?? "" })}
        description={`${target.name} → ${adding?.name ?? ""}`}
        changes={[
          m.target_adds_subject({ name: target.name }),
          addingGoals.length > 0 ? m.target_copies_goals({ goals: addingGoals.map((v) => `${v.channel} ${v.integrationS ? formatHours(v.integrationS) : m.target_goal_frames({ count: v.frameCount ?? 0 })}`).join(", ") }) : m.target_no_goals_to_copy(),
        ]}
        confirmLabel={adding ? m.target_add_to_named({ name: adding.name }) : m.session_add_to_project()}
        onConfirm={() => (adding ? addSubject(adding.id, { targetId, mosaic: null }, adding.revision) : undefined)}
      />
    </div>
  )
}
