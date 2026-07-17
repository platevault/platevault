// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Reusable SIMBAD resolver settings control (spec 035, T031).
//
// Loads `ResolverSettings` via `target.resolution.settings`, and persists every
// change via `target.resolution.settings.update`. Shared by the Settings →
// Target Resolution pane and the repurposed first-run "Target resolution" step.
//
//   - online toggle (default ON; FR-015)
//   - SIMBAD endpoint
//   - debounce (ms)
//   - request timeout (seconds)
//
// In `compact` mode only the online toggle is shown (used by the wizard step),
// with the endpoint / debounce / timeout fields deferred to full Settings.

import { useCallback, useEffect, useId, useState } from 'react';
import { Btn, Skeleton, Toggle } from '@/ui';
import {
  clearResolveCache,
  getResolverSettings,
  updateResolverSettings,
  type ResolverSettings,
} from './settingsIpc';
import { m } from '@/lib/i18n';
import { SettingsRow } from './SettingsKit';

const DEFAULT_SETTINGS: ResolverSettings = {
  onlineEnabled: true,
  simbadEndpoint: 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync',
  debounceMs: 300,
  requestTimeoutSecs: 10,
};

export interface ResolverSettingsControlProps {
  /** When true, render only the online toggle (used by the first-run step). */
  compact?: boolean;
}

export function ResolverSettingsControl({
  compact = false,
}: ResolverSettingsControlProps) {
  const endpointId = useId();
  const debounceId = useId();
  const timeoutId = useId();

  const [settings, setSettings] = useState<ResolverSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheClearMessage, setCacheClearMessage] = useState<string | null>(
    null,
  );
  const [cacheClearError, setCacheClearError] = useState<string | null>(null);

  // Load persisted settings on mount.
  useEffect(() => {
    let cancelled = false;
    getResolverSettings()
      .then((resp) => {
        if (!cancelled) setSettings(resp.settings);
      })
      .catch(() => {
        // Backend unavailable — keep in-code defaults.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist a patch and optimistically update local state.
  const persist = useCallback(
    async (patch: Partial<ResolverSettings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      setSaveError(null);
      try {
        const resp = await updateResolverSettings(next);
        setSettings(resp.settings);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
      }
    },
    [settings],
  );

  // spec 052 P1 (FR-002): manual "clear resolve cache" action — wipes the
  // shared redb typeahead/search cache and re-warms it; never touches saved
  // targets (canonical_target). The re-warm itself runs in the background
  // (issue #695 — it used to freeze this button for minutes), so the success
  // copy can no longer report a synchronous count.
  const handleClearCache = useCallback(async () => {
    setClearingCache(true);
    setCacheClearMessage(null);
    setCacheClearError(null);
    try {
      await clearResolveCache();
      setCacheClearMessage(m.settings_resolver_cache_clear_success());
    } catch (e) {
      setCacheClearError(
        m.settings_resolver_cache_clear_error({
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setClearingCache(false);
    }
  }, []);

  return (
    <>
      {compact ? (
        // First-run Configuration step: label + toggle on one line, description
        // below the control (not beside it).
        <div className="alm-resolver-settings__compact-wrap">
          <div className="alm-resolver-settings__compact-row">
            <span className="alm-resolver-settings__compact-label">
              {m.settings_resolver_online_label()}
            </span>
            {loaded ? (
              <Toggle
                checked={settings.onlineEnabled}
                aria-label={m.settings_resolver_online_aria()}
                onChange={(v) => void persist({ onlineEnabled: v })}
              />
            ) : (
              <Skeleton
                variant="block"
                width={36}
                height={20}
                radius="10px"
                label={m.common_loading()}
              />
            )}
          </div>
          <div className="alm-settings__row-desc">
            {loaded &&
              (settings.onlineEnabled
                ? m.settings_resolver_online_desc()
                : m.settings_resolver_offline_desc())}
          </div>
        </div>
      ) : (
        <SettingsRow
          label={m.settings_resolver_online_label()}
          info={
            loaded
              ? settings.onlineEnabled
                ? m.settings_resolver_online_on_info()
                : m.settings_resolver_online_off_info()
              : undefined
          }
        >
          {loaded ? (
            <Toggle
              checked={settings.onlineEnabled}
              aria-label={m.settings_resolver_online_aria()}
              onChange={(v) => void persist({ onlineEnabled: v })}
            />
          ) : (
            <Skeleton
              variant="block"
              width={36}
              height={20}
              radius="10px"
              label={m.common_loading()}
            />
          )}
        </SettingsRow>
      )}

      {!compact && (
        <>
          <SettingsRow
            label={
              <label htmlFor={endpointId}>
                {m.settings_resolver_endpoint_label()}
              </label>
            }
            info={m.settings_resolver_tapurl_info()}
          >
            {/* eslint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by the SettingsRow label via htmlFor={endpointId} (cross-column association the rule can't trace) */}
            <input
              id={endpointId}
              className="alm-input"
              type="text"
              value={settings.simbadEndpoint}
              disabled={!loaded || !settings.onlineEnabled}
              onChange={(e) =>
                setSettings((s) => ({ ...s, simbadEndpoint: e.target.value }))
              }
              onBlur={(e) =>
                void persist({ simbadEndpoint: e.target.value.trim() })
              }
            />
          </SettingsRow>

          <SettingsRow
            label={
              <label htmlFor={debounceId}>
                {m.settings_resolver_debounce_label()}
              </label>
            }
            info={m.settings_resolver_debounce_info()}
          >
            {/* eslint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by the SettingsRow label via htmlFor={debounceId} (cross-column association the rule can't trace) */}
            <input
              id={debounceId}
              className="alm-input alm-resolver-settings__narrow-input"
              type="number"
              min={0}
              step={50}
              value={settings.debounceMs}
              disabled={!loaded}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  debounceMs: Number(e.target.value),
                }))
              }
              onBlur={(e) =>
                void persist({ debounceMs: Number(e.target.value) })
              }
            />
          </SettingsRow>

          <SettingsRow
            label={
              <label htmlFor={timeoutId}>
                {m.settings_resolver_timeout_label()}
              </label>
            }
            info={m.settings_resolver_timeout_info()}
          >
            {/* eslint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by the SettingsRow label via htmlFor={timeoutId} (cross-column association the rule can't trace) */}
            <input
              id={timeoutId}
              className="alm-input alm-resolver-settings__narrow-input"
              type="number"
              min={1}
              step={1}
              value={settings.requestTimeoutSecs}
              disabled={!loaded || !settings.onlineEnabled}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  requestTimeoutSecs: Number(e.target.value),
                }))
              }
              onBlur={(e) =>
                void persist({ requestTimeoutSecs: Number(e.target.value) })
              }
            />
          </SettingsRow>

          <SettingsRow
            label={m.settings_resolver_cache_clear_label()}
            info={m.settings_resolver_cache_clear_info()}
          >
            <Btn
              type="button"
              variant="ghost"
              disabled={clearingCache}
              onClick={() => void handleClearCache()}
            >
              {clearingCache
                ? m.settings_resolver_cache_clear_pending()
                : m.settings_resolver_cache_clear_label()}
            </Btn>
          </SettingsRow>
          {cacheClearMessage && (
            <div className="alm-settings__row-desc" role="status">
              {cacheClearMessage}
            </div>
          )}
          {cacheClearError && (
            <div className="alm-settings__error" role="alert">
              {cacheClearError}
            </div>
          )}
        </>
      )}

      {saveError && (
        <div className="alm-settings__error" role="alert">
          {m.settings_resolver_save_error({ error: saveError })}
        </div>
      )}
    </>
  );
}
