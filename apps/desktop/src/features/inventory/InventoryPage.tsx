import { useMemo } from "react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { MoreVertical, Plus, FolderOpen, ArrowUpRight } from "lucide-react";

import {
  Button,
  DataTable,
  DockedDrawer,
  DrawerShell,
  EmptyState,
  FactGroup,
  Facts,
  Filters,
  FilterLabel,
  Menu,
  PageHeader,
  Select,
  StateLabel,
} from "../../ui";
import {
  inventoryStateLabel,
  inventoryStateTone,
  type InventorySession,
  type InventorySource,
} from "../../data/mock";
import { setSessionReviewState, useInventorySources } from "../../data/store";
import { useSettings } from "../../data/settings";

const ALL = "__all";

export function InventoryPage() {
  const search = useSearch({ strict: false }) as {
    id?: string;
    source?: string;
    frame?: string;
    review?: string;
  };
  const navigate = useNavigate();
  const selectedId = search.id ?? null;
  const inventorySources = useInventorySources();

  const settings = useSettings();
  const sourceFilter = search.source ?? ALL;
  const frameTypeFilter = search.frame ?? ALL;
  const reviewFilter = search.review ?? ALL;

  const setSourceFilter = (v: string) =>
    navigate({
      to: "/inventory",
      search: { ...search, source: v === ALL ? undefined : v },
    } as never);
  const setFrameTypeFilter = (v: string) =>
    navigate({
      to: "/inventory",
      search: { ...search, frame: v === ALL ? undefined : v },
    } as never);
  const setReviewFilter = (v: string) =>
    navigate({
      to: "/inventory",
      search: { ...search, review: v === ALL ? undefined : v },
    } as never);

  const groups = useMemo(
    () =>
      inventorySources
        .filter((s) => sourceFilter === ALL || s.id === sourceFilter)
        .map<{ id: string; heading: React.ReactNode; meta: React.ReactNode; rows: InventorySession[]; source: InventorySource }>((s) => ({
          id: s.id,
          heading: <span style={{ fontFamily: "var(--font-mono)", textTransform: "none", letterSpacing: 0 }}>{s.path}</span>,
          meta: `${s.kind.replace("_", " ")} · ${s.state}`,
          source: s,
          rows: s.sessions.filter(
            (sess) =>
              (frameTypeFilter === ALL || sess.type === frameTypeFilter) &&
              (reviewFilter === ALL || sess.state === reviewFilter),
          ),
        }))
        .filter((g) => g.rows.length > 0),
    [inventorySources, sourceFilter, frameTypeFilter, reviewFilter],
  );

  const allSessions = inventorySources.flatMap((s) => s.sessions);
  const selected = allSessions.find((s) => s.id === selectedId) ?? null;

  const onRowSelect = (row: InventorySession) => {
    if (selectedId === row.id) {
      navigate({ to: "/inventory", search: { ...search, id: undefined } } as never);
    } else {
      navigate({ to: "/inventory", search: { ...search, id: row.id } } as never);
    }
  };

  const onClose = () =>
    navigate({ to: "/inventory", search: { ...search, id: undefined } } as never);

  const main = (
    <div className="alm-page">
      <PageHeader
        title="Inventory"
        subtitle={`${allSessions.length} sessions · ${allSessions.reduce((a, s) => a + s.frames, 0)} frames`}
        actions={
          <>
            <Button leadingIcon={<Plus size={14} />}>Add source</Button>
            <Menu
              trigger={
                <button
                  type="button"
                  className="alm-iconbtn"
                  aria-label="More actions"
                >
                  <MoreVertical size={15} />
                </button>
              }
              groups={[
                {
                  id: "scan",
                  items: [
                    { id: "rescan", label: "Rescan all sources" },
                    { id: "export", label: "Export inventory…" },
                  ],
                },
              ]}
            />
          </>
        }
      />
      <Filters>
        <FilterLabel>Source</FilterLabel>
        <Select
          ariaLabel="Source filter"
          value={sourceFilter}
          onValueChange={setSourceFilter}
          options={[
            { value: ALL, label: "All sources" },
            ...inventorySources.map((s) => ({ value: s.id, label: s.path })),
          ]}
          minWidth={200}
        />
        <FilterLabel>Frame type</FilterLabel>
        <Select
          ariaLabel="Frame type filter"
          value={frameTypeFilter}
          onValueChange={setFrameTypeFilter}
          options={[
            { value: ALL, label: "All types" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "flat", label: "Flat" },
            { value: "bias", label: "Bias" },
            { value: "mixed", label: "Mixed" },
          ]}
          minWidth={140}
        />
        <FilterLabel>Review</FilterLabel>
        <Select
          ariaLabel="Review state filter"
          value={reviewFilter}
          onValueChange={setReviewFilter}
          options={[
            { value: ALL, label: "All" },
            { value: "confirmed", label: "Confirmed" },
            { value: "needs_review", label: "Needs review" },
            { value: "rejected", label: "Rejected" },
          ]}
          minWidth={140}
        />
      </Filters>
      <div className="alm-page__body">
        {groups.length === 0 ? (
          <EmptyState
            message={
              inventorySources.length === 0
                ? "No data sources registered yet."
                : "No sessions match the current filters."
            }
            action={
              inventorySources.length === 0 ? (
                <Button variant="primary" leadingIcon={<Plus size={14} />}>
                  Add a data source
                </Button>
              ) : (
                <Button
                  onClick={() =>
                    navigate({
                      to: "/inventory",
                      search: { id: selectedId ?? undefined },
                    } as never)
                  }
                >
                  Clear filters
                </Button>
              )
            }
          />
        ) : null}
        {groups.length > 0 ? <DataTable<InventorySession>
          density={settings.rowDensity}
          groups={groups.map((g) => ({ id: g.id, heading: g.heading, meta: g.meta, rows: g.rows }))}
          selectedId={selectedId}
          onSelect={onRowSelect}
          rowOverflow={() => (
            <Menu
              trigger={
                <button type="button" className="alm-iconbtn" aria-label="Row actions">
                  <MoreVertical size={14} />
                </button>
              }
              groups={[
                {
                  id: "row",
                  items: [
                    { id: "reveal", label: "Reveal in OS" },
                    { id: "reassign", label: "Reassign session…" },
                  ],
                },
              ]}
            />
          )}
          columns={[
            {
              id: "name",
              header: "Name",
              size: 220,
              render: (row) => row.name,
            },
            {
              id: "frames",
              header: "Frames",
              size: 70,
              className: "alm-table__cell--num",
              render: (row) => row.frames,
            },
            {
              id: "type",
              header: "Type",
              size: 80,
              className: "alm-table__cell--dim",
              render: (row) => row.type,
            },
            {
              id: "target",
              header: "Target",
              size: 100,
              render: (row) => row.target ?? <span className="alm-text-faint">—</span>,
            },
            {
              id: "filter",
              header: "Filter",
              size: 70,
              render: (row) => row.filter ?? <span className="alm-text-faint">—</span>,
            },
            {
              id: "exposure",
              header: "Exposure",
              size: 90,
              className: "alm-table__cell--dim",
              render: (row) => row.exposure ?? <span className="alm-text-faint">—</span>,
            },
            {
              id: "state",
              header: "State",
              size: 130,
              render: (row) => (
                <StateLabel tone={inventoryStateTone(row.state)}>
                  {inventoryStateLabel(row.state)}
                </StateLabel>
              ),
            },
          ]}
        /> : null}
      </div>
    </div>
  );

  const drawer = selected
    ? (
      <DrawerShell
        title={selected.name}
        subtitle={`${selected.type} · ${selected.frames} frames${selected.filter ? ` · ${selected.filter}` : ""}`}
        onClose={onClose}
        body={
          <>
            <FactGroup label="Lifecycle">
              <Facts
                entries={[
                  {
                    label: "State",
                    value: (
                      <StateLabel tone={inventoryStateTone(selected.state)}>
                        {inventoryStateLabel(selected.state)}
                      </StateLabel>
                    ),
                  },
                  selected.capturedOn
                    ? { label: "Captured", value: selected.capturedOn }
                    : null,
                ].filter(Boolean) as Array<{ label: React.ReactNode; value: React.ReactNode }>}
              />
            </FactGroup>

            <FactGroup label="Facts">
              <Facts
                entries={[
                  { label: "Target", value: selected.target ?? "—" },
                  { label: "Frame", value: selected.type },
                  { label: "Filter", value: selected.filter ?? "—" },
                  { label: "Exposure", value: selected.exposure ?? "—" },
                  { label: "Camera", value: selected.camera ?? "—" },
                  selected.gain ? { label: "Gain", value: selected.gain } : null,
                  selected.binning ? { label: "Binning", value: selected.binning } : null,
                  selected.setTemp ? { label: "Set temp", value: selected.setTemp } : null,
                ].filter(Boolean) as Array<{ label: React.ReactNode; value: React.ReactNode }>}
              />
            </FactGroup>

            {selected.provenance ? (
              <FactGroup label="Provenance">
                <Facts
                  entries={[
                    selected.provenance.target
                      ? { label: "Target", value: selected.provenance.target }
                      : null,
                    selected.provenance.filter
                      ? { label: "Filter", value: selected.provenance.filter }
                      : null,
                    selected.provenance.inferred
                      ? { label: "Inferred", value: selected.provenance.inferred }
                      : null,
                    selected.provenance.confirmedBy
                      ? { label: "Confirmed", value: selected.provenance.confirmedBy }
                      : null,
                  ].filter(Boolean) as Array<{ label: React.ReactNode; value: React.ReactNode }>}
                />
              </FactGroup>
            ) : null}

            {selected.linked ? (
              <FactGroup label="Linked">
                <Facts
                  entries={[
                    selected.linked.projects?.length
                      ? {
                          label: "Project",
                          value: (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                              {selected.linked.projects[0].name} <ArrowUpRight size={12} />
                            </span>
                          ),
                        }
                      : null,
                    selected.linked.session
                      ? { label: "Session", value: selected.linked.session }
                      : null,
                    selected.linked.calibration
                      ? { label: "Calibration", value: selected.linked.calibration }
                      : null,
                  ].filter(Boolean) as Array<{ label: React.ReactNode; value: React.ReactNode }>}
                />
              </FactGroup>
            ) : null}
          </>
        }
        footer={
          <>
            {selected.state === "needs_review" ? (
              <Button
                variant="primary"
                onClick={() => setSessionReviewState(selected.id, "confirmed")}
              >
                Confirm
              </Button>
            ) : null}
            <Button leadingIcon={<FolderOpen size={14} />}>Reveal in OS</Button>
            <Button>Reclassify…</Button>
            <span style={{ flex: 1 }} />
            <Menu
              trigger={
                <button type="button" className="alm-iconbtn" aria-label="More actions">
                  <MoreVertical size={14} />
                </button>
              }
              groups={[
                {
                  id: "more",
                  items: [
                    { id: "rename", label: "Rename session…" },
                    { id: "merge", label: "Merge into another session…" },
                    ...(selected.state !== "needs_review"
                      ? [
                          {
                            id: "reopen",
                            label: "Re-open review",
                            onSelect: () =>
                              setSessionReviewState(selected.id, "needs_review"),
                          },
                        ]
                      : []),
                  ],
                },
                {
                  id: "more-2",
                  items: [
                    {
                      id: "reject",
                      label: "Reject session",
                      tone: "danger" as const,
                      onSelect: () => setSessionReviewState(selected.id, "rejected"),
                    },
                  ],
                },
              ]}
            />
          </>
        }
      />
    )
    : null;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <DockedDrawer main={main} drawer={drawer} />
    </div>
  );
}
