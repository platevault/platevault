import { ToggleGroup } from '@base-ui-components/react/toggle-group';
import { Toggle } from '@base-ui-components/react/toggle';
import { Button } from '@base-ui-components/react/button';
import { clsx } from 'clsx';

export interface FilterBarProps {
  filters: { key: string; label: string }[];
  active: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
}

export function FilterBar({ filters, active, onToggle, onClear }: FilterBarProps) {
  const handleValueChange = (newValue: any[]) => {
    // Derive which key was toggled by comparing active vs newValue
    const added = newValue.find((k: string) => !active.includes(k));
    const removed = active.find((k) => !newValue.includes(k));
    const toggledKey = added ?? removed;
    if (toggledKey) onToggle(toggledKey);
  };

  return (
    <ToggleGroup
      className="alm-toolbar"
      value={active}
      onValueChange={handleValueChange}
      multiple
    >
      {filters.map((f) => (
        <Toggle
          key={f.key}
          value={f.key}
          className={clsx('alm-filter-chip', active.includes(f.key) && 'alm-filter-chip--active')}
          aria-label={f.label}
        >
          {f.label}
          {active.includes(f.key) && (
            <span className="alm-filter-chip__remove" aria-label={`Remove ${f.label}`}>
              &times;
            </span>
          )}
        </Toggle>
      ))}
      {active.length > 0 && (
        <Button className="alm-btn alm-btn--ghost alm-btn--sm" onClick={onClear}>
          Clear
        </Button>
      )}
    </ToggleGroup>
  );
}
