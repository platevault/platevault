import { useMemo, useState, type ReactElement } from "react";
import { useSearch, useNavigate, Link } from "@tanstack/react-router";
import { Activity } from "lucide-react";

import {
  Button,
  DataTable,
  DockedDrawer,
  DrawerShell,
  EmptyState,
  Facts,
  FactGroup,
  Filters,
  FilterLabel,
  MultiSelect,
  PageHeader,
  PlanFooter,
  PlanInlineSummary,
  ResolveFailedItemsDialog,
  StalePlanDialog,
  StateLabel,
  sortRows,
  type DataTableColumn,
  type DataTableGroup,
  type MultiSelectOption,
} from "../../ui";
import {
  planStateLabel,
  planStateTone,
  type Plan,
  type PlanState,
} from "../../data/mock";
import {
  discardPlan,
  revalidateAndApply,
  regeneratePlan,
  usePlans,
  useProjects,
} from "../../data/store";
import { useSettings } from "../../data/settings";

/* ================================================================
   Constants
   ================================================================ */

const ALL_ORIGINS: Array<Plan["origin"]> = [
  "inbox",
  "project",
  "cleanup",
  "restructure",
  "archive",
];

const ORIGIN_DISPLAY_ORDER: Array<Plan["origin"]> = [
  "inbox",
  "project",
  "cleanup",
  "restructure",
  "archive",
];

const DEFAULT_SORT = "created:desc";

type StateFilter =
  | "all"
  | "failed"
  | "pending"
  | "applied"
  | "applying"
  | "discarded";

/* ================================================================
   Helpers
   ================================================================ */

function capitalizeOrigin(origin: string): string {
  return origin.charAt(0).toUpperCase() + origin.slice(1);
}

function parseSort(sort: string | undefined): { id: string; dir: "asc" | "desc" } {
  if (!sort) return { id: "created", dir: "desc" };
  const [id = "created", rawDir] = sort.split(":");
  const dir = rawDir === "asc" ? "asc" : "desc";
  return { id, dir };
}

/** Maps the URL `state` filter value to a predicate over PlanState */
function stateFilterMatches(filter: StateFilter, state: PlanState): boolean {
  switch (filter) {
    case "all":
      return true;
    case "failed":
      return state === "failed" || state === "partially_applied";
    case "pending":
      return (
        state === "draft" ||
        state === "ready_for_review" ||
        state === "approved"
      );
    case "applied":
      return state === "applied";
    case "applying":
      return state === "applying";
    case "discarded":
      // "cancelled" is the closest to discarded in the state machine
      return state === "cancelled";
    default:
      return true;
  }
}

/** Result column text for a plan row */
function resultSummary(plan: Plan): string {
  const { state, itemsApplied, itemsTotal, itemsFailed, itemsPending } = plan;
  if (state === "applied") {
    return `✓ ${itemsApplied}`;
  }
  if (state === "failed") {
    return `⚠ ${itemsApplied}/${itemsTotal} · ${itemsFailed} failed`;
  }
  if (state === "partially_applied") {
    return `⚠ ${itemsApplied}/${itemsTotal} · ${itemsFailed} failed`;
  }
  // draft / ready_for_review / approved / applying
  return `${itemsPending} pending`;
}

/* ================================================================
   Drawer — plan detail panel
   ================================================================ */

const MOCK_DRIFT_ENTRIES = [
  "light_073.fit modified at 2026-05-21 13:42",
  "NGC7000/applied/light_088.fit now exists",
  "light_091.fit no longer present",
  "destination /raw/M101/Ha/2026-04-12/lights/ has 3 new files",
];

/* ================================================================
   Activity drawer
   ================================================================ */

