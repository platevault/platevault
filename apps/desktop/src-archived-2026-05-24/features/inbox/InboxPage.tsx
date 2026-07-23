// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo, useState } from "react";
import { useSearch, useNavigate, Link } from "@tanstack/react-router";
import { MoreVertical, AlertTriangle, Inbox } from "lucide-react";

import {
  Button,
  IconButton,
  DataTable,
  DockedDrawer,
  DrawerShell,
  EmptyState,
  FactGroup,
  Filters,
  FilterLabel,
  Menu,
  MultiSelect,
  PageHeader,
  sortRows,
  type DataTableColumn,
  type MultiSelectOption,
  ConfidenceChip,
  BulkActionBar,
  PlanFooter,
  StalePlanDialog,
} from "../../ui";
import { PlanInlineSummary } from "../../ui/PlanInlineSummary";
import { inboxItems, type InboxItem } from "../../data/mock";
import { createPlanFromInbox, discardPlan, revalidateAndApply, regeneratePlan, usePlans } from "../../data/store";
import { useSettings } from "../../data/settings";

const DEFAULT_SORT = "detected:desc";

const ALL_INBOX_TYPES = ["light", "dark", "flat", "bias", "mixed"] as const;
type InboxTypeFilter = (typeof ALL_INBOX_TYPES)[number];

const INBOX_SOURCE_OPTIONS: MultiSelectOption[] = [
  { value: "src-astrodrive", label: "AstroDrive" },
  { value: "src-local-raw", label: "local raw" },
];

const INBOX_TYPE_OPTIONS: MultiSelectOption[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "flat", label: "Flat" },
  { value: "bias", label: "Bias" },
  { value: "mixed", label: "Mixed" },
];

const ALL_INBOX_SOURCE_IDS = INBOX_SOURCE_OPTIONS.map((o) => o.value);

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

const MOCK_DRIFT_ENTRIES = [
  "light_073.fit modified at 2026-05-21 13:42",
  "NGC7000/applied/light_088.fit now exists",
  "light_091.fit no longer present",
];

function parseSort(sort: string | undefined): { id: string; dir: "asc" | "desc" } {
  if (!sort) return { id: "detected", dir: "desc" };
  const [id = "detected", rawDir] = sort.split(":");
  const dir = rawDir === "asc" ? "asc" : "desc";
  return { id, dir };
}

