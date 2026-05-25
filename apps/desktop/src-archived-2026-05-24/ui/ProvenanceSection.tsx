/**
 * ProvenanceSection — renders the spec 002 `ProvenanceField[]` payload
 * returned from the `useProvenance` hook.
 *
 * Behavior:
 * - Each field renders a label (`fieldPath`), a current-value snippet, and
 *   an origin chip (one of 6 origins: observed | inferred | reviewed |
 *   generated | planned | applied).
 * - History is collapsed into a per-field disclosure (`<details>`) that lists
 *   `history[]` entries with their captured timestamp and origin.
 * - `historyTruncated === true` renders a non-interactive "history truncated"
 *   badge — no contract command exists yet to fetch the full history.
 * - Loading and error states render compact, muted placeholders.
 * - `current: unknown` is coerced safely: primitives render inline; objects
 *   render as a `<code>`-formatted JSON snippet; nullish renders as a muted
 *   em-dash.
 */

import type { ReactElement, ReactNode } from "react";
import type {
  ProvenanceField,
  ProvenanceHistoryEntry,
  ProvenanceOrigin,
} from "../bindings";
import type { ChipTone } from "./Chip";
import { Chip } from "./Chip";
import { Badge } from "./Badge";

export const PROVENANCE_ORIGINS: ReadonlyArray<ProvenanceOrigin> = [
  "observed",
  "inferred",
  "reviewed",
  "generated",
  "planned",
  "applied",
];

/**
 * Origin → ChipTone mapping. Distinct, accessible color per origin.
 *
 *   - observed   → info     (raw, factual reading)
 *   - inferred   → warn     (uncertain, computed)
 *   - reviewed   → success  (user-verified)
 *   - generated  → accent   (system-derived projection)
 *   - planned    → neutral  (intent, not yet applied)
 *   - applied    → archival (system-committed / finalised — teal, distinct
 *                            from `success` which signals user verification)
 */
const ORIGIN_TONE: Record<ProvenanceOrigin, ChipTone> = {
  observed: "info",
  inferred: "warn",
  reviewed: "success",
  generated: "accent",
  planned: "neutral",
  applied: "archival",
};

export interface OriginChipProps {
  origin: ProvenanceOrigin;
}

export function OriginChip({ origin }: OriginChipProps): ReactElement {
  return (
    <span data-provenance-origin={origin}>
      <Chip tone={ORIGIN_TONE[origin]} aria-label={`Origin: ${origin}`}>
        {origin}
      </Chip>
    </span>
  );
}

function renderValue(value: unknown): ReactNode {
  if (value === null || value === undefined) {
    return (
      <span className="alm-dim" aria-label="No value">
        —
      </span>
    );
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span>{String(value)}</span>;
  }
  // Object/array — render as compact JSON. Wrapped in <code> for tabular feel.
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    json = "[unserialisable]";
  }
  return <code className="alm-mono">{json}</code>;
}

function formatCapturedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "Z");
  } catch {
    return iso;
  }
}

interface ProvenanceFieldRowProps {
  field: ProvenanceField;
}

function ProvenanceFieldRow({ field }: ProvenanceFieldRowProps): ReactElement {
  // ProvenanceField is a union of _Serialize | _Deserialize; both have these
  // members with compatible shapes for read-only rendering.
  const history = (field.history ?? []) as ProvenanceHistoryEntry[];
  const truncated = Boolean(field.historyTruncated);

  return (
    <div
      className="alm-provenance-row"
      data-provenance-field={field.fieldPath}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(120px, 30%) 1fr auto",
        gap: 8,
        alignItems: "center",
        padding: "4px 0",
        fontSize: "var(--fs-small)",
      }}
    >
      <span className="alm-fact__label">{field.fieldPath}</span>
      <span>{renderValue(field.current)}</span>
      <OriginChip origin={field.origin} />
      {(history.length > 0 || truncated) ? (
        <details
          className="alm-provenance-history"
          style={{ gridColumn: "1 / -1", marginTop: 4 }}
        >
          <summary
            style={{
              cursor: "pointer",
              fontSize: "var(--fs-small)",
              color: "var(--text-dim)",
            }}
          >
            History ({history.length}
            {truncated ? "+" : ""})
          </summary>
          <ul
            style={{
              listStyle: "none",
              padding: "4px 0 0 8px",
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {history.map((entry, i) => (
              <li
                key={`${field.fieldPath}-h-${i}`}
                data-provenance-history-entry
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <OriginChip origin={entry.origin} />
                <span>{renderValue(entry.value)}</span>
                <span className="alm-dim alm-mono" style={{ fontSize: "var(--fs-x-small, 11px)" }}>
                  {formatCapturedAt(entry.capturedAt)}
                </span>
              </li>
            ))}
            {truncated ? (
              <li>
                <Badge
                  tone="warn"
                  aria-label="History truncated"
                  data-provenance-truncated
                >
                  history truncated
                </Badge>
              </li>
            ) : null}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export interface ProvenanceSectionProps {
  fields: ProvenanceField[] | undefined;
  loading?: boolean;
  error?: Error | undefined;
  /** Optional label for the surrounding region. */
  emptyLabel?: string;
}

/**
 * Renders the body of a "Provenance" section, given the result of
 * `useProvenance`. Loading and error states render inline (no throw).
 */
export function ProvenanceSection({
  fields,
  loading,
  error,
  emptyLabel = "No provenance recorded.",
}: ProvenanceSectionProps): ReactElement {
  if (loading) {
    return (
      <div
        className="alm-dim"
        role="status"
        aria-live="polite"
        data-provenance-loading
        style={{ fontSize: "var(--fs-small)", padding: "4px 0" }}
      >
        Loading provenance…
      </div>
    );
  }
  if (error) {
    return (
      <div
        className="alm-dim"
        role="alert"
        data-provenance-error
        style={{ fontSize: "var(--fs-small)", padding: "4px 0" }}
      >
        Provenance unavailable: {error.message}
      </div>
    );
  }
  if (!fields || fields.length === 0) {
    return (
      <div className="alm-dim" style={{ fontSize: "var(--fs-small)", padding: "4px 0" }}>
        {emptyLabel}
      </div>
    );
  }
  return (
    <div
      className="alm-provenance-section"
      data-provenance-section
      style={{ display: "flex", flexDirection: "column", gap: 0 }}
    >
      {fields.map((f) => (
        <ProvenanceFieldRow key={f.fieldPath} field={f} />
      ))}
    </div>
  );
}
