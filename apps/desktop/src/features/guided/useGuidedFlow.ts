/**
 * useGuidedFlow — React hook that manages guided flow state (spec 010).
 *
 * On first mount after first-run setup, activates the flow.
 * Exposes state + dismiss/restart actions consumed by GuidedOverlay and Settings.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  activateGuidedFlow,
  dismissGuidedFlow,
  restartGuidedFlow,
  type GuidedFlowStateDto,
} from './store';

export interface GuidedFlowHook {
  state: GuidedFlowStateDto | null;
  loading: boolean;
  dismiss: () => Promise<void>;
  restart: () => Promise<void>;
}

/**
 * Initialize and manage guided-flow state.
 *
 * @param setupCompleted - Pass `true` when first-run setup has completed
 *   so the hook knows to activate the flow.  Pass `false`/`undefined` to
 *   skip (e.g. when still in first-run setup).
 */
export function useGuidedFlow(setupCompleted: boolean | undefined): GuidedFlowHook {
  const [state, setState] = useState<GuidedFlowStateDto | null>(null);
  const [loading, setLoading] = useState(false);

  // Activate the flow once setup is complete.
  useEffect(() => {
    if (!setupCompleted) return;
    let cancelled = false;
    setLoading(true);
    activateGuidedFlow()
      .then((dto) => {
        if (!cancelled) setState(dto);
      })
      .catch(() => {
        // Backend unavailable — degrade gracefully (FR-007).
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setupCompleted]);

  const dismiss = useCallback(async () => {
    try {
      await dismissGuidedFlow();
      setState((prev) =>
        prev
          ? { ...prev, dismissed: true, dismissedAt: new Date().toISOString(), currentStep: null }
          : prev,
      );
    } catch {
      // Best-effort; silent failure keeps UI responsive.
    }
  }, []);

  const restart = useCallback(async () => {
    try {
      const newState = await restartGuidedFlow();
      setState(newState);
    } catch {
      // Best-effort.
    }
  }, []);

  return { state, loading, dismiss, restart };
}
