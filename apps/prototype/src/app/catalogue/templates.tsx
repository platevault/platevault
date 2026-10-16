/**
 * Catalogue entry (R9-COMPOSITION-PLAN §3.4, §8.3): the page templates
 * ListPage, DetailPage, StepPage and SettingsPage, and the parts they build
 * on: PageHeader (path, summary, notice), Box (count, BoxTable), DetailDock
 * and DetailPanel (spec 054), ViewTabs and ListSection.
 *
 * - Each template fills a frame the height of a short window, with the demo
 *   seed (Welcome › Load demo library). Here the templates title their page
 *   as h2, as a child area does, so the catalogue keeps its heading order.
 * - The ListPage holds a NightPicker in its header context, and its table
 *   fills the body (`scroll="fill"`).
 * - The DetailPanel docks at the side from 1400 px wide and at the bottom
 *   below; its Display menu pins it and, on the side, sets its width
 *   (Narrow, Medium, Wide), and its leading edge resizes it.
 * - The StepPage is a Project's Wrap up under the Project's tabs; "Full-height step"
 *   switches it to `fill`, where the body takes the region and scrolls itself.
 * - The line under a frame measures how far the table, the panel or the
 *   step pane moved on the last selection, row or step change (it reads
 *   0 px), and names the last action run.
 *
 * Every string comes from the messages; target names, nights and paths are
 * the seed's data.
 */
import { Link } from "@tanstack/react-router"
import { Inbox } from "lucide-react"
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import { BoxTable } from "@/components/app/box"
import type { Action, Column, Facet, FlowStep, MenuItem, StepFlow } from "@/components/app/contracts"
import { KeyValueList, PathText } from "@/components/app/data"
import { DataTable } from "@/components/app/data-table"
import { EmptyState, type PageNotice } from "@/components/app/feedback"
import { SwitchField } from "@/components/app/fields"
import { NightPicker } from "@/components/app/pickers"
import { SettingsSection } from "@/components/app/settings"
import { StatusBadge } from "@/components/app/status"
import { stepEditable } from "@/components/app/step-flow"
import { DetailPage, type DetailSection } from "@/components/templates/detail-page"
import type { PageDetail } from "@/components/templates/detail-panel"
import { ListPage } from "@/components/templates/list-page"
import type { ObjectMenu } from "@/components/templates/parts"
import { ListSection, SettingsPage } from "@/components/templates/settings-page"
import { StepPage } from "@/components/templates/step-page"
import { Toggle } from "@/components/ui/toggle"
import { Button } from "@/components/ui/button"
import { WRAP_UP_NAME, WRAP_UP_STEPS } from "@/domain/labels"
import { PROJECT_TAB_NAME, PROJECT_TABS, type ProjectTabId } from "@/domain/project-view"
import type { Catalog, Location, Project, ProjectGroup, Session, Subject, WrapUpStepId } from "@/domain/types"
import { formatCount, formatDuration, formatExposure, formatNight } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { useStore } from "@/store/core"
import { ComponentSection } from "./specimen"

// ---------------------------------------------------------------------------
// Shared: seed labels, the session facts, the reviewer lines
// ---------------------------------------------------------------------------

function targetName(catalog: Catalog, session: Session): string {
  const id = session.target.value
  return (id ? catalog.targets[id]?.name : undefined) ?? session.objectLabel ?? "–"
}

function sessionLabel(catalog: Catalog, session: Session): string {
  return `${targetName(catalog, session)} · ${formatNight(session.night)} · ${session.channel ?? "–"}`
}

/** The sessions a Project holds, in its input order. */
function heldSessions(catalog: Catalog, project: Project): Session[] {
  return project.inputs.flatMap((input) => catalog.sessions[input.sessionId] ?? [])
}

function sessionFacts(m: Messages, catalog: Catalog, session: Session) {
  return [
    { label: m.run_col_night(), value: formatNight(session.night, true) },
    { label: m.sessions_column_target(), value: targetName(catalog, session) },
    { label: m.run_col_channel(), value: session.channel ?? "–" },
    { label: m.session_column_exposure(), value: formatExposure(session.exposureS) },
    { label: m.run_col_frames(), value: formatCount(session.assetIds.length) },
    { label: m.run_col_integration(), value: formatDuration(session.assetIds.length * session.exposureS) },
    { label: m.session_camera(), value: session.cameraName ?? "–" },
    { label: m.session_telescope(), value: session.telescopeName ?? "–" },
  ]
}

