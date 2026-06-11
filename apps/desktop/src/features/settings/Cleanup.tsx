// spec 018 — owned keys: blockPermanentDelete, defaultProtection,
// protectedCategories. Loads from settings.get('cleanup') on mount and
// auto-saves via the save() prop on change.
//
// The per-type cleanup action table is fixture-driven for the v4 mockup;
// its backend wiring belongs to the cleanup plan spec (not spec 018).
import { useState, useEffect } from 'react';
import { Toggle, SegControl, Pill } from '@/ui';
import { getSettings } from '@/api/commands';
import { CLEANUP_TYPES, type CleanupTypeFixture } from '@/data/fixtures/settings';

type CleanupAction = CleanupTypeFixture['action'];
type DefaultProtection = 'protected' | 'normal' | 'unprotected';

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

  // ── fixture-driven table state (not yet wired to backend) ────────────────
  const [actions, setActions] = useState<Record<number, CleanupAction>>(() => {
    const init: Record<number, CleanupAction> = {};
    for (const row of CLEANUP_TYPES) {
      init[row.id] = row.action;
    }
    return init;
  });

  const handleTableChange = (id: number, action: string) => {
    setActions((prev) => ({ ...prev, [id]: action as CleanupAction }));
    // TODO(cleanup-plan-spec): wire this table to the cleanup plan backend.
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
              className="alm-select"
              value={defaultProtection}
              onChange={(e) => {
                const v = e.target.value as DefaultProtection;
                setDefaultProtection(v);
                save('cleanup', { defaultProtection: v });
              }}
              style={{ height: 28 }}
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
              <th style={{ width: 220 }}>Default action</th>
            </tr>
          </thead>
          <tbody>
            {CLEANUP_TYPES.map((row) => {
              const current = actions[row.id] ?? row.action;
              return (
                <tr key={row.id}>
                  <td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-2)' }}>
                      {row.type}
                      {row.locked && (
                        <Pill variant="neutral">Protected</Pill>
                      )}
                    </span>
                  </td>
                  <td>
                    {row.locked ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-1)', color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-xs)' }}>
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
