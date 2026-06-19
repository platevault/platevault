import type { TargetListItem } from '@/api/commands';
import { ListSidebar, ListItem } from '@/components';
import { Pill } from '@/ui';

interface Props {
  targets: TargetListItem[];
  selected: string | null;
  onSelect: (id: string) => void;
}

export function TargetList({ targets, selected, onSelect }: Props) {
  return (
    <ListSidebar
      placeholder="Search targets..."
      controls={
        <>
          <select defaultValue="name">
            <option value="name">Sort: name</option>
          </select>
        </>
      }
      footer={`${targets.length} items`}
    >
      {targets.map((t) => (
        <ListItem
          key={t.id}
          selected={selected === t.id}
          onClick={() => onSelect(t.id)}
          title={
            <>
              <strong>{t.effectiveLabel}</strong>
              {t.effectiveLabel !== t.primaryDesignation && (
                <span
                  style={{
                    marginLeft: 'var(--alm-sp-1)',
                    color: 'var(--alm-text-muted)',
                    fontSize: 'var(--alm-text-xs)',
                  }}
                >
                  ({t.primaryDesignation})
                </span>
              )}
            </>
          }
          meta={
            <Pill variant="ghost">{t.objectType.replace('_', ' ')}</Pill>
          }
        />
      ))}
    </ListSidebar>
  );
}
