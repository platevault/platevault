// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * SchemaViewer — pretty-prints a JSON Schema file and allows copy to clipboard
 * (spec 021 US3).
 *
 * Schema content is fetched server-side via `dev.schema.get` so no client-side
 * filesystem plugin is needed. When the file is absent, shows a `schema.missing`
 * error state.
 */

import { useState, useEffect } from 'react';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';

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

    commands
      .devSchemaGet({ schemaPath })
      .then(unwrap)
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
      className="alm-dev-schema__overlay"
    >
      <div className="alm-dev-schema__panel">
        <div className="alm-dev-schema__header">
          <div>
            <span className="alm-dev-schema__name">{contractName}</span>
            <span className="alm-dev-schema__version">v{contractVersion}</span>
          </div>
          <div className="alm-dev-schema__actions">
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

        <div className="alm-dev-schema__body">
          {missing ? (
            <div
              role="alert"
              data-testid="schema-missing"
              className="alm-dev-schema__missing"
            >
              <strong>schema.missing</strong>
              <p className="alm-dev-schema__missing-path">
                Schema file not found at:{' '}
                <code className="alm-dev-schema__missing-code">
                  {schemaPath || '(no path)'}
                </code>
              </p>
            </div>
          ) : content === null ? (
            <div className="alm-dev-schema__loading">Loading schema…</div>
          ) : (
            <pre data-testid="schema-content" className="alm-dev-schema__pre">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
