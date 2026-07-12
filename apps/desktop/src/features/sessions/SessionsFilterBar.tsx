import { useState } from 'react';
import { X } from 'lucide-react';
import { m } from '@/lib/i18n';

interface ActiveFilter {
  key: string;
  value: string;
}

/**
 * Sessions filter bar matching the wireframe: "Filter:" label + active filter
 * chips (with x to remove) + dashed "+ add" chip.
 */
export function SessionsFilterBar() {
  const [filters, setFilters] = useState<ActiveFilter[]>([
    { key: 'kind', value: 'acquisition' },
  ]);

  const removeFilter = (key: string) => {
    setFilters((prev) => prev.filter((f) => f.key !== key));
  };

  return (
    <div className="alm-sessions-filter">
      <span className="alm-sessions-filter__label">
        {m.sessions_filterbar_label()}
      </span>
      {filters.map((f) => (
        <span key={f.key} className="alm-sessions-filter__chip">
          {f.key}:{' '}
          <span className="alm-sessions-filter__chip-value">{f.value}</span>
          <button
            type="button"
            className="alm-sessions-filter__chip-remove"
            onClick={() => removeFilter(f.key)}
            aria-label={m.sessions_remove_filter_aria({ key: f.key })}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ))}
      <button type="button" className="alm-sessions-filter__add">
        {m.sessions_filterbar_add()}
      </button>
    </div>
  );
}
