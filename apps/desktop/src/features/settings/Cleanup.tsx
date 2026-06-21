// spec 018 — owned keys: blockPermanentDelete, defaultProtection,
// protectedCategories. Loads from settings.get('cleanup') on mount and
// auto-saves via the save() prop on change.
//
// Per-type cleanup action table: user overrides are stored in localStorage
// (key: 'alm.cleanup.type_actions') so they persist across reloads without
// requiring the cleanup-plan backend spec. CLEANUP_TYPES provides the
// defaults and the locked/unlocked flags. (T061 FR-024)
import { useState, useEffect } from 'react';
import { Toggle, SegControl, Pill } from '@/ui';
import { getSettings } from '@/api/commands';
import { CLEANUP_TYPES, type CleanupTypeFixture } from '@/data/fixtures/settings';

type CleanupAction = CleanupTypeFixture['action'];
type DefaultProtection = 'protected' | 'normal' | 'unprotected';

const ACTIONS_STORAGE_KEY = 'alm.cleanup.type_actions';

/** Load persisted per-type action overrides from localStorage. */
function loadActionsFromStorage(): Record<number, CleanupAction> {
  const init: Record<number, CleanupAction> = {};
  for (const row of CLEANUP_TYPES) {
    init[row.id] = row.action;
  }
  try {
    const raw = typeof localStorage !== 'undefined'
      ? localStorage.getItem(ACTIONS_STORAGE_KEY)
      : null;
    if (raw) {
      const saved = JSON.parse(raw) as Record<string, string>;
      for (const row of CLEANUP_TYPES) {
        if (!row.locked && saved[String(row.id)]) {
          init[row.id] = saved[String(row.id)] as CleanupAction;
        }
      }
    }
  } catch {
    // localStorage unavailable or corrupt — use defaults.
  }
  return init;
}

/** Persist per-type action overrides to localStorage. */
function saveActionsToStorage(actions: Record<number, CleanupAction>): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const serialisable: Record<string, string> = {};
      for (const [id, action] of Object.entries(actions)) {
        serialisable[id] = action;
      }
      localStorage.setItem(ACTIONS_STORAGE_KEY, JSON.stringify(serialisable));
    }
  } catch {
    // localStorage unavailable — best effort.
  }
}

interface CleanupProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

export function Cleanup({ save }: CleanupProps) {
  // ── spec 018 owned state ─────────────────────────────────────────────────
  const [blockPermanentDelete, setBlockPermanentDelete] = useState(true);
  const [defaultProtection, setDefaultProtection] = useState<DefaultProtection>('protected');

  // Load persisted values from backend on mount (T015).
  useEffect(() => {
    let cancelled = false;
    getSettings({ scope: 'cleanup' })
      .then((data) => {
        if (cancelled) return;
        const vals = data.values as Record<string, unknown>;
        if (typeof vals?.blockPermanentDelete === 'boolean') {
          setBlockPermanentDelete(vals.blockPermanentDelete);
        }
        if (vals?.defaultProtection && typeof vals.defaultProtection === 'string') {
          setDefaultProtection(vals.defaultProtection as DefaultProtection);
        }
      })
      .catch(() => {
        // Backend unavailable — stay with in-code defaults.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Per-type action table — persisted in localStorage (T061) ─────────────
  const [actions, setActions] = useState<Record<number, CleanupAction>>(loadActionsFromStorage);

  const handleTableChange = (id: number, action: string) => {
    setActions((prev) => {
      const next = { ...prev, [id]: action as CleanupAction };
      saveActionsToStorage(next);
      return next;
    });
  };

  return (
    <>
      {/* Source protection — spec 018 owned, persisted via settings backend */}
      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Source Protection</div>

        <div className="alm-settings__row">
          <div className="alm-settings__row-label">Block permanent delete</div>
          <div className="alm-settings__row-content">
            <Toggle
              checked={blockPermanentDelete}
              onChange={(v) => {
                setBlockPermanentDelete(v);
                save('cleanup', { blockPermanentDelete: v });
              }}
            />
            <div className="alm-settings__row-desc">
              Routes all destructive operations through archive or trash workflows
              instead of immediate permanent deletion.
            </div>
          </div>
        </div>

        <div className="alm-settings__row">
          <div className="alm-settings__row-label">Default protection</div>
          <div className="alm-settings__row-content">
            <select
              className="alm-select alm-cleanup__protection-select"
              value={defaultProtection}
              onChange={(e) => {
                const v = e.target.value as DefaultProtection;
                setDefaultProtection(v);
                save('cleanup', { defaultProtection: v });
              }}
            >
              <option value="protected">Protected</option>
              <option value="normal">Normal</option>
              <option value="unprotected">Unprotected</option>
            </select>
            <div className="alm-settings__row-desc">
              {defaultProtection === 'protected' && 'New sources start protected — cleanup plans skip them unless explicitly approved.'}
              {defaultProtection === 'normal' && 'New sources start at normal protection — cleanup plans may include them.'}
              {defaultProtection === 'unprotected' && 'New sources start unprotected — cleanup plans may act on them without extra confirmation.'}
            </div>
          </div>
        </div>
      </div>

      {/* Per-type cleanup actions — fixture mockup, not yet wired to backend */}
      {/* TODO(cleanup-plan-spec): replace CLEANUP_TYPES fixture with backend data */}
      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Per-Type Default Actions</div>
        <table className="alm-table">
          <thead>
            <tr>
              <th>Data type</th>
              <th className="alm-cleanup__action-col">Default action</th>
            </tr>
          </thead>
          <tbody>
            {CLEANUP_TYPES.map((row) => {
              const current = actions[row.id] ?? row.action;
              return (
                <tr key={row.id}>
                  <td>
                    <span className="alm-cleanup__type-cell">
                      {row.type}
                      {row.locked && (
                        <Pill variant="neutral">Protected</Pill>
                      )}
                    </span>
                  </td>
                  <td>
                    {row.locked ? (
                      <span className="alm-cleanup__locked-label">
                        <span>&#128274;</span> Keep (protected)
                      </span>
                    ) : (
                      <SegControl
                        options={['Keep', 'Archive', 'Delete']}
                        value={current}
                        onChange={(v) => handleTableChange(row.id, v)}
                        danger
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
