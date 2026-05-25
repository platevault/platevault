import { clsx } from 'clsx';
import { usePreference } from '@/data/preferences';
import type { AppPreferences } from '@/api/types';

type GroupByMode = AppPreferences['sessionsGroupBy'];

const MODES: Array<{ value: GroupByMode; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'target', label: 'Target' },
  { value: 'month', label: 'Month' },
  { value: 'filter', label: 'Filter' },
  { value: 'train', label: 'Optical Train' },
];

export function GroupByBar() {
  const [groupBy, setGroupBy] = usePreference('sessionsGroupBy');

  return (
    <div className="alm-sessions-group">
      <span className="alm-groupby__label">Group:</span>
      {MODES.map((mode) => (
        <button
          key={mode.value}
          type="button"
          className={clsx(
            'alm-filter-chip',
            groupBy === mode.value && 'alm-filter-chip--active',
          )}
          onClick={() => setGroupBy(mode.value)}
          aria-pressed={groupBy === mode.value}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