function ActivityDrawer({
  plan,
  onClose,
  projectName,
}: {
  plan: Plan;
  onClose: () => void;
  projectName: string | null;
}): ReactElement {
  const { state, itemsApplied, itemsTotal, itemsFailed, itemsPending } = plan;
  const [validating, setValidating] = useState(false);
  const [staleOpen, setStaleOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);

  const hasFailedItems = plan.items.some((it) => it.state === "failed");

  const stateTone = planStateTone(state);
  const stateText = planStateLabel(state);

  const originSource: string =
    plan.origin === "project"
      ? (projectName ?? plan.originPath ?? plan.origin)
      : (plan.originPath ?? plan.origin);

  const handleRevalidateApply = async () => {
    setValidating(true);
    try {
      const outcome = await revalidateAndApply(plan.id);
      if (outcome === "stale") {
        setStaleOpen(true);
      }
    } finally {
      setValidating(false);
    }
  };

  const handleDiscard = () => {
    discardPlan(plan.id);
    onClose();
  };

  const handleRegenerate = () => {
    regeneratePlan(plan.id);
    setStaleOpen(false);
    onClose();
  };

  const isFailed = state === "failed" || state === "partially_applied";

  return (
    <>
      <DrawerShell
        title={`#${plan.number} ${plan.title}`}
        subtitle={`${plan.origin} · ${plan.createdAt}`}
        onClose={onClose}
        body={
          <>
            {/* Status */}
            <FactGroup label="Status">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div>
                  <StateLabel tone={stateTone}>{stateText}</StateLabel>
                </div>
                <div style={{ fontSize: "var(--fs-small)", color: "var(--text-dim)" }}>
                  {itemsApplied}/{itemsTotal} applied · {itemsFailed} failed ·{" "}
                  {itemsPending} pending
                </div>
              </div>
            </FactGroup>

            {/* Items */}
            <FactGroup label="Items">
              {plan.items.length === 0 ? (
                <span style={{ fontSize: "var(--fs-small)", color: "var(--text-faint)" }}>
                  No item-level preview available for this plan.
                </span>
              ) : (
                <PlanInlineSummary plan={plan} />
              )}
            </FactGroup>

            {/* Origin */}
            <FactGroup label="Origin">
              <Facts
                entries={[
                  { label: "Origin", value: capitalizeOrigin(plan.origin) },
                  {
                    label: "Origin path",
                    value: (
                      <span className="alm-mono" style={{ fontSize: "var(--fs-dense)" }}>
                        {originSource}
                      </span>
                    ),
                  },
                  { label: "Created", value: plan.createdAt },
                  { label: "Type", value: plan.type },
                ]}
              />
            </FactGroup>
          </>
        }
        footer={
          <>
            <PlanFooter
              plan={plan}
              validating={validating}
              onApprove={handleRevalidateApply}
              onDiscard={handleDiscard}
              onRetry={handleRevalidateApply}
              onDone={onClose}
            />
            {isFailed && hasFailedItems ? (
              <Button variant="ghost" onClick={() => setResolveOpen(true)}>
                Resolve failed items…
              </Button>
            ) : null}
            {(state === "applied") ? (
              <Link
                to="/plans/$planId"
                params={{ planId: plan.id }}
                className="alm-btn"
              >
                Open in detail page
              </Link>
            ) : null}
          </>
        }
      />

      <StalePlanDialog
        open={staleOpen}
        onOpenChange={(o) => { if (!o) setStaleOpen(false); }}
        planNumber={plan.number}
        driftEntries={MOCK_DRIFT_ENTRIES}
        onRegenerate={handleRegenerate}
      />

      <ResolveFailedItemsDialog
        open={resolveOpen}
        onOpenChange={(o) => { if (!o) setResolveOpen(false); }}
        plan={plan}
      />
    </>
  );
}

/* ================================================================
   Main page
   ================================================================ */

const ALL_STATE_FILTERS: StateFilter[] = ["failed", "pending", "applying", "applied", "discarded"];

const STATE_FILTER_OPTIONS: MultiSelectOption[] = [
  { value: "failed", label: "Failed / partial" },
  { value: "pending", label: "Pending" },
  { value: "applying", label: "Applying" },
  { value: "applied", label: "Applied" },
  { value: "discarded", label: "Discarded" },
];

const ORIGIN_OPTIONS: MultiSelectOption[] = ALL_ORIGINS.map((o) => ({
  value: o,
  label: capitalizeOrigin(o),
  tone: "neutral" as const,
}));