function sessionColumns(m: Messages, catalog: Catalog): Column<Session>[] {
  return [
    { id: "night", header: m.run_col_night(), cell: (s) => formatNight(s.night), sortValue: (s) => s.night, rowHeader: true },
    { id: "target", header: m.sessions_column_target(), cell: (s) => targetName(catalog, s), sortValue: (s) => targetName(catalog, s), truncate: true },
    { id: "channel", header: m.run_col_channel(), cell: (s) => s.channel ?? "–", sortValue: (s) => s.channel },
    { id: "exposure", header: m.session_column_exposure(), cell: (s) => formatExposure(s.exposureS), sortValue: (s) => s.exposureS, align: "right" },
    { id: "frames", header: m.run_col_frames(), cell: (s) => formatCount(s.assetIds.length), sortValue: (s) => s.assetIds.length, align: "right" },
    {
      id: "integration",
      header: m.run_col_integration(),
      cell: (s) => formatDuration(s.assetIds.length * s.exposureS),
      sortValue: (s) => s.assetIds.length * s.exposureS,
      align: "right",
    },
  ]
}

function distinct<T>(values: T[]): T[] {
  return [...new Set(values)]
}

/** The rects of the elements `selector` names inside `frame`, relative to the frame. */
function rectsIn(frame: HTMLElement, selector: string): DOMRect[] {
  const origin = frame.getBoundingClientRect()
  return Array.from(frame.querySelectorAll(selector), (element) => {
    const rect = element.getBoundingClientRect()
    return new DOMRect(rect.x - origin.x, rect.y - origin.y, rect.width, rect.height)
  })
}

/**
 * How far the elements `selector` names moved inside `host` on the last
 * change of `key`, in px: position and size, relative to the frame, so
 * scrolling the catalogue counts for nothing. Resizing the window or the
 * frame only resets the baseline, and a change that adds or removes one of
 * them (the panel opening) is not measured.
 */
