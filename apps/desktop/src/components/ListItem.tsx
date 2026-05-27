import type { ReactNode } from 'react';

export interface ListItemProps {
  selected?: boolean;
  onClick?: () => void;
  title: ReactNode;
  pills?: ReactNode;
  meta?: ReactNode;
}

export function ListItem({ selected, onClick, title, pills, meta }: ListItemProps) {
  return (
    <div className={`alm-list-item ${selected ? 'alm-list-item--selected' : ''}`} onClick={onClick}>
      <div className="alm-list-item__title">
        {title}
        {pills}
      </div>
      {meta && <div className="alm-list-item__meta">{meta}</div>}
    </div>
  );
}
