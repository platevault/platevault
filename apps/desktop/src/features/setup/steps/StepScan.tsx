import { Button } from '@base-ui-components/react/button';
import { Switch } from '@base-ui-components/react/switch';

export interface ScanSettings {
  scanFits: boolean;
  scanXisf: boolean;
  scanRaw: boolean;
  scanVideo: boolean;
  extractMetadata: boolean;
  inferSessions: boolean;
}

export interface StepScanProps {
  settings: ScanSettings;
  onSettingsChange: (settings: ScanSettings) => void;
  onNext: () => void;
  onBack: () => void;
}

const SCAN_OPTIONS: Array<{ key: keyof ScanSettings; label: string; description: string }> = [
  { key: 'scanFits', label: 'FITS files', description: 'Scan for .fit, .fits, .fts files' },
  { key: 'scanXisf', label: 'XISF files', description: 'Scan for .xisf PixInsight format files' },
  { key: 'scanRaw', label: 'Camera RAW', description: 'Scan for .cr2, .cr3, .nef, .arw, .dng files' },
  { key: 'scanVideo', label: 'Video files', description: 'Scan for .ser, .avi planetary/lunar captures' },
  { key: 'extractMetadata', label: 'Extract metadata', description: 'Read FITS/XISF headers during scan' },
  { key: 'inferSessions', label: 'Infer sessions', description: 'Group files into acquisition sessions automatically' },
];

export function StepScan({ settings, onSettingsChange, onNext, onBack }: StepScanProps) {
  function toggle(key: keyof ScanSettings) {
    onSettingsChange({ ...settings, [key]: !settings[key] });
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: 'var(--alm-text-lg)', fontWeight: 600, marginBottom: 'var(--alm-space-2)' }}>
        Scan Settings
      </h2>
      <p style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', marginBottom: 'var(--alm-space-5)' }}>
        Choose what to look for during the initial library scan. You can change these later.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-4)', marginBottom: 'var(--alm-space-7)' }}>
        {SCAN_OPTIONS.map((option) => (
          <div
            key={option.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--alm-space-3)',
              padding: 'var(--alm-space-3) var(--alm-space-4)',
              background: 'var(--alm-surface)',
              borderRadius: 'var(--alm-radius-sm)',
              border: '1px solid var(--alm-border)',
            }}
          >
            <div>
              <div style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 500 }}>
                {option.label}
              </div>
              <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
                {option.description}
              </div>
            </div>
            <Switch.Root
              checked={settings[option.key]}
              onCheckedChange={() => toggle(option.key)}
              className="alm-switch"
              aria-label={option.label}
              style={{
                width: 36,
                height: 20,
                borderRadius: 10,
                background: settings[option.key] ? 'var(--alm-gray-900)' : 'var(--alm-gray-200)',
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
                  left: settings[option.key] ? 18 : 2,
                  transition: 'left 150ms',
                }}
              />
            </Switch.Root>
          </div>
        ))}
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button className="alm-btn alm-btn--ghost" onClick={onBack}>
          Back
        </Button>
        <Button className="alm-btn alm-btn--primary" onClick={onNext}>
          Continue
        </Button>
      </div>
    </div>
  );
}