function useShift(host: RefObject<HTMLElement | null>, selector: string, key: string): number {
  const last = useRef<DOMRect[] | null>(null)
  const [shift, setShift] = useState(0)
  useLayoutEffect(() => {
    const frame = host.current
    if (!frame) return
    const observer = new ResizeObserver(() => {
      last.current = rectsIn(frame, selector)
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [host, selector])
  useLayoutEffect(() => {
    const frame = host.current
    if (!frame) return
    const rects = rectsIn(frame, selector)
    const before = last.current
    last.current = rects
    if (!before || before.length !== rects.length) return
    const moved = rects.reduce((most, rect, index) => {
      const was = before[index]
      if (!was) return most
      return Math.max(most, Math.abs(rect.x - was.x), Math.abs(rect.y - was.y), Math.abs(rect.width - was.width), Math.abs(rect.height - was.height))
    }, 0)
    setShift(Math.round(moved))
  }, [host, selector, key])
  return shift
}

/** The reviewer lines under a frame. */
function ReviewLines({ shift, last }: { shift?: string; last: string | null }) {
  const m = useMessages()
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {shift ? <p data-catalogue-shift="">{shift}</p> : null}
      <p>{last ? m.catalogue_templates_last_action({ action: last }) : m.catalogue_datatable_no_action()}</p>
    </div>
  )
}

/** A template's frame: the height of a short window, so the page body, not the catalogue, holds the scroll. */
function Frame({ host, children }: { host?: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  return (
    <div ref={host} className="flex h-136 flex-col overflow-hidden rounded-lg border bg-background">
      {children}
    </div>
  )
}

/** Shown in place of a template while the store holds no demo library. */
function NoSeed() {
  const m = useMessages()
  return (
    <EmptyState
      icon={Inbox}
      title={m.catalogue_templates_no_seed()}
      action={
        <Button variant="outline" size="sm" render={<Link to="/welcome" />}>
          {m.setup_demo_load()}
        </Button>
      }
    />
  )
}

// ---------------------------------------------------------------------------
// ListPage: Sessions with views, toolbar, batch bar, row actions and the dock
// ---------------------------------------------------------------------------

type SessionView = "lights" | "calibration"

function ListDemo() {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const [view, setView] = useState<SessionView>("lights")
  const [query, setQuery] = useState("")
  const [channel, setChannel] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [notice, setNotice] = useState(false)
  const [last, setLast] = useState<string | null>(null)
  // The page's context control: the night the list is read for, seeded with the latest night.
  const [night, setNight] = useState<string | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const shift = useShift(host, "table, [data-detail-panel]", `${selected.join(",")}|${openId ?? ""}`)

  const live = Object.values(catalog.sessions).filter((s) => s.supersededBy === null)
  const ofView = (v: SessionView) => live.filter((s) => (v === "lights" ? s.imageType === "light" : s.imageType !== "light"))
  const sessions = ofView(view)
  const name = (s: Session) => sessionLabel(catalog, s)
  const channels = distinct(sessions.map((s) => s.channel ?? "–")).sort()
  const needle = query.trim().toLowerCase()
  const shown = sessions.filter((s) => (channel === "" || (s.channel ?? "–") === channel) && name(s).toLowerCase().includes(needle))
  const nights = live.map((s) => s.night).sort()
  const latestNight = nights.at(-1)
  const open = openId ? catalog.sessions[openId] : undefined
  const ran = (label: string) => () => setLast(label)
  const trash: Action = { id: "trash", label: m.run_move_to_trash(), kind: "destructive", opensDialog: true, run: ran(m.run_move_to_trash()) }

  const actions: Action[] = [
    { id: "import", label: m.import_open(), kind: "primary", run: ran(m.import_open()) },
    { id: "rescan", label: m.location_rescan(), run: ran(m.location_rescan()) },
    { id: "add", label: m.session_add_to_project(), opensDialog: true, run: ran(m.session_add_to_project()) },
    { id: "review", label: m.verb_review(), run: ran(m.verb_review()) },
    // A fourth standard action and the destructive one go to the object menu.
    { id: "export", label: m.catalogue_templates_export(), opensDialog: true, run: ran(m.catalogue_templates_export()) },
  ]
  const menu: ObjectMenu = { label: m.nav_sessions(), items: [trash] }
  const rowActions = (s: Session): MenuItem[] => [
    { id: "details", label: m.settings_details(), run: () => setOpenId(s.id) },
    { id: "review", label: m.verb_review(), run: ran(m.verb_review()) },
    { separator: true },
    trash,
  ]
  const facets: Facet[] = [
    {
      id: "channel",
      label: m.run_col_channel(),
      kind: "single",
      value: channel,
      options: channels.map((value) => ({ value, label: value, count: sessions.filter((s) => (s.channel ?? "–") === value).length })),
    },
  ]
  const pageNotice: PageNotice | null = notice ? { tone: "offline", title: m.issue_location_offline({ name: Object.values(catalog.locations)[0]?.displayName ?? "–" }) } : null
  const detail: PageDetail | null = open
    ? {
        dockId: "catalogue-sessions",
        title: name(open),
        status: <StatusBadge kind="association" value={open.target.status} />,
        actions: [
          { id: "review", label: m.verb_review(), run: ran(m.verb_review()) },
          { id: "add", label: m.session_add_to_project(), opensDialog: true, run: ran(m.session_add_to_project()) },
        ],
        menu: { label: m.session_label(), items: [trash] },
        content: <KeyValueList items={sessionFacts(m, catalog, open)} />,
        onClose: () => setOpenId(null),
      }
    : null

  return (
    <ComponentSection components={["ListPage", "DetailDock", "DetailPanel", "ViewTabs"]} description={m.catalogue_templates_list_desc()}>
      <div className="space-y-2">
        <Toggle variant="outline" size="sm" pressed={notice} onPressedChange={setNotice}>
          {m.catalogue_templates_notice_toggle()}
        </Toggle>
        <Frame host={host}>
          <ListPage
            level={2}
            title={m.nav_sessions()}
            summary={m.project_sessions_count({ count: sessions.length })}
            context={latestNight ? <NightPicker value={night ?? latestNight} onChange={setNight} today={latestNight} min={nights[0]} /> : undefined}
            actions={actions}
            menu={menu}
            notice={pageNotice}
            views={{
              label: m.catalogue_templates_views(),
              value: view,
              onChange: (id) => {
                setView(id === "calibration" ? "calibration" : "lights")
                setSelected([])
                setOpenId(null)
                setChannel("")
              },
              items: [
                { id: "lights", label: m.naming_type_lights(), count: ofView("lights").length },
                { id: "calibration", label: m.status_role_calibration(), count: ofView("calibration").length },
              ],
            }}
            table={{
              label: m.nav_sessions(),
              rows: shown,
              columns: sessionColumns(m, catalog),
              getRowId: (s) => s.id,
              initialSort: { columnId: "night", direction: "desc" },
              activeRowId: openId,
              onRowClick: (s) => setOpenId(s.id),
              rowLabel: name,
              rowActions,
              selection: {
                selected,
                onChange: setSelected,
                rowLabel: name,
                countLabel: (count) => m.project_sessions_selected({ count }),
                onShowHidden: () => {
                  setQuery("")
                  setChannel("")
                },
              },
              batchActions: () => [{ id: "add", label: m.session_add_to_project(), opensDialog: true, run: ran(m.session_add_to_project()) }, trash],
              empty: (
                <EmptyState
                  icon={Inbox}
                  title={m.sessions_no_match()}
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setQuery("")
                        setChannel("")
                      }}
                    >
                      {m.filters_clear()}
                    </Button>
                  }
                />
              ),
              toolbar: {
                search: { label: m.sessions_search(), placeholder: m.sessions_search_placeholder(), value: query, onChange: setQuery },
                facets: { items: facets, onChange: (patch) => typeof patch.channel === "string" && setChannel(patch.channel) },
                matchCount: shown.length,
              },
            }}
            detail={detail}
          />
        </Frame>
        <ReviewLines shift={m.catalogue_templates_list_shift({ px: String(shift) })} last={last} />
      </div>
    </ComponentSection>
  )
}

