/**
 * AddTargetDialog — spec 036 "Add target" action.
 *
 * Lets the user search for an astronomical target (via the existing
 * TargetSearch / SIMBAD two-phase pipeline) and confirm a selection, which
 * resolves + persists a `canonical_target` via `target.resolve`.  On success
 * the dialog closes and calls `onAdded(targetId)` so the page can reload
 * the list and navigate to the new target.
 *
 * Reuses `TargetSearch` (spec 035 US1/US3) unchanged.  No new backend
 * commands are required: `target.search` supplies suggestions and
 * `target.resolve` persists the canonical row.
 */

import { useState, useCallback } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { m } from '@/lib/i18n';
import { Btn, Pill } from '@/ui';
import { TargetSearch } from '@/components';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type { TargetSuggestion } from '@/bindings/aliases';

/** Contract version for the spec-035 `target.*` resolution commands. */
const TARGET_SEARCH_CONTRACT_VERSION = '1.0';

export interface AddTargetDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after the target has been resolved and persisted, with its id. */
  onAdded: (targetId: string) => void;
}

export function AddTargetDialog({ open, onClose, onAdded }: AddTargetDialogProps) {
  const [pending, setPending] = useState<TargetSuggestion | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPending(null);
    setResolving(false);
    setError(null);
  }, []);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        reset();
        onClose();
      }
    },
    [onClose, reset],
  );

  const handleSelect = useCallback((s: TargetSuggestion) => {
    setPending(s);
    setError(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!pending) return;
    setResolving(true);
    setError(null);
    try {
      const res = unwrap(await commands.targetResolve({
        contractVersion: TARGET_SEARCH_CONTRACT_VERSION,
        requestId: crypto.randomUUID(),
        query: pending.primaryDesignation,
        override: null,
      }));
      if (res.status === 'resolved' && res.target) {
        handleOpenChange(false);
        onAdded(res.target.targetId);
      } else {
        setError(
          m.targets_add_resolve_failed({ query: pending.primaryDesignation }),
        );
      }
    } catch (err: unknown) {
      const code = typeof err === 'string' ? err : (err as Error)?.message ?? 'unknown';
      setError(m.targets_add_failed({ code }));
    } finally {
      setResolving(false);
    }
  }, [pending, handleOpenChange, onAdded]);

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="alm-confirm-overlay__backdrop" />
        <Dialog.Popup
          className="alm-confirm-overlay alm-add-target__popup"
          aria-label={m.targets_add_target()}
        >
          <div className="alm-confirm-overlay__header">
            <Dialog.Title className="alm-confirm-overlay__title">{m.targets_add_target()}</Dialog.Title>
            <Dialog.Description className="alm-confirm-overlay__description">
              {m.targets_add_target_desc()}
            </Dialog.Description>
          </div>

          <div
            className="alm-confirm-overlay__body alm-add-target__body"
          >
            {pending ? (
              <div>
                <span className="alm-field-label">{m.targets_add_target_selected()}</span>
                <div className="alm-add-target__selected-row">
                  <Pill variant="accent">{pending.primaryDesignation}</Pill>
                  {pending.commonName && (
                    <span className="alm-field-hint">{pending.commonName}</span>
                  )}
                  <Btn type="button" variant="ghost" onClick={reset}>
                    {m.common_change()}
                  </Btn>
                </div>
              </div>
            ) : (
              <TargetSearch
                label={m.targets_add_target_search_label()}
                placeholder={m.projects_create_target_search_placeholder()}
                onSelect={handleSelect}
                // eslint-disable-next-line jsx-a11y/no-autofocus -- focus management: moves focus to the search field when the Add Target dialog opens (expected modal behaviour)
                autoFocus
              />
            )}

            {error && (
              <span role="alert" className="alm-field-error">
                {error}
              </span>
            )}
          </div>

          <div className="alm-confirm-overlay__footer">
            <Btn
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={resolving}
            >
              {m.common_cancel()}
            </Btn>
            <Btn
              type="button"
              variant="primary"
              disabled={!pending || resolving}
              onClick={() => void handleConfirm()}
            >
              {resolving ? m.common_adding() : m.targets_add_target()}
            </Btn>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
