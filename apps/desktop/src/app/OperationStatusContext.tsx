import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type OperationStatus = 'idle' | 'scanning' | 'applying';

const STATUS_LABELS: Record<OperationStatus, string> = {
  idle: 'Idle',
  scanning: 'Scanning...',
  applying: 'Applying plan...',
};

interface OperationStatusState {
  status: OperationStatus;
  statusLabel: string;
  setStatus: (status: OperationStatus) => void;
}

const OperationStatusContext = createContext<OperationStatusState>({
  status: 'idle',
  statusLabel: STATUS_LABELS.idle,
  setStatus: () => {},
});

export function OperationStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatusRaw] = useState<OperationStatus>('idle');

  const setStatus = useCallback((next: OperationStatus) => {
    setStatusRaw(next);
  }, []);

  return (
    <OperationStatusContext.Provider
      value={{ status, statusLabel: STATUS_LABELS[status], setStatus }}
    >
      {children}
    </OperationStatusContext.Provider>
  );
}

export function useOperationStatus() {
  return useContext(OperationStatusContext);
}
