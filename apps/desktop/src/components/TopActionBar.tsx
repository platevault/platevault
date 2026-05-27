/**
 * TopActionBar — consistent action bar for data screens (Sessions, Calibration,
 * Targets, Archive). Displays action buttons with optional hotkey hints.
 *
 * Layout: title/subtitle left-aligned, action buttons right-aligned.
 * Uses the existing Btn component from ui/.
 */

import { Btn } from '@/ui';

export interface ActionDef {
  label: string;
  hotkey?: string;
  variant?: 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  onClick: () => void;
}

export interface TopActionBarProps {
  actions: ActionDef[];
  title?: string;
  subtitle?: string;
}

export function TopActionBar({ actions, title, subtitle }: TopActionBarProps) {
  return (
    <div className="alm-top-action-bar">
      {/* Left: title area */}
      {(title || subtitle) && (
        <div className="alm-top-action-bar__heading">
          {title && <h2 className="alm-top-action-bar__title">{title}</h2>}
          {subtitle && <span className="alm-top-action-bar__subtitle">{subtitle}</span>}
        </div>
      )}

      {/* Right: action buttons */}
      <div className="alm-top-action-bar__actions">
        {actions.map((action) => (
          <Btn
            key={action.label}
            variant={action.variant}
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {action.label}
            {action.hotkey && (
              <kbd className="alm-top-action-bar__hotkey">{action.hotkey}</kbd>
            )}
          </Btn>
        ))}
      </div>
    </div>
  );
}
