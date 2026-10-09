/**
 * S10 Target detail (`/targets/$targetId`, slice E): v4's finder list beside
 * the Target. The detail holds identity (aliases, type, coordinates, angular
 * size), tonight's planning window at the planning site with a one-row night
 * timeline, Fit on every rig, the Projects that use it with their goal lines,
 * and captured time per channel with its sessions. New Project opens S4 with
 * this Target as the subject; Add to Project previews the change first.
 */
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { ChevronDown, Search, Star } from "lucide-react"
import { useMemo, useState } from "react"
import { MissingRecord } from "@/app/missing-record"
import { openSheet } from "@/app/ui-state"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { KeyValueList } from "@/components/app/data"
import { ActionError, EmptyState, UnknownValue } from "@/components/app/feedback"
import { ListDetail, PageBody, PageHeader, Section } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { formatHours, goalProgress, liveLightSessions, projectStatus, rigFieldOfView, rigName, sessionRigId, sessionTargetId, subjectName } from "@/domain/derive"
import { goalTemplate } from "@/store/actions/projects"
import { addSubject } from "@/store/actions/projects"
import type { Project } from "@/domain/types"
import { formatDec, formatDegrees, formatNight, formatRa, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { SearchParams } from "@/routes"
import { setFavourite } from "@/store/actions/library"
import { useStore } from "@/store/core"
import { matchesQuery } from "./catalogues"
import { NightTimeline } from "./night-timeline"
import { AddSiteButton, BandStrip, CapturedCell, FitCell, MoonLine, SiteLine, siteTimeRange, useSkyContext } from "./parts"
import { allRows, rowView, sessionCountsByTarget, type TargetRow } from "./targets-model"
import { keepSearch } from "./targets"

const COORDINATE_SOURCE: Record<string, string> = { catalog: "Bundled catalogue", user: "Entered by you", resolver: "Online resolver", unknown: "Unknown" }

/** v4's finder: My targets (or the search), one dense row each, beside the detail. */
function TargetFinder({ activeId }: { activeId: string }) {
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const rows = useMemo(() => allRows(catalog).filter((r) => r.target), [catalog])
  // Local while typing; the URL keeps it for the way back to the table.
  const [query, setQuery] = useState(search.q ?? "")
  const shown = (query ? rows.filter((r) => matchesQuery([r.designation, ...r.aliases], query)) : rows.filter((r) => r.mine)).sort((a, b) => a.designation.localeCompare(b.designation, "en-GB", { numeric: true }))
  const keep = keepSearch(search)

  return (
    <div className="flex min-h-full flex-col" data-chrome>
      <div className="sticky top-0 z-10 space-y-1.5 border-b border-separator bg-background px-2 py-2">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Find a Target"
            placeholder="Name or alias"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              navigate({ to: "/targets/$targetId", params: { targetId: activeId }, search: { ...keep, q: event.target.value || undefined }, replace: true } as never)
            }}
            data-page-search
            className="pl-7"
          />
        </div>
        <p className="text-[0.6875rem] text-muted-foreground tabular-nums">{query ? plural(shown.length, "matching Target") : `My targets · ${shown.length}`}</p>
      </div>
      <ul
        aria-label="Targets"
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
            <li key={r.key}>
              <Link
                data-finder-row
                to="/targets/$targetId"
                params={{ targetId: r.target!.id }}
                search={keep}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "mx-1 flex h-(--row-h) items-center gap-1.5 rounded-[0.3125rem] px-2 text-sm hover:bg-foreground/[0.06]",
                  active && "bg-selected text-selected-foreground hover:bg-selected [&_.text-muted-foreground]:text-selected-foreground/85 [&_svg]:text-selected-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{r.designation}</span>
                  {r.aliases[0] ? <span className="ml-1 text-xs text-muted-foreground">{r.aliases[0]}</span> : null}
                </span>
                {r.target!.favourite ? (
                  <>
                    <Star aria-hidden="true" className="size-3 shrink-0 fill-current text-muted-foreground" />
                    <span className="sr-only">, favourite</span>
                  </>
                ) : null}
                {r.projects.length > 0 ? <span className="shrink-0 text-xs text-muted-foreground">{plural(r.projects.length, "Project")}</span> : null}
              </Link>
            </li>
          )
        })}
      </ul>
      <div className="mt-auto border-t border-separator px-3 py-2">
        <Link to="/targets" search={keep} className="text-xs text-link hover:underline">
          Back to the Targets table
        </Link>
      </div>
    </div>
  )
}

