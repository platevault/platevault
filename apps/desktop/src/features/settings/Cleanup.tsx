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
import { getSettings } from './settingsIpc';
import { CLEANUP_TYPES, CLEANUP_STAGE_ORDER, type CleanupTypeFixture } from '@/data/fixtures/settings';
import { m } from '@/lib/i18n';
import { SettingsSection, SettingsRow, RestoreDefaultsBtn } from './SettingsKit';

const CLEANUP_KEYS = ['blockPermanentDelete', 'defaultProtection', 'protectedCategories'];

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

  const applyValues = (vals: Record<string, unknown>) => {
    if (typeof vals?.blockPermanentDelete === 'boolean') {
      setBlockPermanentDelete(vals.blockPermanentDelete);
    }
    if (vals?.defaultProtection && typeof vals.defaultProtection === 'string') {
      setDefaultProtection(vals.defaultProtection as DefaultProtection);
    }
  };

  // Load persisted values from backend on mount (T015).
  useEffect(() => {
    let cancelled = false;
    getSettings({ scope: 'cleanup' })
      .then((data) => {
        if (cancelled) return;
        applyValues(data.values as Record<string, unknown>);
      })
      .catch(() => {
        // Backend unavailable — stay with in-code defaults.
      });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <SettingsSection
        title={m.settings_cleanup_protection_title()}
        action={
          <RestoreDefaultsBtn
            scope="cleanup"
            keys={CLEANUP_KEYS}
            onRestored={applyValues}
          />
        }
      >
        <SettingsRow
          label={m.settings_cleanup_block_delete_label()}
          info={m.settings_cleanup_route_info()}
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
          label={m.settings_cleanup_default_protection_label()}
          info={m.settings_cleanup_protection_info()}
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
            <option value="protected">{m.settings_cleanup_protection_protected()}</option>
            <option value="normal">{m.settings_cleanup_protection_normal()}</option>
            <option value="unprotected">{m.settings_cleanup_protection_unprotected()}</option>
          </select>
        </SettingsRow>
      </SettingsSection>

      {/* Per-type cleanup actions — fixture mockup, not yet wired to backend */}
      {/* TODO(spec 017 US2): replace CLEANUP_TYPES fixture with the archive plan generator once it lands */}
      <SettingsSection title={m.settings_cleanup_pertype_title()}>
        {warnedTypes.length > 0 && (
          <Banner variant="danger" className="alm-cleanup__warning">
            {m.settings_cleanup_pertype_desc({ types: warnedTypes.join(', ') })}
          </Banner>
        )}
        <table className="alm-table">
          <thead>
            <tr>
              <th>{m.settings_cleanup_col_datatype()}</th>
              <th className="alm-cleanup__action-col">{m.settings_cleanup_col_action()}</th>
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
                            <Pill variant="neutral">{m.settings_cleanup_protection_protected()}</Pill>
                          )}
                        </span>
                      </td>
                      <td>
                        <SegControl
                          options={[
                            { value: 'Keep', label: m.settings_cleanup_action_keep() },
                            { value: 'Archive', label: m.settings_cleanup_action_archive() },
                            { value: 'Delete', label: m.settings_cleanup_action_delete() },
                          ]}
                          value={current}
                          onChange={(v) => handleTableChange(row.id, v)}
                          danger
                          dangerValue="Delete"
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
