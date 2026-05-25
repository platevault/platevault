import type { ReactNode } from 'react';

export interface ThreePaneProps {
  list: ReactNode;
  content: ReactNode;
  detail: ReactNode;
  listWidth?: number;
  detailWidth?: number;
}

export function ThreePane({
  list,
  content,
  detail,
  listWidth = 260,
  detailWidth = 380,
}: ThreePaneProps) {
  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, height: '100%' }}>
      <div style={{ width: listWidth, flexShrink: 0, height: '100%', overflow: 'auto', borderRight: '1px solid var(--alm-border)' }}>
        {list}
      </div>
      <div style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'auto' }}>
        {content}
      </div>
      <div style={{ width: detailWidth, flexShrink: 0, height: '100%', overflow: 'auto', borderLeft: '1px solid var(--alm-border)' }}>
        {detail}
      </div>
    </div>
  );
}
