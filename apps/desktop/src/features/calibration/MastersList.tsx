import { clsx } from 'clsx';
import type { CalibrationMasterFixture } from '@/data/fixtures/calibration';

export interface MastersListProps {
  masters: CalibrationMasterFixture[];
  selectedId?: string;
  onSelect: (id: string) => void;
  groupValue: string;
  onGroupChange: (value: string) => void;
}

const KIND_ORDER = ['dark', 'flat', 'bias'] as const;
const KIND_LABELS: Record<string, string> = {
  dark: 'Darks',
  flat: 'Flats',
  bias: 'Bias',
};

/**
 * Left pane: grouped master list with kind headers, mono names,
 * exposure/gain/camera metadata, and aging warnings.
 * Matches wireframe: calibration.jsx listPane.
 */
export function MastersList({
  masters,
  selectedId,
  onSelect,
  groupValue,
  onGroupChange,
}: MastersListProps) {
  // Group masters by kind
  const grouped = new Map<string, CalibrationMasterFixture[]>();
  for (const m of masters) {
    const list = grouped.get(m.kind) ?? [];
    list.push(m);
    grouped.set(m.kind, list);
  }

  const totalDarks = grouped.get('dark')?.length ?? 0;
  const totalFlats = grouped.get('flat')?.length ?? 0;
  const totalBias = grouped.get('bias')?.length ?? 0;

  return (
    <nav className="alm-masters-list" aria-label="Calibration masters">
      {/* Header */}
      <div className="alm-masters-list__header">
        <div className="alm-masters-list__title">Calibration masters</div>
        <div className="alm-masters-list__counts">
          {masters.length} masters · {totalDarks} darks · {totalFlats} flats · {totalBias} bias
        </div>
      </div>

      {/* Group dropdown */}
      <div className="alm-masters-list__group-bar">
        <select
          className="alm-masters-list__group-select"
          value={groupValue}
          onChange={(e) => onGroupChange(e.target.value)}
        >
          <option value="kind">Group: kind</option>
          <option value="camera">Group: camera</option>
          <option value="age">Group: age</option>
          <option value="none">Group: none</option>
        </select>
      </div>

      {/* Grouped items */}
      {KIND_ORDER.filter((kind) => grouped.has(kind)).map((kind) => (
        <div key={kind}>
          <div className="alm-masters-list__kind-header">
            {KIND_LABELS[kind]}
          </div>
          {grouped.get(kind)!.map((m) => {
            const isSelected = m.id === selectedId;
            return (
              <button
                key={m.id}
                type="button"
                className={clsx(
                  'alm-masters-list__item',
                  isSelected && 'alm-masters-list__item--selected',
                )}
                onClick={() => onSelect(m.id)}
                aria-current={isSelected ? 'true' : undefined}
              >
                <div
                  className={clsx(
                    'alm-masters-list__item-name alm-mono',
                    isSelected && 'alm-masters-list__item-name--active',
                  )}
                  title={m.name}
                >
                  {m.name}
                </div>
                <div className="alm-masters-list__item-meta">
                  <span className="alm-mono">
                    {m.exp} · g{m.gain}
                  </span>
                  <span>{m.cam.replace('ASI', '')}</span>
                  {m.warn && (
                    <span className="alm-masters-list__item-warn">
                      ⚠ {m.age}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