export function ActivityPage(): ReactElement {
  const rawSearch = useSearch({ strict: false }) as {
    id?: string;
    states?: string;
    origins?: string;
    sort?: string;
  };
  const navigate = useNavigate();
  const plans = usePlans();
  const projects = useProjects();
  const settings = useSettings();

  // --- URL-driven state ---
  const selectedId = rawSearch.id ?? null;

  // Parse active state filters — if absent, all are active
  const activeStateFilters: StateFilter[] = useMemo(() => {
    if (!rawSearch.states) return [...ALL_STATE_FILTERS];
    const parts = rawSearch.states.split(",").filter((s): s is StateFilter =>
      ALL_STATE_FILTERS.includes(s as StateFilter),
    );
    return parts.length > 0 ? parts : [...ALL_STATE_FILTERS];
  }, [rawSearch.states]);

  // Parse active origins — if `origins` param is absent, all are active
  const activeOrigins: Set<string> = useMemo(() => {
    if (!rawSearch.origins) return new Set(ALL_ORIGINS);
    const parts = rawSearch.origins.split(",").filter((s) => s.length > 0);
    return new Set(parts);
  }, [rawSearch.origins]);

  const sortState = parseSort(rawSearch.sort);

  // --- Derived counts for subtitle ---
  const failedCount = plans.filter(
    (p) => p.state === "failed" || p.state === "partially_applied",
  ).length;
  const pendingCount = plans.filter(
    (p) =>
      p.state === "draft" ||
      p.state === "ready_for_review" ||
      p.state === "approved",
  ).length;

  // --- Navigation helpers ---
  const navigate_ = (patch: Partial<typeof rawSearch>) => {
    const next = { ...rawSearch, ...patch };
    // Strip defaults
    if (!next.states || next.states === ALL_STATE_FILTERS.join(",")) delete next.states;
    if (!next.origins || next.origins === ALL_ORIGINS.join(",")) delete next.origins;
    if (!next.sort || next.sort === DEFAULT_SORT) delete next.sort;
    navigate({ to: "/activity", search: next } as never);
  };

  const onRowSelect = (row: Plan) => {
    if (selectedId === row.id) {
      navigate_({ id: undefined });
    } else {
      navigate_({ id: row.id });
    }
  };

  const onClose = () => navigate_({ id: undefined });

  const setActiveStateFilters = (filters: string[]) => {
    const sorted = [...filters].sort();
    const allSorted = [...ALL_STATE_FILTERS].sort();
    const isAll = sorted.length === allSorted.length && sorted.every((v, i) => v === allSorted[i]);
    navigate_({ states: isAll ? undefined : sorted.join(",") });
  };

  const setActiveOrigins = (origins: string[]) => {
    const allOn = ALL_ORIGINS.every((o) => origins.includes(o));
    navigate_({ origins: allOn ? undefined : origins.join(",") });
  };

  const handleSortChange = (next: { id: string; dir: "asc" | "desc" } | null) => {
    const sortStr = next ? `${next.id}:${next.dir}` : undefined;
    const isDefault = !sortStr || sortStr === DEFAULT_SORT;
    navigate_({ sort: isDefault ? undefined : sortStr });
  };

  // --- Columns ---
  const columns: DataTableColumn<Plan>[] = useMemo(
    () => [
      {
        id: "title",
        header: "Title",
        sortable: true,
        accessor: (row) => row.title,
        render: (row) => row.title,
      },
      {
        id: "result",
        header: "Result",
        size: 160,
        sortable: true,
        accessor: (row) => row.itemsTotal,
        render: (row) => (
          <span
            style={{
              fontSize: "var(--fs-dense)",
              color:
                row.state === "failed" || row.state === "partially_applied"
                  ? "var(--danger)"
                  : row.state === "applied"
                  ? "var(--success)"
                  : "var(--text-dim)",
            }}
          >
            {resultSummary(row)}
          </span>
        ),
      },
      {
        id: "origin",
        header: "Origin",
        size: 120,
        sortable: true,
        accessor: (row) => row.origin,
        render: (row) => (
          <span className="alm-table__cell--dim">{row.origin}</span>
        ),
      },
      {
        id: "source",
        header: "Project / Source",
        size: 240,
        sortable: true,
        accessor: (row) => {
          if (row.origin === "project") {
            const project = projects.find((p) => p.id === row.originPath);
            return project?.name ?? row.originPath ?? "";
          }
          return row.originPath ?? "";
        },
        render: (row) => {
          if (row.origin === "project") {
            const project = projects.find((p) => p.id === row.originPath);
            const label = project?.name ?? row.originPath ?? "—";
            return <span>{label}</span>;
          }
          return (
            <span
              className="alm-mono"
              style={{ fontSize: "var(--fs-dense)", color: "var(--text-dim)" }}
            >
              {row.originPath ?? "—"}
            </span>
          );
        },
      },
      {
        id: "created",
        header: "Created",
        size: 130,
        sortable: true,
        accessor: (row) => row.createdAt,
        render: (row) => (
          <span className="alm-table__cell--dim">{row.createdAt}</span>
        ),
      },
    ],
    [projects],
  );

  // --- Filtered plans (by state filters + origins) ---
  const filteredPlans = useMemo(
    () =>
      plans.filter((p) => {
        const originOk = activeOrigins.has(p.origin);
        const stateOk = activeStateFilters.some((f) => stateFilterMatches(f, p.state));
        return originOk && stateOk;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plans, rawSearch.origins, rawSearch.states],
  );

  // --- Sort active column ---
  const activeCol = columns.find((c) => c.id === sortState.id);

  // --- Groups ---
  const groups: DataTableGroup<Plan>[] = useMemo(() => {
    const built = ORIGIN_DISPLAY_ORDER.filter((origin) => activeOrigins.has(origin))
      .map((origin) => {
        const originPlans = filteredPlans.filter((p) => p.origin === origin);
        const sorted = activeCol
          ? sortRows(originPlans, activeCol, sortState.dir)
          : originPlans;

        // Compute meta signal: "N plans, M failed / M pending" when non-applied states exist
        const failedCount = sorted.filter(
          (p) => p.state === "failed" || p.state === "partially_applied",
        ).length;
        const pendingCount = sorted.filter(
          (p) => p.state === "draft" || p.state === "ready_for_review" || p.state === "approved",
        ).length;
        let meta = `${sorted.length} plan${sorted.length !== 1 ? "s" : ""}`;
        if (failedCount > 0 || pendingCount > 0) {
          const parts: string[] = [];
          if (failedCount > 0) parts.push(`${failedCount} failed`);
          if (pendingCount > 0) parts.push(`${pendingCount} pending`);
          meta += ` · ${parts.join(" / ")}`;
        }

        return {
          id: origin,
          heading: capitalizeOrigin(origin),
          meta,
          rows: sorted,
          collapsible: true as const,
          defaultExpanded: true as const,
          _hasFailed: failedCount > 0,
        };
      })
      .filter((g) => g.rows.length > 0);

    // Failed groups sort first; ties remain in ORIGIN_DISPLAY_ORDER
    built.sort((a, b) => {
      if (a._hasFailed && !b._hasFailed) return -1;
      if (!a._hasFailed && b._hasFailed) return 1;
      return 0;
    });

    // Strip the internal _hasFailed field before returning
    return built.map(({ _hasFailed: _f, ...g }) => g);
  }, [filteredPlans, activeOrigins, activeCol, sortState.dir]);

  // --- Selected plan for drawer ---
  const selected = useMemo(
    () => (selectedId ? plans.find((p) => p.id === selectedId) ?? null : null),
    [plans, selectedId],
  );

  const selectedProjectName = useMemo(() => {
    if (!selected || selected.origin !== "project") return null;
    return projects.find((p) => p.id === selected.originPath)?.name ?? null;
  }, [selected, projects]);

  // --- Render ---
  const main = (
    <div className="alm-page">
      <PageHeader
        title="Activity"
        subtitle={`${plans.length} plan${plans.length !== 1 ? "s" : ""} · ${failedCount} failed · ${pendingCount} pending`}
      />
      <Filters>
        <FilterLabel>State</FilterLabel>
        <MultiSelect
          ariaLabel="State filter"
          value={activeStateFilters}
          options={STATE_FILTER_OPTIONS}
          onValueChange={setActiveStateFilters}
          allLabel="All states"
          emptyLabel="No states"
          minWidth={170}
        />
        <FilterLabel>Origin</FilterLabel>
        <MultiSelect
          ariaLabel="Origin filter"
          value={[...activeOrigins]}
          options={ORIGIN_OPTIONS}
          onValueChange={setActiveOrigins}
          allLabel="All origins"
          emptyLabel="No origins"
          minWidth={150}
        />
      </Filters>

      <div className="alm-page__body">
        {plans.length === 0 ? (
          <EmptyState
            icon={<Activity size={36} />}
            heading="No activity yet"
            description="Plans you generate from Inbox, Projects, or cleanup actions will appear here. Nothing has happened to your library yet."
          />
        ) : groups.length === 0 ? (
          <EmptyState
            heading="No plans match these filters"
            description="Try changing the state or origin filters above."
            action={
              <Button
                onClick={() =>
                  navigate({ to: "/activity", search: {} } as never)
                }
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <DataTable<Plan>
            density={settings.rowDensity}
            groups={groups}
            selectedId={selectedId}
            onSelect={onRowSelect}
            sort={rawSearch.sort ? sortState : null}
            onSortChange={handleSortChange}
            columns={columns}
          />
        )}
      </div>
    </div>
  );

  const drawer =
    selected !== null ? (
      <ActivityDrawer
        plan={selected}
        onClose={onClose}
        projectName={selectedProjectName}
      />
    ) : null;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <DockedDrawer main={main} drawer={drawer} defaultDrawerSize={42} />
    </div>
  );
}
