import type { ReviewItem } from '@/api/types';
import { KV } from '@/ui';

export interface EvidencePaneProps {
  item: ReviewItem | null;
}

/**
 * Center pane showing evidence for the active review item.
 * Displays metadata KV rows with provenance glyphs for sessions,
 * or file path and suggested matches for unclassified files.
 * Shows a blocking-reason banner when reasons exist.
 */
export function EvidencePane({ item }: EvidencePaneProps) {
  if (!item) {
    return (
      <div className="alm-evidence-pane alm-evidence-pane--empty" style={{ padding: 24 }}>
        <p style={{ color: 'var(--alm-text-muted)' }}>Select an item from the queue to review.</p>
      </div>
    );
  }

  return (
    <div className="alm-evidence-pane" style={{ padding: 16, overflow: 'auto', height: '100%' }}>
      {/* Blocking reasons banner */}
      {item.blocking_reasons.length > 0 && (
        <div
          className="alm-evidence-pane__blocking-banner"
          role="alert"
          style={{
            padding: '8px 12px',
            marginBottom: 16,
            background: 'var(--alm-warn-bg, #fef3cd)',
            border: '1px solid var(--alm-warn, #f0ad4e)',
            borderRadius: 4,
            fontSize: 'var(--alm-text-sm)',
          }}
        >
          <strong>Cannot confirm:</strong>{' '}
          {item.blocking_reasons.join('; ')}
        </div>
      )}

      {/* Session evidence */}
      {item.kind === 'session' && (
        <section>
          <h3 style={{ fontSize: 'var(--alm-text-sm)', marginBottom: 8, fontWeight: 600 }}>
            Session Evidence
          </h3>
          {item.suggested_target && (
            <KV label="Suggested Target" value={item.suggested_target} />
          )}
          {item.suggested_filter && (
            <KV label="Suggested Filter" value={item.suggested_filter} />
          )}
          <div style={{ marginTop: 12 }}>
            {Object.entries(item.evidence).map(([key, meta]) => (
              <KV
                key={key}
                label={key.replace(/_/g, ' ')}
                value={String(meta.value)}
                origin={meta.origin}
                confidence={meta.confidence}
              />
            ))}
          </div>
        </section>
      )}

      {/* Unclassified file evidence */}
      {item.kind === 'unclassified_file' && (
        <section>
          <h3 style={{ fontSize: 'var(--alm-text-sm)', marginBottom: 8, fontWeight: 600 }}>
            Unclassified File
          </h3>
          {item.file_path && (
            <KV label="File Path" value={item.file_path} />
          )}
          <div style={{ marginTop: 12 }}>
            {Object.entries(item.evidence).map(([key, meta]) => (
              <KV
                key={key}
                label={key.replace(/_/g, ' ')}
                value={String(meta.value)}
                origin={meta.origin}
                confidence={meta.confidence}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
