// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Post-creation source add/remove state + actions for EditProjectPane
 * (WP-008-C, extracted #1000).
 *
 * Removing the project's last source requires an inline confirm step
 * (`lifecycle.last_confirmed_source`). Resets its own transient UI state
 * whenever `project` changes (e.g. after an add/remove refetch) so a stale
 * confirm/add selection doesn't linger.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ProjectDetailDto } from '@/bindings/index';
import {
  callAddProjectSource,
  callRemoveProjectSource,
} from '@/features/projects/store';
import { errMessage, isContractError } from '@/lib/errors';

export function useEditProjectSources(project: ProjectDetailDto) {
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [removeBusyId, setRemoveBusyId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [showAddSources, setShowAddSources] = useState(false);
  const [addSelection, setAddSelection] = useState<string[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);

  useEffect(() => {
    setSourceError(null);
    setConfirmRemoveId(null);
    setAddError(null);
    setAddSelection([]);
  }, [project]);

  const linkedSessionIds = project.sources.map((s) => s.inventoryId);

  const handleRemoveSource = useCallback(
    async (inventoryId: string, confirmLastSource: boolean) => {
      if (removeBusyId) return;
      setSourceError(null);
      setRemoveBusyId(inventoryId);
      try {
        await callRemoveProjectSource({
          requestId: crypto.randomUUID(),
          projectId: project.id,
          projectSourceId: inventoryId,
          confirmLastSource,
        });
        setConfirmRemoveId(null);
      } catch (err: unknown) {
        if (
          isContractError(err) &&
          err.code === 'lifecycle.last_confirmed_source' &&
          !confirmLastSource
        ) {
          setConfirmRemoveId(inventoryId);
        } else {
          setConfirmRemoveId(null);
          setSourceError(errMessage(err));
        }
      } finally {
        setRemoveBusyId(null);
      }
    },
    [removeBusyId, project.id],
  );

  const handleAddSources = useCallback(async () => {
    if (addBusy || addSelection.length === 0) return;
    // Defensive: drop anything that landed in a previous partial attempt
    // (re-derived from the latest project prop, not mutated mid-loop) so a
    // retry after a failure doesn't re-request an already-linked session.
    const idsToAdd = addSelection.filter(
      (id) => !linkedSessionIds.includes(id),
    );
    if (idsToAdd.length === 0) {
      setShowAddSources(false);
      setAddSelection([]);
      return;
    }
    setAddError(null);
    setAddBusy(true);
    try {
      for (const inventorySessionId of idsToAdd) {
        // eslint-disable-next-line no-await-in-loop -- the backend links one
        // session per call; sources must be added sequentially.
        await callAddProjectSource({
          requestId: crypto.randomUUID(),
          projectId: project.id,
          inventorySessionId,
        });
      }
      setShowAddSources(false);
      setAddSelection([]);
    } catch (err: unknown) {
      setAddError(errMessage(err));
    } finally {
      setAddBusy(false);
    }
  }, [addBusy, addSelection, linkedSessionIds, project.id]);

  return {
    linkedSessionIds,
    sourceError,
    removeBusyId,
    confirmRemoveId,
    setConfirmRemoveId,
    showAddSources,
    setShowAddSources,
    addSelection,
    setAddSelection,
    addError,
    setAddError,
    addBusy,
    handleRemoveSource,
    handleAddSources,
  };
}
