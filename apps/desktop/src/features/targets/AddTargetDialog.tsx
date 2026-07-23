// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * AddTargetDialog — spec 036 "Add target" action.
 *
 * Lets the user search for an astronomical target (via the existing
 * TargetSearch / SIMBAD two-phase pipeline) and confirm a selection.
 * Confirming is the explicit in-use commit (spec 052 P1 FR-004): `target.
 * search`/`target.resolve` no longer persist a `canonical_target` row on
 * their own (they only populate the shared redb resolve cache), so the
 * confirm click calls `target.adopt` with the selected suggestion's
 * `targetId` to promote it into the durable table. On success the dialog
 * closes and calls `onAdded(targetId)` so the page can reload the list and
 * navigate to the new target.
 *
 * Reuses `TargetSearch` (spec 035 US1/US3) unchanged.
 */

import { useState, useCallback, useRef } from 'react';
import { m } from '@/lib/i18n';
import { Btn, Pill } from '@/ui';
import { Modal, TargetSearch } from '@/components';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import { errMessage } from '@/lib/errors';
import type { TargetSuggestion } from '@/bindings/aliases';

export interface AddTargetDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after the target has been resolved and persisted, with its id. */
  onAdded: (targetId: string) => void;
}

export function AddTargetDialog({
  open,
  onClose,
  onAdded,
}: AddTargetDialogProps) {
  const [pending, setPending] = useState<TargetSuggestion | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // #841: point the dialog's initial focus directly at the search input
  // instead of racing Base UI's own default (first tabbable = the ✕ close
  // button) with a bare `autoFocus`.
  const searchInputRef = useRef<HTMLInputElement>(null);

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
      const res = unwrap(
        await commands.targetAdopt({
          requestId: crypto.randomUUID(),
          targetId: pending.targetId,
        }),
      );
      if (res.adopted) {
        handleOpenChange(false);
        onAdded(res.targetId);
      } else {
        setError(
          m.targets_add_resolve_failed({ query: pending.primaryDesignation }),
        );
      }
    } catch (err: unknown) {
      setError(m.targets_add_failed({ message: errMessage(err) }));
    } finally {
      setResolving(false);
    }
  }, [pending, handleOpenChange, onAdded]);

  return (
    <Modal
      open={open}
      onClose={() => handleOpenChange(false)}
      title={m.targets_add_target()}
      subtitle={m.targets_add_target_desc()}
      size="md"
      className="pv-add-target__popup"
      ariaLabel={m.targets_add_target()}
      initialFocus={searchInputRef}
      footer={
        <>
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
        </>
      }
    >
      <div className="pv-add-target__body">
        {pending ? (
          <div>
            <span className="pv-field-label">
              {m.targets_add_target_selected()}
            </span>
            <div className="pv-add-target__selected-row">
              <Pill variant="accent">{pending.primaryDesignation}</Pill>
              {pending.commonName && (
                <span className="pv-field-hint">{pending.commonName}</span>
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
            inputRef={searchInputRef}
          />
        )}

        {error && (
          <span role="alert" className="pv-field-error">
            {error}
          </span>
        )}
      </div>
    </Modal>
  );
}
