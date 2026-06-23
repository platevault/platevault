import { useState, type ReactNode } from 'react';
import { Btn, InfoTip } from '@/ui';
import { settingsRestoreDefaults, getSettings } from '@/api/commands';
import { m } from '@/lib/i18n';

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

// ── Restore-defaults action (spec 018 T028) ───────────────────────────────────

export interface RestoreDefaultsBtnProps {
  /**
   * Keys belonging to this pane (settings-scope mode). Pass an empty array to
   * restore all keys. The set mirrors the backend `scope_keys` in settings.rs.
   * Ignored when `onRestore` is supplied.
   */
  keys?: string[];
  /** Called after defaults are restored so the pane can re-hydrate. */
  onRestored?: (values: Record<string, unknown>) => void;
  /** Settings scope used to refetch after restore (e.g. 'advanced'). */
  scope?: string;
  /**
   * Custom restore action for panes whose values are NOT in the settings table
   * (e.g. Calibration, which owns its own `calibrationTolerances` IPC). When
   * provided, the button runs this instead of `settings.restore-defaults`, and
   * `keys`/`scope`/`onRestored` are unused.
   */
  onRestore?: () => Promise<void>;
}

type RestoreState = 'idle' | 'restoring' | 'done';

/**
 * Small "Restore defaults" button for a settings section header.
 *
 * Default mode calls `settings.restore-defaults` with this pane's key list,
 * then re-fetches the scope so controls reflect the restored values. Panes
 * backed by a different store pass `onRestore` to run their own reset instead.
 */
export function RestoreDefaultsBtn({ keys, onRestored, scope, onRestore }: RestoreDefaultsBtnProps) {
  const [state, setState] = useState<RestoreState>('idle');

  const handleClick = async () => {
    if (state === 'restoring') return;
    setState('restoring');
    try {
      if (onRestore) {
        await onRestore();
      } else {
        await settingsRestoreDefaults(keys ?? []);
        // Re-fetch so the pane receives the actual persisted defaults.
        const fresh = await getSettings({ scope: scope ?? '' });
        onRestored?.(fresh.values as Record<string, unknown>);
      }
      setState('done');
      setTimeout(() => setState('idle'), 1500);
    } catch {
      setState('idle');
    }
  };

  const label =
    state === 'restoring'
      ? m.settings_action_restore_defaults_restoring()
      : state === 'done'
        ? m.settings_action_restore_defaults_done()
        : m.settings_action_restore_defaults();

  return (
    <Btn size="sm" variant="ghost" disabled={state === 'restoring'} onClick={() => void handleClick()}>
      {label}
    </Btn>
  );
}