/** ListPage inside an object: a Project's sessions under the path Projects › {Project}. */
function ListPathDemo() {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const project = Object.values(catalog.projects)[0]
  const [query, setQuery] = useState("")
  if (!project) return <NoSeed />
  const sessions = heldSessions(catalog, project)
  const shown = sessions.filter((s) => sessionLabel(catalog, s).toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <ComponentSection components={["ListPage"]} description={m.catalogue_templates_list_path_desc()}>
      <Frame>
        <ListPage
          level={2}
          path={[
            { label: m.nav_projects(), link: { to: "/projects" } },
            { label: project.name, link: { to: "/projects/$projectId", params: { projectId: project.id } } },
          ]}
          title={m.nav_sessions()}
          summary={m.project_sessions_count({ count: sessions.length })}
          table={{
            label: m.nav_sessions(),
            rows: shown,
            columns: sessionColumns(m, catalog),
            getRowId: (s) => s.id,
            rowLabel: (s) => sessionLabel(catalog, s),
            toolbar: { search: { label: m.catalogue_templates_search_sessions(), value: query, onChange: setQuery }, matchCount: shown.length },
          }}
        />
      </Frame>
    </ComponentSection>
  )
}

// ---------------------------------------------------------------------------
// DetailPage: a Project with views, sections (Box, BoxTable) and the dock
// ---------------------------------------------------------------------------

type ProjectView = "overview" | "groups"

