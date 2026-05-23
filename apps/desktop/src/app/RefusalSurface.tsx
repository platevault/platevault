/**
 * RefusalSurface — global status-bar pill that surfaces recent
 * `RefusalRecord`s from `useRefusals()`.
 *
 * Shape decision: persistent pill with a count badge that opens a popover
 * listing the most recent refusals. Persistent (not auto-dismiss) because
 * `needsAction` refusals describe user follow-ups; auto-dismissing those
 * would be wrong. Hidden entirely when the list is empty.
 *
 * E2E hooks:
 *   - root element exposes `data-refusal-surface`
 *   - each entry exposes `data-refusal-bucket` and `data-refusal-code`
 *
 * Groups: `needsAction` first, then `needsAttention`. Cap rendered entries
 * (scrolls when the list grows; newest-first per the store).
 */
import { useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";

import { Tooltip } from "../ui";
import { useRefusals, refusalBucket, type RefusalRecord } from "../data/store";


interface Bucketed {
  needsAction: RefusalRecord[];
  needsAttention: RefusalRecord[];
}

function bucketRefusals(refusals: RefusalRecord[]): Bucketed {
  const out: Bucketed = { needsAction: [], needsAttention: [] };
  for (const r of refusals) {
    out[refusalBucket(r.code)].push(r);
  }
  return out;
}

export function RefusalSurface() {
  const refusals = useRefusals();
  const [open, setOpen] = useState(false);

  const { needsAction, needsAttention, total } = useMemo(() => {
    const b = bucketRefusals(refusals);
    return {
      needsAction: b.needsAction,
      needsAttention: b.needsAttention,
      total: b.needsAction.length + b.needsAttention.length,
    };
  }, [refusals]);

  if (total === 0) return null;

  const tone = needsAction.length > 0 ? "danger" : "warn";
  const tooltip =
    needsAction.length > 0
      ? `${needsAction.length} refusal(s) need action`
      : `${needsAttention.length} refusal(s) need attention`;

  return (
    <div
      className="alm-refusal-surface"
      data-refusal-surface
      style={{ position: "relative", display: "inline-flex" }}
    >
      <Tooltip content={tooltip}>
        <button
          type="button"
          className="alm-shell__bridge-pill"
          data-tone={tone}
          aria-label={tooltip}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((o) => !o)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            padding: "2px 6px",
            borderRadius: 4,
            border: "1px solid var(--border)",
            background: tone === "danger" ? "var(--danger-soft)" : "var(--warn-soft)",
            color: tone === "danger" ? "var(--danger)" : "var(--warn)",
            cursor: "pointer",
          }}
        >
          <AlertCircle size={11} aria-hidden />
          <span>{total}</span>
        </button>
      </Tooltip>
      {open ? (
        <div
          role="dialog"
          aria-label="Recent refusals"
          className="alm-refusal-surface__popover"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 60,
            minWidth: 320,
            maxWidth: 420,
            padding: 8,
            border: "1px solid var(--border)",
            background: "var(--surface-1)",
            borderRadius: 6,
            boxShadow: "var(--shadow-md)",
            fontSize: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            maxHeight: "60vh",
            overflowY: "auto",
          }}
        >
          {needsAction.length > 0 ? (
            <RefusalGroup
              label="Needs action"
              bucket="needsAction"
              entries={needsAction}
            />
          ) : null}
          {needsAttention.length > 0 ? (
            <RefusalGroup
              label="Needs attention"
              bucket="needsAttention"
              entries={needsAttention}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface RefusalGroupProps {
  label: string;
  bucket: "needsAction" | "needsAttention";
  entries: RefusalRecord[];
}

function RefusalGroup({ label, bucket, entries }: RefusalGroupProps) {
  if (entries.length === 0) return null;
  return (
    <section>
      <header
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: "var(--text-dim)",
          marginBottom: 4,
        }}
      >
        {label} ({entries.length})
      </header>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {entries.map((r) => (
          <li
            key={r.id}
            data-refusal-bucket={bucket}
            data-refusal-code={r.code}
            style={{
              padding: "4px 6px",
              border: "1px solid var(--border-subtle)",
              borderRadius: 4,
              background: "var(--surface-2)",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span style={{ fontWeight: 600, color: "var(--text)" }}>{r.code}</span>
            <span style={{ color: "var(--text-dim)" }}>{r.message}</span>
            <span
              className="alm-mono"
              style={{ color: "var(--text-faint)", fontSize: 10 }}
            >
              {r.entityType} · {r.entityId}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
