import { useNavigate, useSearch } from "@tanstack/react-router";
import { MoreVertical } from "lucide-react";

import {
  Button,
  DataTable,
  EmptyState,
  Filters,
  FilterLabel,
  Menu,
  PageHeader,
  Select,
  StateLabel,
} from "../../ui";
import { planStateLabel, planStateTone, type Plan } from "../../data/mock";
import { usePlans } from "../../data/store";
import { useSettings } from "../../data/settings";

const ALL = "__all";

export function PlansListPage() {
  const navigate = useNavigate();
  const plans = usePlans();
  const settings = useSettings();
  const search = useSearch({ strict: false }) as { state?: string; origin?: string };
  const stateFilter = search.state ?? ALL;
  const originFilter = search.origin ?? ALL;
  const setStateFilter = (v: string) =>
    navigate({
      to: "/plans",
      search: { ...search, state: v === ALL ? undefined : v },
    } as never);
  const setOriginFilter = (v: string) =>
    navigate({
      to: "/plans",
      search: { ...search, origin: v === ALL ? undefined : v },
    } as never);

  const rows = plans
    .filter(
      (p) =>
        (stateFilter === ALL || p.state === stateFilter) &&
        (originFilter === ALL || p.origin === originFilter),
    )
    .sort((a, b) => {
      const priority = (state: Plan["state"]) =>
        state === "failed" || state === "partially_applied"
          ? 0
          : state === "ready_for_review"
          ? 1
          : state === "draft"
          ? 2
          : state === "approved" || state === "applying"
          ? 3
          : 4;
      return priority(a.state) - priority(b.state);
    });

  return (
    <div className="alm-page">
      <PageHeader title="Plans" subtitle={`${plans.length} total · ${plans.filter((p) => p.state === "failed").length} failed`} />
      <Filters>
        <FilterLabel>State</FilterLabel>
        <Select
          ariaLabel="State filter"
          value={stateFilter}
          onValueChange={setStateFilter}
          options={[
            { value: ALL, label: "All" },
            { value: "draft", label: "Draft" },
            { value: "ready_for_review", label: "Ready for review" },
            { value: "approved", label: "Approved" },
            { value: "applying", label: "Applying" },
            { value: "applied", label: "Applied" },
            { value: "partially_applied", label: "Partial" },
            { value: "failed", label: "Failed" },
            { value: "cancelled", label: "Cancelled" },
          ]}
          minWidth={170}
        />
        <FilterLabel>Origin</FilterLabel>
        <Select
          ariaLabel="Origin filter"
          value={originFilter}
          onValueChange={setOriginFilter}
          options={[
            { value: ALL, label: "Any" },
            { value: "inbox", label: "Inbox" },
            { value: "cleanup", label: "Cleanup" },
            { value: "restructure", label: "Restructure" },
            { value: "project", label: "Project" },
            { value: "archive", label: "Archive" },
          ]}
          minWidth={140}
        />
      </Filters>
      <div className="alm-page__body">
        {plans.length === 0 ? (
          <EmptyState
            message="No plans yet. Plans are generated when you confirm Inbox items, prepare projects, or trigger cleanup."
            action={
              <Button onClick={() => navigate({ to: "/inbox" })}>
                Go to Inbox
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            message="No plans match the current filters."
            action={
              <Button
                onClick={() => {
                  setStateFilter(ALL);
                  setOriginFilter(ALL);
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <DataTable<Plan>
          density={settings.rowDensity}
          rows={rows}
          onSelect={(row) =>
            navigate({ to: "/plans/$planId", params: { planId: row.id } } as never)
          }
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
                    { id: "view-origin", label: "View source row" },
                    { id: "duplicate", label: "Duplicate plan" },
                  ],
                },
                {
                  id: "row-2",
                  items: [{ id: "discard", label: "Discard plan", tone: "danger" }],
                },
              ]}
            />
          )}
          columns={[
            {
              id: "number",
              header: "#",
              size: 50,
              className: "alm-table__cell--mono",
              render: (row) => row.number,
            },
            { id: "title", header: "Title", size: 260, render: (row) => row.title },
            {
              id: "state",
              header: "State",
              size: 160,
              render: (row) => (
                <StateLabel tone={planStateTone(row.state)}>{planStateLabel(row.state)}</StateLabel>
              ),
            },
            {
              id: "items",
              header: "Items",
              size: 130,
              className: "alm-table__cell--num",
              render: (row) =>
                row.state === "failed" || row.state === "partially_applied"
                  ? `${row.itemsApplied}/${row.itemsTotal} (${row.itemsFailed} failed)`
                  : row.state === "cancelled"
                  ? `${row.itemsApplied}/${row.itemsTotal} (${row.itemsPending} skipped)`
                  : row.itemsTotal,
            },
            {
              id: "origin",
              header: "Origin",
              size: 110,
              className: "alm-table__cell--dim",
              render: (row) => row.origin,
            },
            {
              id: "created",
              header: "Created",
              size: 110,
              className: "alm-table__cell--dim",
              render: (row) => row.createdAt,
            },
          ]}
        />
        )}
      </div>
    </div>
  );
}
