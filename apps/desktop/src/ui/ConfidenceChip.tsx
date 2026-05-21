import { AlertTriangle } from "lucide-react";
import { Chip } from "./Chip";
import { Tooltip } from "./Tooltip";

export interface ConfidenceChipProps {
  value: number;
  mixed?: boolean;
}

/**
 * Confidence pill shown in the Inbox table.
 * Reuses `Chip` for styling; wraps in a Tooltip with decision support.
 */
export function ConfidenceChip({ value, mixed }: ConfidenceChipProps) {
  const tone = mixed || value < 0.7 ? "warn" : value < 0.85 ? "warn" : "success";
  const tooltipContent = mixed
    ? "Mixed-type folder — needs manual review of the split"
    : value >= 0.9
    ? "High confidence in auto-classification"
    : value >= 0.7
    ? "Some ambiguity — verify before applying"
    : "Low confidence — review carefully";

  return (
    <Tooltip content={tooltipContent}>
      <Chip tone={tone} active>
        {mixed ? (
          <>
            <AlertTriangle size={11} /> mixed · {(value * 100).toFixed(0)}%
          </>
        ) : (
          `${(value * 100).toFixed(0)}%`
        )}
      </Chip>
    </Tooltip>
  );
}