function DetailDemo() {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const project = Object.values(catalog.projects)[0]
  const [view, setView] = useState<ProjectView>("overview")
  const [openId, setOpenId] = useState<string | null>(null)
  const [last, setLast] = useState<string | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const shift = useShift(host, "[data-template] section[data-slot='box'], [data-detail-panel]", openId ?? "")
  if (!project) return <NoSeed />

  const ran = (label: string) => () => setLast(label)
  const sessions = heldSessions(catalog, project)
  const open = openId ? catalog.sessions[openId] : undefined
  const name = (s: Session) => sessionLabel(catalog, s)
  const subjectName = (subject: Subject) => catalog.targets[subject.targetId]?.name ?? "–"
  const subjectColumns: Column<Subject>[] = [
    { id: "subject", header: m.project_col_subject(), cell: subjectName, sortValue: subjectName, rowHeader: true },
    {
      id: "sessions",
      header: m.nav_sessions(),
      cell: (subject) => formatCount(sessions.filter((s) => s.target.value === subject.targetId).length),
      sortValue: (subject) => sessions.filter((s) => s.target.value === subject.targetId).length,
      align: "right",
    },
  ]
  const members = (group: ProjectGroup) => project.inputs.filter((i) => i.groupId === group.id).length
  const groupColumns: Column<ProjectGroup>[] = [
    { id: "group", header: m.project_col_group(), cell: (group) => group.name, sortValue: (group) => group.name, rowHeader: true },
    { id: "sessions", header: m.nav_sessions(), cell: (group) => formatCount(members(group)), sortValue: members, align: "right" },
  ]
  const overview: DetailSection[] = [
    {
      id: "tpl-project-facts",
      title: m.settings_details(),
      content: (
        <KeyValueList
          columns={2}
          items={[
            { label: m.project_subjects(), value: formatCount(project.subjects.length) },
            { label: m.project_rigs(), value: formatCount(project.rigIds.length) },
            { label: m.home_goals(), value: formatCount(project.goals.length) },
            { label: m.newproject_notes(), value: project.notes || "–" },
          ]}
        />
      ),
    },
    {
      id: "tpl-project-subjects",
      title: m.project_subjects(),
      count: project.subjects.length,
      flush: true,
      content: <BoxTable label={m.project_subjects()} rows={project.subjects} columns={subjectColumns} getRowId={(subject) => subject.id} />,
    },
    {
      id: "tpl-project-sessions",
      title: m.nav_sessions(),
      count: sessions.length,
      flush: true,
      actions: [{ id: "add-sessions", label: m.catalogue_templates_add_sessions(), opensDialog: true, run: ran(m.catalogue_templates_add_sessions()) }],
      content: (
        <BoxTable
          label={m.nav_sessions()}
          rows={sessions}
          columns={sessionColumns(m, catalog)}
          getRowId={(s) => s.id}
          initialSort={{ columnId: "night", direction: "desc" }}
          activeRowId={openId}
          onRowClick={(s) => setOpenId(s.id)}
          rowLabel={name}
          rowActions={(s) => [{ id: "details", label: m.settings_details(), run: () => setOpenId(s.id) }]}
        />
      ),
    },
  ]
  const groupSections: DetailSection[] = [
    {
      id: "tpl-project-groups",
      title: m.project_groups(),
      count: project.groups.length,
      flush: true,
      content: <BoxTable label={m.project_groups()} rows={project.groups} columns={groupColumns} getRowId={(group) => group.id} />,
    },
  ]
  const detail: PageDetail | null = open
    ? {
        dockId: "catalogue-project",
        title: name(open),
        status: <StatusBadge kind="association" value={open.target.status} />,
        actions: [{ id: "review", label: m.verb_review(), run: ran(m.verb_review()) }],
        content: <KeyValueList items={sessionFacts(m, catalog, open)} />,
        onClose: () => setOpenId(null),
      }
    : null

  return (
    <ComponentSection components={["DetailPage", "PageHeader", "Box", "BoxTable"]} description={m.catalogue_templates_detail_desc()}>
      <div className="space-y-2">
        <Frame host={host}>
          <DetailPage
            level={2}
            path={[{ label: m.nav_projects(), link: { to: "/projects" } }]}
            title={project.name}
            status={<StatusBadge kind="project" value={project.state} />}
            actions={[
              { id: "apply", label: m.project_apply(), kind: "primary", opensDialog: true, run: ran(m.project_apply()) },
              { id: "export", label: m.catalogue_templates_export(), opensDialog: true, run: ran(m.catalogue_templates_export()) },
            ]}
            menu={{
              label: m.project_noun(),
              items: [
                { id: "edit", label: m.settings_edit(), opensDialog: true, run: ran(m.settings_edit()) },
                { id: "duplicate", label: m.project_duplicate(), opensDialog: true, run: ran(m.project_duplicate()) },
              ],
            }}
            views={{
              label: m.catalogue_templates_project_views(),
              value: view,
              onChange: (id) => {
                setView(id === "groups" ? "groups" : "overview")
                setOpenId(null)
              },
              items: [
                { id: "overview", label: m.catalogue_templates_overview() },
                { id: "groups", label: m.project_groups(), count: project.groups.length },
              ],
            }}
            sections={view === "overview" ? overview : groupSections}
            detail={detail}
          />
        </Frame>
        <ReviewLines shift={m.catalogue_templates_list_shift({ px: String(shift) })} last={last} />
      </div>
    </ComponentSection>
  )
}

