// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Default planner catalogues control (task #82).
//
// Lets the user pick which catalogues are enabled by default in the Targets →
// Planner multi-select. Persisted via the generic settings backend under the
// `'catalogues'` scope (see features/targets/catalogue-settings.ts). The Planner
// initializes its catalogue filter from this setting on load.

import { useCallback, useEffect, useState } from 'react';
import { Toggle } from '@/ui';
import {
  PLANNER_CATALOGS,
  type CatalogueId,
} from '@/features/targets/planner-catalog';
import {
  DEFAULT_ENABLED_CATALOGUES,
  loadDefaultCatalogues,
  saveDefaultCatalogues,
} from '@/features/targets/catalogue-settings';
import { m } from '@/lib/i18n';
import { SettingsRow } from './SettingsKit';

export function CatalogueSettingsControl() {
  const [enabled, setEnabled] = useState<Set<CatalogueId>>(
    () => new Set(DEFAULT_ENABLED_CATALOGUES),
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDefaultCatalogues()
      .then((ids) => {
        if (!cancelled) setEnabled(new Set(ids));
      })
      .catch(() => {
        // Backend unavailable — keep in-code defaults.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: Set<CatalogueId>) => {
    setEnabled(next);
    setSaveError(null);
    try {
      await saveDefaultCatalogues(
        PLANNER_CATALOGS.map((c) => c.id).filter((id) => next.has(id)),
      );
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const toggle = (id: CatalogueId, on: boolean): void => {
    const next = new Set(enabled);
    if (on) next.add(id);
    else next.delete(id);
    void persist(next);
  };

  return (
    <>
      {PLANNER_CATALOGS.map((c) => (
        <SettingsRow
          key={c.id}
          label={c.label()}
          info={m.settings_catalogue_default_info({ label: c.label() })}
        >
          <Toggle
            checked={enabled.has(c.id)}
            aria-label={m.settings_catalogue_enable_default_aria({
              label: c.label(),
            })}
            onChange={(v) => toggle(c.id, v)}
          />
        </SettingsRow>
      ))}

      {saveError && (
        <div className="alm-settings__error" role="alert">
          {m.settings_catalogue_save_error({ error: saveError })}
        </div>
      )}
    </>
  );
}
