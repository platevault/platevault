import type { MasterFixture } from '@/data/fixtures/calibration';
import { ListSidebar, ListItem } from '@/components';
import { Pill } from '@/ui';

const KIND_ORDER: Array<MasterFixture['kind']> = ['dark', 'flat', 'bias'];
const GROUP_LABELS: Record<MasterFixture['kind'], string> = {
  dark: 'DARKS',
  flat: 'FLATS',
  bias: 'BIAS',
};

interface Props {
  masters: MasterFixture[];
  selected: number | null;
  onSelect: (id: number) => void;
}

export function MastersList({ masters, selected, onSelect }: Props) {
  const grouped = KIND_ORDER.map(kind => ({
    kind,
    items: masters.filter(m => m.kind === kind),
  })).filter(g => g.items.length > 0);

  return (
    <ListSidebar
      placeholder="Search name, camera..."
      controls={
        <>
          <select defaultValue="kind">
            <option value="kind">Group: kind</option>
            <option value="camera">camera</option>
            <option value="none">none</option>
          </select>
          <select defaultValue="name">
            <option value="name">Sort: name</option>
            <option value="age">age</option>
            <option value="sessions">sessions</option>
          </select>
        </>
      }
      footer={`${masters.length} items`}
    >
      {grouped.map(group => (
        <div key={group.kind}>
          <div className="alm-group-header">{GROUP_LABELS[group.kind]}</div>
          {group.items.map(m => (
            <ListItem
              key={m.id}
              selected={selected === m.id}
              onClick={() => onSelect(m.id)}
              title={
                <span className="alm-mono" style={{ fontSize: 11 }}>{m.name}</span>
              }
              meta={
                <>
                  {m.exposure !== '--' && <>{m.exposure}<span className="alm-list-item__meta-sep">·</span></>}
                  {m.temp !== '--' && <>{m.temp}<span className="alm-list-item__meta-sep">·</span></>}
                  g{m.gain}
                  <span className="alm-list-item__meta-sep">·</span>
                  {m.camera.replace('ASI', '')}
                  {m.aging && (
                    <>
                      <span className="alm-list-item__meta-sep">·</span>
                      <Pill variant="warn">aging {m.age}d</Pill>
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
