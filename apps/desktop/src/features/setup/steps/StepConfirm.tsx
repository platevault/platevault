import type { SourceCategory } from './StepSources';
import type { CatalogSettings } from './StepCatalogs';
import type { ScanSettings } from './StepScan';

export interface StepConfirmProps {
  categories: SourceCategory[];
  catalogSettings: CatalogSettings;
  scanSettings: ScanSettings;
  isSubmitting: boolean;
}

const CATALOG_LABELS: Record<keyof Omit<CatalogSettings, 'simbadOnline'>, string> = {
  openngc: 'OpenNGC',
  messier: 'Messier',
  sharpless: 'Sharpless',
  barnard: 'Barnard',
  lbn: 'LBN',
  ldn: 'LDN',
};

const GROUPING_LABELS: Record<ScanSettings['groupingStrategy'], string> = {
  standard: 'Standard (target + filter + night + train)',
  night_only: 'By night only',
  target_only: 'By target only',
};

function estimateScanTime(totalFiles: number): string {
  if (totalFiles < 500) return 'Less than a minute';
  if (totalFiles < 5000) return '1-3 minutes';
  if (totalFiles < 20000) return '3-10 minutes';
  return '10+ minutes';
}

/**
 * Step 5 — Confirm before starting the scan.
 * Shows a summary of sources, catalog settings, and scan/discovery settings.
 *
 * The parent SetupWizard renders the step heading and navigation footer
 * (which includes the "Complete setup" primary button).
 */
export function StepConfirm({
  categories,
  catalogSettings,
  scanSettings,
  isSubmitting,
}: StepConfirmProps) {
  const totalFolders = categories.reduce((sum, c) => sum + c.paths.filter(Boolean).length, 0);
  const totalFiles = categories.reduce(
    (sum, c) => sum + c.estimates.reduce((a, b) => a + b, 0),
    0,
  );

  const enabledCatalogs = (Object.keys(CATALOG_LABELS) as Array<keyof typeof CATALOG_LABELS>)
    .filter((key) => catalogSettings[key]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-5)' }}>
      {/* Sources summary */}
      <div
        style={{
          padding: 'var(--alm-space-4)',
          background: 'var(--alm-surface)',
          borderRadius: 'var(--alm-radius-sm)',
          border: '1px solid var(--alm-border)',
        }}
      >
        <h3
          style={{
            fontSize: 'var(--alm-text-sm)',
            fontWeight: 600,
            marginBottom: 'var(--alm-space-3)',
          }}
        >
          Library Sources ({totalFolders} folder{totalFolders !== 1 ? 's' : ''})
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-2)' }}>
          {categories
            .filter((c) => c.paths.some(Boolean))
            .map((cat) => (
              <div key={cat.key}>
                <div
                  style={{
                    fontSize: 'var(--alm-text-xs)',
                    fontWeight: 600,
                    color: 'var(--alm-text-muted)',
                    textTransform: 'uppercase',
                    marginBottom: 'var(--alm-space-1)',
                  }}
                >
                  {cat.label}
                </div>
                {cat.paths.filter(Boolean).map((p, j) => (
                  <div
                    key={j}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--alm-space-3)',
                      marginBottom: 'var(--alm-space-1)',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 'var(--alm-text-xs)',
                        fontFamily: 'var(--alm-font-mono)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                      }}
                    >
                      {p}
                    </span>
                    {cat.estimates[j] > 0 && (
                      <span
                        style={{
                          fontSize: 'var(--alm-text-xs)',
                          color: 'var(--alm-text-muted)',
                          flexShrink: 0,
                        }}
                      >
                        ~{cat.estimates[j].toLocaleString()} files
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>

      {/* Catalogs summary */}
      <div
        style={{
          padding: 'var(--alm-space-4)',
          background: 'var(--alm-surface)',
          borderRadius: 'var(--alm-radius-sm)',
          border: '1px solid var(--alm-border)',
        }}
      >
        <h3
          style={{
            fontSize: 'var(--alm-text-sm)',
            fontWeight: 600,
            marginBottom: 'var(--alm-space-3)',
          }}
        >
          Target Catalogs ({enabledCatalogs.length} enabled)
        </h3>
        <div
          style={{
            fontSize: 'var(--alm-text-xs)',
            color: 'var(--alm-text-muted)',
            lineHeight: 1.6,
          }}
        >
          <div>
            {enabledCatalogs.length > 0
              ? enabledCatalogs.map((k) => CATALOG_LABELS[k]).join(', ')
              : 'No catalogs selected'}
          </div>
          <div style={{ marginTop: 'var(--alm-space-1)' }}>
            SIMBAD online lookup: {catalogSettings.simbadOnline ? 'Enabled' : 'Disabled'}
          </div>
        </div>
      </div>

      {/* Scan settings summary */}
      <div
        style={{
          padding: 'var(--alm-space-4)',
          background: 'var(--alm-surface)',
          borderRadius: 'var(--alm-radius-sm)',
          border: '1px solid var(--alm-border)',
        }}
      >
        <h3
          style={{
            fontSize: 'var(--alm-text-sm)',
            fontWeight: 600,
            marginBottom: 'var(--alm-space-3)',
          }}
        >
          Scan Configuration
        </h3>
        <div
          style={{
            fontSize: 'var(--alm-text-xs)',
            color: 'var(--alm-text-muted)',
            lineHeight: 1.8,
          }}
        >
          <div>
            <strong>Session grouping:</strong> {GROUPING_LABELS[scanSettings.groupingStrategy]}
          </div>
          <div>
            <strong>Target resolution:</strong>{' '}
            {scanSettings.targetResolution
              ? scanSettings.ambiguityHandling === 'flag_review'
                ? 'On — flag ambiguous matches for review'
                : 'On — auto-pick best match'
              : 'Off'}
          </div>
          <div>
            <strong>Calibration discovery:</strong>{' '}
            {scanSettings.calibrationDiscovery ? 'On' : 'Off'}
          </div>
          <div>
            <strong>Equipment detection:</strong>{' '}
            {scanSettings.equipmentDetection ? 'On' : 'Off'}
          </div>
          <div>
            <strong>Symlink following:</strong>{' '}
            {scanSettings.followSymlinks ? 'On' : 'Off'}
          </div>
          {totalFiles > 0 && (
            <>
              <div style={{ marginTop: 'var(--alm-space-2)' }}>
                ~{totalFiles.toLocaleString()} estimated total files
              </div>
              <div>Estimated time: {estimateScanTime(totalFiles)}</div>
            </>
          )}
        </div>
      </div>

      {isSubmitting && (
        <div
          style={{
            fontSize: 'var(--alm-text-xs)',
            color: 'var(--alm-text-muted)',
            textAlign: 'center',
          }}
        >
          Registering roots and starting scan...
        </div>
      )}
    </div>
  );
}
