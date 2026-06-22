import type { ReactNode } from 'react';
import { InfoTip } from '@/ui';

/**
 * Settings layout kit — the consistent section + form-row primitives every
 * settings pane composes (authoritative: platevault-settings-menu.html).
 *
 * - `SettingsSection`: uppercase title + optional right-aligned action, then a
 *   hairline rule, then the rows/table (mock `.sec` / `.sec__t` / `.sec__r`).
 * - `SettingsRow`: 200px label column (with an optional ⓘ InfoTip carrying the
 *   help text) + control column. Help prose lives in the tooltip, never as
 *   always-on text under the control (mock de-vibe step).
 */

export interface SettingsSectionProps {
  title: string;
  /** Optional right-aligned action (e.g. a primary "+ Add…" button). */
  action?: ReactNode;
  children: ReactNode;
}

export function SettingsSection({ title, action, children }: SettingsSectionProps) {
  return (
    <div className="alm-settings__group">
      {action ? (
        <div className="alm-settings__group-header alm-settings__group-header--ruled">
          <div className="alm-settings__group-title">{title}</div>
          {action}
        </div>
      ) : (
        <div className="alm-settings__group-title">{title}</div>
      )}
      {children}
    </div>
  );
}

export interface SettingsRowProps {
  label: ReactNode;
  /** Help text shown in an ⓘ tooltip beside the label (replaces help prose). */
  info?: string;
  children: ReactNode;
}

export function SettingsRow({ label, info, children }: SettingsRowProps) {
  return (
    <div className="alm-settings__row">
      <div className="alm-settings__row-label">
        <span>{label}</span>
        {info ? <InfoTip tip={info} /> : null}
      </div>
      <div className="alm-settings__row-content">{children}</div>
    </div>
  );
}
