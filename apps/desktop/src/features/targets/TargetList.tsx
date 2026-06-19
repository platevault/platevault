import { useState } from 'react';
import type { TargetListItem } from '@/api/commands';
import { ListSidebar, ListItem } from '@/components';
import { Pill } from '@/ui';

interface Props {
  targets: TargetListItem[];
  selected: string | null;
  onSelect: (id: string) => void;
}

function matchesSearch(t: TargetListItem, query: string): boolean {
  const q = query.toLowerCase();
  return (
    t.primaryDesignation.toLowerCase().includes(q) ||
    t.effectiveLabel.toLowerCase().includes(q)
  );
}

export function TargetList({ targets, selected, onSelect }: Props) {
  const [search, setSearch] = useState('');
  const filtered = search.trim() ? targets.filter((t) => matchesSearch(t, search.trim())) : targets;

  return (
    <ListSidebar
      placeholder="Search targets..."
      searchValue={search}
      onSearchChange={setSearch}
      controls={
        <>
          <select defaultValue="name">
            <option value="name">Sort: name</option>
          </select>
        </>
      }
      footer={`${filtered.length} items`}
    >
      {filtered.map((t) => (
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
