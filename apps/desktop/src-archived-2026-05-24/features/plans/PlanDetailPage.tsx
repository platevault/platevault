// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, MoreVertical, Pause, FolderOpen, RefreshCw } from "lucide-react";

import { Button, IconButton, Facts, Menu, StateLabel, ProvenanceSection } from "../../ui";
import { planStateLabel, planStateTone, type Plan, type PlanItem } from "../../data/mock";
import { discardPlan, simulateApply, updatePlanState, usePlans } from "../../data/store";
import { useProvenance } from "../../data/provenance";

export function PlanDetailPage() {
  const { planId } = useParams({ strict: false }) as { planId?: string };
  const navigate = useNavigate();
  const allPlans = usePlans();
  const plan = allPlans.find((p) => p.id === planId);

  // Hooks must run unconditionally — keep them above the not-found guard.
  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    plan?.items[0]?.id ?? null,
  );

  useEffect(() => {
    if (!plan) return;
    setSelectedItemId(plan.items[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id]);

  const selectedItem = useMemo(
    () => plan?.items.find((i) => i.id === selectedItemId) ?? plan?.items[0] ?? null,
    [plan?.items, selectedItemId],
  );

  if (!plan) {
    return (
      <div className="alm-page">
        <div className="alm-page__head">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ to: "/plans" })}
          >
            <ArrowLeft size={14} /> Plans
          </Button>
          <h1>Plan not found</h1>
        </div>
      </div>
    );
  }

  const isApplying = plan.state === "applying";
  const isFailed = plan.state === "failed";
  const isPartial = plan.state === "partially_applied";
  const isApplied = plan.state === "applied";
  const isApproved = plan.state === "approved";
  const isDraft = plan.state === "draft" || plan.state === "ready_for_review";
  const isCancelled = plan.state === "cancelled";
  const inProgressOrDone =
    isApplying || isApplied || isFailed || isPartial || isCancelled;
  const itemsTotalSafe = plan.itemsTotal > 0 ? plan.itemsTotal : 1;

  return (
    <div className="alm-page" style={{ display: "flex", flexDirection: "column" }}>
      <div className="alm-page__head">
        <div className="alm-page__title" style={{ alignItems: "center" }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ to: "/plans" })}
            style={{ marginRight: 8 }}
          >
            <ArrowLeft size={14} /> Plans
          </Button>
          <h1>
            <span className="alm-mono alm-dim">#{plan.number}</span> {plan.title}
          </h1>
          <StateLabel tone={planStateTone(plan.state)}>{planStateLabel(plan.state)}</StateLabel>
        </div>
        <div className="alm-page__actions">
          <Menu
            trigger={
              <IconButton aria-label="More actions">
                <MoreVertical size={15} />
              </IconButton>
            }
            groups={[
              { id: "g1", items: [{ id: "diff", label: "View diff" }, { id: "dup", label: "Duplicate" }] },
              { id: "g2", items: [{ id: "discard", label: "Discard plan", tone: "danger" }] },
            ]}
          />
        </div>
      </div>

      {/* Progress / summary strip */}
      <div className="alm-plan-progress">
        <span>
          Origin{" "}
          <span className="alm-mono alm-dim">
            {plan.origin}
            {plan.originPath ? ` · ${plan.originPath}` : ""}
          </span>
        </span>
        <span className="alm-spacer" />
        {isApplying ||
        plan.state === "applied" ||
        plan.state === "partially_applied" ||
        isFailed ||
        isCancelled ? (
          <>
            <span>
              {plan.itemsApplied} / {plan.itemsTotal}
            </span>
            <div className="alm-plan-progress__bar">
              <div
                className="alm-plan-progress__bar-fill"
                style={{
                  width: `${(plan.itemsApplied / itemsTotalSafe) * 100}%`,
                }}
              />
              {plan.itemsFailed > 0 ? (
                <div
                  className="alm-plan-progress__bar-fail"
                  style={{ width: `${(plan.itemsFailed / itemsTotalSafe) * 100}%` }}
                />
              ) : null}
            </div>
            {plan.itemsFailed > 0 ? (
              <StateLabel tone="danger">{plan.itemsFailed} failed</StateLabel>
            ) : null}
            {plan.estimateRemaining ? (
              <span className="alm-text-dense alm-dim">est. {plan.estimateRemaining}</span>
            ) : null}
          </>
        ) : (
          <>
            <span>{plan.itemsTotal} moves · 0 archives · 0 deletes</span>
          </>
        )}
      </div>

      <div className="alm-plan-pane" style={{ flex: 1, minHeight: 0 }}>
        {inProgressOrDone ? (
          <ApplyingPane plan={plan} />
        ) : (
          <>
            <div className="alm-plan-pane__list">
              {plan.items.length === 0 ? (
                <div style={{ padding: 24, color: "var(--text-faint)" }}>No items.</div>
              ) : (
                plan.items.map((item) => (
                  <PlanItemRow
                    key={item.id}
                    item={item}
                    selected={selectedItemId === item.id}
                    onSelect={() => setSelectedItemId(item.id)}
                  />
                ))
              )}
              {plan.itemsTotal > plan.items.length ? (
                <div style={{ padding: 12, color: "var(--text-faint)", fontSize: "var(--fs-dense)" }}>
                  … {plan.itemsTotal - plan.items.length} more
                </div>
              ) : null}
            </div>
            <div className="alm-plan-pane__detail">
              {selectedItem ? (
                <PlanItemDetail item={selectedItem} />
              ) : (
                <div style={{ color: "var(--text-faint)" }}>Select an item to inspect.</div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Action bar — state-aware */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px",
          borderTop: "1px solid var(--border)",
          background: "var(--surface-1)",
        }}
      >
        {isApplying ? (
          <>
            <Button leadingIcon={<Pause size={14} />}>Pause</Button>
            <Button
              variant="danger"
              onClick={() => updatePlanState(plan.id, "cancelled")}
            >
              Cancel remaining
            </Button>
            <span className="alm-spacer" />
            <Button variant="subtle">Run in background</Button>
          </>
        ) : isFailed || isPartial ? (
          <>
            <Button variant="primary" leadingIcon={<RefreshCw size={14} />}>
              Generate retry plan for failures
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                discardPlan(plan.id);
                navigate({ to: "/plans" });
              }}
            >
              Discard plan
            </Button>
            <span className="alm-spacer" />
          </>
        ) : isApplied ? (
          <>
            <Button onClick={() => navigate({ to: "/plans" })}>Back to plans</Button>
            <span className="alm-spacer" />
            <Button variant="subtle">View audit log</Button>
          </>
        ) : isCancelled ? (
          <>
            <Button onClick={() => navigate({ to: "/plans" })}>Back to plans</Button>
            <Button
              variant="ghost"
              onClick={() => {
                discardPlan(plan.id);
                navigate({ to: "/plans" });
              }}
            >
              Discard plan
            </Button>
            <span className="alm-spacer" />
            <span className="alm-text-dense alm-dim">
              Cancelled by user — partial changes left in place
            </span>
          </>
        ) : isApproved ? (
          <>
            <Button variant="primary" onClick={() => simulateApply(plan.id)}>
              Apply now
            </Button>
            <Button onClick={() => updatePlanState(plan.id, "draft")}>
              Reopen & edit
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                discardPlan(plan.id);
                navigate({ to: "/plans" });
              }}
            >
              Discard plan
            </Button>
            <span className="alm-spacer" />
          </>
        ) : isDraft ? (
          <>
            <Button
              variant="primary"
              onClick={() => {
                updatePlanState(plan.id, "approved");
                simulateApply(plan.id);
              }}
            >
              Approve & Apply
            </Button>
            <Button onClick={() => updatePlanState(plan.id, "draft")}>
              Save Draft
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                discardPlan(plan.id);
                navigate({ to: "/plans" });
              }}
            >
              Discard plan
            </Button>
            <span className="alm-spacer" />
            <Button variant="subtle">Edit reason on all…</Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function PlanItemRow({
  item,
  selected,
  onSelect,
}: {
  item: PlanItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className="alm-plan-item"
      data-selected={selected ? "true" : undefined}
      data-state={item.state}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="alm-plan-item__index">#{item.index}</span>
      <span className="alm-plan-item__name">{item.name}</span>
      <span className="alm-plan-item__state">
        {item.state === "failed" ? "✕" : item.state === "succeeded" ? "✓" : item.state}
      </span>
    </div>
  );
}

