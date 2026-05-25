import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "./Button";
import type { Plan } from "../data/mock";

export interface PlanFooterProps {
  plan: Plan | undefined;
  onGenerate?: () => void;
  onApprove?: () => Promise<void> | void;
  onDiscard?: () => void;
  onRetry?: () => void;
  onDone?: () => void;
  onEditDestinations?: () => void;
  /** When true, show the spinner "Verifying…" button instead of action buttons. */
  validating?: boolean;
  /** Additional label used when generating, e.g. "Generate split plan". */
  generateLabel?: string;
  /** Slot for an overflow menu or other right-side extra. */
  extra?: ReactNode;
}

/**
 * State-driven footer for plan drawers.
 * Renders the correct set of buttons based on plan.state + validating flag.
 * Used by Inbox drawer, Projects Plans tab, Activity drawer.
 */
export function PlanFooter({
  plan,
  onGenerate,
  onApprove,
  onDiscard,
  onRetry,
  onDone,
  onEditDestinations,
  validating = false,
  generateLabel = "Generate plan",
  extra,
}: PlanFooterProps) {
  const planState = plan?.state;
  const isApplying = planState === "applying";
  const isApplied = planState === "applied" || planState === "partially_applied";
  const hasFailures = planState === "partially_applied" || planState === "failed";

  const buttons: ReactNode = (() => {
    if (validating) {
      return (
        <Button variant="ghost" disabled>
          <Loader2 size={13} className="alm-spin" /> Verifying plan against current state…
        </Button>
      );
    }

    if (!plan) {
      return (
        <>
          {onGenerate ? (
            <Button variant="primary" onClick={onGenerate}>
              {generateLabel}
            </Button>
          ) : null}
          <Button>Reclassify…</Button>
        </>
      );
    }

    if (isApplying) {
      return (
        <Button variant="ghost" disabled>
          <Loader2 size={13} className="alm-spin" /> Applying {plan.itemsApplied}/{plan.itemsTotal}…
        </Button>
      );
    }

    if (isApplied) {
      return (
        <>
          {onDone ? (
            <Button variant="primary" onClick={onDone}>
              Done
            </Button>
          ) : null}
          {hasFailures && onRetry ? (
            <Button onClick={onRetry}>Retry failures</Button>
          ) : null}
        </>
      );
    }

    // draft / ready_for_review / approved
    return (
      <>
        {onApprove ? (
          <Button variant="primary" onClick={() => void onApprove()}>
            Approve &amp; apply
          </Button>
        ) : null}
        {onEditDestinations ? (
          <Button onClick={onEditDestinations}>Edit destinations…</Button>
        ) : null}
        {onDiscard ? (
          <Button variant="danger" onClick={onDiscard}>
            Discard plan
          </Button>
        ) : null}
      </>
    );
  })();

  return (
    <>
      {buttons}
      {extra ? (
        <>
          <span style={{ flex: 1 }} />
          {extra}
        </>
      ) : null}
    </>
  );
}
