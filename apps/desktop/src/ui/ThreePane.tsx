import type { ReactNode } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';

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
  listWidth = 220,
  detailWidth = 320,
}: ThreePaneProps) {
  const listPercent = Math.round((listWidth / 1200) * 100);
  const detailPercent = Math.round((detailWidth / 1200) * 100);

  return (
    <Group orientation="horizontal" style={{ flex: 1, display: 'flex' }}>
      <Panel defaultSize={listPercent} minSize={10} maxSize={30}>
        {list}
      </Panel>
      <Separator style={{ width: 1, background: 'var(--alm-border)', cursor: 'col-resize' }} />
      <Panel minSize={30}>
        {content}
      </Panel>
      <Separator style={{ width: 1, background: 'var(--alm-border)', cursor: 'col-resize' }} />
      <Panel defaultSize={detailPercent} minSize={15} maxSize={40}>
        {detail}
      </Panel>
    </Group>
  );
}
