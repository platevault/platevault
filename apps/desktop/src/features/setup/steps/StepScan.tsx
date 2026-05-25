import { Switch } from '@base-ui-components/react/switch';

export interface ScanSettings {
  groupingStrategy: 'standard' | 'night_only' | 'target_only';
  targetResolution: boolean;
  calibrationDiscovery: boolean;
  equipmentDetection: boolean;
  followSymlinks: boolean;
}

export const DEFAULT_SCAN_SETTINGS: ScanSettings = {
  groupingStrategy: 'standard',
  targetResolution: true,
  calibrationDiscovery: true,
  equipmentDetection: true,
  followSymlinks: false,
};

export interface StepScanProps {
  settings: ScanSettings;
  onSettingsChange: (settings: ScanSettings) => void;
}

const GROUPING_OPTIONS: Array<{ value: ScanSettings['groupingStrategy']; label: string; description: string }> = [
  { value: 'standard', label: 'Standard (target + filter + night + train)', description: 'Group by OBJECT + FILTER + night + optical train' },
  { value: 'night_only', label: 'By night only', description: 'Group all frames from the same night together' },
  { value: 'target_only', label: 'By target only', description: 'Group all frames of the same target regardless of night or filter' },
];

/**
 * Switch row — renders a labeled toggle with description in a card-style row.
 */
function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  children,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: 'var(--alm-space-3) var(--alm-space-4)',
        background: 'var(--alm-surface)',
        borderRadius: 'var(--alm-radius-sm)',
        border: '1px solid var(--alm-border)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--alm-space-3)',
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 500 }}>
            {label}
          </div>
          <div
            style={{
              fontSize: 'var(--alm-text-xs)',
              color: 'var(--alm-text-muted)',
              lineHeight: 1.5,
              marginTop: 'var(--alm-space-1)',
            }}
          >
            {description}
          </div>
        </div>
        <Switch.Root
          checked={checked}
          onCheckedChange={onCheckedChange}
          className="alm-switch"
          aria-label={label}
          style={{
            width: 36,
            height: 20,
            borderRadius: 10,
            background: checked ? 'var(--alm-gray-900)' : 'var(--alm-gray-200)',
            position: 'relative',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 150ms',
          }}
        >
          <Switch.Thumb
            className="alm-switch__thumb"
            style={{
              display: 'block',
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: '#fff',
              position: 'absolute',
              top: 2,
              left: checked ? 18 : 2,
              transition: 'left 150ms',
            }}
          />
        </Switch.Root>
      </div>
      {checked && children && (
        <div
          style={{
            marginTop: 'var(--alm-space-3)',
            paddingTop: 'var(--alm-space-3)',
            borderTop: '1px solid var(--alm-border)',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Step 4 — Scan & discovery settings.
 * Five controls: session grouping strategy, target resolution, calibration
 * discovery, equipment detection, and symlink/junction following.
 *
 * The parent SetupWizard renders the step heading and navigation footer.
 */
export function StepScan({ settings, onSettingsChange }: StepScanProps) {
  function update<K extends keyof ScanSettings>(key: K, value: ScanSettings[K]) {
    onSettingsChange({ ...settings, [key]: value });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-4)' }}>
      {/* 1. Session grouping strategy */}
      <div
        style={{
          padding: 'var(--alm-space-3) var(--alm-space-4)',
          background: 'var(--alm-surface)',
          borderRadius: 'var(--alm-radius-sm)',
          border: '1px solid var(--alm-border)',
        }}
      >
        <div style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 500 }}>
          Session grouping strategy
        </div>
        <div
          style={{
            fontSize: 'var(--alm-text-xs)',
            color: 'var(--alm-text-muted)',
            lineHeight: 1.5,
            marginTop: 'var(--alm-space-1)',
            marginBottom: 'var(--alm-space-3)',
          }}
        >
          How should frames be grouped into sessions?
        </div>
        <select
          value={settings.groupingStrategy}
          onChange={(e) =>
            update('groupingStrategy', e.target.value as ScanSettings['groupingStrategy'])
          }
          aria-label="Session grouping strategy"
          style={{
            width: '100%',
            padding: 'var(--alm-space-2) var(--alm-space-3)',
            fontSize: 'var(--alm-text-sm)',
            border: '1px solid var(--alm-border)',
            borderRadius: 'var(--alm-radius-sm)',
            background: 'var(--alm-bg)',
            color: 'var(--alm-text)',
            cursor: 'pointer',
          }}
        >
          {GROUPING_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div
          style={{
            fontSize: 'var(--alm-text-xs)',
            color: 'var(--alm-text-muted)',
            marginTop: 'var(--alm-space-2)',
          }}
        >
          {GROUPING_OPTIONS.find((o) => o.value === settings.groupingStrategy)?.description}
        </div>
      </div>

      {/* 2. Target resolution */}
      <SwitchRow
        label="Target resolution"
        description="Match OBJECT headers against your enabled catalogs. All matches are flagged for manual review."
        checked={settings.targetResolution}
        onCheckedChange={() => update('targetResolution', !settings.targetResolution)}
      />

      {/* 3. Calibration discovery */}
      <SwitchRow
        label="Calibration discovery"
        description="Scan for darks, flats, bias, and dark flats alongside light frames. Fingerprint calibration masters for matching."
        checked={settings.calibrationDiscovery}
        onCheckedChange={() => update('calibrationDiscovery', !settings.calibrationDiscovery)}
      />

      {/* 4. Equipment detection */}
      <SwitchRow
        label="Equipment detection"
        description="Infer optical trains from FITS headers (camera, telescope, filter wheel, gain, binning)."
        checked={settings.equipmentDetection}
        onCheckedChange={() => update('equipmentDetection', !settings.equipmentDetection)}
      />

      {/* 5. Symlink / junction following */}
      <SwitchRow
        label="Symlink / junction following"
        description="Follow symbolic links and NTFS junctions during scan. Off by default for safety — enable if your library uses linked folder structures."
        checked={settings.followSymlinks}
        onCheckedChange={() => update('followSymlinks', !settings.followSymlinks)}
      />
    </div>
  );
}
