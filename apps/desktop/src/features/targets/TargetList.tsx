import type { TargetFixture } from '@/data/fixtures/targets';
import { ListSidebar, ListItem } from '@/components';
import { Pill } from '@/ui';

interface Props {
  targets: TargetFixture[];
  /** The selected target UUID string (spec 023: IDs are UUIDs, not numerics). */
  selected: string | null;
  onSelect: (uuid: string) => void;
}

export function TargetList({ targets, selected, onSelect }: Props) {
  return (
    <ListSidebar
      placeholder="Search targets..."
      controls={
        <>
          <select defaultValue="none">
            <option value="none">Group: none</option>
            <option value="type">type</option>
            <option value="constellation">constellation</option>
          </select>
          <select defaultValue="name">
            <option value="name">Sort: name</option>
            <option value="sessions">sessions</option>
            <option value="hours">integration hours</option>
          </select>
        </>
      }
      footer={`${targets.length} items`}
    >
      {targets.map(t => (
        <ListItem
          key={t.id}
          selected={selected === t.uuid}
          onClick={() => onSelect(t.uuid)}
          title={
            <>
              <strong>{t.name}</strong>
              {t.warn && <span style={{ color: 'var(--alm-warn)' }}>&#x26A0;</span>}
              <Pill variant="ghost">{t.kind}</Pill>
            </>
          }
          meta={
            <>
              {t.sessions} sess
              <span className="alm-list-item__meta-sep">·</span>
              {t.hours.toFixed(1)}h
              <span className="alm-list-item__meta-sep">·</span>
              {t.projects} proj
              {t.common && (
                <>
                  <span className="alm-list-item__meta-sep">·</span>
                  {t.common}
                </>
              )}
            </>
          }
        />
      ))}
    </ListSidebar>
  );
}
