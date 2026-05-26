import type { SourcesState, SourceKind } from '../sources-store';
import type { CatalogSettings } from './StepCatalogs';

export interface StepConfirmProps {
  sources: SourcesState;
  catalogSettings: CatalogSettings;
  isSubmitting: boolean;
}

const KIND_LABELS: Record<SourceKind, string> = {
  raw: 'Raw sources',
  calibration: 'Calibration sources',
  project: 'Project sources',
  inbox: 'Inbox sources',
};

const CATALOG_LABELS: Record<keyof Omit<CatalogSettings, 'simbadOnline'>, string> = {
  openngc: 'OpenNGC',
  messier: 'Messier',
  sharpless: 'Sharpless',
  barnard: 'Barnard',
  lbn: 'LBN',
  ldn: 'LDN',
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

export function StepConfirm({
  sources,
  catalogSettings,
  isSubmitting,
}: StepConfirmProps) {
  const allKinds: SourceKind[] = ['raw', 'calibration', 'project', 'inbox'];
  const kindsWithPaths = allKinds.filter((k) => sources[k].length > 0);
  const totalFolders = allKinds.reduce((sum, k) => sum + sources[k].length, 0);

  const enabledCatalogs = (Object.keys(CATALOG_LABELS) as Array<keyof typeof CATALOG_LABELS>)
    .filter((key) => catalogSettings[key]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-5)' }}>
      {/* Sources summary */}
      <Card title={`Library sources (${totalFolders} folder${totalFolders !== 1 ? 's' : ''})`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-3)' }}>
          {kindsWithPaths.map((kind) => (
            <div key={kind}>
              <div style={{ fontSize: 'var(--alm-text-xs)', fontWeight: 600, color: 'var(--alm-text-muted)', textTransform: 'uppercase', marginBottom: 'var(--alm-space-1)' }}>
                {KIND_LABELS[kind]}
              </div>
              {sources[kind].map((entry, j) => (
                <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-space-3)', marginBottom: 2 }}>
                  <span style={{ fontSize: 'var(--alm-text-xs)', fontFamily: 'var(--alm-font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {entry.path}
                  </span>
                  <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', flexShrink: 0 }}>
                    {entry.scanDepth === 'recursive' ? 'Recursive' : 'Single level'}
                  </span>
                </div>
              ))}
            </div>
          ))}
          {kindsWithPaths.length === 0 && (
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

      {/* What happens next */}
      <Card title="What happens next">
        <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', lineHeight: 1.8 }}>
          <div>When you complete setup, the app will:</div>
          <ul style={{ margin: 'var(--alm-space-2) 0 0 var(--alm-space-4)', padding: 0 }}>
            <li>Register all selected folders as library roots</li>
            <li>Index all FITS, XISF, and video files in your registered folders</li>
            <li>Extract metadata from every file header</li>
            <li>Group light frames into acquisition sessions</li>
            <li>Flag all discovered sessions for manual review</li>
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
