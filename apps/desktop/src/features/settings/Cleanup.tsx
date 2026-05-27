import { useState } from 'react';
import { SegControl, Pill } from '@/ui';
import { CLEANUP_TYPES, type CleanupTypeFixture } from '@/data/fixtures/settings';

type CleanupAction = CleanupTypeFixture['action'];

export function Cleanup() {
  const [actions, setActions] = useState<Record<number, CleanupAction>>(() => {
    const init: Record<number, CleanupAction> = {};
    for (const row of CLEANUP_TYPES) {
      init[row.id] = row.action;
    }
    return init;
  });

  const handleChange = (id: number, action: string) => {
    setActions((prev) => ({ ...prev, [id]: action as CleanupAction }));
  };

  return (
    <>
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
                        onChange={(v) => handleChange(row.id, v)}
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
