/**
 * TargetDetailV2 — spec 036 gen-3 detail pane for a single canonical target.
 *
 * Fetches target detail via `target.get` and renders:
 *   - Header: effectiveLabel (displayAlias ?? primaryDesignation), objectType pill,
 *     coordinates, source, simbadOid.
 *   - Display-alias control: set / clear the user presentation label (FR-012).
 *   - Alias list: all aliases with kind badge; only kind='user' aliases have a
 *     remove button (SIMBAD designations/common names are read-only).
 *   - Add-alias form: adds a user alias.
 *
 * Sessions and Projects sections are empty-state stubs — cross-spec FK wiring
 * is deferred (see spec 036 open gaps).
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  getTargetDetail,
  addTargetAlias,
  removeTargetAlias,
  setDisplayAlias,
  clearDisplayAlias,
} from '@/api/commands';
import type { TargetDetailV3, TargetOpError } from '@/api/commands';
import { DetailPane, DetailHeader } from '@/components';
import { Pill, Section, EmptyState, Banner } from '@/ui';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  targetId: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: TargetDetailV3 };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Map an AliasKind string to a human label for the badge. */
function kindLabel(kind: string): string {
  switch (kind) {
    case 'designation':
      return 'desig';
    case 'common_name':
      return 'name';
    case 'user':
      return 'user';
    default:
      return kind;
  }
}

/** Format decimal degrees to a short sexagesimal string for display. */
function fmtDeg(deg: number, isRa: boolean): string {
  if (!Number.isFinite(deg)) return '—';
  if (isRa) {
    // RA in hours
    const h = deg / 15;
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    const ss = ((h - hh) * 60 - mm) * 60;
    return `${hh}h ${mm}m ${ss.toFixed(1)}s`;
  }
  const sign = deg < 0 ? '−' : '+';
  const abs = Math.abs(deg);
  const dd = Math.floor(abs);
  const mm = Math.floor((abs - dd) * 60);
  const ss = ((abs - dd) * 60 - mm) * 60;
  return `${sign}${dd}° ${mm}′ ${ss.toFixed(0)}″`;
}

/** Map TargetOpError.code to a user-readable message. */
function errorMessage(err: TargetOpError, fallback: string): string {
  switch (err.code) {
    case 'alias.blank':
      return 'Alias must not be blank.';
    case 'alias.not_found':
      return 'Alias not found on this target.';
    case 'alias.not_removable':
      return 'Only user-added aliases can be removed.';
    case 'target.not_found':
      return 'Target not found.';
    case 'target.invalid_id':
      return 'Invalid target ID.';
    default:
      return fallback;
  }
}

// ── TargetDetailV2 ────────────────────────────────────────────────────────────