export function TargetPage() {
  const { targetId = "" } = useParams({ strict: false }) as { targetId?: string }
  const exists = useStore((s) => Boolean(s.catalog.targets[targetId]))
  if (!exists) return <MissingRecord noun="Target" backTo="/targets" backLabel="Open Targets" />
  return (
    <ListDetail listLabel="Target finder" list={<TargetFinder activeId={targetId} />} detail={<TargetDetail key={targetId} targetId={targetId} />} className="grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]" />
  )
}

function TargetDetail({ targetId }: { targetId: string }) {
  const search = useSearch({ strict: false }) as SearchParams
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const ctx = useSkyContext()
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null)
  const [adding, setAdding] = useState<Project | null>(null)
  const target = catalog.targets[targetId]!
  const row = useMemo(() => allRows(catalog).find((r) => r.key === targetId) as TargetRow, [catalog, targetId])
  const rigIds = Object.keys(catalog.opticalTrains)
  const view = useMemo(() => rowView(catalog, disk, ctx, row, rigIds, sessionCountsByTarget(catalog)), [catalog, disk, ctx, row])
  const projects = Object.values(catalog.projects).filter((p) => p.subjects.some((s) => s.targetId === targetId))
  const openWithout = Object.values(catalog.projects).filter((p) => p.state === "open" && !p.subjects.some((s) => s.targetId === targetId))
  const sessions = liveLightSessions(catalog)
    .filter((s) => sessionTargetId(s) === targetId)
    .sort((a, b) => b.night.localeCompare(a.night))

  function star() {
    const attempt = () => {
      const result = setFavourite(targetId, !target.favourite)
      setError(result.ok ? null : { message: result.message, retry: attempt })
    }
    attempt()
  }

  const sky = view.sky
  const addingTemplate = adding ? goalTemplate(adding.goalTemplateId) : undefined

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title={target.name}
        eyebrow={
          <Link to="/targets" search={keepSearch(search)}>
            Targets
          </Link>
        }
        description={[row.aliases.slice(0, 3).join(" · "), row.objectType].filter(Boolean).join(" — ") || undefined}
        meta={
          <Button size="xs" variant="ghost" aria-pressed={target.favourite} onClick={star}>
            <Star aria-hidden="true" data-icon="inline-start" className={cn(target.favourite && "fill-warning text-warning")} />
            {target.favourite ? "Favourite" : "Add ★"}
          </Button>
        }
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" disabled={openWithout.length === 0} title={openWithout.length === 0 ? "Every open Project already has this Target as a subject" : undefined} />}>
                Add to Project
                <ChevronDown aria-hidden="true" data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Open Projects</DropdownMenuLabel>
                  {openWithout.map((p) => (
                    <DropdownMenuItem key={p.id} onClick={() => setAdding(p)}>
                      {p.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => openSheet({ kind: "new-project", targetId })}>New Project…</Button>
          </>
        }
      />
      <PageBody>
        {error ? <ActionError message={error.message} onRetry={error.retry} /> : null}

        <Section id="tgt-tonight" title="Planning window tonight" description="Astronomical suitability only: altitude, darkness and the Moon at the planning site." actions={ctx ? <Button size="sm" variant="outline" render={<Link to="/plan" />}>Open Plan</Button> : null}>
          {!ctx ? (
            <EmptyState icon={Search} title="No observing site" description="Tonight's window needs a planning site." action={<AddSiteButton returnTo={`/targets/${targetId}`} />} />
          ) : sky.status === "no-coordinates" ? (
            <p className="text-sm text-muted-foreground">{sky.reason}</p>
          ) : sky.status === "ok" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <SiteLine site={ctx.site} />
                <MoonLine ctx={ctx} />
              </div>
              <KeyValueList
                columns={2}
                items={[
                  { label: "Best window", value: sky.best ? `${siteTimeRange(sky.best.start, sky.best.end, ctx.site)}, peak ${Math.round(sky.best.maxAltitudeDeg)}°` : (sky.zeroReason ?? "No window tonight") },
                  { label: "Img time", value: sky.imgTimeS > 0 ? formatHours(sky.imgTimeS) : `0h — ${sky.zeroReason}` },
                  { label: "Max alt", value: sky.peakDeg === null ? <UnknownValue label="–" reason="No darkness tonight" /> : `${Math.round(sky.peakDeg)}° in darkness` },
                  { label: "Lunar", value: `${Math.round(sky.lunarDeg)}° from the Moon` },
                  { label: "Filters", value: <BandStrip cells={view.strip.cells} recommendation={view.strip.recommendation} /> },
                  { label: "Opposition", value: view.opposition ? formatNight(view.opposition, true) : "–" },
                ]}
              />
              <NightTimeline
                grid={ctx.grid}
                caption={`${target.name} tonight at ${ctx.site.name}`}
                minAltitudeDeg={ctx.criteria.minAltitudeDeg}
                nowMs={ctx.nowMs}
                moonIlluminationPct={ctx.tonight.moon.illuminationPct}
                rows={[{ key: target.id, name: target.name, label: <span className="truncate font-medium">{target.name}</span>, altitudes: sky.altitudes, windows: sky.windows }]}
              />
            </div>
          ) : null}
        </Section>

        <Section id="tgt-identity" title="Identity">
          <KeyValueList
            columns={2}
            items={[
              { label: "Designation", value: target.name },
              { label: "Aliases", value: row.aliases.length > 0 ? row.aliases.join(", ") : <UnknownValue label="None recorded" /> },
              { label: "Type", value: row.objectType ?? <UnknownValue reason="Not in a bundled catalogue and not resolved online" />, source: row.entry ? "Bundled catalogue" : target.resolver ? target.resolver.provider : undefined },
              { label: "Catalogues", value: row.entry ? row.entry.catalogues.join(", ") : "None of the bundled catalogues" },
              {
                label: "Coordinates",
                value: target.ra !== null && target.dec !== null ? `${formatRa(target.ra)} ${formatDec(target.dec)}` : <UnknownValue reason="No catalogued coordinates, so visibility can't be computed" />,
                source: COORDINATE_SOURCE[target.coordinateSource],
              },
              { label: "Angular size", value: row.sizeDeg ? `${formatDegrees(row.sizeDeg.width, 2)} × ${formatDegrees(row.sizeDeg.height, 2)}` : <UnknownValue reason="Size unknown, so Fit reads –" /> },
            ]}
          />
        </Section>

        <Section id="tgt-fit" title="Fit on your rigs" description="The Target's major axis against the shorter side of each rig's field of view (D-W61).">
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <caption className="sr-only">Fit per rig</caption>
              <thead className="text-[0.6875rem] text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className="h-(--row-h) px-3 text-left font-medium">Rig</th>
                  <th scope="col" className="px-3 text-left font-medium">Field of view</th>
                  <th scope="col" className="px-3 text-left font-medium">Fit</th>
                </tr>
              </thead>
              <tbody>
                {view.fits.map((f) => {
                  const rig = catalog.opticalTrains[f.rigId]!
                  const fov = rigFieldOfView(catalog, rig)
                  return (
                    <tr key={f.rigId} className="h-(--row-h) border-b border-border/50 last:border-0">
                      <th scope="row" className="px-3 text-left font-normal">
                        <Link to="/settings/equipment" search={{ rig: f.rigId }} className="hover:underline">
                          {f.rigName}
                        </Link>
                      </th>
                      <td className="px-3 tabular-nums">{fov ? `${formatDegrees(fov.widthDeg, 2)} × ${formatDegrees(fov.heightDeg, 2)}` : <UnknownValue reason="Camera or focal length unknown" />}</td>
                      <td className="px-3">
                        <FitCell fits={[f]} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="tgt-projects" title="Projects that use it" description="Each subject's goals per channel, in project and captured.">
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Project has this Target as a subject. Use New Project or Add to Project above.</p>
          ) : (
            <ul className="divide-y divide-separator rounded-md border">
              {projects.map((p) => {
                const subjects = p.subjects.filter((s) => s.targetId === targetId)
                const lines = goalProgress(catalog, p).filter((g) => subjects.some((s) => s.id === g.goal.subjectId))
                return (
                  <li key={p.id} className="space-y-1 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to="/projects/$projectId" params={{ projectId: p.id }} className="font-medium text-link hover:underline">
                        {p.name}
                      </Link>
                      <span className="text-xs text-muted-foreground">{projectStatus(p) === "open" ? "Open" : projectStatus(p) === "done" ? "Done" : "Archived"}</span>
                      {subjects.map((s) => (
                        <span key={s.id} className="text-xs text-muted-foreground">
                          {s.mosaic ? `${subjectName(catalog, s)} · ${plural(s.mosaic.panels.length, "panel")}` : "Target subject"}
                        </span>
                      ))}
                      {p.state === "open" ? (
                        <Link to="/targets" search={{ project: p.id }} className="ml-auto text-xs text-link hover:underline">
                          Open in Planner
                        </Link>
                      ) : null}
                    </div>
                    {lines.length > 0 ? (
                      <ul className="space-y-0.5 text-xs tabular-nums">
                        {lines.map((g) => (
                          <li key={g.goal.id} className={cn(g.met ? "text-muted-foreground" : "text-foreground")}>
                            {g.goal.panelId ? `Panel ${subjects.flatMap((s) => s.mosaic?.panels ?? []).find((x) => x.id === g.goal.panelId)?.n ?? "?"} · ` : ""}
                            {g.line}
                            {g.met ? " · met" : ""}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">No goals set for this subject.</p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <Section id="tgt-captured" title="Captured and sessions" description="Every light session confirmed as this Target, whatever its quality. Trashed sessions count toward neither.">
          <div className="text-sm">
            Captured: <CapturedCell captured={view.captured} />
          </div>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sessions yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <caption className="sr-only">Sessions of {target.name}</caption>
                <thead className="text-[0.6875rem] text-muted-foreground">
                  <tr className="border-b">
                    <th scope="col" className="h-(--row-h) px-3 text-left font-medium">Night</th>
                    <th scope="col" className="px-3 text-left font-medium">Channel</th>
                    <th scope="col" className="px-3 text-right font-medium">Frames</th>
                    <th scope="col" className="px-3 text-left font-medium">Rig</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} className="h-(--row-h) border-b border-border/50 last:border-0 even:bg-foreground/[0.022]">
                      <th scope="row" className="px-3 text-left font-normal">
                        <Link to="/sessions/$sessionId" params={{ sessionId: s.id }} className="text-link hover:underline">
                          {formatNight(s.night, true)}
                        </Link>
                      </th>
                      <td className="px-3">{s.channel ?? "No filter"}</td>
                      <td className="px-3 text-right tabular-nums">{s.assetIds.filter((id) => !catalog.assets[id]?.trashed).length}</td>
                      <td className="px-3">{rigName(catalog, sessionRigId(s))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </PageBody>

      <ConfirmDialog
        open={adding !== null}
        onOpenChange={(open) => !open && setAdding(null)}
        title={`Add ${target.name} to ${adding?.name ?? ""}?`}
        description="The Target becomes a subject of the Project. Its candidates are the sessions of this Target on the Project's rigs."
        changes={[
          `Adds ${target.name} as a subject of ${adding?.name ?? ""}`,
          addingTemplate ? `Copies the ${addingTemplate.name} goal values for it: ${addingTemplate.values.map((v) => `${v.channel} ${v.integrationS ? formatHours(v.integrationS) : `${v.frameCount} frames`}`).join(", ")}` : "Adds no goals: the Project has no goal template",
        ]}
        unchanged={["Runs and their sessions", "Other subjects and their goals", "Library quality and files"]}
        confirmLabel={`Add to ${adding?.name ?? "Project"}`}
        onConfirm={() => (adding ? addSubject(adding.id, { targetId, mosaic: null }, adding.revision) : undefined)}
      />
    </div>
  )
}
