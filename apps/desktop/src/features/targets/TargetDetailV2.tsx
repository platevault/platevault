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
import { X } from 'lucide-react';
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
          <span className="alm-target-detail__title-extra">
            <Pill variant="neutral">{detail.objectType.replace('_', ' ')}</Pill>
          </span>
        }
      />

      {/* Coordinates + metadata */}
      <Section title="Identity">
        <dl className="alm-target-detail__identity-grid">
          <dt className="alm-target-detail__identity-label">Designation</dt>
          <dd>{detail.primaryDesignation}</dd>
          <dt className="alm-target-detail__identity-label">RA</dt>
          <dd>{detail.raDeg != null ? fmtDeg(detail.raDeg, true) : '—'}</dd>
          <dt className="alm-target-detail__identity-label">Dec</dt>
          <dd>{detail.decDeg != null ? fmtDeg(detail.decDeg, false) : '—'}</dd>
          <dt className="alm-target-detail__identity-label">Source</dt>
          <dd>
            <Pill variant="ghost">{detail.source}</Pill>
          </dd>
          {detail.simbadOid != null && (
            <>
              <dt className="alm-target-detail__identity-label">SIMBAD OID</dt>
              <dd>{detail.simbadOid}</dd>
            </>
          )}
        </dl>
      </Section>

      {/* Display alias (FR-012: user presentation label) */}
      <Section title="Display label">
        {displayAliasEditing ? (
          <div className="alm-target-detail__display-alias-edit">
            <input
              aria-label="Display label"
              placeholder={detail.primaryDesignation}
              value={displayAliasInput}
              onChange={(e) => setDisplayAliasInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleDisplayAliasSet();
                if (e.key === 'Escape') setDisplayAliasEditing(false);
              }}
              className="alm-target-detail__text-input"
              autoFocus
            />
            <button
              onClick={handleDisplayAliasSet}
              className="alm-target-detail__action-btn"
            >
              Save
            </button>
            {detail.displayAlias != null && (
              <button
                onClick={handleDisplayAliasClear}
                className="alm-target-detail__action-btn alm-target-detail__action-btn--muted"
              >
                Clear
              </button>
            )}
            <button
              onClick={() => setDisplayAliasEditing(false)}
              className="alm-target-detail__action-btn alm-target-detail__action-btn--muted"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="alm-target-detail__display-alias-view">
            <span className="alm-target-detail__display-alias-value">
              {detail.displayAlias ?? (
                <em className="alm-target-detail__display-alias-placeholder">
                  Not set — showing primary designation
                </em>
              )}
            </span>
            <button
              onClick={() => setDisplayAliasEditing(true)}
              className="alm-target-detail__edit-btn"
            >
              {detail.displayAlias != null ? 'Edit' : 'Set'}
            </button>
          </div>
        )}
      </Section>

      {/* Aliases */}
      <Section title="Aliases" count={detail.aliases.length}>
        <div className="alm-target-detail__alias-list">
          {detail.aliases.map((a) => (
            <Pill key={a.id} variant={a.kind === 'user' ? 'accent' : 'ghost'}>
              <span title={`kind: ${a.kind}`}>
                <span className="alm-target-detail__alias-kind">
                  [{kindLabel(a.kind)}]
                </span>
                {a.alias}
              </span>
              {a.kind === 'user' && (
                <button
                  aria-label={`Remove alias ${a.alias}`}
                  className="alm-target-detail__alias-remove"
                  onClick={() => handleAliasRemove(a.id)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </Pill>
          ))}
          {detail.aliases.length === 0 && (
            <span className="alm-target-detail__alias-empty">
              No aliases
            </span>
          )}
        </div>

        {/* Add user alias form */}
        <div className="alm-target-detail__alias-add-row">
          <input
            aria-label="New alias"
            placeholder="Add user alias…"
            value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleAliasAdd();
            }}
            className="alm-target-detail__text-input"
          />
          <button
            onClick={handleAliasAdd}
            className="alm-target-detail__action-btn"
          >
            Add
          </button>
        </div>
        {aliasError && (
          <Banner variant="danger" className="alm-target-detail__banner">
            {aliasError}
          </Banner>
        )}
        {actionError && (
          <Banner variant="danger" className="alm-target-detail__banner">
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
        className="alm-target-detail__back-btn"
        onClick={() => navigate({ to: '/targets' })}
      >
        ← All targets
      </button>
    </DetailPane>
  );
}
