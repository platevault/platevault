/**
 * TargetDetailV2 — spec 023 wired detail pane for a single target.
 *
 * Fetches the target aggregate via `target.get` and renders:
 *   - Header: primary name, updated_at, alias chips, catalog ref chips.
 *   - Notes: editable text area with 5-second debounced auto-save.
 *   - Alias controls: add-alias form, remove button per alias, primary-rename button.
 *   - Sessions: empty state (sessions list deferred to T012/T013 when FK populated).
 *   - Projects: empty state (projects list deferred to T017/T018 when FK populated).
 *
 * Targets are NOT in the primary nav. This component is reachable via:
 *   - Cmd+K alias-aware search → /targets/$id
 *   - Inventory row target chip → /targets/$id  (T009 deferred pending FK wiring)
 *   - Project source row target chip → /targets/$id  (T010 deferred)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  getTargetIdentity,
  updateTargetNote,
  addTargetAlias,
  removeTargetAlias,
  renameTargetPrimary,
} from '@/api/commands';
import type { TargetGetResult_Serialize as TargetGetResult } from '@/bindings/index';
import type { TargetOpError } from '@/api/commands';
import { DetailPane, DetailHeader } from '@/components';
import { Pill, Section, EmptyState, Banner } from '@/ui';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  targetId: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: TargetGetResult };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format an ISO timestamp to a human-readable date. */
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

/** Map TargetOpError.code to a user-readable message. */
function errorMessage(err: TargetOpError, fallback: string): string {
  switch (err.code) {
    case 'alias.duplicate':
      return 'This alias is already used by a different target.';
    case 'alias.invalid':
      return 'Alias must not be empty.';
    case 'alias.is_primary':
      return 'Cannot remove the primary name. Rename primary first.';
    case 'alias.not_found':
      return 'Alias not found on this target.';
    case 'designation.not_in_aliases':
      return 'New primary must already be an alias. Add it first.';
    case 'designation.already_primary':
      return 'This is already the primary name.';
    case 'target.not_found':
      return 'Target not found.';
    default:
      return fallback;
  }
}

// ── TargetDetailV2 ────────────────────────────────────────────────────────────

