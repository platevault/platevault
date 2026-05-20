import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Menu, type MenuGroup } from "./Menu";
import { IconButton } from "./IconButton";

export interface PatternPart {
  id: string;
  kind: "token" | "separator";
  value: string;
}

export interface TokenPatternBuilderProps {
  pattern: PatternPart[];
  availableTokens: string[];
  separators?: string[];
  onAdd?: (part: Omit<PatternPart, "id">) => void;
  onRemove?: (id: string) => void;
}

export function TokenPatternBuilder({
  pattern,
  availableTokens,
  separators = ["/", "-", "_", " "],
  onAdd,
  onRemove,
}: TokenPatternBuilderProps) {
  const tokenMenu: MenuGroup[] = [
    {
      id: "tokens",
      label: "Tokens",
      items: availableTokens.map((token) => ({
        id: token,
        label: <code>{`{${token}}`}</code>,
        onSelect: () => onAdd?.({ kind: "token", value: token }),
      })),
    },
  ];

  const sepMenu: MenuGroup[] = [
    {
      id: "seps",
      label: "Separators",
      items: separators.map((sep) => ({
        id: sep,
        label: <code>{sep === " " ? "(space)" : sep}</code>,
        onSelect: () => onAdd?.({ kind: "separator", value: sep }),
      })),
    },
  ];

  return (
    <div className="alm-token-row">
      {pattern.map((part) => (
        <span
          key={part.id}
          className="alm-token"
          data-kind={part.kind === "separator" ? "separator" : undefined}
        >
          {part.kind === "token" ? `{${part.value}}` : part.value === " " ? "·" : part.value}
          {onRemove ? (
            <button
              type="button"
              aria-label={`Remove ${part.value}`}
              className="alm-token__remove"
              onClick={() => onRemove(part.id)}
            >
              <X size={11} />
            </button>
          ) : null}
        </span>
      ))}
      <Menu
        trigger={
          <button type="button" className="alm-btn" data-size="sm" data-variant="ghost">
            + Token
          </button>
        }
        groups={tokenMenu}
        align="start"
      />
      <Menu
        trigger={
          <button type="button" className="alm-btn" data-size="sm" data-variant="ghost">
            + Separator
          </button>
        }
        groups={sepMenu}
        align="start"
      />
    </div>
  );
}

export interface PatternPreviewProps {
  rows: Array<{ path: string; count?: number | string }>;
}

export function PatternPreview({ rows }: PatternPreviewProps) {
  return (
    <div className="alm-token-preview">
      {rows.map((row, idx) => (
        <div key={idx} className="alm-token-preview-row">
          <span>{row.path}</span>
          {row.count != null ? (
            <span className="alm-token-preview-row__count">({row.count})</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export interface RenderPatternProps {
  pattern: PatternPart[];
}

/** Render-only view (no editing) for inline displays. */
export function RenderPattern({ pattern }: RenderPatternProps): ReactNode {
  return (
    <code style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-dense)" }}>
      {pattern
        .map((part) => (part.kind === "token" ? `{${part.value}}` : part.value))
        .join("")}
    </code>
  );
}
