import type { ReactNode } from 'react';

export interface ListDetailLayoutProps {
  topBar?: ReactNode;
  list: ReactNode;
  detail: ReactNode;
  sidebar?: ReactNode;
}

export function ListDetailLayout({ topBar, list, detail, sidebar }: ListDetailLayoutProps) {
  if (sidebar) {
    return (
      <>
        {topBar}
        <div className="alm-three-pane" style={{ flex: 1 }}>
          {list}
          <div className="alm-three-pane__content">{detail}</div>
          <div className="alm-three-pane__sidebar">{sidebar}</div>
        </div>
      </>
    );
  }
  return (
    <>
      {topBar}
      <div className="alm-two-pane">
        {list}
        <div className="alm-two-pane__detail">{detail}</div>
      </div>
    </>
  );
}