export function TargetDetailV2({ targetId }: Props) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [noteContent, setNoteContent] = useState('');
  const [noteStatus, setNoteStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [aliasInput, setAliasInput] = useState('');
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  // Load target data.
  useEffect(() => {
    setLoadState({ status: 'loading' });
    getTargetIdentity({ targetId })
      .then((data) => {
        setLoadState({ status: 'loaded', data });
        setNoteContent(data.target.notes ?? '');
      })
      .catch(() => {
        setLoadState({ status: 'error', message: 'Failed to load target.' });
      });
  }, [targetId]);

  // Debounced note save (5 seconds after last keystroke).
  const handleNoteChange = useCallback(
    (value: string) => {
      setNoteContent(value);
      if (noteTimer.current) clearTimeout(noteTimer.current);
      noteTimer.current = setTimeout(() => {
        setNoteStatus('saving');
        updateTargetNote({ targetId, content: value })
          .then(() => setNoteStatus('saved'))
          .catch(() => setNoteStatus('error'));
      }, 5000);
    },
    [targetId],
  );

  // Cleanup timer on unmount.
  useEffect(
    () => () => {
      if (noteTimer.current) clearTimeout(noteTimer.current);
    },
    [],
  );

  // Add alias.
  const handleAliasAdd = useCallback(async () => {
    const alias = aliasInput.trim();
    if (!alias) {
      setAliasError('Alias must not be empty.');
      return;
    }
    setAliasError(null);
    try {
      await addTargetAlias({ targetId, alias });
      setAliasInput('');
      // Reload target data to reflect new alias.
      const data = await getTargetIdentity({ targetId });
      setLoadState({ status: 'loaded', data });
    } catch (err) {
      const e = err as TargetOpError;
      setAliasError(errorMessage(e, 'Failed to add alias.'));
    }
  }, [targetId, aliasInput]);

  // Remove alias.
  const handleAliasRemove = useCallback(
    async (alias: string) => {
      setActionError(null);
      try {
        await removeTargetAlias({ targetId, alias });
        const data = await getTargetIdentity({ targetId });
        setLoadState({ status: 'loaded', data });
      } catch (err) {
        const e = err as TargetOpError;
        setActionError(errorMessage(e, 'Failed to remove alias.'));
      }
    },
    [targetId],
  );

  // Rename primary.
  const handlePrimaryRename = useCallback(
    async (newPrimary: string) => {
      setActionError(null);
      try {
        await renameTargetPrimary({ targetId, newPrimaryDesignation: newPrimary });
        const data = await getTargetIdentity({ targetId });
        setLoadState({ status: 'loaded', data });
      } catch (err) {
        const e = err as TargetOpError;
        setActionError(errorMessage(e, 'Failed to rename primary.'));
      }
    },
    [targetId],
  );

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

  const { target, sessions, projects } = loadState.data;

  return (
    <DetailPane fill>
      <DetailHeader
        title={<strong>{target.primaryDesignation}</strong>}
        titleExtra={
          <span style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-sm)' }}>
            Updated {formatDate(target.updatedAt)}
          </span>
        }
      />

      {/* Alias chips */}
      <Section title="Aliases">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--alm-sp-1)' }}>
          {target.aliases.map((alias: string) => (
            <Pill key={alias} variant="ghost">
              {alias}
              <button
                aria-label={`Remove alias ${alias}`}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  marginLeft: 'var(--alm-sp-1)',
                  padding: 0,
                  color: 'var(--alm-text-muted)',
                }}
                onClick={() => handleAliasRemove(alias)}
              >
                ×
              </button>
              <button
                aria-label={`Make ${alias} primary`}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  marginLeft: 'var(--alm-sp-1)',
                  padding: 0,
                  fontSize: 'var(--alm-text-xs)',
                  color: 'var(--alm-text-muted)',
                }}
                title="Make primary"
                onClick={() => handlePrimaryRename(alias)}
              >
                ↑
              </button>
            </Pill>
          ))}
          {target.aliases.length === 0 && (
            <span style={{ color: 'var(--alm-text-faint)', fontSize: 'var(--alm-text-sm)' }}>
              No aliases
            </span>
          )}
        </div>

        {/* Catalog ref chips */}
        {target.catalogRefs.length > 0 && (
          <div
            style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--alm-sp-1)', marginTop: 'var(--alm-sp-2)' }}
          >
            {target.catalogRefs.map((ref: { catalogId: string; catalogDisplay: string; designation: string }) => (
              <Pill key={`${ref.catalogId}:${ref.designation}`} variant="neutral">
                {ref.catalogDisplay}: {ref.designation}
              </Pill>
            ))}
          </div>
        )}

        {/* Add alias form */}
        <div style={{ display: 'flex', gap: 'var(--alm-sp-2)', marginTop: 'var(--alm-sp-2)' }}>
          <input
            aria-label="New alias"
            placeholder="Add alias…"
            value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAliasAdd(); }}
            style={{ flex: 1, padding: 'var(--alm-sp-1)', fontSize: 'var(--alm-text-sm)' }}
          />
          <button onClick={handleAliasAdd} style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}>
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

      {/* Notes editor */}
      <Section title="Notes">
        <textarea
          aria-label="Target notes"
          value={noteContent}
          onChange={(e) => handleNoteChange(e.target.value)}
          rows={5}
          style={{
            width: '100%',
            padding: 'var(--alm-sp-2)',
            fontFamily: 'inherit',
            fontSize: 'var(--alm-text-sm)',
            resize: 'vertical',
          }}
        />
        {noteStatus === 'saving' && (
          <span style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-xs)' }}>
            Saving…
          </span>
        )}
        {noteStatus === 'saved' && (
          <span style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-xs)' }}>
            Saved.
          </span>
        )}
        {noteStatus === 'error' && (
          <Banner variant="danger">Failed to save note. Try again.</Banner>
        )}
      </Section>

      {/* Sessions — empty state (T012 deferred) */}
      <Section title="Sessions" count={sessions.length}>
        {sessions.length === 0 ? (
          <EmptyState
            title="No sessions linked"
            desc="Sessions appear here once the ingestion pipeline populates target_id from FITS OBJECT data."
          />
        ) : null}
      </Section>

      {/* Projects — empty state (T017 deferred) */}
      <Section title="Projects" count={projects.length}>
        {projects.length === 0 ? (
          <EmptyState
            title="No projects linked"
            desc="Projects appear here once they are created with a target reference."
          />
        ) : null}
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
