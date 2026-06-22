// spec 018 — owned keys: blockPermanentDelete, defaultProtection,
// protectedCategories. Loads from settings.get('cleanup') on mount and
// auto-saves via the save() prop on change.
//
// Per-type cleanup action table: user overrides are stored in localStorage
// (key: 'alm.cleanup.type_actions') so they persist across reloads without
// requiring the cleanup-plan backend spec. CLEANUP_TYPES provides the
// defaults and the locked/unlocked flags. (T061 FR-024)
import { useState, useEffect, Fragment } from 'react';
import { Toggle, SegControl, Pill, Banner } from '@/ui';
import { getSettings } from '@/api/commands';
import { CLEANUP_TYPES, CLEANUP_STAGE_ORDER, type CleanupTypeFixture } from '@/data/fixtures/settings';
import { SettingsSection, SettingsRow } from './SettingsKit';

type CleanupAction = CleanupTypeFixture['action'];
type DefaultProtection = 'protected' | 'normal' | 'unprotected';

// Bumped to v2: row ids and the type set changed (per-type raw calibration
// frames + per-type masters), so old persisted overrides no longer map.
const ACTIONS_STORAGE_KEY = 'alm.cleanup.type_actions.v2';

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
        if (saved[String(row.id)]) {
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

  // Protected (high-value) categories currently set to a destructive action —
  // surfaced as an impact warning so the change is deliberate. (T028)
  const warnedTypes = CLEANUP_TYPES.filter(
    (row) => row.warnOnChange && (actions[row.id] ?? row.action) !== 'Keep',
  ).map((row) => row.type);

  return (
    <>
      {/* Source protection — spec 018 owned, persisted via settings backend */}
      <SettingsSection title="Source Protection">
        <SettingsRow
          label="Block permanent delete"
          info="Routes all destructive operations through archive or trash workflows instead of immediate permanent deletion."
        >
          <Toggle
            checked={blockPermanentDelete}
            onChange={(v) => {
              setBlockPermanentDelete(v);
              save('cleanup', { blockPermanentDelete: v });
            }}
          />
        </SettingsRow>

        <SettingsRow
          label="Default protection"
          info="Controls the starting protection level assigned to newly ingested sources. Protected sources are skipped by cleanup plans unless explicitly approved."
        >
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
        </SettingsRow>
      </SettingsSection>

      {/* Per-type cleanup actions — fixture mockup, not yet wired to backend */}
      {/* TODO(cleanup-plan-spec): replace CLEANUP_TYPES fixture with backend data */}
      <SettingsSection title="Per-Type Default Actions">
        {warnedTypes.length > 0 && (
          <Banner variant="danger" className="alm-cleanup__warning">
            Protected categories are set to a destructive action: {warnedTypes.join(', ')}.
            These are costly to reacquire — confirm this is intentional.
          </Banner>
        )}
        <table className="alm-table">
          <thead>
            <tr>
              <th>Data type</th>
              <th className="alm-cleanup__action-col">Default action</th>
            </tr>
          </thead>
          <tbody>
            {CLEANUP_STAGE_ORDER.map((stage) => (
              <Fragment key={stage}>
                <tr className="alm-cleanup__group-row">
                  <td colSpan={2}>{stage}</td>
                </tr>
                {CLEANUP_TYPES.filter((row) => row.stage === stage).map((row) => {
                  const current = actions[row.id] ?? row.action;
                  return (
                    <tr key={row.id}>
                      <td>
                        <span className="alm-cleanup__type-cell">
                          {row.type}
                          {row.warnOnChange && (
                            <Pill variant="neutral">Protected</Pill>
                          )}
                        </span>
                      </td>
                      <td>
                        <SegControl
                          options={['Keep', 'Archive', 'Delete']}
                          value={current}
                          onChange={(v) => handleTableChange(row.id, v)}
                          danger
                        />
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </SettingsSection>
    </>
  );
}
