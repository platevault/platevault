import { useState } from 'react';
import { Switch } from '@base-ui-components/react/switch';
import clsx from 'clsx';
import { Pill } from '@/ui';

type CleanupAction = 'Keep' | 'Archive' | 'Delete';

const ACTIONS: CleanupAction[] = ['Keep', 'Archive', 'Delete'];

const ACTION_VARIANT: Record<CleanupAction, 'ok' | 'info' | 'danger'> = {
  Keep: 'ok',
  Archive: 'info',
  Delete: 'danger',
};

interface DataTypeRow {
  id: string;
  label: string;
  defaultAction: CleanupAction;
}

const DATA_TYPES: DataTypeRow[] = [
  { id: 'registered_frames', label: 'Registered frames', defaultAction: 'Archive' },
  { id: 'calibrated_frames', label: 'Calibrated frames', defaultAction: 'Archive' },
  { id: 'debayered_frames', label: 'Debayered frames', defaultAction: 'Archive' },
  { id: 'local_normalized', label: 'Local normalized', defaultAction: 'Archive' },
  { id: 'drizzle_data', label: 'Drizzle data', defaultAction: 'Archive' },
  { id: 'integration_cache', label: 'Integration cache', defaultAction: 'Delete' },
  { id: 'stack_intermediate', label: 'Stack output (intermediate)', defaultAction: 'Keep' },
  { id: 'temporary_files', label: 'Temporary files', defaultAction: 'Delete' },
  { id: 'processing_logs', label: 'Processing logs', defaultAction: 'Archive' },
  { id: 'process_icons', label: 'Process icons / tool config', defaultAction: 'Keep' },
  { id: 'source_frames', label: 'Source frames (raw lights)', defaultAction: 'Keep' },
  { id: 'calibration_masters', label: 'Calibration masters', defaultAction: 'Keep' },
  { id: 'source_views', label: 'Source views (links)', defaultAction: 'Delete' },
  { id: 'final_outputs', label: 'Final outputs', defaultAction: 'Keep' },
  { id: 'notes_manifests', label: 'Notes & manifests', defaultAction: 'Keep' },
];

export function Cleanup() {
  const [actions, setActions] = useState<Record<string, CleanupAction>>(() => {
    const initial: Record<string, CleanupAction> = {};
    for (const dt of DATA_TYPES) {
      initial[dt.id] = dt.defaultAction;
    }
    return initial;
  });

  const [autoOnCompletion, setAutoOnCompletion] = useState(false);

  const handleActionChange = (id: string, action: CleanupAction) => {
    setActions((prev) => ({ ...prev, [id]: action }));
  };

  return (
    <div className="alm-cleanup">
      {/* Mode toggle */}
      <section className="alm-cleanup__section">
        <div className="alm-cleanup__toggle-row">
          <label className="alm-cleanup__toggle-label">
            <Switch.Root
              className="alm-switch"
              checked={autoOnCompletion}
              onCheckedChange={(checked) => setAutoOnCompletion(checked)}
              aria-label="Auto-suggest cleanup on project completion"
            >
              <Switch.Thumb className="alm-switch__thumb" />
            </Switch.Root>
            <span>
              {autoOnCompletion
                ? 'Auto-suggest cleanup when project is completed'
                : 'Manual cleanup only (generate plans yourself)'}
            </span>
          </label>
        </div>
      </section>

      {/* Per-type action table */}
      <section className="alm-cleanup__section">
        <h3 className="alm-cleanup__subtitle">Per-Type Actions</h3>
        <p className="alm-cleanup__hint">
          Select the default action for each data type when a cleanup plan is generated.
        </p>

        <table className="alm-cleanup__table">
          <thead>
            <tr>
              <th>Data Type</th>
              <th className="alm-cleanup__col-action">Action</th>
            </tr>
          </thead>
          <tbody>
            {DATA_TYPES.map((dt) => {
              const current = actions[dt.id] ?? dt.defaultAction;
              return (
                <tr key={dt.id} className="alm-cleanup__row">
                  <td className="alm-cleanup__type-label">{dt.label}</td>
                  <td>
                    <div className="alm-cleanup__action-group">
                      {ACTIONS.map((action) => (
                        <button
                          key={action}
                          type="button"
                          className={clsx(
                            'alm-cleanup__action-btn',
                            current === action && 'alm-cleanup__action-btn--active',
                            current === action && `alm-cleanup__action-btn--${action.toLowerCase()}`,
                          )}
                          onClick={() => handleActionChange(dt.id, action)}
                          aria-pressed={current === action}
                          aria-label={`${action} ${dt.label}`}
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
