// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// spec 016 US2 — per-source protection override control (T015).
//
// Renders a compact protection pill for a specific source UUID plus, when
// `open` is true, the level-select editor. The caller (a kebab "Edit
// protection…" item) fully controls when the editor is shown — this
// component owns no trigger button of its own (issue #562: the standalone
// "Override" button + duplicate "Inherits global default" pill + repeated
// hint sentence were decluttered into a single pill; hovering it still
// surfaces the hint via `title`).
//
// Used wherever a source UUID is available — currently only the DataSources
// settings pane (one control per registered root, keyed by root.id).

import { useEffect, useState, useCallback } from 'react';
import { Pill, Btn } from '@/ui';
import { sourceProtectionGet, sourceProtectionSet } from './settingsIpc';
import type { ProtectionLevel } from './settingsIpc';
import { m } from '@/lib/i18n';

interface SourceProtectionOverrideProps {
  /** Real source UUID from the backend. */
  sourceId: string;
  /** Optional callback after a successful override save. */
  onSaved?: (newLevel: ProtectionLevel) => void;
  /** Whether the level-select editor is shown (controlled by the caller). */
  open: boolean;
  /** Invoked with `false` after Save/Cancel to close the editor. */
  onOpenChange: (open: boolean) => void;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'saving' | 'error';

// 2-level model (issue #506): the third "normal" level is retired — absence
// of a per-source override already means inherit-global, so a distinct
// explicit "normal" state added confusion without capability.
const LEVEL_LABEL: Record<ProtectionLevel, () => string> = {
  protected: m.settings_cleanup_protection_protected,
  unprotected: m.settings_cleanup_protection_unprotected,
};

const LEVEL_VARIANT: Record<
  ProtectionLevel,
  'ok' | 'info' | 'warn' | 'danger' | 'neutral'
> = {
  protected: 'ok',
  unprotected: 'warn',
};

/** Convert a ProtectionLevel to its hint string (spec 016 T034). */
function levelHint(level: ProtectionLevel, inherits: boolean): string {
  const prefix = inherits ? m.settings_source_protect_inherits_prefix() : '';
  switch (level) {
    case 'protected':
      return m.settings_source_protect_hint_protected({ prefix });
    case 'unprotected':
      return m.settings_source_protect_hint_unprotected({ prefix });
  }
}

export function SourceProtectionOverride({
  sourceId,
  onSaved,
  open,
  onOpenChange,
}: SourceProtectionOverrideProps) {
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [level, setLevel] = useState<ProtectionLevel>('protected');
  const [inheritsDefault, setInheritsDefault] = useState(true);
  const [pendingLevel, setPendingLevel] =
    useState<ProtectionLevel>('protected');
  const [errorMsg, setErrorMsg] = useState('');

  const load = useCallback(() => {
    setLoadState('loading');
    sourceProtectionGet(sourceId)
      .then((resp) => {
        setLevel(resp.level);
        setInheritsDefault(resp.inheritsDefault);
        setPendingLevel(resp.level);
        setLoadState('ready');
      })
      .catch(() => {
        setLoadState('error');
      });
  }, [sourceId]);

  useEffect(() => {
    load();
  }, [load]);

  // Re-sync the pending selection to the current level each time the editor
  // opens, so a prior cancel never leaks a stale selection into the next
  // edit session.
  useEffect(() => {
    if (open) setPendingLevel(level);
  }, [open, level]);

  const handleSave = () => {
    setLoadState('saving');
    sourceProtectionSet({
      sourceId,
      level: pendingLevel,
    })
      .then(() => {
        setLevel(pendingLevel);
        setInheritsDefault(false);
        setLoadState('ready');
        onSaved?.(pendingLevel);
        onOpenChange(false);
      })
      .catch((err: unknown) => {
        setErrorMsg(typeof err === 'string' ? err : m.common_save_failed());
        setLoadState('error');
      });
  };

  const handleCancel = () => {
    setPendingLevel(level);
    setErrorMsg('');
    onOpenChange(false);
  };

  if (loadState === 'loading' || loadState === 'idle') {
    return (
      <span className="alm-source-protect__status">{m.common_loading()}</span>
    );
  }

  if (loadState === 'error' && !open) {
    return (
      <span className="alm-source-protect__status">
        {errorMsg || m.settings_protection_load_error()}
      </span>
    );
  }

  return (
    <div className="alm-source-protect__root">
      <Pill
        variant={LEVEL_VARIANT[level]}
        title={levelHint(level, inheritsDefault)}
      >
        {LEVEL_LABEL[level]()}
      </Pill>

      {open && (
        <div className="alm-source-protect__edit-col">
          <div className="alm-source-protect__edit-row">
            {}
            <label
              htmlFor={`protection-level-${sourceId}`}
              className="alm-source-protect__label"
            >
              {m.settings_source_protect_level_label()}
            </label>
            <select
              id={`protection-level-${sourceId}`}
              className="alm-select alm-source-protect__select"
              value={pendingLevel}
              onChange={(e) =>
                setPendingLevel(e.target.value as ProtectionLevel)
              }
              aria-label={m.settings_source_protect_level_aria()}
            >
              <option value="protected">
                {m.settings_cleanup_protection_protected()}
              </option>
              <option value="unprotected">
                {m.settings_cleanup_protection_unprotected()}
              </option>
            </select>
            <div className="alm-source-protect__hint">
              {levelHint(pendingLevel, false)}
            </div>
          </div>
          {errorMsg && (
            <div className="alm-source-protect__error">{errorMsg}</div>
          )}
          <div className="alm-source-protect__actions">
            <Btn
              size="sm"
              onClick={handleSave}
              disabled={loadState === 'saving'}
            >
              {loadState === 'saving'
                ? m.common_saving()
                : m.settings_source_protect_save_btn()}
            </Btn>
            <Btn size="sm" variant="ghost" onClick={handleCancel}>
              {m.common_cancel()}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}
