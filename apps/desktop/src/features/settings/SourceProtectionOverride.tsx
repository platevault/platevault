// spec 016 US2 — per-source protection override control (T015).
//
// Renders a protection badge + override control for a specific source UUID.
// When `sourceId` is provided, loads the current effective protection and
// allows the user to change the level. When no per-source override exists the
// component shows "Inherits global default" as an inheritance badge.
//
// This component is used wherever a source UUID is available (e.g. the
// project detail source rows). DataSources.tsx uses fixture IDs (not UUIDs)
// so it cannot be wired yet — see TODO comment there.

import { useEffect, useState, useCallback } from 'react';
import { Pill, Btn } from '@/ui';
import { sourceProtectionGet, sourceProtectionSet } from '@/api/commands';
import type { ProtectionLevel } from '@/api/commands';

interface SourceProtectionOverrideProps {
  /** Real source UUID from the backend. */
  sourceId: string;
  /** Optional callback after a successful override save. */
  onSaved?: (newLevel: ProtectionLevel) => void;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'saving' | 'error';

const LEVEL_LABEL: Record<ProtectionLevel, string> = {
  protected: 'Protected',
  normal: 'Normal',
  unprotected: 'Unprotected',
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
      <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
        Loading…
      </span>
    );
  }

  if (loadState === 'error' && !editing) {
    return (
      <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
        {errorMsg || 'Could not load protection'}
      </span>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-1)' }}>
      {!editing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-2)', flexWrap: 'wrap' }}>
          <Pill variant={LEVEL_VARIANT[level]}>{LEVEL_LABEL[level]}</Pill>
          {inheritsDefault && (
            <Pill variant="neutral">Inherits global default</Pill>
          )}
          <Btn size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Override
          </Btn>
          <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', flexBasis: '100%' }}>
            {levelHint(level, inheritsDefault)}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-2)', flexWrap: 'wrap' }}>
            <label
              htmlFor={`protection-level-${sourceId}`}
              style={{ fontSize: 'var(--alm-text-sm)' }}
            >
              Protection level
            </label>
            <select
              id={`protection-level-${sourceId}`}
              className="alm-select"
              value={pendingLevel}
              onChange={(e) => setPendingLevel(e.target.value as ProtectionLevel)}
              style={{ height: 28 }}
              aria-label="Protection level override"
            >
              <option value="protected">Protected</option>
              <option value="normal">Normal</option>
              <option value="unprotected">Unprotected</option>
            </select>
            <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', flexBasis: '100%' }}>
              {levelHint(pendingLevel, false)}
            </div>
          </div>
          {errorMsg && (
            <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-danger)' }}>
              {errorMsg}
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--alm-sp-1)' }}>
            <Btn
              size="sm"
              onClick={handleSave}
              disabled={loadState === 'saving'}
            >
              {loadState === 'saving' ? 'Saving…' : 'Save override'}
            </Btn>
            <Btn size="sm" variant="ghost" onClick={handleCancel}>
              Cancel
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}