/** DetailPage with an aside: two columns from 1280 px, one column below it (sections first). */
function DetailAsideDemo() {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const project = Object.values(catalog.projects)[0]
  if (!project) return <NoSeed />
  const subjectName = (subject: Subject) => catalog.targets[subject.targetId]?.name ?? "-"
  return (
    <ComponentSection components={["DetailPage"]} description={m.catalogue_templates_detail_aside_desc()}>
      <Frame>
        <DetailPage
          level={2}
          title={project.name}
          sections={[
            {
              id: "tpl-aside-facts",
              title: m.settings_details(),
              content: (
                <KeyValueList
                  items={[
                    { label: m.project_subjects(), value: formatCount(project.subjects.length) },
                    { label: m.project_rigs(), value: formatCount(project.rigIds.length) },
                  ]}
                />
              ),
            },
            {
              id: "tpl-aside-subjects",
              title: m.project_subjects(),
              count: project.subjects.length,
              content: <KeyValueList items={project.subjects.map((subject) => ({ label: subjectName(subject), value: formatCount(project.goals.filter((g) => g.subjectId === subject.id).length) }))} />,
            },
          ]}
          aside={[{ id: "tpl-aside-notes", title: m.newproject_notes(), content: <KeyValueList items={[{ label: m.newproject_notes(), value: project.notes || "–" }]} /> }]}
        />
      </Frame>
    </ComponentSection>
  )
}

// ---------------------------------------------------------------------------
// StepPage: a Project's Wrap up steps on local state; Proceed, then Close project
// ---------------------------------------------------------------------------

/** The step whose body is a selection: proceeding with nothing selected records it as skipped (F4). */
const SELECTION_STEP: WrapUpStepId = "archive"

function StepDemo() {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const project = Object.values(catalog.projects).find((p) => p.state === "open")
  const [at, setAt] = useState(0)
  const [finished, setFinished] = useState(false)
  const [viewing, setViewing] = useState<string>(WRAP_UP_STEPS[0]!)
  const [selected, setSelected] = useState<string[]>([])
  const [last, setLast] = useState<string | null>(null)
  // Fill: the step body takes the full region and scrolls itself (the review Workspace's case).
  const [fill, setFill] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const shift = useShift(host, "[data-step-strip], [data-step-region], [data-step-footer]", `${viewing}|${at}|${finished}|${selected.length}`)
  if (!project) return <NoSeed />

  const ran = (label: string) => () => setLast(label)
  const sessions = heldSessions(catalog, project)
  const name = (s: Session) => sessionLabel(catalog, s)
  const steps: FlowStep[] = WRAP_UP_STEPS.map((id, index) => ({
    id,
    label: say(m, WRAP_UP_NAME[id]),
    state: finished || index < at ? (id === SELECTION_STEP && selected.length === 0 ? "skipped" : "finished") : index === at ? "current" : "todo",
    summary: id === SELECTION_STEP ? m.project_sessions_selected({ count: selected.length }) : undefined,
  }))
  const lastStep = at === WRAP_UP_STEPS.length - 1
  const proceed: Action | null = finished
    ? null
    : lastStep
      ? {
          id: "close-project",
          label: m.stepflow_close_project(),
          confirm: { title: m.stepflow_close_project_title({ name: project.name }), confirm: { label: m.stepflow_close_project() } },
          run: () => {
            setFinished(true)
            setLast(m.stepflow_close_project())
          },
        }
      : {
          id: "proceed",
          label: m.stepflow_proceed(),
          run: () => {
            const next = WRAP_UP_STEPS[at + 1] ?? WRAP_UP_STEPS[0]!
            setAt(at + 1)
            setViewing(next)
            setLast(m.stepflow_proceed())
          },
        }
  const flow: StepFlow = { steps, current: WRAP_UP_STEPS[at] ?? WRAP_UP_STEPS[0]!, ordered: true, proceed, next: null }
  const editable = stepEditable(flow, viewing)
  const restart: Action = {
    id: "restart",
    label: m.catalogue_templates_restart(),
    run: () => {
      setAt(0)
      setFinished(false)
      setViewing(WRAP_UP_STEPS[0]!)
      setSelected([])
    },
  }
  const rows =
    viewing === SELECTION_STEP ? (
      <DataTable
        label={m.nav_sessions()}
        rows={sessions}
        columns={sessionColumns(m, catalog)}
        getRowId={(s) => s.id}
        scroll={fill ? "fill" : "none"}
        selection={editable ? { selected, onChange: setSelected, rowLabel: name, countLabel: (count) => m.project_sessions_selected({ count }) } : undefined}
      />
    ) : (
      <KeyValueList
        items={[
          { label: m.run_col_project(), value: project.name },
          { label: m.nav_sessions(), value: m.project_sessions_count({ count: sessions.length }) },
        ]}
      />
    )
  // In fill mode the body owns its padding and its scroll; the region adds neither.
  const body = fill ? <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">{rows}</div> : rows

  return (
    <ComponentSection components={["StepPage"]} description={m.catalogue_templates_step_desc()}>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton action={restart} />
          <Toggle variant="outline" size="sm" pressed={fill} onPressedChange={setFill}>
            {m.catalogue_templates_fill_toggle()}
          </Toggle>
        </div>
        <Frame host={host}>
          <StepPage
            level={2}
            path={[
              { label: m.nav_projects(), link: { to: "/projects" } },
              { label: project.name, link: { to: "/projects/$projectId", params: { projectId: project.id } } },
            ]}
            title={m.wrapup_action()}
            status={<StatusBadge kind="project" value={finished ? "closed" : "open"} />}
            menu={{
              label: m.project_noun(),
              items: [{ id: "duplicate", label: m.project_duplicate(), opensDialog: true, run: ran(m.project_duplicate()) }],
            }}
            flow={flow}
            viewing={viewing}
            onSelectStep={setViewing}
            stepsLabel={m.catalogue_templates_wrapup_steps()}
            views={{
              label: m.catalogue_templates_project_views(),
              value: "wrap-up",
              items: PROJECT_TABS.map((id) => ({ id, label: say(m, PROJECT_TAB_NAME[id]) })),
              // The host switches template for another view; the specimen records the choice.
              onChange: (id) => {
                if (id !== "wrap-up") setLast(say(m, PROJECT_TAB_NAME[id as ProjectTabId]))
              },
            }}
            fill={fill}
            step={body}
          />
        </Frame>
        <ReviewLines shift={m.catalogue_templates_step_shift({ px: String(shift) })} last={last} />
      </div>
    </ComponentSection>
  )
}

