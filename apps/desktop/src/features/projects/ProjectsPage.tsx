import { useMemo, type ReactElement } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Plus, FolderOpen, Telescope } from "lucide-react";

import {
  Button,
  IconButton,
  Chip,
  DataTable,
  DockedDrawer,
  DrawerShell,
  EmptyState,
  Facts,
  Filters,
  FilterLabel,
  Menu,
  MultiSelect,
  PageHeader,
  PlanFooter,
  PlanInlineSummary,
  ProvenanceSection,
  SectionHeader,
  StateLabel,
  Tabs,
  TwoLineCell,
  sortRows,
  type DataTableColumn,
  type MultiSelectOption,
  type TabItem,
} from "../../ui";
import {
  projectLifecycleSteps,
  lifecycleLabel,
  lifecycleTone,
  type Project,
  type ProjectLifecycle,
} from "../../data/mock";
import {
  appendLog,
  createSourceMapPlanForProject,
  discardPlan,
  isProjectTransitionAllowed,
  setProjectLifecycle,
  revalidateAndApply,
  usePendingPlanForProject,
  usePlans,
  useProjects,
} from "../../data/store";
import { useSettings } from "../../data/settings";
import { useProvenance } from "../../data/provenance";

const DEFAULT_SORT = "updated:desc";

function parseCSV<T extends string>(
  raw: string | undefined,
  allowed: ReadonlyArray<T>,
  defaultVal: T[],
): T[] {
  if (!raw) return defaultVal;
  const set = new Set<string>(allowed);
  const picked = raw.split(",").filter((s) => set.has(s)) as T[];
  return picked.length > 0 ? picked : defaultVal;
}

function serializeCSV<T extends string>(values: T[], allValues: ReadonlyArray<T>): string | undefined {
  if (values.length === allValues.length) return undefined;
  return values.join(",");
}

/* ================================================================
   Helpers
   ================================================================ */

function formatHours(seconds: number): string {
  const h = seconds / 3600;
  return `${h.toFixed(1)}h`;
}

function formatRelative(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = diffMs / 1000;
  const diffMin = diffSec / 60;
  const diffHours = diffMin / 60;
  const diffDays = diffHours / 24;

  if (diffDays > 30) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  if (diffDays >= 1) {
    const d = Math.floor(diffDays);
    return `${d} ${d === 1 ? "day" : "days"} ago`;
  }
  if (diffHours >= 1) {
    const h = Math.floor(diffHours);
    return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  }
  const m = Math.max(1, Math.floor(diffMin));
  return `${m} ${m === 1 ? "minute" : "minutes"} ago`;
}

function lifecycleOrdinal(lc: ProjectLifecycle): number {
  const idx = projectLifecycleSteps.findIndex((s) => s.id === lc);
  return idx >= 0 ? idx : 99;
}

function parseSort(sort: string | undefined): { id: string; dir: "asc" | "desc" } {
  if (!sort) return { id: "updated", dir: "desc" };
  const parts = sort.split(":");
  const id = parts[0] ?? "updated";
  const dir = parts[1] === "asc" ? "asc" : "desc";
  return { id, dir };
}

/* ================================================================
   Tab strip
   ================================================================ */

type DrawerTab = "overview" | "sources" | "plans" | "activity";
const TABS: TabItem[] = [
  { id: "overview", label: "Overview" },
  { id: "sources", label: "Sources" },
  { id: "plans", label: "Plans" },
  { id: "activity", label: "Activity" },
];

/* ================================================================
   Pending plan chip — needs its own component so it can call a hook
   ================================================================ */

function PendingPlanChip({
  project,
  onNavigateToPlans,
}: {
  project: Project;
  onNavigateToPlans: (e: React.MouseEvent) => void;
}): ReactElement | null {
  const plan = usePendingPlanForProject(project.id);
  if (!plan) return null;
  return (
    <Chip tone="warn" active onClick={onNavigateToPlans}>
      Plan ready · {plan.itemsTotal} items
    </Chip>
  );
}

/* ================================================================
   Drawer body panels
   ================================================================ */

