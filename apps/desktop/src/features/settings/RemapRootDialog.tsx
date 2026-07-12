/**
 * RemapRootDialog — Data Sources "Remap" flow (P6a).
 *
 * Two-step preview → apply flow over `roots.remap` / `roots.remap.apply`:
 *  1. Pick a new path for the root (native directory picker via `DirPicker`).
 *  2. "Verify" calls `roots.remap`, which samples relative paths from the
 *     current root and reports whether each is found under the new path.
 *  3. "Apply remap" calls `roots.remap.apply` with the preview's `allVerified`
 *     flag, then reloads the roots list and closes.
 *
 * Editing the path after a preview invalidates it (forces a fresh Verify)
 * so Apply never fires against a stale/mismatched preview.
 */

import { useEffect, useState } from 'react';
import { Modal } from '@/components';
import { Btn, Banner, Pill } from '@/ui';
import { DirPicker } from '@/ui/DirPicker';
import { remapRoot, applyRootRemap } from './settingsIpc';
import type { RemapVerification } from './settingsIpc';
import type { LibraryRoot } from '@/bindings/types';
import { errMessage } from '@/lib/errors';
import { m } from '@/lib/i18n';

export interface RemapRootDialogProps {
  /** Root being remapped; `null` keeps the dialog closed. */
  root: LibraryRoot | null;
  onClose: () => void;
  /** Called after a successful apply so the caller can reload the roots list. */
  onApplied: () => void;
}

export function RemapRootDialog({
  root,
  onClose,
  onApplied,
}: RemapRootDialogProps) {
  const [newPath, setNewPath] = useState('');
  const [verification, setVerification] = useState<RemapVerification | null>(
    null,
  );
  const [verifying, setVerifying] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset dialog-local state whenever a new root is targeted.
  useEffect(() => {
    setNewPath('');
    setVerification(null);
    setVerifying(false);
    setApplying(false);
    setError(null);
  }, [root?.id]);

  if (!root) return null;

  const handlePathChange = (path: string) => {
    setNewPath(path);
    // Any path edit invalidates the previous preview — force a fresh Verify.
    setVerification(null);
    setError(null);
  };

  const handleVerify = async () => {
    const trimmed = newPath.trim();
    if (!trimmed) return;
    setVerifying(true);
    setError(null);
    try {
      const result = await remapRoot({ rootId: root.id, newPath: trimmed });
      setVerification(result);
    } catch (err: unknown) {
      setVerification(null);
      setError(errMessage(err));
    } finally {
      setVerifying(false);
    }
  };

  const handleApply = async () => {
    if (!verification) return;
    setApplying(true);
    setError(null);
    try {
      await applyRootRemap({
        rootId: root.id,
        newPath: verification.newPath,
        verified: verification.allVerified,
      });
      onApplied();
      onClose();
    } catch (err: unknown) {
      setError(errMessage(err));
    } finally {
      setApplying(false);
    }
  };

  const pathUnchanged = newPath.trim() === '' || newPath.trim() === root.path;

  return (
    <Modal
      open
      onClose={onClose}
      title={m.settings_datasources_remap_title()}
      subtitle={root.path}
      size="md"
      ariaLabel={m.settings_datasources_remap_title()}
      data-testid="remap-root-dialog"
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={applying}>
            {m.common_cancel()}
          </Btn>
          <Btn
            onClick={() => void handleVerify()}
            disabled={pathUnchanged || verifying || applying}
          >
            {verifying
              ? m.settings_datasources_remap_verifying()
              : m.settings_datasources_remap_verify_btn()}
          </Btn>
          <Btn
            variant="primary"
            onClick={() => void handleApply()}
            disabled={!verification || verifying || applying}
          >
            {applying
              ? m.common_applying()
              : m.settings_datasources_remap_apply_btn()}
          </Btn>
        </>
      }
    >
      <div className="alm-remap-dialog__field">
        <span className="alm-remap-dialog__field-label">
          {m.settings_datasources_remap_current_path_label()}
        </span>
        <code className="alm-mono">{root.path}</code>
      </div>

      <DirPicker
        value={newPath}
        onChange={handlePathChange}
        label={m.settings_datasources_remap_new_path_label()}
        lastPathKind={root.category}
      />

      {error && (
        <Banner variant="danger" className="alm-remap-dialog__banner">
          {m.settings_datasources_remap_error({ error })}
        </Banner>
      )}

      {verification && !error && (
        <>
          <Banner
            variant={verification.allVerified ? 'info' : 'warn'}
            className="alm-remap-dialog__banner"
          >
            {verification.allVerified
              ? m.settings_datasources_remap_all_verified()
              : m.settings_datasources_remap_not_all_verified()}
          </Banner>
          <ul className="alm-remap-dialog__samples">
            {verification.samples.map((sample) => (
              <li
                key={sample.relativePath}
                className="alm-remap-dialog__sample-row"
              >
                <code className="alm-mono">{sample.relativePath}</code>
                <Pill variant={sample.found ? 'ok' : 'warn'}>
                  {sample.found
                    ? m.settings_datasources_remap_found()
                    : m.settings_datasources_remap_not_found()}
                </Pill>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
