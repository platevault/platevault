import type { SessionFixture } from '@/data/fixtures/sessions';
import { ListSidebar, ListItem } from '@/components';
import { Pill } from '@/ui';

const stateVariant = (s: string) =>
  (({ confirmed: 'ok', needs_review: 'warn', rejected: 'danger', discovered: 'ghost', candidate: 'neutral', ignored: 'neutral' } as Record<string, 'ok' | 'warn' | 'danger' | 'ghost' | 'neutral'>)[s] ?? 'neutral');

const stateLabel = (s: string) => s.replace(/_/g, ' ');

interface Props {
  sessions: SessionFixture[];
  selected: number | null;
  onSelect: (id: number) => void;
}

export function SessionsList({ sessions, selected, onSelect }: Props) {
  return (
    <ListSidebar
      placeholder="Search target, filter, train..."
      controls={
        <>
          <select defaultValue="none">
            <option value="none">Group: none</option>
            <option value="target">target</option>
            <option value="month">month</option>
          </select>
          <select defaultValue="date_desc">
            <option value="date_desc">Sort: newest</option>
            <option value="date_asc">oldest</option>
            <option value="name">name</option>
          </select>
          <select defaultValue="all">
            <option value="all">Filter: all states</option>
            <option value="confirmed">Confirmed</option>
            <option value="needs_review">Needs review</option>
            <option value="discovered">Discovered</option>
            <option value="candidate">Candidate</option>
            <option value="rejected">Rejected</option>
            <option value="ignored">Ignored</option>
          </select>
        </>
      }
      footer={`${sessions.length} items`}
    >
      {sessions.map(s => (
        <ListItem
          key={s.id}
          selected={selected === s.id}
          onClick={() => onSelect(s.id)}
          title={
            <>
              <strong>{s.target}</strong>
              <Pill variant="neutral">{s.filter}</Pill>
              {s.state === 'discovered' && <span style={{ color: 'var(--alm-warn)' }}>&#x26A0;</span>}
            </>
          }
          meta={
            <>
              {s.date}
              <span className="alm-list-item__meta-sep">·</span>
              {s.integration}
              <span className="alm-list-item__meta-sep">·</span>
              <Pill variant={stateVariant(s.state)}>{stateLabel(s.state)}</Pill>
            </>
          }
        />
      ))}
    </ListSidebar>
  );
}
