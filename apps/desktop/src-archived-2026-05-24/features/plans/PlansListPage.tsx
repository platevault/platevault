// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { MoreVertical } from "lucide-react";

import {
  Button,
  IconButton,
  DataTable,
  EmptyState,
  Filters,
  FilterLabel,
  Menu,
  MultiSelect,
  PageHeader,
  StateLabel,
  type MultiSelectOption,
} from "../../ui";
import { planStateLabel, planStateTone, type Plan, type PlanState } from "../../data/mock";
import { usePlans } from "../../data/store";
import { useSettings } from "../../data/settings";

const ALL_PLAN_STATES: PlanState[] = [
  "draft",
  "ready_for_review",
  "approved",
  "applying",
  "applied",
  "partially_applied",
  "failed",
  "cancelled",
];

const STATE_OPTIONS: MultiSelectOption[] = [
  { value: "draft", label: "Draft" },
  { value: "ready_for_review", label: "Ready for review" },
  { value: "approved", label: "Approved" },
  { value: "applying", label: "Applying" },
  { value: "applied", label: "Applied" },
  { value: "partially_applied", label: "Partial" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

const ALL_PLAN_ORIGINS = ["inbox", "cleanup", "restructure", "project", "archive"] as const;
type PlanOrigin = (typeof ALL_PLAN_ORIGINS)[number];

const ORIGIN_OPTIONS: MultiSelectOption[] = [
  { value: "inbox", label: "Inbox" },
  { value: "cleanup", label: "Cleanup" },
  { value: "restructure", label: "Restructure" },
  { value: "project", label: "Project" },
  { value: "archive", label: "Archive" },
];

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

export function PlansListPage() {
  const navigate = useNavigate();
  const plans = usePlans();
  const settings = useSettings();
  const search = useSearch({ strict: false }) as { state?: string; origin?: string };

  const activeStates = parseCSV<PlanState>(search.state, ALL_PLAN_STATES, [...ALL_PLAN_STATES]);
  const activeOrigins = parseCSV<PlanOrigin>(search.origin, ALL_PLAN_ORIGINS, [...ALL_PLAN_ORIGINS]);

  const setActiveStates = (states: string[]) =>
    navigate({
      to: "/plans",
      search: {
        ...search,
        state: serializeCSV(states as PlanState[], ALL_PLAN_STATES),
      },
    } as never);

  const setActiveOrigins = (origins: string[]) =>
    navigate({
      to: "/plans",
      search: {
        ...search,
        origin: serializeCSV(origins as PlanOrigin[], ALL_PLAN_ORIGINS),
      },
    } as never);

  const activeStateSet = new Set(activeStates);
  const activeOriginSet = new Set(activeOrigins);

  const rows = useMemo(
    () =>
      plans
        .filter(
          (p) =>
            activeStateSet.has(p.state as PlanState) &&
            activeOriginSet.has(p.origin as PlanOrigin),
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
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plans, search.state, search.origin],
  );

  return (
    <div className="alm-page">
      <PageHeader
        title="Plans"
        subtitle={`${plans.length} total · ${plans.filter((p) => p.state === "failed").length} failed`}
      />
      <Filters>
        <FilterLabel>State</FilterLabel>
        <MultiSelect
          ariaLabel="State filter"
          value={activeStates}
          options={STATE_OPTIONS}
          onValueChange={setActiveStates}
          allLabel="All states"
          emptyLabel="No states"
          minWidth={170}
        />
        <FilterLabel>Origin</FilterLabel>
        <MultiSelect
          ariaLabel="Origin filter"
          value={activeOrigins}
          options={ORIGIN_OPTIONS}
          onValueChange={setActiveOrigins}
          allLabel="All origins"
          emptyLabel="No origins"
          minWidth={140}
        />
      </Filters>
      <div className="alm-page__body">
        {plans.length === 0 ? (
          <EmptyState
            heading="No plans yet"
            description="Plans are generated when you confirm Inbox items, prepare projects, or trigger cleanup."
            action={
              <Button onClick={() => navigate({ to: "/inbox" })}>
                Go to Inbox
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            heading="No plans match the current filters"
            description="Try widening the state or origin filters above."
            action={
              <Button
                onClick={() =>
                  navigate({ to: "/plans", search: {} } as never)
                }
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
                  <IconButton aria-label="Row actions">
                    <MoreVertical size={14} />
                  </IconButton>
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
                    items: [{ id: "discard", label: "Discard plan", tone: "danger" as const }],
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
