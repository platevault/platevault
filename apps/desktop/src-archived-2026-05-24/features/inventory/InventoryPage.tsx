// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo, useState } from "react";
import { useSearch, useNavigate, Link } from "@tanstack/react-router";
import {
  MoreVertical,
  Plus,
  FolderOpen,
  ArrowUpRight,
  Check,
  X,
  AlertTriangle,
  WifiOff,
  HardDrive,
} from "lucide-react";

import {
  Button,
  IconButton,
  DataTable,
  DockedDrawer,
  DrawerShell,
  EmptyState,
  FactGroup,
  Facts,
  Filters,
  FilterLabel,
  Menu,
  MultiSelect,
  PageHeader,
  Select,
  StateLabel,
  sortRows,
  type DataTableColumn,
  Chip,
  CalibrationCell,
  BulkActionBar,
  RemapSourceDialog,
  InlineLink,
  type MultiSelectOption,
} from "../../ui";
import { AddSourceDialog } from "../../ui/AddSourceDialog";
import {
  inventoryStateLabel,
  inventoryStateTone,
  INVENTORY_STATES,
  type InventorySession,
  type InventorySessionState,
} from "../../data/mock";
import { setSessionReviewState, useInventorySources, useProjects, addInventorySource } from "../../data/store";
import { useSettings } from "../../data/settings";
import { useProvenance } from "../../data/provenance";
import { ProvenanceSection } from "../../ui";

const DEFAULT_SORT = "date:desc";

type GroupMode = "source" | "target" | "date";

/** Calibration frame types — library-wide, not assignable to projects. */
const CALIBRATION_TYPES = new Set(["dark", "flat", "bias", "dark_flat"]);

function isCalibrationSession(type: InventorySession["type"]): boolean {
  return CALIBRATION_TYPES.has(type);
}

/**
 * Provenance pane for an inventory session. Reads the spec 002
 * `ProvenanceField[]` payload via `useProvenance` — `calibration_session`
 * for bias/dark/flat, `acquisition_session` otherwise. In `pnpm dev` this
 * resolves through the dev shim that synthesises fields from the legacy
 * `InventorySession.provenance` dict; under Tauri it hits the contract.
 */
function SessionProvenance({
  sessionId,
  sessionType,
}: {
  sessionId: string;
  sessionType: InventorySession["type"];
}) {
  const assetType = isCalibrationSession(sessionType)
    ? ("calibration_session" as const)
    : ("acquisition_session" as const);
  const { data, loading, error } = useProvenance(sessionId, assetType);
  const hasContent = loading || error || (data && data.length > 0);
  if (!hasContent) return null;
  return (
    <FactGroup label="Provenance">
      <ProvenanceSection fields={data} loading={loading} error={error} />
    </FactGroup>
  );
}

const DEFAULT_STATES: InventorySessionState[] = [
  "discovered",
  "candidate",
  "needs_review",
  "confirmed",
];

const ALL_FRAME_TYPES = ["light", "dark", "flat", "bias", "mixed", "dark_flat"] as const;
type FrameTypeFilter = (typeof ALL_FRAME_TYPES)[number];

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

function serializeCSV<T extends string>(values: T[], defaultVal: T[]): string | undefined {
  const sorted = [...values].sort();
  const def = [...defaultVal].sort();
  if (sorted.length === def.length && sorted.every((s, i) => s === def[i])) return undefined;
  return sorted.join(",");
}

function serializeSourceCSV(values: string[], allIds: string[]): string | undefined {
  if (values.length === allIds.length) return undefined;
  return values.join(",");
}

function parseSourceCSV(raw: string | undefined, allIds: string[]): string[] {
  if (!raw) return allIds;
  const ids = raw.split(",").filter((s) => s.length > 0);
  return ids.length > 0 ? ids : allIds;
}

function parseSort(sort: string | undefined): { id: string; dir: "asc" | "desc" } {
  if (!sort) return { id: "date", dir: "desc" };
  const [id = "date", rawDir] = sort.split(":");
  const dir = rawDir === "asc" ? "asc" : "desc";
  return { id, dir };
}

/** Ordinal for state sort — mirrors INVENTORY_STATES array order */
function stateOrdinal(state: InventorySessionState): number {
  const idx = INVENTORY_STATES.indexOf(state);
  return idx >= 0 ? idx : 99;
}

