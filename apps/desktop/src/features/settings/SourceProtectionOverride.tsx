// spec 016 US2 — per-source protection override control (T015).
//
// Renders a protection badge + override control for a specific source UUID.
// When `sourceId` is provided, loads the current effective protection and
// allows the user to change the level. When no per-source override exists the
// component shows "Inherits global default" as an inheritance badge.
//
// Used wherever a source UUID is available — wired into the DataSources
// settings pane (one control per registered root, keyed by root.id) and
// available for project detail source rows.

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
}

type LoadState = 'idle' | 'loading' | 'ready' | 'saving' | 'error';

const LEVEL_LABEL: Record<ProtectionLevel, () => string> = {
  protected: m.settings_cleanup_protection_protected,
  normal: m.settings_cleanup_protection_normal,
  unprotected: m.settings_cleanup_protection_unprotected,
};

const LEVEL_VARIANT: Record<ProtectionLevel, 'ok' | 'info' | 'warn' | 'danger' | 'neutral'> = {
  protected: 'ok',
  normal: 'info',
  unprotected: 'warn',
};

/** Convert a ProtectionLevel to its hint string (spec 016 T034). */
function levelHint(level: ProtectionLevel, inherits: boolean): string {
  const prefix = inherits ? 'Inherits global default — ' : '';
  switch (level) {
    case 'protected':
      return `${prefix}Cleanup plans require explicit approval for this source's files.`;
    case 'normal':
      return `${prefix}Standard plan review applies; no extra acknowledgement required.`;
    case 'unprotected':
      return `${prefix}Destructive plan actions proceed without additional confirmation.`;
  }
}

export function SourceProtectionOverride({ sourceId, onSaved }: SourceProtectionOverrideProps) {
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [level, setLevel] = useState<ProtectionLevel>('protected');
  const [inheritsDefault, setInheritsDefault] = useState(true);
  const [editing, setEditing] = useState(false);
  const [pendingLevel, setPendingLevel] = useState<ProtectionLevel>('protected');
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

  const handleSave = () => {
    setLoadState('saving');
    sourceProtectionSet({
      sourceId,
      level: pendingLevel,
    })
      .then(() => {
        setLevel(pendingLevel);
        setInheritsDefault(false);
        setEditing(false);
        setLoadState('ready');
        onSaved?.(pendingLevel);
      })
      .catch((err: unknown) => {
        setErrorMsg(typeof err === 'string' ? err : 'Save failed');
        setLoadState('error');
      });
  };

  const handleCancel = () => {
    setPendingLevel(level);
    setEditing(false);
    setErrorMsg('');
  };

  if (loadState === 'loading' || loadState === 'idle') {
    return (
      <span className="alm-source-protect__status">
        {m.common_loading()}
      </span>
    );
  }

  if (loadState === 'error' && !editing) {
    return (
      <span className="alm-source-protect__status">
        {errorMsg || m.settings_protection_load_error()}
      </span>
    );
  }

  return (
    <div className="alm-source-protect__root">
      {!editing ? (
        <div className="alm-source-protect__view-row">
          <Pill variant={LEVEL_VARIANT[level]}>{LEVEL_LABEL[level]()}</Pill>
          {inheritsDefault && (
            <Pill variant="neutral">{m.settings_source_protect_inherits()}</Pill>
          )}
          <Btn size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {m.common_override()}
          </Btn>
          <div className="alm-source-protect__hint">
            {levelHint(level, inheritsDefault)}
          </div>
        </div>
      ) : (
        <div className="alm-source-protect__edit-col">
          <div className="alm-source-protect__edit-row">
            { }
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
              onChange={(e) => setPendingLevel(e.target.value as ProtectionLevel)}
              aria-label={m.settings_source_protect_level_aria()}
            >
              <option value="protected">{m.settings_cleanup_protection_protected()}</option>
              <option value="normal">{m.settings_cleanup_protection_normal()}</option>
              <option value="unprotected">{m.settings_cleanup_protection_unprotected()}</option>
            </select>
            <div className="alm-source-protect__hint">
              {levelHint(pendingLevel, false)}
            </div>
          </div>
          {errorMsg && (
            <div className="alm-source-protect__error">
              {errorMsg}
            </div>
          )}
          <div className="alm-source-protect__actions">
            <Btn
              size="sm"
              onClick={handleSave}
              disabled={loadState === 'saving'}
            >
              {loadState === 'saving' ? m.common_saving() : m.settings_source_protect_save_btn()}
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
