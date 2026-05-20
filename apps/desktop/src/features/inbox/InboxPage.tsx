import { useMemo } from "react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { MoreVertical, AlertTriangle, ArrowRight } from "lucide-react";

import {
  Button,
  DataTable,
  DockedDrawer,
  DrawerShell,
  FactGroup,
  Filters,
  FilterLabel,
  IconButton,
  Menu,
  PageHeader,
  Select,
  StateLabel,
} from "../../ui";
import { inboxItems, type InboxItem } from "../../data/mock";
import { createPlanFromInbox, usePlans } from "../../data/store";
import { useSettings } from "../../data/settings";

const ALL = "__all";

export function InboxPage() {
  const search = useSearch({ strict: false }) as {
    id?: string;
    type?: string;
    source?: string;
  };
  const navigate = useNavigate();
  const selectedId = search.id ?? null;

  const settings = useSettings();
  const typeFilter = search.type ?? ALL;
  const sourceFilter = search.source ?? ALL;
  const setTypeFilter = (v: string) =>
    navigate({
      to: "/inbox",
      search: { ...search, type: v === ALL ? undefined : v },
    } as never);
  const setSourceFilter = (v: string) =>
    navigate({
      to: "/inbox",
      search: { ...search, source: v === ALL ? undefined : v },
    } as never);

  const rows = useMemo(
    () =>
      inboxItems.filter(
        (item) =>
          (typeFilter === ALL || item.type === typeFilter) &&
          (sourceFilter === ALL || item.sourceId === sourceFilter),
      ),
    [typeFilter, sourceFilter],
  );

  const selected = inboxItems.find((i) => i.id === selectedId) ?? null;

  const onRowSelect = (row: InboxItem) => {
    if (selectedId === row.id) {
      navigate({ to: "/inbox", search: { ...search, id: undefined } } as never);
    } else {
      navigate({ to: "/inbox", search: { ...search, id: row.id } } as never);
    }
  };

  const onClose = () =>
    navigate({ to: "/inbox", search: { ...search, id: undefined } } as never);

  const main = (
    <div className="alm-page">
      <PageHeader
        title="Review Queue"
        subtitle={`${rows.length} items waiting · routed by Inbox`}
      />
      <Filters>
        <FilterLabel>Type</FilterLabel>
        <Select
          ariaLabel="Type filter"
          value={typeFilter}
          onValueChange={setTypeFilter}
          options={[
            { value: ALL, label: "All types" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "flat", label: "Flat" },
            { value: "bias", label: "Bias" },
            { value: "mixed", label: "Mixed" },
          ]}
          minWidth={130}
        />
        <FilterLabel>Source</FilterLabel>
        <Select
          ariaLabel="Source filter"
          value={sourceFilter}
          onValueChange={setSourceFilter}
          options={[
            { value: ALL, label: "All sources" },
            { value: "src-astrodrive", label: "AstroDrive" },
            { value: "src-local-raw", label: "local raw" },
          ]}
          minWidth={150}
        />
      </Filters>
      <div className="alm-page__body">
        <DataTable<InboxItem>
          density={settings.rowDensity}
          rows={rows}
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
                    { id: "ignore", label: "Ignore" },
                  ],
                },
              ]}
            />
          )}
          columns={[
            {
              id: "path",
              header: "Path",
              size: 320,
              className: "alm-table__cell--mono",
              render: (row) => row.path,
            },
            {
              id: "files",
              header: "Files",
              size: 70,
              className: "alm-table__cell--num",
              render: (row) => row.files,
            },
            {
              id: "type",
              header: "Type",
              size: 100,
              render: (row) =>
                row.type === "mixed" ? (
                  <StateLabel tone="warn">mixed</StateLabel>
                ) : (
                  <span className="alm-dim">{row.type}</span>
                ),
            },
            {
              id: "source",
              header: "Source",
              size: 130,
              className: "alm-table__cell--dim",
              render: (row) => row.sourceLabel,
            },
            {
              id: "detected",
              header: "Detected",
              size: 140,
              className: "alm-table__cell--dim",
              render: (row) => row.detectedAt,
            },
          ]}
        />
      </div>
    </div>
  );

  const isMixed = selected?.type === "mixed";

  // `usePlans()` subscribes us to plan changes so `existingPlan` recomputes
  // when plans are created, applied, or discarded.
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

  const handleGeneratePlan = () => {
    if (!selected) return;
    if (existingPlan) {
      navigate({ to: "/plans/$planId", params: { planId: existingPlan.id } } as never);
      return;
    }
    const plan = createPlanFromInbox(selected);
    navigate({ to: "/plans/$planId", params: { planId: plan.id } } as never);
  };
  const drawer = selected
    ? (
      <DrawerShell
        title={selected.path}
        subtitle={`${selected.files} files · ${
          isMixed ? "mixed types detected" : `${selected.type} frames`
        }`}
        onClose={onClose}
        body={
          <>
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
          <>
            <Button
              variant="primary"
              trailingIcon={<ArrowRight size={14} />}
              onClick={handleGeneratePlan}
            >
              {existingPlan
                ? `Open existing plan #${existingPlan.number}`
                : isMixed
                ? "Generate split plan"
                : "Confirm to Inventory"}
            </Button>
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
