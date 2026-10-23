/**
 * S10 Target (`/targets/$targetId`, slice E): one Target on a DetailPage.
 *
 * - Header: the path back to Targets (keeping its view and night), the
 *   Favourite toggle beside the title (pressed for a favourite), Add to
 *   Plan for the chosen night (the Targets page's `?night=`, else tonight),
 *   New Project… with this Target as the subject, and the Target menu: Add
 *   to or Remove from favourites, and Add to Project ▸ (each Project
 *   confirms what it adds).
 * - Sections: the chosen night at the planning site (altitude, best window,
 *   Img time, filter grades under the Moon curves, Moon and darkness), the
 *   identity, Fit on every rig, the Projects that use it with their goals
 *   and window, the library's integration per channel, and its sessions; a
 *   session with an issue offers Dismiss issue in its menu, then Restore
 *   issue once dismissed (F7, P-ISS1).
 */
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { MapPin, Star } from "lucide-react"
import { useMemo } from "react"
import { MissingRecord } from "@/app/missing-record"
import { useMessages } from "@/app/preferences"
import { ActionToggle } from "@/components/app/action-toggle"
import { ActionButton } from "@/components/app/actions"
import { BoxTable } from "@/components/app/box"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { rowIssues, withIssueItems } from "@/components/app/issue-actions"
import { KeyValueList } from "@/components/app/data"
import { EmptyState } from "@/components/app/feedback"
import { StatusBadge } from "@/components/app/status"
import { DuplicatesBadge } from "@/components/domain/duplicates-badge"
import { GradeBadges } from "@/components/domain/grade-badges"
import { AltitudeSpark, DarkLine, MoonLine } from "@/components/domain/sky-lines"
import { DetailPage, type DetailSection } from "@/components/templates/detail-page"
import { formatHours, liveLightSessions, rigFieldOfView, rigName, sessionCountsByTarget, sessionRigId, sessionTargetId, subjectProgress } from "@/domain/derive"
import { objectTypeRef } from "@/domain/labels"
import { captureSite, targetCoverage } from "@/domain/library"
import { nightPlan } from "@/domain/planning"
import { sessionDuplicateCopies } from "@/domain/storage"
import type { Catalog, Project, Session } from "@/domain/types"
import { formatDec, formatDegrees, formatNight, formatRa } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import type { SearchParams } from "@/routes"
import { useStore } from "@/store/core"
import { useIssues } from "@/store/issues"
import { addToProjectMenu, clockRange, criteriaText, favouriteAction, fitText, keepSearch, newProjectAction, planAction, planNight, useSkyContext } from "./parts"
import { allRows, imgTimeText, prioritiesByTarget, type RigFit, rowView, type TargetRow } from "./targets-model"

/** Integration as "2h 10m"; "–" for none. */
function hoursOrDash(seconds: number): string {
  return seconds > 0 ? formatHours(seconds) : "–"
}

function coordinateSource(m: Messages, source: string): string {
  return source === "catalog" ? m.target_source_catalogue() : source === "user" ? m.target_source_user() : source === "resolver" ? m.target_source_resolver() : m.status_unknown()
}

/** One Project that uses the Target: its subject's goals and window on the chosen night (C7). */
interface ProjectUse {
  project: Project
  met: number
  total: number
  window: string | null
}

function projectUses(m: Messages, catalog: Catalog, targetId: string, night: string): ProjectUse[] {
  return Object.values(catalog.projects).flatMap((project) =>
    subjectProgress(catalog, project, night)
      .filter((p) => p.subject.targetId === targetId)
      .map((p) => ({ project, met: p.goals.filter((g) => g.met).length, total: p.goals.length, window: p.window ? say(m, p.window.line) : null })),
  )
}

export function TargetPage() {
  const m = useMessages()
  const { targetId = "" } = useParams({ strict: false }) as { targetId?: string }
  const exists = useStore((s) => Boolean(s.catalog.targets[targetId]))
  if (!exists) return <MissingRecord title={m.target_missing_title()} backTo="/targets" backLabel={m.nav_targets()} />
  return <TargetDetail key={targetId} targetId={targetId} />
}

