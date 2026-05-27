import { Pill } from '@/ui';

export interface ArchiveListItemProps {
  id: string;
  name: string;
  entityType: string;
  archivedAt: string;
  selected: boolean;
  onClick: () => void;
}

export function ArchiveListItem({
  name,
  entityType,
  archivedAt,
  selected,
  onClick,
}: ArchiveListItemProps) {
  return (
    <button
      type="button"
      className={`alm-archive-list__item ${selected ? 'alm-archive-list__item--selected' : ''}`}
      onClick={onClick}
    >
      <div className="alm-archive-list__item-row">
        <span className="alm-archive-list__item-name">{name}</span>
        <Pill>{entityType}</Pill>
      </div>
      <span className="alm-archive-list__item-date">{archivedAt}</span>
    </button>
  );
}
