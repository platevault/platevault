import { createContext, useContext, useState, type ReactNode } from 'react';

interface LogPanelState {
  expanded: boolean;
  toggle: () => void;
}

const LogPanelContext = createContext<LogPanelState>({
  expanded: false,
  toggle: () => {},
});

export function LogPanelProvider({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => setExpanded((v) => !v);

  return (
    <LogPanelContext.Provider value={{ expanded, toggle }}>
      {children}
    </LogPanelContext.Provider>
  );
}

export function useLogPanel() {
  return useContext(LogPanelContext);
}
