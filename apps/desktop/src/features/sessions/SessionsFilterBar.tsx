import { useState } from 'react';
import { X } from 'lucide-react';

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
      <span className="alm-sessions-filter__label">Filter:</span>
      {filters.map((f) => (
        <span key={f.key} className="alm-sessions-filter__chip">
          {f.key}: <span className="alm-sessions-filter__chip-value">{f.value}</span>
          <button
            type="button"
            className="alm-sessions-filter__chip-remove"
            onClick={() => removeFilter(f.key)}
            aria-label={`Remove ${f.key} filter`}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ))}
      <button type="button" className="alm-sessions-filter__add">
        + add
      </button>
    </div>
  );
}