/**
 * Provenance pane for a plan item. Reads the spec 002 `ProvenanceField[]`
 * payload via `useProvenance` (asset type `filesystem_plan`). In `pnpm dev`
 * this resolves through the dev-mode shim that synthesises fields from the
 * legacy `PlanItem.provenance` mock data; under Tauri it hits the real
 * contract.
 */
function PlanItemProvenance({ itemId }: { itemId: string }) {
  const { data, loading, error } = useProvenance(itemId, "filesystem_plan");
  const hasContent = loading || error || (data && data.length > 0);
  if (!hasContent) return null;
  return (
    <div style={{ marginTop: 16 }} data-provenance-pane="plan-item">
      <div className="alm-fact-group__label">Provenance</div>
      <ProvenanceSection fields={data} loading={loading} error={error} />
    </div>
  );
}

function PlanItemDetail({ item }: { item: PlanItem }) {
  return (
    <div>
      <h2 style={{ fontSize: "var(--fs-md)", marginBottom: 8 }}>
        Item {item.index}: <span className="alm-mono">{item.name}</span>
      </h2>
      <Facts
        entries={[
          { label: "Action", value: item.action },
          { label: "From", value: item.from, mono: true },
          { label: "To", value: item.to, mono: true },
          { label: "Reason", value: item.reason },
          { label: "Protection", value: item.protection },
          item.linked ? { label: "Linked", value: item.linked } : null,
          item.failureReason ? { label: "Failure", value: item.failureReason } : null,
        ].filter(Boolean) as Array<{ label: React.ReactNode; value: React.ReactNode; mono?: boolean }>}
      />

      <PlanItemProvenance itemId={item.id} />


      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Button leadingIcon={<FolderOpen size={14} />}>Reveal source in OS</Button>
        {item.state === "pending" ? (
          <Button variant="ghost">Skip this item</Button>
        ) : null}
      </div>
    </div>
  );
}

