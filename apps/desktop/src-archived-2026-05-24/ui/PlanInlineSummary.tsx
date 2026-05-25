import type { ReactElement } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import type { Plan } from "../data/mock";

export function PlanInlineSummary({ plan }: { plan: Plan }): ReactElement {
  const previewItems = plan.items.slice(0, 6);
  const remaining = plan.itemsTotal - previewItems.length;
  const isApplying = plan.state === "applying";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 12, fontSize: "var(--fs-small)" }}>
        <span><strong>{plan.itemsTotal}</strong> moves</span>
        {plan.itemsApplied > 0 ? (
          <span style={{ color: "var(--success, #2f9e44)" }}>
            <CheckCircle2 size={12} style={{ verticalAlign: -2 }} /> {plan.itemsApplied} applied
          </span>
        ) : null}
        {plan.itemsFailed > 0 ? (
          <span style={{ color: "var(--danger, #e5484d)" }}>
            <XCircle size={12} style={{ verticalAlign: -2 }} /> {plan.itemsFailed} failed
          </span>
        ) : null}
      </div>

      {isApplying && plan.itemsTotal > 0 ? (
        <div className="alm-log__scan-bar" role="progressbar"
          aria-valuenow={Math.round(((plan.itemsApplied + plan.itemsFailed) / plan.itemsTotal) * 100)}
          aria-valuemin={0} aria-valuemax={100}>
          <div
            className="alm-log__scan-bar-fill"
            style={{
              width: `${Math.round(((plan.itemsApplied + plan.itemsFailed) / plan.itemsTotal) * 100)}%`,
            }}
          />
        </div>
      ) : null}

      <div
        style={{
          border: "1px solid var(--border-subtle, var(--border))",
          borderRadius: "var(--r-sm)",
          background: "var(--surface-2)",
          padding: 6,
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-micro)",
          lineHeight: 1.55,
        }}
      >
        {previewItems.map((item) => {
          const tone =
            item.state === "succeeded"
              ? "var(--success, #2f9e44)"
              : item.state === "failed"
              ? "var(--danger, #e5484d)"
              : item.state === "applying"
              ? "var(--accent)"
              : "var(--text-faint)";
          return (
            <div key={item.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ color: tone, width: 12 }}>
                {item.state === "succeeded" ? "✓" : item.state === "failed" ? "✕" : "·"}
              </span>
              <span style={{ color: "var(--text-dim)" }}>{item.action}</span>
              <span style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.name}
              </span>
              <span style={{ color: "var(--text-faint)", marginLeft: "auto" }}>
                → {item.to.split("/").slice(-3).join("/")}
              </span>
            </div>
          );
        })}
        {remaining > 0 ? (
          <div style={{ color: "var(--accent)", padding: "4px 0 0", cursor: "pointer" }}>
            Show all {plan.itemsTotal} items →
          </div>
        ) : null}
      </div>
    </div>
  );
}