/**
 * Provenance pane for a project. Reads the spec 002 `ProvenanceField[]`
 * payload via `useProvenance` (asset type `project`). In `pnpm dev` the
 * dev shim returns an empty list (no per-project mock projection), so this
 * section self-hides until the contract is wired under Tauri.
 */
function ProjectProvenance({ projectId }: { projectId: string }): ReactElement | null {
  const { data, loading, error } = useProvenance(projectId, "project");
  const hasContent = loading || error || (data && data.length > 0);
  if (!hasContent) return null;
  return (
    <div style={{ marginTop: 16 }} data-provenance-pane="project">
      <div className="alm-fact-group__label">Provenance</div>
      <ProvenanceSection fields={data} loading={loading} error={error} />
    </div>
  );
}

function OverviewPanel({ project }: { project: Project }): ReactElement {
  return (
    <>
    <Facts
      entries={[
        { label: "Lifecycle", value: <StateLabel tone={lifecycleTone(project.lifecycle)}>{lifecycleLabel(project.lifecycle)}</StateLabel> },
        { label: "Target(s)", value: project.targets.length > 0 ? project.targets.join(", ") : "—" },
        { label: "Tool", value: project.tool },
        {
          label: "Frames",
          value: (
            <span>
              {project.totalFrames} frames
              {project.exposureBreakdown.length > 0 ? (
                <span className="alm-dim alm-text-dense" style={{ marginLeft: 8 }}>
                  {project.exposureBreakdown.map((e) => `${formatHours(e.seconds)} ${e.filter}`).join(" · ")}
                </span>
              ) : null}
            </span>
          ),
        },
        project.lastAction
          ? { label: "Last apply", value: `${project.lastAction.label} · ${project.lastAction.when}` }
          : null,
      ].filter(Boolean) as Array<{ label: React.ReactNode; value: React.ReactNode }>}
    />
    <ProjectProvenance projectId={project.id} />
    </>
  );
}

function SourcesPanel({ project }: { project: Project }): ReactElement {
  if (project.sources.length === 0) {
    return <span className="alm-text-faint" style={{ fontSize: "var(--fs-small)" }}>No sources yet.</span>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {project.sources.map((s) => (
        <div
          key={s.inventoryId}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto auto auto",
            alignItems: "center",
            gap: "var(--space-3)",
            fontSize: "var(--fs-small)",
            padding: "4px 0",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <span
            title={s.name}
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {s.name}
          </span>
          <span className="alm-dim alm-text-dense" style={{ whiteSpace: "nowrap" }}>{s.filter}</span>
          <span className="alm-dim alm-text-dense" style={{ whiteSpace: "nowrap" }}>{s.exposure}</span>
          <span className="alm-table__cell--num alm-dim" style={{ whiteSpace: "nowrap" }}>{s.frames} fr</span>
        </div>
      ))}
    </div>
  );
}

function PlansPanel({ project }: { project: Project }): ReactElement {
  const pendingPlan = usePendingPlanForProject(project.id);
  const allPlans = usePlans();
  const projectPlans = allPlans
    .filter((p) => p.origin === "project" && p.originPath === project.id)
    .sort((a, b) => b.number - a.number);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {pendingPlan ? (
        <div>
          <SectionHeader marginTop="0">Pending plan · #{pendingPlan.number}</SectionHeader>
          <PlanInlineSummary plan={pendingPlan} />
        </div>
      ) : null}
      {projectPlans.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <SectionHeader marginTop="0">All project plans</SectionHeader>
          {projectPlans.map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "4px 0",
                fontSize: "var(--fs-small)",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <span>#{p.number} {p.title}</span>
              <span className="alm-dim alm-text-dense">
                {p.state} · {p.itemsApplied}/{p.itemsTotal}
              </span>
            </div>
          ))}
        </div>
      ) : !pendingPlan ? (
        <div>
          <SectionHeader marginTop="0">No plans yet</SectionHeader>
          <span style={{ fontSize: "var(--fs-small)", color: "var(--text-dim)" }}>
            Generate a source-map plan from the footer to materialize sources into a tool-friendly tree.
          </span>
        </div>
      ) : null}
    </div>
  );
}

