import { useMemo } from 'react';
import { Select } from '@base-ui-components/react/select';
import { useQuery, createQueryStore } from '@/data/store';
import { listSessions, listCalibrationMasters } from '@/api/commands';
import type { CalibrationMaster } from '@/api/types';
import { Confidence } from '@/ui';

const sessionsStore = createQueryStore(() => listSessions());
const mastersStore = createQueryStore(() => listCalibrationMasters());

export interface CalibrationMapping {
  flatMappings: Record<string, string>; // filter -> master_id
  sharedDarkId: string;
  sharedBiasId: string;
  sharedDarkFlatId: string;
}

export interface StepCalibrationProps {
  selectedSessionIds: string[];
  data: CalibrationMapping;
  onChange: (data: CalibrationMapping) => void;
}

export function StepCalibration({ selectedSessionIds, data, onChange }: StepCalibrationProps) {
  const { data: sessions } = useQuery(sessionsStore);
  const { data: masters, loading } = useQuery(mastersStore);

  // Get unique filters from selected light sessions
  const uniqueFilters = useMemo(() => {
    if (!sessions) return [];
    const filters = new Set<string>();
    sessions
      .filter((s) => selectedSessionIds.includes(s.id))
      .forEach((s) => filters.add(s.session_key.filter));
    return Array.from(filters);
  }, [sessions, selectedSessionIds]);

  // Group masters by kind
  const flatMasters = useMemo(
    () => (masters || []).filter((m) => m.kind === 'flat'),
    [masters],
  );
  const darkMasters = useMemo(
    () => (masters || []).filter((m) => m.kind === 'dark'),
    [masters],
  );
  const biasMasters = useMemo(
    () => (masters || []).filter((m) => m.kind === 'bias'),
    [masters],
  );
  const darkFlatMasters = useMemo(
    () => (masters || []).filter((m) => m.kind === 'dark_flat'),
    [masters],
  );

  if (loading) {
    return <div style={{ color: 'var(--alm-text-muted)' }}>Loading calibration masters...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-5)' }}>
      {/* Per-filter flat mapping */}
      <div>
        <h3 style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 600, marginBottom: 'var(--alm-space-3)' }}>
          Flat Masters (per filter)
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-3)' }}>
          {uniqueFilters.map((filter) => (
            <div
              key={filter}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--alm-space-3)',
                padding: 'var(--alm-space-2) var(--alm-space-3)',
                border: '1px solid var(--alm-border)',
                borderRadius: 6,
              }}
            >
              <span style={{ minWidth: 60, fontSize: 'var(--alm-text-sm)', fontWeight: 500 }}>
                {filter}
              </span>
              <Select.Root
                value={data.flatMappings[filter] || ''}
                onValueChange={(value) =>
                  onChange({
                    ...data,
                    flatMappings: { ...data.flatMappings, [filter]: value ?? '' },
                  })
                }
              >
                <Select.Trigger
                  className="alm-select alm-select--sm"
                  aria-label={`Flat master for ${filter}`}
                  style={{ flex: 1 }}
                >
                  <Select.Value>
                    {(value: string | null) => value || 'Select flat master...'}
                  </Select.Value>
                  <Select.Icon className="alm-select__icon" />
                </Select.Trigger>
                <Select.Portal>
                  <Select.Positioner>
                    <Select.Popup className="alm-select__popup">
                      <Select.Item value="" className="alm-select__item">
                        <Select.ItemText>Select flat master...</Select.ItemText>
                      </Select.Item>
                      {flatMasters.map((m) => (
                        <Select.Item key={m.id} value={m.id} className="alm-select__item">
                          <Select.ItemText>
                            {m.fingerprint.filter || 'no filter'} — {m.fingerprint.camera} ({m.id.slice(0, 8)})
                          </Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Popup>
                  </Select.Positioner>
                </Select.Portal>
              </Select.Root>
              {data.flatMappings[filter] && (
                <MatchScore masterId={data.flatMappings[filter]} masters={flatMasters} />
              )}
            </div>
          ))}
          {uniqueFilters.length === 0 && (
            <div style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-xs)' }}>
              No light sessions selected — go back and select sources first
            </div>
          )}
        </div>
      </div>

      {/* Shared calibration */}
      <div>
        <h3 style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 600, marginBottom: 'var(--alm-space-3)' }}>
          Shared Calibration
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-3)' }}>
          {/* Dark master */}
          <MasterSelect
            label="Dark master"
            value={data.sharedDarkId}
            options={darkMasters}
            onChange={(id) => onChange({ ...data, sharedDarkId: id })}
          />
          {/* Bias master */}
          <MasterSelect
            label="Bias master"
            value={data.sharedBiasId}
            options={biasMasters}
            onChange={(id) => onChange({ ...data, sharedBiasId: id })}
          />
          {/* Dark flat master */}
          <MasterSelect
            label="Dark flat master"
            value={data.sharedDarkFlatId}
            options={darkFlatMasters}
            onChange={(id) => onChange({ ...data, sharedDarkFlatId: id })}
          />
        </div>
      </div>
    </div>
  );
}

function MasterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: CalibrationMaster[];
  onChange: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--alm-space-3)',
        padding: 'var(--alm-space-2) var(--alm-space-3)',
        border: '1px solid var(--alm-border)',
        borderRadius: 6,
      }}
    >
      <span style={{ minWidth: 100, fontSize: 'var(--alm-text-sm)', fontWeight: 500 }}>
        {label}
      </span>
      <Select.Root
        value={value}
        onValueChange={(newValue) => onChange(newValue ?? '')}
      >
        <Select.Trigger
          className="alm-select alm-select--sm"
          aria-label={label}
          style={{ flex: 1 }}
        >
          <Select.Value>
            {(value: string | null) => value || 'None selected'}
          </Select.Value>
          <Select.Icon className="alm-select__icon" />
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner>
            <Select.Popup className="alm-select__popup">
              <Select.Item value="" className="alm-select__item">
                <Select.ItemText>None selected</Select.ItemText>
              </Select.Item>
              {options.map((m) => (
                <Select.Item key={m.id} value={m.id} className="alm-select__item">
                  <Select.ItemText>
                    {m.fingerprint.camera} — {m.fingerprint.exposure_s}s, gain {m.fingerprint.gain} ({m.id.slice(0, 8)})
                  </Select.ItemText>
                </Select.Item>
              ))}
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

function MatchScore({ masterId, masters }: { masterId: string; masters: CalibrationMaster[] }) {
  const master = masters.find((m) => m.id === masterId);
  if (!master) return null;
  // Show a simple confidence based on age
  const ageDays = master.age_days;
  const level = ageDays < 7 ? 'high' : ageDays < 30 ? 'medium' : 'low';
  return <Confidence level={level} />;
}
