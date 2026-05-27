import { useState } from 'react';
import { Table } from '@/ui';
import { CALIBRATION_CRITERIA } from '@/data/fixtures/settings';

interface CalibrationMatchingProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

export function CalibrationMatching({ save }: CalibrationMatchingProps) {
  const [agingThreshold, setAgingThreshold] = useState(90);

  return (
    <>
      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Matching Criteria</div>
        <Table
          columns={[
            { key: 'field', label: 'Field' },
            { key: 'required', label: 'Required', style: { width: 90 } },
            { key: 'tolerance', label: 'Tolerance', style: { width: 120 } },
            { key: 'notes', label: 'Notes' },
          ]}
          rows={CALIBRATION_CRITERIA.map((c) => ({
            field: c.field,
            required: c.required
              ? <span style={{ color: 'var(--alm-ok)', fontWeight: 600 }}>Yes</span>
              : <span style={{ color: 'var(--alm-text-muted)' }}>No</span>,
            tolerance: c.tolerance
              ? <code className="alm-mono">{c.tolerance}</code>
              : <span style={{ color: 'var(--alm-text-muted)' }}>—</span>,
            notes: <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>{c.notes}</span>,
          }))}
        />
      </div>

      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Aging Threshold</div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-label">Default maximum calibration age</div>
          <div className="alm-settings__row-content">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-2)' }}>
              <input
                type="number"
                className="alm-input"
                style={{ width: 80 }}
                value={agingThreshold}
                min={1}
                max={3650}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setAgingThreshold(v);
                  save('calibration_matching', { aging_threshold_days: v });
                }}
              />
              <span style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)' }}>days</span>
            </div>
          </div>
          <div className="alm-settings__row-desc">
            Calibration frames older than this threshold generate a warning when matched against light frames.
          </div>
        </div>
      </div>
    </>
  );
}
