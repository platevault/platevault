import { useState } from 'react';
import type { TargetFixture } from '@/data/fixtures/targets';
import { ListSidebar, ListItem } from '@/components';
import { Pill } from '@/ui';
import { groupTargets, sortTargets } from './target-list-utils';
import type { GroupBy, SortBy } from './target-list-utils';

interface Props {
  targets: TargetFixture[];
  /** The selected target UUID string (spec 023: IDs are UUIDs, not numerics). */
  selected: string | null;
  onSelect: (uuid: string) => void;
}

/** T039b (FR-041): Targets list with grouping (type, constellation) and
 *  sorting (name, session count, integration hours) with clear labels. */
export function TargetList({ targets, selected, onSelect }: Props) {
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [sortBy, setSortBy] = useState<SortBy>('name');

  const groups = groupTargets(targets, groupBy, sortBy);

  return (
    <ListSidebar
      placeholder="Search targets..."
      controls={
        <>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            aria-label="Group targets by"
          >
            <option value="none">Group: none</option>
            <option value="type">Group: type</option>
            <option value="constellation">Group: constellation</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            aria-label="Sort targets by"
          >
            <option value="name">Sort: name</option>
            <option value="sessions">Sort: session count</option>
            <option value="hours">Sort: integration hours</option>
          </select>
        </>
      }
      footer={`${targets.length} targets`}
    >
      {groups.map((group) => (
        <div key={group.key || '__all__'}>
          {group.label && (
            <div
              style={{
                padding: '4px 12px',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'var(--alm-text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                borderBottom: '1px solid var(--alm-border)',
              }}
            >
              {group.label}
            </div>
          )}
          {group.targets.map((t) => (
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
        </div>
      ))}
    </ListSidebar>
  );
}
