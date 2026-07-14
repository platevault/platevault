// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";

export interface LogEntry {
  id: string;
  time: string; // formatted timestamp e.g. "14:32:11"
  level: "info" | "warn" | "error" | "debug";
  source: string;
  message: string;
  context?: string;
}

export interface ScanStatusView {
  state: "idle" | "running" | "error";
  source: string;
  processed?: number;
  total?: number;
  message?: string;
}

export interface LogPanelProps {
  entries: LogEntry[];
  scan?: ScanStatusView;
}

const LEVELS = ["all", "info", "warn", "error", "debug"] as const;
type LevelFilter = (typeof LEVELS)[number];

export function LogPanel({ entries, scan }: LogPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [level, setLevel] = useState<LevelFilter>("all");

  const visible = level === "all" ? entries : entries.filter((e) => e.level === level);

  return (
    <div className="alm-log" data-expanded={expanded ? "true" : "false"}>
      <div className="alm-log__head">
        <button
          type="button"
          className="alm-log__head-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          <span>Log</span>
        </button>
        {expanded ? (
          <div className="alm-log__filters">
            {LEVELS.map((l) => (
              <span
                key={l}
                className="alm-log__filter"
                data-active={level === l ? "true" : undefined}
                onClick={() => setLevel(l)}
              >
                {l}
              </span>
            ))}
          </div>
        ) : (
          <ScanStatusInline scan={scan} latest={entries[0]} />
        )}
      </div>
      {expanded ? (
        <div className="alm-log__list">
          {visible.map((entry) => (
            <div key={entry.id} className="alm-log__entry" data-level={entry.level}>
              <span className="alm-log__entry-time">{entry.time}</span>
              <span className="alm-log__entry-level">{entry.level}</span>
              <span style={{ color: "var(--text-dim)" }}>{entry.source}</span>
              <span className="alm-log__entry-message">{entry.message}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ScanStatusInline({ scan, latest }: { scan?: ScanStatusView; latest?: LogEntry }) {
  if (scan?.state === "running") {
    const pct =
      scan.total && scan.processed != null
        ? Math.min(100, Math.round((scan.processed / scan.total) * 100))
        : null;
    return (
      <div className="alm-log__scan" data-state="running">
        <Loader2 size={12} className="alm-log__scan-spinner" />
        <span className="alm-log__scan-source">{scan.source}</span>
        <span className="alm-log__scan-counter">
          {scan.processed?.toLocaleString()} / {scan.total?.toLocaleString()}
          {pct != null ? ` files · ${pct}%` : " files"}
        </span>
        {pct != null ? (
          <div className="alm-log__scan-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="alm-log__scan-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        ) : null}
      </div>
    );
  }
  if (scan?.state === "error") {
    return (
      <span className="alm-log__scan" data-state="error">
        {scan.message ?? "Scan failed"}
      </span>
    );
  }
  return (
    <span className="alm-log__scan" data-state="idle">
      {scan?.message ?? (latest ? latest.message : "Idle")}
    </span>
  );
}
