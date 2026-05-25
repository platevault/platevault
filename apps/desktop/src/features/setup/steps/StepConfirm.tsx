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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 'var(--alm-space-4)',
        background: 'var(--alm-surface)',
        borderRadius: 'var(--alm-radius-sm)',
        border: '1px solid var(--alm-border)',
      }}
    >
      <h3 style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 600, marginBottom: 'var(--alm-space-3)' }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px dotted var(--alm-border)' }}>
      <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>{label}</span>
      <span style={{ fontSize: 'var(--alm-text-xs)' }}>{value}</span>
    </div>
  );
}

export function StepConfirm({
  categories,
  catalogSettings,
  scanSettings,
  isSubmitting,
}: StepConfirmProps) {
  const foldersByCategory = categories.filter((c) => c.paths.some(Boolean));
  const totalFolders = categories.reduce((sum, c) => sum + c.paths.filter(Boolean).length, 0);

  const enabledCatalogs = (Object.keys(CATALOG_LABELS) as Array<keyof typeof CATALOG_LABELS>)
    .filter((key) => catalogSettings[key]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-5)' }}>
      {/* Sources summary */}
      <Card title={`Library sources (${totalFolders} folder${totalFolders !== 1 ? 's' : ''})`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-3)' }}>
          {foldersByCategory.map((cat) => (
            <div key={cat.key}>
              <div style={{ fontSize: 'var(--alm-text-xs)', fontWeight: 600, color: 'var(--alm-text-muted)', textTransform: 'uppercase', marginBottom: 'var(--alm-space-1)' }}>
                {cat.label}
              </div>
              {cat.paths.filter(Boolean).map((p, j) => (
                <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-space-3)', marginBottom: 2 }}>
                  <span style={{ fontSize: 'var(--alm-text-xs)', fontFamily: 'var(--alm-font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {p}
                  </span>
                  {cat.estimates[j] > 0 && (
                    <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', flexShrink: 0 }}>
                      ~{cat.estimates[j].toLocaleString()} files
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
          {foldersByCategory.length === 0 && (
            <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
              No folders configured (you can add them later in Settings)
            </div>
          )}
        </div>
      </Card>

      {/* Catalogs summary */}
      <Card title={`Target catalogs (${enabledCatalogs.length} enabled)`}>
        <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', lineHeight: 1.6 }}>
          <div>{enabledCatalogs.length > 0 ? enabledCatalogs.map((k) => CATALOG_LABELS[k]).join(', ') : 'No catalogs selected'}</div>
          <div style={{ marginTop: 'var(--alm-space-1)' }}>
            SIMBAD online lookup: {catalogSettings.simbadOnline ? 'Enabled' : 'Disabled'}
          </div>
        </div>
      </Card>

      {/* Scan configuration summary */}
      <Card title="Scan configuration">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Row label="Session grouping" value={GROUPING_LABELS[scanSettings.groupingStrategy]} />
          <Row label="Target resolution" value={scanSettings.targetResolution ? 'On — matches flagged for manual review' : 'Off'} />
          <Row label="Calibration discovery" value={scanSettings.calibrationDiscovery ? 'On' : 'Off'} />
          <Row label="Equipment detection" value={scanSettings.equipmentDetection ? 'On' : 'Off'} />
          <Row label="Symlink following" value={scanSettings.followSymlinks ? 'On' : 'Off'} />
        </div>
      </Card>

      {/* What we'll discover — preview of initial data load */}
      <Card title="What the initial scan will produce">
        <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', lineHeight: 1.8 }}>
          <div>Based on your configuration, the first scan will:</div>
          <ul style={{ margin: 'var(--alm-space-2) 0 0 var(--alm-space-4)', padding: 0 }}>
            <li>Index all FITS, XISF, and video files in your registered folders</li>
            <li>Extract metadata from every file header (OBJECT, FILTER, EXPTIME, GAIN, camera, telescope, etc.)</li>
            <li>Group light frames into <strong>acquisition sessions</strong> using the {GROUPING_LABELS[scanSettings.groupingStrategy].toLowerCase()} strategy</li>
            <li>Resolve OBJECT header values against {enabledCatalogs.length > 0 ? enabledCatalogs.map((k) => CATALOG_LABELS[k]).join(', ') : 'local catalogs'}{catalogSettings.simbadOnline ? ' + SIMBAD online' : ''}</li>
            {scanSettings.calibrationDiscovery && (
              <li>Discover and fingerprint <strong>calibration masters</strong> (darks, flats, bias, dark flats) for matching</li>
            )}
            {scanSettings.equipmentDetection && (
              <li>Detect <strong>optical trains</strong> from header metadata (camera + telescope + filter wheel combos)</li>
            )}
            <li>Flag all discovered sessions and unclassified files for <strong>manual review</strong> in the Review queue</li>
          </ul>
          <div style={{ marginTop: 'var(--alm-space-3)', padding: 'var(--alm-space-3)', background: 'var(--alm-bg)', border: '1px solid var(--alm-border)', borderRadius: 'var(--alm-radius-sm)' }}>
            <strong>Nothing is moved or modified.</strong> The scan only reads file headers and builds an index. Your files stay exactly where they are.
          </div>
        </div>
      </Card>

      {isSubmitting && (
        <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', textAlign: 'center' }}>
          Registering roots and starting scan...
        </div>
      )}
    </div>
  );
}
