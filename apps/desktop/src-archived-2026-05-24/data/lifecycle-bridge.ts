/**
 * Lifecycle bridge — runtime-detection + probe hook for spec 002.
 *
 * Used by the Shell header pill to surface "Connected to Tauri" vs
 * "Browser mock". Probes `listLedger()` once on mount so we know the
 * IPC plumbing is live, not just that `window.__TAURI_INTERNALS__`
 * exists.
 */

import { useEffect, useState } from "react";

import { isTauriRuntime, listLedger, NotInTauriRuntimeError } from "../api/lifecycle";

export type BridgeStatus =
  | { runtime: "browser" }
  | { runtime: "probing" }
  | { runtime: "tauri"; ledgerCount: number }
  | { runtime: "error"; message: string };

export function useTauriBridgeStatus(): BridgeStatus {
  const [status, setStatus] = useState<BridgeStatus>(() =>
    isTauriRuntime() ? { runtime: "probing" } : { runtime: "browser" },
  );

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    listLedger({ limit: 1 })
      .then((rows) => {
        if (!cancelled) setStatus({ runtime: "tauri", ledgerCount: rows.length });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof NotInTauriRuntimeError) {
          setStatus({ runtime: "browser" });
          return;
        }
        setStatus({
          runtime: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