function ActivityPanel({ project }: { project: Project }): ReactElement {
  const events: Array<{ timestamp: string; text: string }> = [
    ...(project.lastAction
      ? [{ timestamp: project.lastAction.when, text: project.lastAction.label }]
      : []),
    { timestamp: project.updatedAt.slice(0, 16).replace("T", " "), text: `Lifecycle set to ${lifecycleLabel(project.lifecycle)}` },
    { timestamp: project.updatedAt.slice(0, 16).replace("T", " "), text: "Project updated" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {events.map((ev, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "160px 1fr",
            gap: 8,
            fontSize: "var(--fs-small)",
            padding: "4px 0",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <span className="alm-dim alm-mono">{ev.timestamp}</span>
          <span>{ev.text}</span>
        </div>
      ))}
    </div>
  );
}

/* ================================================================
   Footer
   ================================================================ */

function ProjectDrawerFooter({
  project,
  tab,
  onTabChange,
}: {
  project: Project;
  tab: DrawerTab;
  onTabChange: (t: DrawerTab) => void;
}): ReactElement {
  const pendingPlan = usePendingPlanForProject(project.id);
  const allowedTransitions = projectLifecycleSteps
    .map((s) => s.id as ProjectLifecycle)
    .filter((lc) => isProjectTransitionAllowed(project.lifecycle, lc));

  const handleGenerateSourceMap = () => {
    createSourceMapPlanForProject(project.id);
    onTabChange("plans");
  };

  const handleRevealFolder = () => {
    appendLog({
      level: "info",
      source: "fs",
      message: `[mock] reveal project folder for ${project.name}`,
    });
  };

  if (tab === "plans") {
    return (
      <PlanFooter
        plan={pendingPlan ?? undefined}
        generateLabel="Generate source-map plan"
        onGenerate={handleGenerateSourceMap}
        onApprove={() => {
          if (pendingPlan) void revalidateAndApply(pendingPlan.id);
        }}
        onDiscard={() => {
          if (pendingPlan) discardPlan(pendingPlan.id);
        }}
        onRetry={() => {
          if (pendingPlan) void revalidateAndApply(pendingPlan.id);
        }}
        onDone={() => onTabChange("overview")}
      />
    );
  }

  return (
    <>
      <Button
        variant="primary"
        onClick={handleGenerateSourceMap}
        disabled={pendingPlan != null}
      >
        Generate source-map plan
      </Button>

      {allowedTransitions.length > 0 ? (
        <Menu
          trigger={
            <Button>
              Mark lifecycle…
            </Button>
          }
          groups={[
            {
              id: "transitions",
              items: allowedTransitions.map((lc) => ({
                id: lc,
                label: lifecycleLabel(lc),
                onSelect: () => setProjectLifecycle(project.id, lc),
              })),
            },
          ]}
        />
      ) : null}

      <Button onClick={handleRevealFolder} leadingIcon={<FolderOpen size={14} />}>
        Open folder
      </Button>
    </>
  );
}

/* ================================================================
   Main page
   ================================================================ */

export function ProjectsPage(): ReactElement {
  const rawSearch = useSearch({ strict: false }) as {
    id?: string;
    lifecycle?: string;
    tool?: string;
    tab?: "overview" | "sources" | "plans" | "activity";
    sort?: string;
  };
  const navigate = useNavigate();
  const selectedId = rawSearch.id ?? null;
  const projects = useProjects();
  const settings = useSettings();

  const activeTab: DrawerTab = rawSearch.tab ?? "overview";
  const sortState = parseSort(rawSearch.sort);

  const ALL_LIFECYCLES: ProjectLifecycle[] = [
    ...projectLifecycleSteps.map((s) => s.id as ProjectLifecycle),
    "blocked",
  ];
  const ALL_TOOLS = ["PixInsight", "Siril", "Planetary Suite"] as const;
  type ProjectTool = (typeof ALL_TOOLS)[number];

  const activeLifecycles = parseCSV<ProjectLifecycle>(rawSearch.lifecycle, ALL_LIFECYCLES, [...ALL_LIFECYCLES]);
  const activeTools = parseCSV<ProjectTool>(rawSearch.tool, ALL_TOOLS, [...ALL_TOOLS]);

  const lifecycleOptions: MultiSelectOption[] = ALL_LIFECYCLES.map((lc) => ({
    value: lc,
    label: lifecycleLabel(lc),
    tone: lifecycleTone(lc) as "neutral" | "success" | "warn" | "danger",
  }));

  const toolOptions: MultiSelectOption[] = ALL_TOOLS.map((t) => ({ value: t, label: t }));

  const setActiveLifecycles = (lcs: string[]) =>
    navigate({
      to: "/projects",
      search: { ...rawSearch, lifecycle: serializeCSV(lcs as ProjectLifecycle[], ALL_LIFECYCLES) },
    } as never);

  const setActiveTools = (tools: string[]) =>
    navigate({
      to: "/projects",
      search: { ...rawSearch, tool: serializeCSV(tools as ProjectTool[], ALL_TOOLS) },
    } as never);

  const handleSortChange = (next: { id: string; dir: "asc" | "desc" } | null) => {
    const sortStr = next ? `${next.id}:${next.dir}` : undefined;
    const isDefault = sortStr === DEFAULT_SORT || sortStr === undefined;
    navigate({
      to: "/projects",
      search: {
        ...rawSearch,
        sort: isDefault ? undefined : sortStr,
      },
    } as never);
  };

  const onRowSelect = (row: Project) => {
    if (selectedId === row.id) {
      navigate({ to: "/projects", search: { ...rawSearch, id: undefined } } as never);
    } else {
      navigate({ to: "/projects", search: { ...rawSearch, id: row.id } } as never);
    }
  };

  const onClose = () =>
    navigate({ to: "/projects", search: { ...rawSearch, id: undefined } } as never);

  const setTab = (t: DrawerTab) =>
    navigate({
      to: "/projects",
      search: {
        ...rawSearch,
        tab: t === "overview" ? undefined : t,
      },
    } as never);

  const activeLifecycleSet = new Set(activeLifecycles);
  const activeToolSet = new Set(activeTools);

  const filteredRows = useMemo(
    () =>
      projects.filter(
        (p) =>
          activeLifecycleSet.has(p.lifecycle) &&
          activeToolSet.has(p.tool),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, rawSearch.lifecycle, rawSearch.tool],
  );

  // Build columns
  const columns: DataTableColumn<Project>[] = [
    {
      id: "name",
      header: "Name",
      sortable: true,
      accessor: (row) => row.name,
      render: (row) => row.name,
    },
    {
      id: "target",
      header: "Target",
      size: 140,
      sortable: true,
      accessor: (row) => row.targets[0] ?? null,
      render: (row) =>
        row.targets.length === 0
          ? <span className="alm-text-faint">—</span>
          : row.targets.length === 1
          ? row.targets[0]
          : <span>⋈ {row.targets.length} targets</span>,
    },
    {
      id: "frames",
      header: "Frames / Exposure",
      size: 190,
      sortable: true,
      accessor: (row) => row.totalFrames,
      render: (row) => (
        <TwoLineCell
          primary={`${row.totalFrames} frames`}
          secondary={
            row.exposureBreakdown.length > 0
              ? row.exposureBreakdown.map((e) => `${formatHours(e.seconds)} ${e.filter}`).join(" · ")
              : undefined
          }
        />
      ),
    },
    {
      id: "lifecycle",
      header: "Lifecycle",
      size: 140,
      sortable: true,
      accessor: (row) => lifecycleOrdinal(row.lifecycle),
      render: (row) => (
        <StateLabel tone={lifecycleTone(row.lifecycle)}>
          {lifecycleLabel(row.lifecycle)}
        </StateLabel>
      ),
    },
    {
      id: "pending",
      header: "Pending",
      size: 130,
      sortable: false,
      render: (row) => (
        <PendingPlanChip
          project={row}
          onNavigateToPlans={(e) => {
            e.stopPropagation();
            navigate({
              to: "/projects",
              search: { ...rawSearch, id: row.id, tab: "plans" },
            } as never);
          }}
        />
      ),
    },
    {
      id: "updated",
      header: "Updated",
      size: 120,
      sortable: true,
      accessor: (row) => new Date(row.updatedAt).getTime(),
      render: (row) => formatRelative(new Date(row.updatedAt)),
    },
  ];

  // Sort rows
  const activeCol = columns.find((c) => c.id === sortState.id);
  const sortedRows = activeCol
    ? sortRows(filteredRows, activeCol, sortState.dir)
    : filteredRows;

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  const main = (
    <div className="alm-page">
      <PageHeader
        title="Projects"
        subtitle={`${filteredRows.length} of ${projects.length}`}
        actions={
          <Button variant="primary" leadingIcon={<Plus size={14} />}>
            New project
          </Button>
        }
      />
      <Filters>
        <FilterLabel>Lifecycle</FilterLabel>
        <MultiSelect
          ariaLabel="Lifecycle filter"
          value={activeLifecycles}
          options={lifecycleOptions}
          onValueChange={setActiveLifecycles}
          allLabel="All lifecycles"
          emptyLabel="No lifecycles"
          minWidth={160}
          showTones
        />
        <FilterLabel>Tool</FilterLabel>
        <MultiSelect
          ariaLabel="Tool filter"
          value={activeTools}
          options={toolOptions}
          onValueChange={setActiveTools}
          allLabel="All tools"
          emptyLabel="No tools"
          minWidth={150}
        />
      </Filters>
      <div className="alm-page__body">
        {projects.length === 0 ? (
          <EmptyState
            icon={<Telescope size={36} />}
            heading="No projects yet"
            description="Start a project to map your sessions, calibration, and processing tool. You can create one from any confirmed inventory target."
            action={
              <Button
                variant="primary"
                leadingIcon={<Plus size={14} />}
                onClick={() => {
                  appendLog({ level: "info", source: "projects", message: "[mock] would open new-project dialog" });
                }}
              >
                New project
              </Button>
            }
          />
        ) : sortedRows.length === 0 ? (
          <EmptyState
            heading="No projects match these filters"
            description="Try changing the lifecycle or tool filter above."
            action={
              <Button
                onClick={() =>
                  navigate({ to: "/projects", search: { id: rawSearch.id } } as never)
                }
              >
                Clear filters
              </Button>
            }
          />
        ) : (
        <DataTable<Project>
          density={settings.rowDensity}
          rows={sortedRows}
          selectedId={selectedId}
          onSelect={onRowSelect}
          sort={sortState.id === "updated" && sortState.dir === "desc" && !rawSearch.sort ? null : sortState}
          onSortChange={handleSortChange}
          rowOverflow={() => (
            <Menu
              trigger={
                <IconButton aria-label="Row actions">
                  <span style={{ fontSize: 14, lineHeight: 1 }}>⋮</span>
                </IconButton>
              }
              groups={[
                {
                  id: "row",
                  items: [
                    { id: "open", label: "Open" },
                    { id: "edit", label: "Edit…" },
                  ],
                },
                {
                  id: "row-2",
                  items: [{ id: "archive", label: "Archive…", tone: "danger" as const }],
                },
              ]}
            />
          )}
          columns={columns}
        />
        )}
      </div>
    </div>
  );

  const drawer = selected ? (
    <DrawerShell
      title={selected.name}
      subtitle={`${selected.tool} · ${selected.channels.join(", ") || "no channels"}`}
      onClose={onClose}
      body={
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {/* Tab strip */}
          <div style={{ marginBottom: 16 }}>
            <Tabs
              tabs={TABS}
              value={activeTab}
              onChange={(id) => setTab(id as DrawerTab)}
              aria-label="Project details tabs"
            />
          </div>

          {/* Panel */}
          {activeTab === "overview" ? (
            <OverviewPanel project={selected} />
          ) : activeTab === "sources" ? (
            <SourcesPanel project={selected} />
          ) : activeTab === "plans" ? (
            <PlansPanel project={selected} />
          ) : (
            <ActivityPanel project={selected} />
          )}
        </div>
      }
      footer={
        <ProjectDrawerFooter
          project={selected}
          tab={activeTab}
          onTabChange={setTab}
        />
      }
    />
  ) : null;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <DockedDrawer main={main} drawer={drawer} defaultDrawerSize={42} />
    </div>
  );
}
