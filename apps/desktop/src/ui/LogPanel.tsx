import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export interface LogEntry {
  id: string;
  time: string; // formatted timestamp e.g. "14:32:11"
  level: "info" | "warn" | "error" | "debug";
  source: string;
  message: string;
  context?: string;
}

export interface LogPanelProps {
  entries: LogEntry[];
}

const LEVELS = ["all", "info", "warn", "error", "debug"] as const;
type LevelFilter = (typeof LEVELS)[number];

export function LogPanel({ entries }: LogPanelProps) {
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
          <span style={{ color: "var(--text-faint)", fontSize: "var(--fs-micro)" }}>
            {entries.length > 0 ? entries[0].message : "Idle"}
          </span>
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