function TargetDetail({ targetId }: { targetId: string }) {
  const m = useMessages()
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const duplicates = useStore(sessionDuplicateCopies)
  const curves = useStore((s) => s.settings.moonAvoidance)
  const issueView = useIssues()
  const ctx = useSkyContext(search.night)
  const night = planNight(ctx)
  const target = catalog.targets[targetId]!
  const row = useMemo(() => allRows(catalog).find((r) => r.key === targetId) as TargetRow, [catalog, targetId])
  const rigIds = Object.keys(catalog.opticalTrains)
  const view = useMemo(
    () => rowView(catalog, disk, ctx, row, { rigIds, sessionCounts: sessionCountsByTarget(catalog), curves, priorities: prioritiesByTarget(catalog, night) }),
    [catalog, disk, ctx, row, curves, night],
  )
  const inPlan = nightPlan(catalog, night).some((t) => t.id === targetId)
  const uses = useMemo(() => projectUses(m, catalog, targetId, night), [m, catalog, targetId, night])
  const sessions = useMemo(
    () =>
      liveLightSessions(catalog)
        .filter((s) => sessionTargetId(s) === targetId)
        .sort((a, b) => b.night.localeCompare(a.night)),
    [catalog, targetId],
  )
  const coverage = useMemo(() => targetCoverage(disk, catalog, targetId).channels, [disk, catalog, targetId])

  const addSite: Action = { id: "add-site", label: m.tonight_add_site(), run: () => void navigate({ to: "/settings/sites", search: { return: `/targets/${targetId}` } } as never) }
  const sky = view.sky
  const tonight =
    !ctx ? (
      <EmptyState icon={MapPin} title={m.project_no_site()} action={<ActionButton action={addSite} />} />
    ) : sky.status !== "ok" ? (
      <EmptyState icon={MapPin} title={m.tonight_no_coordinates()} action={null} />
    ) : (
      <KeyValueList
        columns={2}
        items={[
          { label: m.tonight_altitude(), value: <AltitudeSpark night={ctx.grid} sky={sky} darkness={ctx.summary.darkness} minAltitudeDeg={ctx.criteria.minAltitudeDeg} timeZone={ctx.site.timeZone} /> },
          { label: m.tonight_best(), value: sky.best ? clockRange(sky.best.start, sky.best.end, ctx.site.timeZone) : m.target_best_none() },
          { label: m.tonight_img_time(), value: imgTimeText(sky) },
          { label: m.tonight_lunar(), value: `${Math.round(sky.lunarDeg)}°` },
          { label: m.domain_suitable_filters(), value: <GradeBadges grades={view.tonight} wrap /> },
          { label: m.tonight_opposition(), value: view.opposition ? formatNight(view.opposition, true) : "–" },
          {
            // The lines name themselves ("Dark …", "Moon …"), so the row's term is the night they describe.
            label: m.tonight_night(),
            value: (
              <>
                <DarkLine darkness={ctx.summary.darkness} timeZone={ctx.site.timeZone} /> <MoonLine moon={ctx.summary.moon} timeZone={ctx.site.timeZone} />
              </>
            ),
          },
          { label: m.plan_site(), value: `${ctx.site.name} · ${ctx.site.timeZone}` },
          { label: m.tonight_criteria(), value: criteriaText(m, ctx.criteria) },
        ]}
      />
    )

  const fitColumns: Column<RigFit>[] = [
    { id: "rig", header: m.targets_rig(), rowHeader: true, truncate: true, sortValue: (f) => say(m, f.rig), cell: (f) => say(m, f.rig) },
    {
      id: "field",
      header: m.target_field(),
      sortValue: (f) => {
        const fov = rigFieldOfView(catalog, catalog.opticalTrains[f.rigId]!)
        return fov ? fov.widthDeg * fov.heightDeg : null
      },
      cell: (f) => {
        const fov = rigFieldOfView(catalog, catalog.opticalTrains[f.rigId]!)
        return fov ? `${formatDegrees(fov.widthDeg, 2)} × ${formatDegrees(fov.heightDeg, 2)}` : "–"
      },
    },
    { id: "fit", header: m.targets_fit(), sortValue: (f) => (f.fit.kind === "unknown" ? null : say(m, f.fit.label)), cell: (f) => fitText(m, f.fit) },
  ]

  const projectColumns: Column<ProjectUse>[] = [
    { id: "project", header: m.nav_projects(), rowHeader: true, truncate: true, sortValue: (u) => u.project.name, cell: (u) => u.project.name },
    { id: "status", header: m.target_project_state(), sortValue: (u) => u.project.state, cell: (u) => <StatusBadge kind="project" value={u.project.state} /> },
    { id: "goals", header: m.plan_goals(), align: "right", sortValue: (u) => (u.total > 0 ? u.met / u.total : null), cell: (u) => (u.total > 0 ? m.projects_goals_met({ met: u.met, total: u.total }) : m.projects_no_goals()) },
    { id: "window", header: m.tonight_window(), sortValue: (u) => u.window, cell: (u) => u.window ?? "–" },
  ]

  type Coverage = (typeof coverage)[number]
  const coverageColumns: Column<Coverage>[] = [
    { id: "channel", header: m.target_channel(), rowHeader: true, sortValue: (c) => c.channel, cell: (c) => c.channel },
    { id: "usable", header: m.status_usable(), align: "right", sortValue: (c) => c.breakdown.usable.seconds, cell: (c) => hoursOrDash(c.breakdown.usable.seconds) },
    { id: "unreviewed", header: m.status_unreviewed(), align: "right", sortValue: (c) => c.breakdown.unreviewed.seconds, cell: (c) => hoursOrDash(c.breakdown.unreviewed.seconds) },
  ]

  const sessionColumns: Column<Session>[] = [
    {
      id: "night",
      header: m.tonight_night(),
      rowHeader: true,
      sortValue: (s) => s.night,
      // F5: the same duplicates badge as the session's row in Sessions.
      cell: (s) => {
        const copies = duplicates.get(s.id) ?? 0
        return copies > 0 ? (
          <>
            {formatNight(s.night, true)} <DuplicatesBadge count={copies} />
          </>
        ) : (
          formatNight(s.night, true)
        )
      },
    },
    { id: "channel", header: m.target_channel(), sortValue: (s) => s.channel, cell: (s) => s.channel ?? "–" },
    { id: "frames", header: m.target_frames(), align: "right", sortValue: (s) => frames(s), cell: (s) => frames(s) },
    { id: "rig", header: m.targets_rig(), truncate: true, sortValue: (s) => rigName(m, catalog, sessionRigId(s)), cell: (s) => rigName(m, catalog, sessionRigId(s)) },
    { id: "site", header: m.session_capture_site(), truncate: true, sortValue: (s) => captureSite(catalog, s)?.name ?? null, cell: (s) => captureSite(catalog, s)?.name ?? "–" },
  ]
  function frames(s: Session): number {
    return s.assetIds.filter((id) => !catalog.assets[id]?.trashed).length
  }

  const openProject = (p: Project) => void navigate({ to: "/projects/$projectId", params: { projectId: p.id } })
  const openSession = (s: Session) => void navigate({ to: "/sessions/$sessionId", params: { sessionId: s.id } })

  const sections: DetailSection[] = [
    {
      id: "tgt-tonight",
      title: ctx && ctx.grid.night !== ctx.tonight ? formatNight(ctx.grid.night, true) : m.target_tonight(),
      actions: ctx ? [{ id: "show-planned", label: m.targets_open_plan(), run: () => void navigate({ to: "/targets", search: { view: "planned", night: search.night } } as never) }] : [],
      content: tonight,
    },
    {
      id: "tgt-identity",
      title: m.target_identity(),
      content: (
        <KeyValueList
          columns={2}
          items={[
            { label: m.targets_designation(), value: target.name },
            { label: m.target_aliases(), value: row.aliases.length > 0 ? row.aliases.join(", ") : "–" },
            {
              label: m.targets_type(),
              value: row.objectType ? say(m, objectTypeRef(row.objectType)) : m.target_type_unresolved(),
              source: row.objectType ? (row.entry ? m.target_source_catalogue() : (target.resolver?.provider ?? undefined)) : undefined,
            },
            { label: m.targets_catalogues(), value: row.entry ? row.entry.catalogues.join(", ") : "–" },
            {
              label: m.target_coordinates(),
              value: target.ra !== null && target.dec !== null ? `${formatRa(target.ra)} ${formatDec(target.dec)}` : m.tonight_no_coordinates(),
              source: target.ra !== null ? coordinateSource(m, target.coordinateSource) : undefined,
            },
            { label: m.target_angular_size(), value: row.sizeDeg ? `${formatDegrees(row.sizeDeg.width, 2)} × ${formatDegrees(row.sizeDeg.height, 2)}` : m.target_size_unknown() },
          ]}
        />
      ),
    },
    {
      id: "tgt-fit",
      title: m.targets_fit_per_rig(),
      count: view.fits.length,
      flush: true,
      content: (
        <BoxTable
          label={m.targets_fit_per_rig()}
          rows={view.fits}
          columns={fitColumns}
          getRowId={(f) => f.rigId}
          rowLabel={(f) => say(m, f.rig)}
          rowActions={(f) => [{ id: "open-rig", label: m.target_open_equipment(), run: () => void navigate({ to: "/settings/equipment", search: { rig: f.rigId } } as never) }]}
          empty={<EmptyState icon={MapPin} title={m.equipment_no_rigs()} action={null} />}
        />
      ),
    },
    {
      id: "tgt-projects",
      title: m.nav_projects(),
      count: uses.length,
      flush: true,
      content: (
        <BoxTable
          label={m.nav_projects()}
          rows={uses}
          columns={projectColumns}
          getRowId={(u) => u.project.id}
          rowLabel={(u) => u.project.name}
          onRowClick={(u) => openProject(u.project)}
          rowActions={(u) => [
            { id: "open-project", label: m.target_open_project(), run: () => openProject(u.project) },
            ...(u.project.state === "open"
              ? [{ id: "open-planner", label: m.target_open_planner(), run: () => void navigate({ to: "/targets", search: { project: u.project.id, night: search.night } } as never) }]
              : []),
          ]}
          empty={<EmptyState icon={MapPin} title={m.sessions_no_project()} action={<ActionButton action={newProjectAction(m, targetId)} />} />}
        />
      ),
    },
    {
      id: "tgt-library",
      title: m.nav_library(),
      count: coverage.length,
      flush: true,
      content: (
        <BoxTable
          label={m.target_library_caption({ name: target.name })}
          rows={coverage}
          columns={coverageColumns}
          getRowId={(c) => c.channel}
          empty={<EmptyState icon={MapPin} title={m.target_library_empty()} action={null} />}
        />
      ),
    },
    {
      id: "tgt-sessions",
      title: m.nav_sessions(),
      count: sessions.length,
      flush: true,
      content: (
        <BoxTable
          label={m.common_sessions_of({ name: target.name })}
          rows={sessions}
          columns={sessionColumns}
          getRowId={(s) => s.id}
          rowLabel={(s) => formatNight(s.night, true)}
          onRowClick={openSession}
          rowActions={(s) => withIssueItems(m, [{ id: "open-session", label: m.project_open_session(), run: () => openSession(s) }], rowIssues(issueView, { kind: "session", id: s.id }))}
          empty={<EmptyState icon={MapPin} title={m.target_no_sessions()} action={null} />}
        />
      ),
    },
  ]

  const addTo = addToProjectMenu(m, catalog, target)
  const favourite = favouriteAction(m, row)
  const menu: MenuItem[] = [favourite, ...(addTo ? [addTo] : [])]
  return (
    <DetailPage
      path={[{ label: m.nav_targets(), link: { to: "/targets", search: keepSearch(search) as Record<string, string> } }]}
      title={target.name}
      status={<ActionToggle label={m.targets_favourite()} pressed={target.favourite} action={favourite} icon={Star} pressedIconClassName="fill-warning text-warning" />}
      actions={[newProjectAction(m, targetId), { ...planAction(m, row, night, inPlan), kind: "primary" }]}
      menu={{ label: m.target_menu(), items: menu }}
      sections={sections}
    />
  )
}