export function InventoryPage() {
  const search = useSearch({ strict: false }) as {
    id?: string;
    source?: string;
    frame?: string;
    states?: string;
    group?: GroupMode;
    sort?: string;
  };
  const navigate = useNavigate();
  const selectedId = search.id ?? null;
  const inventorySources = useInventorySources();
  const [bulkSelection, setBulkSelection] = useState<Set<string>>(new Set());
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [remapSourceId, setRemapSourceId] = useState<string | null>(null);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const remapSource = remapSourceId ? inventorySources.find((s) => s.id === remapSourceId) : null;

  const settings = useSettings();

  const allSourceIds = useMemo(() => inventorySources.map((s) => s.id), [inventorySources]);
  const activeSourceIds = parseSourceCSV(search.source, allSourceIds);
  const activeFrameTypes = parseCSV<FrameTypeFilter>(search.frame, ALL_FRAME_TYPES, [...ALL_FRAME_TYPES]);
  const activeStates = parseCSV<InventorySessionState>(search.states, INVENTORY_STATES, DEFAULT_STATES);
  const groupMode: GroupMode = search.group ?? "source";
  const sortState = parseSort(search.sort);

  const navigate_ = (patch: Partial<typeof search>) => {
    const next = { ...search, ...patch };
    navigate({ to: "/inventory", search: next } as never);
  };

  const setActiveSourceIds = (ids: string[]) => {
    navigate_({ source: serializeSourceCSV(ids, allSourceIds) });
  };

  const setActiveFrameTypes = (types: string[]) => {
    navigate_({ frame: serializeCSV(types as FrameTypeFilter[], [...ALL_FRAME_TYPES]) });
  };

  const setActiveStates = (states: string[]) => {
    navigate_({ states: serializeCSV(states as InventorySessionState[], DEFAULT_STATES) });
  };

  const setGroupMode = (v: GroupMode) => navigate_({ group: v === "source" ? undefined : v });

  const handleSortChange = (next: { id: string; dir: "asc" | "desc" } | null) => {
    const sortStr = next ? `${next.id}:${next.dir}` : undefined;
    const isDefault = !sortStr || sortStr === DEFAULT_SORT;
    navigate_({ sort: isDefault ? undefined : sortStr });
  };

  // MultiSelect options for sources
  const sourceOptions: MultiSelectOption[] = useMemo(
    () => inventorySources.map((s) => ({ value: s.id, label: s.path })),
    [inventorySources],
  );

  // MultiSelect options for frame types
  const frameTypeOptions: MultiSelectOption[] = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "flat", label: "Flat" },
    { value: "bias", label: "Bias" },
    { value: "mixed", label: "Mixed" },
    { value: "dark_flat", label: "Dark flat" },
  ];

  // MultiSelect options for states with tones
  const stateOptions: MultiSelectOption[] = INVENTORY_STATES.map((s) => ({
    value: s,
    label: inventoryStateLabel(s),
    tone: inventoryStateTone(s) as "neutral" | "success" | "warn" | "danger",
  }));

  const columns: DataTableColumn<InventorySession>[] = useMemo(
    () => [
      {
        id: "date",
        header: "Date",
        size: 100,
        className: "alm-table__cell--dim",
        sortable: true,
        accessor: (row) => row.capturedOn ?? null,
        render: (row) => row.capturedOn ?? <span className="alm-text-faint">—</span>,
      },
      {
        id: "target",
        header: "Target",
        size: 110,
        sortable: true,
        accessor: (row) => row.target ?? null,
        render: (row) => row.target ?? <span className="alm-text-faint">—</span>,
      },
      {
        id: "frames",
        header: "Frames",
        size: 70,
        className: "alm-table__cell--num",
        sortable: true,
        accessor: (row) => row.frames,
        render: (row) => row.frames,
      },
      {
        id: "type",
        header: "Type",
        size: 70,
        className: "alm-table__cell--dim",
        sortable: true,
        accessor: (row) => row.type,
        render: (row) => row.type,
      },
      {
        id: "filter",
        header: "Filter",
        size: 60,
        sortable: true,
        accessor: (row) => row.filter ?? null,
        render: (row) => row.filter ?? <span className="alm-text-faint">—</span>,
      },
      {
        id: "exposure",
        header: "Exposure",
        size: 80,
        className: "alm-table__cell--dim",
        sortable: true,
        accessor: (row) => row.exposure ?? null,
        render: (row) => row.exposure ?? <span className="alm-text-faint">—</span>,
      },
      {
        id: "project",
        header: "Project",
        size: 160,
        sortable: true,
        accessor: (row) => {
          if (isCalibrationSession(row.type)) return null;
          return row.linked?.projects?.[0]?.name ?? null;
        },
        render: (row) => {
          // Calibration frames are library-wide — not applicable to a project
          if (isCalibrationSession(row.type)) {
            return <span className="alm-text-faint">—</span>;
          }
          const p = row.linked?.projects?.[0];
          if (!p) return <span className="alm-text-faint">unassigned</span>;
          return (
            <InlineLink
              to="/projects"
              search={{ id: p.id }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              {p.name} <ArrowUpRight size={11} />
            </InlineLink>
          );
        },
      },
      {
        id: "cal",
        header: "Cal",
        size: 50,
        className: "alm-table__cell--center",
        sortable: false,
        render: (row) => <CalibrationCell row={row} />,
      },
      {
        id: "state",
        header: "State",
        size: 140,
        sortable: true,
        accessor: (row) => stateOrdinal(row.state),
        render: (row) => (
          <Menu
            trigger={
              <button
                type="button"
                className="alm-statebtn"
                onClick={(e) => e.stopPropagation()}
                aria-label={`Change state (currently ${inventoryStateLabel(row.state)})`}
              >
                <StateLabel tone={inventoryStateTone(row.state)}>
                  {inventoryStateLabel(row.state)}
                </StateLabel>
              </button>
            }
            groups={[
              {
                id: "set",
                items: INVENTORY_STATES.filter((s) => s !== row.state).map((s) => ({
                  id: `to-${s}`,
                  label: `Mark ${inventoryStateLabel(s)}`,
                  onSelect: () => setSessionReviewState(row.id, s),
                  tone: s === "rejected" ? ("danger" as const) : undefined,
                })),
              },
            ]}
          />
        ),
      },
    ],
    [],
  );

  const allSessions = useMemo(
    () => inventorySources.flatMap((src) => src.sessions.map((sess) => ({ sess, src }))),
    [inventorySources],
  );

  const activeSourceSet = new Set(activeSourceIds);
  const activeFrameSet = new Set(activeFrameTypes);
  const activeStateSet = new Set(activeStates);

  const filtered = useMemo(
    () =>
      allSessions.filter(
        ({ sess, src }) =>
          activeSourceSet.has(src.id) &&
          activeFrameSet.has(sess.type) &&
          activeStateSet.has(sess.state),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allSessions, search.source, search.frame, search.states, allSourceIds.join(",")],
  );

  const activeCol = columns.find((c) => c.id === sortState.id);

  const groups = useMemo(() => {
    const map = new Map<
      string,
      { id: string; heading: React.ReactNode; meta: React.ReactNode; rows: InventorySession[] }
    >();
    for (const { sess, src } of filtered) {
      const { key, heading, meta } = bucketFor(groupMode, sess, src, setRemapSourceId);
      let bucket = map.get(key);
      if (!bucket) {
        bucket = { id: key, heading, meta, rows: [] };
        map.set(key, bucket);
      }
      bucket.rows.push(sess);
    }
    const arr = Array.from(map.values());
    arr.sort((a, b) => a.id.localeCompare(b.id));
    if (activeCol) {
      return arr.map((g) => ({
        ...g,
        rows: sortRows(g.rows, activeCol, sortState.dir),
      }));
    }
    return arr;
  }, [filtered, groupMode, activeCol, sortState.dir]);

  const allFlat = inventorySources.flatMap((s) => s.sessions);
  const selected = allFlat.find((s) => s.id === selectedId) ?? null;

  const onRowSelect = (row: InventorySession) => {
    if (selectedId === row.id) {
      navigate_({ id: undefined });
    } else {
      navigate_({ id: row.id });
    }
  };

  const onClose = () => navigate_({ id: undefined });

  const main = (
    <div className="alm-page">
      <PageHeader
        title="Inventory"
        subtitle={`${allFlat.length} sessions · ${allFlat.reduce((a, s) => a + s.frames, 0)} frames`}
        actions={
          <>
            <Button leadingIcon={<Plus size={14} />} onClick={() => setAddSourceOpen(true)}>Add source</Button>
            <Menu
              trigger={
                <IconButton aria-label="More actions">
                  <MoreVertical size={15} />
                </IconButton>
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
        <MultiSelect
          ariaLabel="Source filter"
          value={activeSourceIds}
          options={sourceOptions}
          onValueChange={setActiveSourceIds}
          allLabel="All sources"
          emptyLabel="No sources"
          minWidth={200}
        />
        <FilterLabel>Frame type</FilterLabel>
        <MultiSelect
          ariaLabel="Frame type filter"
          value={activeFrameTypes}
          options={frameTypeOptions}
          onValueChange={setActiveFrameTypes}
          allLabel="All types"
          emptyLabel="No types"
          minWidth={140}
        />
        <FilterLabel>State</FilterLabel>
        <MultiSelect
          ariaLabel="State filter"
          value={activeStates}
          options={stateOptions}
          onValueChange={setActiveStates}
          allLabel="All states"
          emptyLabel="No states"
          minWidth={140}
          showTones
        />
        <FilterLabel>Group by</FilterLabel>
        <Select
          ariaLabel="Group by"
          value={groupMode}
          onValueChange={(v) => setGroupMode(v as GroupMode)}
          options={[
            { value: "source", label: "Source" },
            { value: "target", label: "Target" },
            { value: "date", label: "Date" },
          ]}
          minWidth={120}
        />
      </Filters>
      <div className="alm-page__body">
        {groups.length === 0 && inventorySources.length === 0 ? (
          <EmptyState
            icon={<HardDrive size={36} />}
            heading="No inventory yet"
            description="Register at least one raw-image source so ALM can index it. Nothing moves during scan."
            action={
              <Button
                variant="primary"
                leadingIcon={<Plus size={14} />}
                onClick={() => setAddSourceOpen(true)}
              >
                Add a source…
              </Button>
            }
            secondaryAction={
              <Link to="/welcome" className="alm-inline-link">
                Restart setup wizard
              </Link>
            }
          />
        ) : groups.length === 0 ? (
          <EmptyState
            heading="No sessions match these filters"
            description="Try widening the state filter or clearing the source and frame filters above."
            action={
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
            }
          />
        ) : null}
        {groups.length > 0 ? (
          <DataTable<InventorySession>
            density={settings.rowDensity}
            groups={groups.map((g) => ({ id: g.id, heading: g.heading, meta: g.meta, rows: g.rows }))}
            selectedId={selectedId}
            onSelect={onRowSelect}
            sort={search.sort ? sortState : null}
            onSortChange={handleSortChange}
            selectedIds={bulkSelection}
            onToggleRow={(row, mods) => {
              const flatList = groups.flatMap((g) => g.rows);
              setBulkSelection((prev) => {
                const next = new Set(prev);
                if (mods.shift && lastChecked) {
                  const lastIdx = flatList.findIndex((r) => r.id === lastChecked);
                  const currIdx = flatList.findIndex((r) => r.id === row.id);
                  if (lastIdx >= 0 && currIdx >= 0) {
                    const [from, to] = lastIdx < currIdx ? [lastIdx, currIdx] : [currIdx, lastIdx];
                    for (let i = from; i <= to; i++) next.add(flatList[i].id);
                    return next;
                  }
                }
                if (next.has(row.id)) next.delete(row.id);
                else next.add(row.id);
                return next;
              });
              setLastChecked(row.id);
            }}
            onToggleAll={() => {
              const flatList = groups.flatMap((g) => g.rows);
              setBulkSelection((prev) => {
                const allChecked = flatList.every((r) => prev.has(r.id));
                if (allChecked) return new Set();
                return new Set(flatList.map((r) => r.id));
              });
            }}
            rowOverflow={() => (
              <Menu
                trigger={
                  <IconButton size="sm" aria-label="Row actions">
                    <MoreVertical size={14} />
                  </IconButton>
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
            columns={columns}
          />
        ) : null}
      </div>
      {bulkSelection.size > 0 ? (
        <BulkActionBar
          count={bulkSelection.size}
          onClear={() => setBulkSelection(new Set())}
          aria-label="Bulk actions"
          actions={
            <>
              <Button onClick={() => bulkApplyState("confirmed", bulkSelection, setBulkSelection)}>Confirm</Button>
              <Button onClick={() => bulkApplyState("needs_review", bulkSelection, setBulkSelection)}>Needs review</Button>
              <Button onClick={() => bulkApplyState("rejected", bulkSelection, setBulkSelection)} variant="danger">Reject</Button>
              <Menu
                trigger={<Button variant="ghost">More…</Button>}
                groups={[
                  {
                    id: "more",
                    items: [
                      { id: "assign", label: "Assign to project…" },
                      { id: "reclass", label: "Re-classify…" },
                      { id: "reveal", label: "Reveal in OS" },
                    ],
                  },
                  {
                    id: "ignore",
                    items: [
                      { id: "ignore", label: "Ignore", tone: "danger" as const, onSelect: () => bulkApplyState("ignored", bulkSelection, setBulkSelection) },
                    ],
                  },
                ]}
              />
            </>
          }
        />
      ) : null}
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

            <SessionProvenance
              sessionId={selected.id}
              sessionType={selected.type}
            />


            {/* Project assignment: only for light/mixed sessions */}
            {selected.type === "light" || selected.type === "mixed" ? (
              <FactGroup label="Project">
                <ProjectAssign sessionId={selected.id} current={selected.linked?.projects?.[0]} />
              </FactGroup>
            ) : isCalibrationSession(selected.type) ? (
              <FactGroup label="Calibration scope">
                <span style={{ fontSize: "var(--fs-small)", color: "var(--text-dim)" }}>
                  Calibration frames are reusable across projects.
                </span>
              </FactGroup>
            ) : null}

            {selected.type === "light" || selected.type === "mixed" ? (
              <FactGroup label="Calibration match">
                <CalibrationDetails session={selected} />
              </FactGroup>
            ) : selected.usedByLightSessions != null ? (
              <FactGroup label="Calibration usage">
                <Facts
                  entries={[
                    {
                      label: "Used by",
                      value: `${selected.usedByLightSessions} light session${selected.usedByLightSessions === 1 ? "" : "s"}`,
                    },
                  ]}
                />
              </FactGroup>
            ) : null}

            {selected.observerLocation ? (
              <FactGroup label="Observer location">
                <Facts
                  entries={[
                    {
                      label: "Latitude",
                      value: `${selected.observerLocation.latitude.toFixed(3)}° N`,
                    },
                    {
                      label: "Longitude",
                      value: `${selected.observerLocation.longitude.toFixed(3)}° E`,
                    },
                    selected.observerLocation.elevation != null
                      ? { label: "Elevation", value: `${selected.observerLocation.elevation} m` }
                      : null,
                    {
                      label: "Source",
                      value: observerLocationSourceLabel(selected.observerLocation.source),
                    },
                  ].filter(Boolean) as Array<{ label: React.ReactNode; value: React.ReactNode }>}
                />
              </FactGroup>
            ) : null}

            {selected.linked?.session ? (
              <FactGroup label="Linked">
                <Facts
                  entries={[{ label: "Session", value: selected.linked.session }]}
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
                <IconButton size="sm" aria-label="More actions">
                  <MoreVertical size={14} />
                </IconButton>
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
      {remapSource ? (
        <RemapSourceDialog
          open={remapSourceId !== null}
          onOpenChange={(o) => { if (!o) setRemapSourceId(null); }}
          sourceId={remapSource.id}
          currentPath={remapSource.path}
          lastSeen="2026-05-19"
        />
      ) : null}
      <AddSourceDialog
        open={addSourceOpen}
        onOpenChange={setAddSourceOpen}
        category="raw"
        onAdd={({ path, kind }) => {
          addInventorySource({ path, kind });
        }}
      />
    </div>
  );
}

const UNASSIGNED = "__unassigned";

function ProjectAssign({
  sessionId,
  current,
}: {
  sessionId: string;
  current?: { id: string; name: string };
}) {
  const projects = useProjects();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
      <Select
        ariaLabel="Assign to project"
        value={current?.id ?? UNASSIGNED}
        onValueChange={(v) => {
          // eslint-disable-next-line no-console
          console.info("[mock] reassign session", sessionId, "to", v);
        }}
        options={[
          { value: UNASSIGNED, label: "Unassigned" },
          ...projects.map((p) => ({ value: p.id, label: p.name })),
        ]}
        minWidth={220}
      />
      {current ? (
        <InlineLink to="/projects" search={{ id: current.id }}>
          View <ArrowUpRight size={12} />
        </InlineLink>
      ) : null}
    </div>
  );
}

function CalibrationDetails({ session }: { session: InventorySession }) {
  const match = session.calibrationMatch;
  if (match === "ok") {
    return (
      <Facts
        entries={[
          {
            label: "Darks",
            value: (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Check size={13} style={{ color: "var(--success, #2f9e44)" }} /> darks-120s-gain100 · 30 frames
              </span>
            ),
          },
          {
            label: "Flats",
            value: (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Check size={13} style={{ color: "var(--success, #2f9e44)" }} /> Ha flats 2026-04 · 25 frames
              </span>
            ),
          },
          {
            label: "Bias",
            value: (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Check size={13} style={{ color: "var(--success, #2f9e44)" }} /> Bias library · 500 frames
              </span>
            ),
          },
        ]}
      />
    );
  }
  if (match === "partial") {
    return (
      <Facts
        entries={[
          {
            label: "Darks",
            value: (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Check size={13} style={{ color: "var(--success, #2f9e44)" }} /> darks-120s-gain100 · 30 frames
              </span>
            ),
          },
          {
            label: "Flats",
            value: (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--warn, #d97706)" }}>
                <AlertTriangle size={13} /> OIII flats missing
              </span>
            ),
          },
          {
            label: "Bias",
            value: (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Check size={13} style={{ color: "var(--success, #2f9e44)" }} /> Bias library · 500 frames
              </span>
            ),
          },
        ]}
      />
    );
  }
  if (match === "missing") {
    return (
      <Facts
        entries={[
          {
            label: "Status",
            value: (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--danger, #e5484d)" }}>
                <X size={13} /> No matching calibration found
              </span>
            ),
          },
        ]}
      />
    );
  }
  return (
    <Facts
      entries={[{ label: "Status", value: "Not yet evaluated" }]}
    />
  );
}

function bulkApplyState(
  state: InventorySessionState,
  ids: Set<string>,
  clear: (next: Set<string>) => void,
) {
  ids.forEach((id) => setSessionReviewState(id, state));
  clear(new Set());
}

function bucketFor(
  mode: GroupMode,
  sess: InventorySession,
  src: { id: string; path: string; kind: string; state: string },
  onReconnect?: (sourceId: string) => void,
): { key: string; heading: React.ReactNode; meta: React.ReactNode } {
  if (mode === "source") {
    const isDisconnected = src.state === "reconnect_required" || src.state === "missing";
    return {
      key: `src:${src.id}`,
      heading: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", fontFamily: "var(--font-mono)", textTransform: "none", letterSpacing: 0 }}>
          {src.path}
          {isDisconnected ? (
            <>
              <Chip
                tone="warn"
                active
              >
                <WifiOff size={10} /> disconnected · last seen 2026-05-19
              </Chip>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); onReconnect?.(src.id); }}
              >
                Reconnect…
              </Button>
            </>
          ) : null}
        </span>
      ),
      meta: `${src.kind.replace("_", " ")} · ${src.state}`,
    };
  }
  if (mode === "target") {
    const target = sess.target ?? "Unassigned";
    return {
      key: `tgt:${target}`,
      heading: <span>{target}</span>,
      meta: sess.target ? "" : "no target linked",
    };
  }
  // date
  const month = sess.capturedOn ? sess.capturedOn.slice(0, 7) : "unknown";
  return {
    key: `date:${month}`,
    heading: <span style={{ fontFamily: "var(--font-mono)" }}>{month}</span>,
    meta: sess.capturedOn ? "" : "no capture date",
  };
}

function observerLocationSourceLabel(
  source: "fits-header" | "user" | "inherited",
): string {
  switch (source) {
    case "fits-header":
      return "FITS header";
    case "user":
      return "User-confirmed";
    case "inherited":
      return "Inherited from source";
  }
}