export function TargetDetailV2({ targetId }: Props) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [aliasInput, setAliasInput] = useState('');
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [displayAliasInput, setDisplayAliasInput] = useState('');
  const [displayAliasEditing, setDisplayAliasEditing] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(() => {
    setLoadState({ status: 'loading' });
    getTargetDetail({ targetId })
      .then((data) => {
        setLoadState({ status: 'loaded', data });
        setDisplayAliasInput(data.displayAlias ?? '');
      })
      .catch(() => {
        setLoadState({ status: 'error', message: 'Failed to load target.' });
      });
  }, [targetId]);

  useEffect(() => {
    load();
  }, [load]);

  // Add user alias.
  const handleAliasAdd = useCallback(async () => {
    const alias = aliasInput.trim();
    if (!alias) {
      setAliasError('Alias must not be blank.');
      return;
    }
    setAliasError(null);
    try {
      await addTargetAlias({ targetId, alias });
      setAliasInput('');
      load();
    } catch (err) {
      const e = err as TargetOpError;
      setAliasError(errorMessage(e, 'Failed to add alias.'));
    }
  }, [targetId, aliasInput, load]);

  // Remove user alias by id.
  const handleAliasRemove = useCallback(
    async (aliasId: string) => {
      setActionError(null);
      try {
        await removeTargetAlias({ targetId, aliasId });
        load();
      } catch (err) {
        const e = err as TargetOpError;
        setActionError(errorMessage(e, 'Failed to remove alias.'));
      }
    },
    [targetId, load],
  );

  // Set display alias.
  const handleDisplayAliasSet = useCallback(async () => {
    setActionError(null);
    try {
      const data = await setDisplayAlias({ targetId, displayAlias: displayAliasInput.trim() });
      setLoadState({ status: 'loaded', data });
      setDisplayAliasInput(data.displayAlias ?? '');
      setDisplayAliasEditing(false);
    } catch (err) {
      const e = err as TargetOpError;
      setActionError(errorMessage(e, 'Failed to set display alias.'));
    }
  }, [targetId, displayAliasInput]);

  // Clear display alias.
  const handleDisplayAliasClear = useCallback(async () => {
    setActionError(null);
    try {
      const data = await clearDisplayAlias({ targetId });
      setLoadState({ status: 'loaded', data });
      setDisplayAliasInput('');
      setDisplayAliasEditing(false);
    } catch (err) {
      const e = err as TargetOpError;
      setActionError(errorMessage(e, 'Failed to clear display alias.'));
    }
  }, [targetId]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loadState.status === 'loading') {
    return (
      <DetailPane>
        <EmptyState title="Loading…" desc="" />
      </DetailPane>
    );
  }

  if (loadState.status === 'error') {
    return (
      <DetailPane>
        <EmptyState title="Error" desc={loadState.message} />
      </DetailPane>
    );
  }

  const detail = loadState.data;

  return (
    <DetailPane fill>
      <DetailHeader
        title={<strong>{detail.effectiveLabel}</strong>}
        titleExtra={
          <span style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-sm)' }}>
            <Pill variant="neutral">{detail.objectType.replace('_', ' ')}</Pill>
          </span>
        }
      />

      {/* Coordinates + metadata */}
      <Section title="Identity">
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'max-content 1fr',
            gap: 'var(--alm-sp-1) var(--alm-sp-3)',
            fontSize: 'var(--alm-text-sm)',
          }}
        >
          <dt style={{ color: 'var(--alm-text-muted)' }}>Designation</dt>
          <dd>{detail.primaryDesignation}</dd>
          <dt style={{ color: 'var(--alm-text-muted)' }}>RA</dt>
          <dd>{detail.raDeg != null ? fmtDeg(detail.raDeg, true) : '—'}</dd>
          <dt style={{ color: 'var(--alm-text-muted)' }}>Dec</dt>
          <dd>{detail.decDeg != null ? fmtDeg(detail.decDeg, false) : '—'}</dd>
          <dt style={{ color: 'var(--alm-text-muted)' }}>Source</dt>
          <dd>
            <Pill variant="ghost">{detail.source}</Pill>
          </dd>
          {detail.simbadOid != null && (
            <>
              <dt style={{ color: 'var(--alm-text-muted)' }}>SIMBAD OID</dt>
              <dd>{detail.simbadOid}</dd>
            </>
          )}
        </dl>
      </Section>

      {/* Display alias (FR-012: user presentation label) */}
      <Section title="Display label">
        {displayAliasEditing ? (
          <div style={{ display: 'flex', gap: 'var(--alm-sp-2)', flexWrap: 'wrap' }}>
            <input
              aria-label="Display label"
              placeholder={detail.primaryDesignation}
              value={displayAliasInput}
              onChange={(e) => setDisplayAliasInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleDisplayAliasSet();
                if (e.key === 'Escape') setDisplayAliasEditing(false);
              }}
              style={{ flex: 1, padding: 'var(--alm-sp-1)', fontSize: 'var(--alm-text-sm)' }}
              autoFocus
            />
            <button
              onClick={handleDisplayAliasSet}
              style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}
            >
              Save
            </button>
            {detail.displayAlias != null && (
              <button
                onClick={handleDisplayAliasClear}
                style={{
                  padding: 'var(--alm-sp-1) var(--alm-sp-2)',
                  color: 'var(--alm-text-muted)',
                }}
              >
                Clear
              </button>
            )}
            <button
              onClick={() => setDisplayAliasEditing(false)}
              style={{
                padding: 'var(--alm-sp-1) var(--alm-sp-2)',
                color: 'var(--alm-text-muted)',
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-2)' }}>
            <span style={{ fontSize: 'var(--alm-text-sm)' }}>
              {detail.displayAlias ?? (
                <em style={{ color: 'var(--alm-text-faint)' }}>
                  Not set — showing primary designation
                </em>
              )}
            </span>
            <button
              onClick={() => setDisplayAliasEditing(true)}
              style={{
                background: 'none',
                border: '1px solid var(--alm-border)',
                borderRadius: 'var(--alm-radius-sm)',
                cursor: 'pointer',
                padding: '2px var(--alm-sp-2)',
                fontSize: 'var(--alm-text-xs)',
              }}
            >
              {detail.displayAlias != null ? 'Edit' : 'Set'}
            </button>
          </div>
        )}
      </Section>

      {/* Aliases */}
      <Section title="Aliases" count={detail.aliases.length}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--alm-sp-1)' }}>
          {detail.aliases.map((a) => (
            <Pill key={a.id} variant={a.kind === 'user' ? 'accent' : 'ghost'}>
              <span title={`kind: ${a.kind}`}>
                <span
                  style={{
                    fontSize: 'var(--alm-text-xs)',
                    color: 'var(--alm-text-muted)',
                    marginRight: 'var(--alm-sp-1)',
                  }}
                >
                  [{kindLabel(a.kind)}]
                </span>
                {a.alias}
              </span>
              {a.kind === 'user' && (
                <button
                  aria-label={`Remove alias ${a.alias}`}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    marginLeft: 'var(--alm-sp-1)',
                    padding: 0,
                    color: 'var(--alm-text-muted)',
                  }}
                  onClick={() => handleAliasRemove(a.id)}
                >
                  ×
                </button>
              )}
            </Pill>
          ))}
          {detail.aliases.length === 0 && (
            <span style={{ color: 'var(--alm-text-faint)', fontSize: 'var(--alm-text-sm)' }}>
              No aliases
            </span>
          )}
        </div>

        {/* Add user alias form */}
        <div style={{ display: 'flex', gap: 'var(--alm-sp-2)', marginTop: 'var(--alm-sp-2)' }}>
          <input
            aria-label="New alias"
            placeholder="Add user alias…"
            value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleAliasAdd();
            }}
            style={{ flex: 1, padding: 'var(--alm-sp-1)', fontSize: 'var(--alm-text-sm)' }}
          />
          <button
            onClick={handleAliasAdd}
            style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}
          >
            Add
          </button>
        </div>
        {aliasError && (
          <Banner variant="danger" style={{ marginTop: 'var(--alm-sp-1)' }}>
            {aliasError}
          </Banner>
        )}
        {actionError && (
          <Banner variant="danger" style={{ marginTop: 'var(--alm-sp-1)' }}>
            {actionError}
          </Banner>
        )}
      </Section>

      {/* Sessions — empty state (cross-spec FK wiring deferred) */}
      <Section title="Sessions">
        <EmptyState
          title="No sessions linked"
          desc="Sessions appear here once the ingestion pipeline populates target_id from FITS OBJECT data."
        />
      </Section>

      {/* Projects — empty state (cross-spec FK wiring deferred) */}
      <Section title="Projects">
        <EmptyState
          title="No projects linked"
          desc="Projects appear here once they are created with a target reference."
        />
      </Section>

      {/* Back button */}
      <button
        style={{
          margin: 'var(--alm-sp-3) 0',
          padding: 'var(--alm-sp-1) var(--alm-sp-3)',
          fontSize: 'var(--alm-text-sm)',
          cursor: 'pointer',
        }}
        onClick={() => navigate({ to: '/targets' })}
      >
        ← All targets
      </button>
    </DetailPane>
  );
}