// ---------------------------------------------------------------------------
// SettingsPage: a SettingsSection and a ListSection
// ---------------------------------------------------------------------------

function SettingsDemo() {
  const m = useMessages()
  const locations = useStore((s) => Object.values(s.catalog.locations))
  const [rescan, setRescan] = useState(true)
  const [last, setLast] = useState<string | null>(null)
  const ran = (label: string) => () => setLast(label)
  const columns: Column<Location>[] = [
    { id: "name", header: m.equipment_name(), cell: (l) => l.displayName, sortValue: (l) => l.displayName, rowHeader: true },
    { id: "path", header: m.location_path(), cell: (l) => <PathText path={l.path} truncate />, sortValue: (l) => l.path },
    { id: "role", header: m.location_role(), cell: (l) => <StatusBadge kind="role" value={l.role} />, sortValue: (l) => l.role },
    { id: "access", header: m.location_access(), cell: (l) => <StatusBadge kind="access" value={l.access} />, sortValue: (l) => l.access },
  ]
  return (
    <ComponentSection components={["SettingsPage", "ListSection"]} description={m.catalogue_templates_settings_desc()}>
      <div className="space-y-2">
        <div className="max-h-112 overflow-y-auto rounded-lg border bg-background">
          <SettingsPage title={m.nav_library()}>
            <SettingsSection title={m.catalogue_templates_indexing()}>
              <SwitchField label={m.catalogue_templates_rescan_on_open()} checked={rescan} onChange={setRescan} />
            </SettingsSection>
            <ListSection
              title={m.common_locations()}
              add={{ id: "add-location", label: m.storage_add_location(), opensDialog: true, run: ran(m.storage_add_location()) }}
              table={{
                label: m.common_locations(),
                rows: locations,
                columns,
                getRowId: (l) => l.id,
                rowLabel: (l) => l.displayName,
                rowActions: () => [
                  { id: "rescan", label: m.location_rescan(), run: ran(m.location_rescan()) },
                  { id: "remove", label: m.settings_remove(), kind: "destructive", opensDialog: true, run: ran(m.settings_remove()) },
                ],
              }}
            />
          </SettingsPage>
        </div>
        <ReviewLines last={last} />
      </div>
    </ComponentSection>
  )
}

export function TemplatesCatalogue() {
  return (
    <div className="space-y-8">
      <ListDemo />
      <ListPathDemo />
      <DetailDemo />
      <DetailAsideDemo />
      <StepDemo />
      <SettingsDemo />
    </div>
  )
}
