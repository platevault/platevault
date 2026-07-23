// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { m } from '@/lib/i18n';

export type OperationStatus = 'idle' | 'scanning' | 'applying';

// `label` is a render-time thunk so it re-reads the active locale (spec 046 #8) —
// never call these at module scope (e.g. in the `createContext` default below).
const STATUS_LABEL_FNS: Record<OperationStatus, () => string> = {
  idle: () => m.opstatus_idle(),
  scanning: () => m.opstatus_scanning(),
  applying: () => m.opstatus_applying_plan(),
};

interface OperationStatusState {
  status: OperationStatus;
  statusLabel: string;
  setStatus: (status: OperationStatus) => void;
}

const OperationStatusContext = createContext<OperationStatusState>({
  status: 'idle',
  // Fallback default context value (never rendered — the app always mounts
  // under OperationStatusProvider); left empty to avoid calling `m.*()` at
  // module-import time, which would freeze the locale (spec 046 #8).
  statusLabel: '',
  setStatus: () => {},
});

export function OperationStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatusRaw] = useState<OperationStatus>('idle');

  const setStatus = useCallback((next: OperationStatus) => {
    setStatusRaw(next);
  }, []);

  return (
    <OperationStatusContext.Provider
      value={{ status, statusLabel: STATUS_LABEL_FNS[status](), setStatus }}
    >
      {children}
    </OperationStatusContext.Provider>
  );
}

export function useOperationStatus() {
  return useContext(OperationStatusContext);
}
