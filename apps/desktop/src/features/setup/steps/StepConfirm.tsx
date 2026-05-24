import { Button } from '@base-ui-components/react/button';
import type { SourceEntry } from './StepSources';
import type { ScanSettings } from './StepScan';

export interface StepConfirmProps {
  sources: SourceEntry[];
  scanSettings: ScanSettings;
  onComplete: () => void;
  onBack: () => void;
  isSubmitting: boolean;
}

function estimateScanTime(sources: SourceEntry[]): string {
  const totalFiles = sources.reduce((sum, s) => sum + (s.estimatedFiles ?? 0), 0);
  if (totalFiles < 500) return 'Less than a minute';
  if (totalFiles < 5000) return '1-3 minutes';
  if (totalFiles < 20000) return '3-10 minutes';
  return '10+ minutes';
}

export function StepConfirm({ sources, scanSettings, onComplete, onBack, isSubmitting }: StepConfirmProps) {
  const totalFiles = sources.reduce((sum, s) => sum + (s.estimatedFiles ?? 0), 0);
  const enabledScanTypes = Object.entries(scanSettings)
    .filter(([, v]) => v)
    .map(([k]) => k);

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: 'var(--alm-text-lg)', fontWeight: 600, marginBottom: 'var(--alm-space-2)' }}>
        Ready to Go
      </h2>
      <p style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', marginBottom: 'var(--alm-space-5)' }}>
        Review your configuration before starting the initial scan.
      </p>

      {/* Sources summary */}
      <div style={{
        marginBottom: 'var(--alm-space-5)',
        padding: 'var(--alm-space-4)',
        background: 'var(--alm-surface)',
        borderRadius: 'var(--alm-radius-sm)',
        border: '1px solid var(--alm-border)',
      }}>
        <h3 style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 600, marginBottom: 'var(--alm-space-3)' }}>
          Library Sources ({sources.length})
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-2)' }}>
          {sources.map((source, i) => (
            <div key={`${source.path}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-space-3)' }}>
              <span style={{
                fontSize: 'var(--alm-text-xs)',
                padding: '1px 6px',
                borderRadius: 'var(--alm-radius-sm)',
                background: 'var(--alm-gray-100)',
                textTransform: 'capitalize',
                minWidth: 72,
                textAlign: 'center',
              }}>
                {source.category}
              </span>
              <span style={{
                fontSize: 'var(--alm-text-xs)',
                fontFamily: 'var(--alm-font-mono)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}>
                {source.path}
              </span>
              {source.estimatedFiles != null && (
                <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', flexShrink: 0 }}>
                  ~{source.estimatedFiles.toLocaleString()} files
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Scan settings summary */}
      <div style={{
        marginBottom: 'var(--alm-space-5)',
        padding: 'var(--alm-space-4)',
        background: 'var(--alm-surface)',
        borderRadius: 'var(--alm-radius-sm)',
        border: '1px solid var(--alm-border)',
      }}>
        <h3 style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 600, marginBottom: 'var(--alm-space-3)' }}>
          Scan Configuration
        </h3>
        <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', lineHeight: 1.6 }}>
          <div>{enabledScanTypes.length} scan options enabled</div>
          <div>~{totalFiles.toLocaleString()} estimated total files</div>
          <div>Estimated time: {estimateScanTime(sources)}</div>
        </div>
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button className="alm-btn alm-btn--ghost" onClick={onBack} disabled={isSubmitting}>
          Back
        </Button>
        <Button
          className="alm-btn alm-btn--primary"
          onClick={onComplete}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Setting up...' : 'Complete setup'}
        </Button>
      </div>
    </div>
  );
}
