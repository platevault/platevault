/**
 * SchemaViewer — pretty-prints a JSON Schema file and allows copy to clipboard
 * (spec 021 US3).
 *
 * Schema content is fetched server-side via `dev.schema.get` so no client-side
 * filesystem plugin is needed. When the file is absent, shows a `schema.missing`
 * error state.
 */

import { useState, useEffect } from 'react';
import { devSchemaGet } from '@/api/commands';

interface SchemaViewerProps {
  /** Absolute path to the JSON Schema file. */
  schemaPath: string;
  /** Contract version pinned on the call (may differ from registry current). */
  contractVersion: string;
  /** Contract name for display. */
  contractName: string;
  onClose: () => void;
}

export function SchemaViewer({
  schemaPath,
  contractVersion,
  contractName,
  onClose,
}: SchemaViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setMissing(false);

    devSchemaGet(schemaPath)
      .then((resp) => {
        if (cancelled) return;
        if (resp.found && resp.content != null) {
          setContent(resp.content);
        } else {
          setMissing(true);
        }
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });

    return () => {
      cancelled = true;
    };
  }, [schemaPath]);

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable in non-HTTPS context (e.g. tests).
    }
  };

  return (
    <div
      role="dialog"
      aria-label={`Schema viewer: ${contractName} v${contractVersion}`}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: 'var(--alm-surface)',
          border: '1px solid var(--alm-border)',
          borderRadius: 'var(--alm-radius)',
          width: '80vw',
          maxWidth: 900,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 'var(--alm-sp-4)',
          gap: 'var(--alm-sp-3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{contractName}</span>
            <span
              style={{
                color: 'var(--alm-text-muted)',
                marginLeft: 'var(--alm-sp-2)',
                fontSize: 'var(--alm-text-xs)',
              }}
            >
              v{contractVersion}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 'var(--alm-sp-2)' }}>
            <button
              type="button"
              className="alm-btn alm-btn--sm"
              onClick={handleCopy}
              disabled={!content}
              aria-label="Copy schema to clipboard"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              type="button"
              className="alm-btn alm-btn--sm"
              onClick={onClose}
              aria-label="Close schema viewer"
            >
              Close
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {missing ? (
            <div
              role="alert"
              data-testid="schema-missing"
              style={{
                color: 'var(--alm-danger)',
                padding: 'var(--alm-sp-4)',
                fontSize: 'var(--alm-text-sm)',
              }}
            >
              <strong>schema.missing</strong>
              <p style={{ marginTop: 'var(--alm-sp-1)' }}>
                Schema file not found at:{' '}
                <code style={{ fontFamily: 'monospace', fontSize: '0.8em' }}>
                  {schemaPath || '(no path)'}
                </code>
              </p>
            </div>
          ) : content === null ? (
            <div style={{ color: 'var(--alm-text-muted)', padding: 'var(--alm-sp-4)' }}>
              Loading schema…
            </div>
          ) : (
            <pre
              data-testid="schema-content"
              style={{
                margin: 0,
                padding: 'var(--alm-sp-2)',
                fontFamily: 'monospace',
                fontSize: 'var(--alm-text-xs)',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                background: 'var(--alm-surface-2)',
                borderRadius: 'var(--alm-radius-sm)',
              }}
            >
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
