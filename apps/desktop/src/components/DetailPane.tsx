import type { ReactNode } from 'react';

export interface DetailPaneProps {
  children: ReactNode;
}

export function DetailPane({ children }: DetailPaneProps) {
  return <div className="alm-detail">{children}</div>;
}
