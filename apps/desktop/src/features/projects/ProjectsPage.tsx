import { useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { MoreVertical, Plus, FolderOpen, ArrowUpRight } from "lucide-react";

import {
  Accordion,
  Button,
  DataTable,
  DockedDrawer,
  DrawerShell,
  Facts,
  Filters,
  FilterLabel,
  IconButton,
  Menu,
  PageHeader,
  Select,
  StateLabel,
  Stepper,
} from "../../ui";
import {
  projectLifecycleSteps,
  lifecycleLabel,
  lifecycleTone,
  planStateLabel,
  type Project,
  type PlanState,
} from "../../data/mock";
import { setProjectLifecycle, useProjects } from "../../data/store";
import { useSettings } from "../../data/settings";

const ALL = "__all";

export function ProjectsPage() {
  const search = useSearch({ strict: false }) as {
    id?: string;
    lifecycle?: string;
    tool?: string;
  };
  const navigate = useNavigate();
  const selectedId = search.id ?? null;
  const projects = useProjects();

  const settings = useSettings();
  const lifecycleFilter = search.lifecycle ?? ALL;
  const toolFilter = search.tool ?? ALL;
  const setLifecycleFilter = (v: string) =>
    navigate({
      to: "/projects",
      search: { ...search, lifecycle: v === ALL ? undefined : v },
    } as never);
  const setToolFilter = (v: string) =>
    navigate({
      to: "/projects",
      search: { ...search, tool: v === ALL ? undefined : v },
    } as never);

  const rows = useMemo(
    () =>
      projects.filter(
        (p) =>
          (lifecycleFilter === ALL || p.lifecycle === lifecycleFilter) &&
          (toolFilter === ALL || p.tool === toolFilter),
      ),
    [projects, lifecycleFilter, toolFilter],
  );

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  const onRowSelect = (row: Project) => {
    if (selectedId === row.id) {
      navigate({ to: "/projects", search: { ...search, id: undefined } } as never);
    } else {
      navigate({ to: "/projects", search: { ...search, id: row.id } } as never);
    }
  };
  const onClose = () =>
    navigate({ to: "/projects", search: { ...search, id: undefined } } as never);

  const main = (
    <div className="alm-page">
      <PageHeader
        title="Projects"
        subtitle={`${rows.length} of ${projects.length}`}
        actions={
          <Button variant="primary" leadingIcon={<Plus size={14} />}>
            New project
          </Button>
        }
      />
      <Filters>
        <FilterLabel>Lifecycle</FilterLabel>
        <Select
          ariaLabel="Lifecycle filter"
          value={lifecycleFilter}
          onValueChange={setLifecycleFilter}
          options={[
            { value: ALL, label: "All" },
            ...projectLifecycleSteps.map((s) => ({ value: s.id, label: s.label })),
            { value: "blocked", label: "Blocked" },
          ]}
          minWidth={150}
        />
        <FilterLabel>Tool</FilterLabel>
        <Select
          ariaLabel="Tool filter"
          value={toolFilter}
          onValueChange={setToolFilter}
          options={[
            { value: ALL, label: "All" },
            { value: "PixInsight", label: "PixInsight" },
            { value: "Siril", label: "Siril" },
            { value: "Planetary Suite", label: "Planetary Suite" },
          ]}
          minWidth={150}
        />
      </Filters>
      <div className="alm-page__body">
        <DataTable<Project>
          density={settings.rowDensity}
          rows={rows}
          selectedId={selectedId}
          onSelect={onRowSelect}
          rowOverflow={(row) => (
            <Menu
              trigger={
                <button type="button" className="alm-iconbtn" aria-label="Row actions">
                  <MoreVertical size={14} />
                </button>
              }
              groups={rowMenuGroupsForLifecycle(row.lifecycle, row.tool)}
            />
          )}
          columns={[
            { id: "name", header: "Name", size: 220, render: (row) => row.name },
            {
              id: "lifecycle",
              header: "Lifecycle",
              size: 140,
              render: (row) => (
                <StateLabel tone={lifecycleTone(row.lifecycle)}>
                  {lifecycleLabel(row.lifecycle)}
                </StateLabel>
              ),
            },
            {
              id: "sources",
              header: "Sources",
              size: 80,
              className: "alm-table__cell--num",
              render: (row) => row.sources.length,
            },
            {
              id: "tool",
              header: "Tool",
              size: 120,
              className: "alm-table__cell--dim",
              render: (row) => row.tool,
            },
            {
              id: "lastAction",
              header: "Last action",
              size: 220,
              className: "alm-table__cell--dim",
              render: (row) =>
                row.lastAction ? `${row.lastAction.label} · ${row.lastAction.when}` : "—",
            },
          ]}
        />
      </div>
    </div>
  );

  const drawer = selected
    ? (
      <DrawerShell
        title={selected.name}
        subtitle={`${selected.tool} · ${selected.channels.join(", ") || "no channels"}`}
        onClose={onClose}
        stepper={
          <>
            {selected.lifecycle === "blocked" ? (
              <div
                style={{
                  marginBottom: 8,
                  padding: "6px 10px",
                  borderRadius: "var(--r-sm)",
                  background: "var(--warn-soft)",
                  color: "var(--warn)",
                  fontSize: "var(--fs-dense)",
                  fontWeight: "var(--fw-medium)",
                }}
              >
                Blocked — resolve before continuing
              </div>
            ) : null}
            <Stepper
              steps={projectLifecycleSteps}
              currentStepId={
                selected.lifecycle === "blocked"
                  ? selected.lastAction
                    ? "ready"
                    : "setup_incomplete"
                  : selected.lifecycle
              }
              caption={
                selected.lastAction
                  ? `Last action: ${selected.lastAction.label}, ${selected.lastAction.when}`
                  : undefined
              }
            />
          </>
        }
        body={
          <Accordion
            sections={[
              {
                id: "lifecycle",
                title: "Lifecycle",
                defaultOpen: true,
                body: (
                  <Facts
                    entries={[
                      { label: "State", value: lifecycleLabel(selected.lifecycle) },
                      { label: "Tool", value: selected.tool },
                      { label: "Channels", value: selected.channels.join(", ") || "—" },
                      selected.lastAction
                        ? {
                            label: "Last action",
                            value: `${selected.lastAction.label} · ${selected.lastAction.when}`,
                          }
                        : null,
                    ].filter(Boolean) as Array<{ label: React.ReactNode; value: React.ReactNode }>}
                  />
                ),
              },
              {
                id: "sources",
                title: "Sources",
                count: selected.sources.length,
                defaultOpen: true,
                body: (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {selected.sources.length === 0 ? (
                      <span className="alm-text-faint" style={{ fontSize: "var(--fs-small)" }}>
                        No sources yet.
                      </span>
                    ) : (
                      selected.sources.map((s) => (
                        <div
                          key={s.inventoryId}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 70px 60px 70px 16px",
                            alignItems: "center",
                            gap: 8,
                            fontSize: "var(--fs-small)",
                            padding: "4px 0",
                            borderBottom: "1px solid var(--border-subtle)",
                          }}
                        >
                          <span>{s.name}</span>
                          <span className="alm-table__cell--num alm-dim">{s.frames}</span>
                          <span className="alm-dim">{s.filter}</span>
                          <span className="alm-dim">{s.exposure}</span>
                          <ArrowUpRight size={12} style={{ color: "var(--text-faint)" }} />
                        </div>
                      ))
                    )}
                    <button
                      type="button"
                      className="alm-btn"
                      data-variant="ghost"
                      data-size="sm"
                      style={{ alignSelf: "flex-start", marginTop: 4 }}
                    >
                      <Plus size={12} /> Add source
                    </button>
                  </div>
                ),
              },
              {
                id: "calibration",
                title: "Calibration sets",
                count: selected.calibrationSets.length,
                body: (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {selected.calibrationSets.length === 0 ? (
                      <span className="alm-text-faint">No calibration mapped.</span>
                    ) : (
                      selected.calibrationSets.map((c) => (
                        <div
                          key={c.id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: "var(--fs-small)",
                            padding: "4px 0",
                          }}
                        >
                          <span>{c.label}</span>
                          <span className="alm-dim alm-text-dense">matched ({c.matched})</span>
                        </div>
                      ))
                    )}
                  </div>
                ),
              },
              {
                id: "plans",
                title: "Plans",
                count: selected.plans.length,
                body: (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {selected.plans.length === 0 ? (
                      <span className="alm-text-faint">No plans yet.</span>
                    ) : (
                      selected.plans.map((p) => (
                        <div
                          key={p.id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "4px 0",
                            fontSize: "var(--fs-small)",
                          }}
                        >
                          <span>{p.title}</span>
                          <span className="alm-dim alm-text-dense">
                            {planStateLabel(p.state as PlanState)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                ),
              },
              {
                id: "manifests",
                title: "Manifests",
                count: selected.manifests.length,
                body: (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {selected.manifests.map((m) => (
                      <details
                        key={m.id}
                        style={{
                          borderBottom: "1px solid var(--border-subtle)",
                          padding: "4px 0",
                        }}
                      >
                        <summary
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            cursor: "pointer",
                            fontSize: "var(--fs-small)",
                          }}
                        >
                          <span>{m.reason}</span>
                          <span className="alm-mono alm-dim">{m.timestamp}</span>
                        </summary>
                        {m.body ? (
                          <div
                            style={{
                              padding: "8px 0",
                              fontSize: "var(--fs-dense)",
                              color: "var(--text-dim)",
                            }}
                          >
                            <div>
                              <strong>Sources</strong>
                              <ul style={{ margin: "2px 0 6px 16px", padding: 0 }}>
                                {m.body.sources.map((s, i) => (
                                  <li key={i}>{s}</li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <strong>Calibration</strong>
                              <ul style={{ margin: "2px 0 6px 16px", padding: 0 }}>
                                {m.body.calibration.map((s, i) => (
                                  <li key={i}>{s}</li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <strong>Lifecycle:</strong> {m.body.lifecycle}
                            </div>
                            {m.body.notes ? (
                              <div>
                                <strong>Notes:</strong> {m.body.notes}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <div
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "var(--fs-micro)",
                            color: "var(--text-faint)",
                            marginTop: 4,
                          }}
                        >
                          {m.path}
                        </div>
                      </details>
                    ))}
                  </div>
                ),
              },
              {
                id: "notes",
                title: "Notes",
                body: selected.notes ? (
                  <p
                    style={{
                      fontSize: "var(--fs-small)",
                      color: "var(--text-dim)",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {selected.notes}
                  </p>
                ) : (
                  <span className="alm-text-faint">No notes.</span>
                ),
              },
              {
                id: "tools",
                title: "Tool launches",
                body: <span className="alm-text-faint">No recent launches.</span>,
              },
            ]}
          />
        }
        footer={projectFooter(selected)}
      />
    )
    : null;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <DockedDrawer main={main} drawer={drawer} defaultDrawerSize={42} />
    </div>
  );
}

function rowMenuGroupsForLifecycle(lifecycle: Project["lifecycle"], tool: Project["tool"]) {
  if (lifecycle === "archived") {
    return [
      {
        id: "row",
        items: [
          { id: "view", label: "View (read-only)" },
          { id: "manifests", label: "Reveal manifest folder" },
        ],
      },
      {
        id: "row-2",
        items: [{ id: "unarchive", label: "Unarchive…" }],
      },
    ];
  }
  const open = lifecycle === "setup_incomplete"
    ? { id: "continue", label: "Continue setup" }
    : { id: "open-tool", label: `Open in ${tool}` };
  return [
    {
      id: "row",
      items: [
        { id: "open", label: "Open" },
        { id: "edit", label: "Edit…" },
        open,
      ],
    },
    {
      id: "row-2",
      items: [{ id: "archive", label: "Archive…", tone: "danger" as const }],
    },
  ];
}

function projectFooter(project: Project) {
  const overflow = (
    <Menu
      trigger={
        <button type="button" className="alm-iconbtn" aria-label="More actions">
          <MoreVertical size={14} />
        </button>
      }
      groups={[
        { id: "g1", items: [{ id: "duplicate", label: "Duplicate project" }, { id: "export", label: "Export manifest…" }] },
        { id: "g2", items: [{ id: "archive", label: "Archive…", tone: "danger" as const }] },
      ]}
    />
  );

  switch (project.lifecycle) {
    case "setup_incomplete":
      return (
        <>
          <Button variant="primary">Continue setup</Button>
          <Button>Edit</Button>
          <span style={{ flex: 1 }} />
          {overflow}
        </>
      );
    case "ready":
    case "prepared":
      return (
        <>
          <Button variant="primary" leadingIcon={<FolderOpen size={14} />}>
            Open in {project.tool}
          </Button>
          <Button onClick={() => setProjectLifecycle(project.id, "processing")}>
            Mark as Processing
          </Button>
          <span style={{ flex: 1 }} />
          {overflow}
        </>
      );
    case "processing":
      return (
        <>
          <Button variant="primary" leadingIcon={<FolderOpen size={14} />}>
            Open in {project.tool}
          </Button>
          <Button onClick={() => setProjectLifecycle(project.id, "completed")}>
            Mark as Completed
          </Button>
          <span style={{ flex: 1 }} />
          {overflow}
        </>
      );
    case "completed":
      return (
        <>
          <Button variant="primary" leadingIcon={<FolderOpen size={14} />}>
            Open in {project.tool}
          </Button>
          {project.sources.length > 0 ? (
            <Button>Generate cleanup plan…</Button>
          ) : null}
          <span style={{ flex: 1 }} />
          {overflow}
        </>
      );
    case "archived":
      return (
        <>
          <Button
            variant="primary"
            onClick={() =>
              setProjectLifecycle(project.id, "processing", "Unarchived")
            }
          >
            Unarchive…
          </Button>
          <span style={{ flex: 1 }} />
          <span className="alm-text-dense alm-dim">
            Project is read-only while archived.
          </span>
        </>
      );
    case "blocked":
      return (
        <>
          <Button variant="primary">Resolve blocker…</Button>
          <Button>Edit</Button>
          <span style={{ flex: 1 }} />
          {overflow}
        </>
      );
  }
}