function ApplyingPane({ plan }: { plan: Plan }) {
  const failed = plan.items.filter((i) => i.state === "failed");
  const applied = plan.items.filter((i) => i.state === "succeeded").reverse();
  const pending = plan.items.filter((i) => i.state === "pending");
  const isCancelled = plan.state === "cancelled";

  return (
    <div style={{ overflowY: "auto", gridColumn: "1 / -1" }}>
      {failed.length > 0 ? (
        <div className="alm-plan-section">
          <div className="alm-plan-section__heading" data-tone="danger">
            <span>Needs attention ({failed.length})</span>
          </div>
          {failed.map((item) => (
            <div
              key={item.id}
              style={{
                display: "grid",
                gridTemplateColumns: "16px 1fr auto",
                gap: 8,
                padding: "4px 0",
                fontSize: "var(--fs-small)",
                alignItems: "center",
              }}
            >
              <span style={{ color: "var(--danger)" }}>✕</span>
              <span>
                <span className="alm-mono">{item.name}</span>{" "}
                {item.failureReason ? (
                  <span className="alm-dim alm-text-dense">— {item.failureReason}</span>
                ) : null}
              </span>
              <div style={{ display: "flex", gap: 4 }}>
                <Button variant="ghost" size="sm">
                  Retry
                </Button>
                <Button variant="ghost" size="sm">
                  Skip
                </Button>
                <Button variant="ghost" size="sm">
                  Reveal
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {applied.length > 0 ? (
        <div className="alm-plan-section">
          <div className="alm-plan-section__heading">
            <span>Recently applied ({applied.length})</span>
          </div>
          {applied.slice(0, 12).map((row) => (
            <div
              key={row.id}
              style={{
                padding: "3px 0",
                fontSize: "var(--fs-dense)",
                display: "grid",
                gridTemplateColumns: "16px 1fr",
                gap: 8,
              }}
            >
              <span style={{ color: "var(--success)" }}>✓</span>
              <span className="alm-mono alm-dim">
                {row.name} → {row.to}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {pending.length > 0 ? (
        <div className="alm-plan-section">
          <div className="alm-plan-section__heading">
            <span>
              {isCancelled
                ? `Skipped (${pending.length}) — not applied`
                : `Pending (${pending.length})`}
            </span>
          </div>
          {pending.slice(0, 12).map((row) => (
            <div
              key={row.id}
              style={{
                padding: "3px 0",
                fontSize: "var(--fs-dense)",
                display: "grid",
                gridTemplateColumns: "16px 1fr",
                gap: 8,
                color: "var(--text-faint)",
                textDecoration: isCancelled ? "line-through" : undefined,
              }}
            >
              <span>{isCancelled ? "⊘" : "·"}</span>
              <span className="alm-mono">
                {row.name} → {row.to}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