export function InboxPage() {
  const search = useSearch({ strict: false }) as {
    id?: string;
    type?: string;
    source?: string;
    sort?: string;
  };
  const navigate = useNavigate();
  const selectedId = search.id ?? null;

  const settings = useSettings();

  const activeTypes = parseCSV<InboxTypeFilter>(search.type, ALL_INBOX_TYPES, [...ALL_INBOX_TYPES]);
  const activeSources = parseCSV<string>(search.source, ALL_INBOX_SOURCE_IDS, [...ALL_INBOX_SOURCE_IDS]);

  const sortState = parseSort(search.sort);

  const navigate_ = (patch: Partial<typeof search>) => {
    const next = { ...search, ...patch };
    navigate({ to: "/inbox", search: next } as never);
  };

  const setActiveTypes = (types: string[]) =>
    navigate_({ type: serializeCSV(types as InboxTypeFilter[], ALL_INBOX_TYPES) });
  const setActiveSources = (sources: string[]) =>
    navigate_({ source: serializeCSV(sources, ALL_INBOX_SOURCE_IDS) });

  const handleSortChange = (next: { id: string; dir: "asc" | "desc" } | null) => {
    const sortStr = next ? `${next.id}:${next.dir}` : undefined;
    const isDefault = !sortStr || sortStr === DEFAULT_SORT;
    navigate_({ sort: isDefault ? undefined : sortStr });
  };

  const columns: DataTableColumn<InboxItem>[] = useMemo(
    () => [
      {
        id: "path",
        header: "Path",
        size: 300,
        className: "alm-table__cell--mono",
        sortable: true,
        accessor: (row) => row.path,
        render: (row) => row.path,
      },
      {
        id: "files",
        header: "Files",
        size: 60,
        className: "alm-table__cell--num",
        sortable: true,
        accessor: (row) => row.files,
        render: (row) => row.files,
      },
      {
        id: "target",
        header: "Target",
        size: 90,
        sortable: true,
        accessor: (row) => row.proposedTarget ?? null,
        render: (row) =>
          row.proposedTarget ? (
            row.proposedTarget
          ) : (
            <span className="alm-text-faint">unknown</span>
          ),
      },
      {
        id: "type",
        header: "Type",
        size: 80,
        className: "alm-table__cell--dim",
        sortable: true,
        accessor: (row) => row.type,
        render: (row) => row.type,
      },
      {
        id: "confidence",
        header: "Confidence",
        size: 110,
        sortable: true,
        accessor: (row) => row.confidence,
        render: (row) => <ConfidenceChip value={row.confidence} mixed={row.type === "mixed"} />,
      },
      {
        id: "detected",
        header: "Detected",
        size: 140,
        className: "alm-table__cell--dim",
        sortable: true,
        accessor: (row) => row.detectedAt,
        render: (row) => row.detectedAt,
      },
    ],
    [],
  );

  const activeTypeSet = new Set(activeTypes);
  const activeSourceSet = new Set(activeSources);

  const baseRows = useMemo(
    () =>
      inboxItems.filter(
        (item) =>
          activeTypeSet.has(item.type) &&
          activeSourceSet.has(item.sourceId),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search.type, search.source],
  );

  const rows = useMemo(() => {
    const activeCol = columns.find((c) => c.id === sortState.id);
    if (!activeCol) return baseRows;
    return sortRows(baseRows, activeCol, sortState.dir);
  }, [baseRows, columns, sortState.id, sortState.dir]);

  const selected = inboxItems.find((i) => i.id === selectedId) ?? null;
  const [bulkSelection, setBulkSelection] = useState<Set<string>>(new Set());
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const onRowSelect = (row: InboxItem) => {
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
        title="Review queue"
        subtitle={`${rows.length} folders detected · routed by Inbox`}
      />
      <Filters>
        <FilterLabel>Type</FilterLabel>
        <MultiSelect
          ariaLabel="Type filter"
          value={activeTypes}
          options={INBOX_TYPE_OPTIONS}
          onValueChange={setActiveTypes}
          allLabel="All types"
          emptyLabel="No types"
          minWidth={130}
        />
        <FilterLabel>Source</FilterLabel>
        <MultiSelect
          ariaLabel="Source filter"
          value={activeSources}
          options={INBOX_SOURCE_OPTIONS}
          onValueChange={setActiveSources}
          allLabel="All sources"
          emptyLabel="No sources"
          minWidth={150}
        />
      </Filters>
      <div className="alm-page__body">
        {inboxItems.length === 0 ? (
          <EmptyState
            icon={<Inbox size={36} />}
            heading="Inbox is empty"
            description="Drop folders into a watch path or wait for the next scan. Detected items appear here for review before they enter your library."
            action={
              <Link to={"/settings/$section" as never} params={{ section: "data-sources" } as never}>
                <Button variant="primary">Go to scan settings</Button>
              </Link>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            heading="No folders match these filters"
            description="Try widening the type or source filters above."
            action={
              <Button
                onClick={() =>
                  navigate({ to: "/inbox", search: { id: search.id } } as never)
                }
              >
                Clear filters
              </Button>
            }
          />
        ) : null}
        {rows.length > 0 ? (
          <>
            <DataTable<InboxItem>
              density={settings.rowDensity}
              rows={rows}
              selectedId={selectedId}
              onSelect={onRowSelect}
              selectedIds={bulkSelection}
              sort={search.sort ? sortState : null}
              onSortChange={handleSortChange}
              onToggleRow={(row, mods) => {
                setBulkSelection((prev) => {
                  const next = new Set(prev);
                  if (mods.shift && lastChecked) {
                    const a = rows.findIndex((r) => r.id === lastChecked);
                    const b = rows.findIndex((r) => r.id === row.id);
                    if (a >= 0 && b >= 0) {
                      const [from, to] = a < b ? [a, b] : [b, a];
                      for (let i = from; i <= to; i++) next.add(rows[i].id);
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
                setBulkSelection((prev) => {
                  const allChecked = rows.every((r) => prev.has(r.id));
                  return allChecked ? new Set() : new Set(rows.map((r) => r.id));
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
                        { id: "ignore", label: "Ignore", tone: "danger" as const },
                      ],
                    },
                  ]}
                />
              )}
              columns={columns}
            />
            {bulkSelection.size > 0 ? (
              <BulkActionBar
                count={bulkSelection.size}
                countLabel={(n) => `${n} folders`}
                onClear={() => setBulkSelection(new Set())}
                aria-label="Inbox bulk actions"
                actions={
                  <>
                    <Button
                      variant="primary"
                      onClick={() => {
                        rows.filter((r) => bulkSelection.has(r.id)).forEach((r) => createPlanFromInbox(r));
                        setBulkSelection(new Set());
                      }}
                    >
                      Generate plans for selected
                    </Button>
                    <Button>Ignore all</Button>
                  </>
                }
              />
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );

  const isMixed = selected?.type === "mixed";

  const allPlans = usePlans();
  const existingPlan = useMemo(
    () =>
      selected
        ? allPlans.find(
            (p) =>
              p.originPath === selected.path &&
              (p.state === "draft" ||
                p.state === "ready_for_review" ||
                p.state === "approved" ||
                p.state === "applying"),
          )
        : undefined,
    [allPlans, selected],
  );

  const [validating, setValidating] = useState(false);
  const [staleOpen, setStaleOpen] = useState(false);

  const handleGeneratePlan = () => {
    if (!selected) return;
    if (existingPlan) return;
    createPlanFromInbox(selected);
  };

  const handleApply = async () => {
    if (!existingPlan) return;
    setValidating(true);
    try {
      const outcome = await revalidateAndApply(existingPlan.id);
      if (outcome === "stale") {
        setStaleOpen(true);
      }
    } finally {
      setValidating(false);
    }
  };

  const handleDiscard = () => {
    if (!existingPlan) return;
    discardPlan(existingPlan.id);
  };

  const handleRegenerate = () => {
    if (!existingPlan) return;
    regeneratePlan(existingPlan.id);
    setStaleOpen(false);
  };

  const planState = existingPlan?.state;
  const isApplied = planState === "applied" || planState === "partially_applied";

  const drawer = selected
    ? (
      <>
        <DrawerShell
          title={selected.path}
          subtitle={`${selected.files} files · ${
            isMixed ? "mixed types detected" : `${selected.type} frames`
          }`}
          onClose={onClose}
          body={
            <>
              {existingPlan ? (
                <FactGroup
                  label={
                    isApplied
                      ? existingPlan.state === "partially_applied"
                        ? `Plan #${existingPlan.number} · partially applied`
                        : `Plan #${existingPlan.number} · applied`
                      : planState === "applying"
                      ? `Plan #${existingPlan.number} · applying…`
                      : `Plan #${existingPlan.number} · ready for review`
                  }
                >
                  <PlanInlineSummary plan={existingPlan} />
                </FactGroup>
              ) : null}
              {selected.mixedBreakdown ? (
                <FactGroup label="Inferred breakdown">
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {selected.mixedBreakdown.map((b) => (
                      <div
                        key={b.kind}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "70px 60px 1fr",
                          gap: 12,
                          alignItems: "center",
                          fontSize: "var(--fs-small)",
                        }}
                      >
                        <span style={{ color: "var(--text-dim)", textTransform: "capitalize" }}>
                          {b.kind}
                        </span>
                        <span className="alm-table__cell--num">{b.count}</span>
                        <span
                          className="alm-mono"
                          style={{
                            color:
                              b.destination.includes("unclassified")
                                ? "var(--warn)"
                                : "var(--text)",
                          }}
                        >
                          {b.destination.includes("unclassified") ? (
                            <AlertTriangle size={11} style={{ display: "inline", marginRight: 4 }} />
                          ) : null}
                          → {b.destination}
                        </span>
                      </div>
                    ))}
                  </div>
                </FactGroup>
              ) : null}

              {selected.sampleFiles ? (
                <FactGroup label="Sample files">
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "var(--r-sm)",
                      padding: 6,
                      background: "var(--surface-2)",
                    }}
                  >
                    {selected.sampleFiles.map((f, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 60px 60px 60px",
                          gap: 8,
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--fs-micro)",
                          padding: "2px 6px",
                        }}
                      >
                        <span>{f.name}</span>
                        <span className="alm-dim">{f.type}</span>
                        <span className="alm-dim">{f.exposure ?? "—"}</span>
                        <span className="alm-dim">{f.filter ?? "—"}</span>
                      </div>
                    ))}
                    <div
                      style={{
                        padding: "4px 6px",
                        fontSize: "var(--fs-dense)",
                        color: "var(--accent)",
                        cursor: "pointer",
                      }}
                    >
                      Show all {selected.files} →
                    </div>
                  </div>
                </FactGroup>
              ) : null}

              {selected.destinationPattern ? (
                <FactGroup label={isMixed ? "Pattern driving destinations" : "Will route to"}>
                  <div
                    style={{
                      padding: 8,
                      background: "var(--surface-2)",
                      borderRadius: "var(--r-sm)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--fs-dense)",
                      color: "var(--text)",
                    }}
                  >
                    {selected.destinationPattern}
                  </div>
                  <div
                    style={{
                      fontSize: "var(--fs-dense)",
                      color: "var(--text-dim)",
                      marginTop: 4,
                    }}
                  >
                    From Settings → Naming & Structure
                  </div>
                </FactGroup>
              ) : null}
            </>
          }
          footer={
            <PlanFooter
              plan={existingPlan}
              validating={validating}
              generateLabel={isMixed ? "Generate split plan" : "Generate plan"}
              onGenerate={handleGeneratePlan}
              onApprove={handleApply}
              onDiscard={handleDiscard}
              onDone={onClose}
              onRetry={handleApply}
              onEditDestinations={() => { /* placeholder */ }}
              extra={
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
                        { id: "reveal", label: "Reveal in OS" },
                        { id: "rescan", label: "Re-scan folder" },
                      ],
                    },
                    {
                      id: "more-2",
                      items: [{ id: "ignore", label: "Ignore this folder", tone: "danger" }],
                    },
                  ]}
                />
              }
            />
          }
        />
        {existingPlan ? (
          <StalePlanDialog
            open={staleOpen}
            onOpenChange={(o) => { if (!o) setStaleOpen(false); }}
            planNumber={existingPlan.number}
            driftEntries={MOCK_DRIFT_ENTRIES}
            onRegenerate={handleRegenerate}
          />
        ) : null}
      </>
    )
    : null;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <DockedDrawer main={main} drawer={drawer} />
    </div>
  );
}
