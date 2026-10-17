// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Update status copy and actions (astro-plan-mkkgi), shared by the shell
 * update notice and Settings > Advanced so both offer the same choice for
 * each phase: Install now or Install on quit, never an implicit install.
 */

import { useState } from 'react';
import { Btn } from '@/ui';
import { m } from '@/lib/i18n';
import type { UpdateFailure } from '@/bindings/index';
import {
  canInstall,
  checkForUpdate,
  installUpdateNow,
  installUpdateOnQuit,
  type UpdateState,
} from '@/data/updateSubscription';

/**
 * Why the last step failed, in the user's language. The backend sends a code;
 * its English detail stays in the log.
 */
export function updateFailureMessage(failure: UpdateFailure | null): string {
  switch (failure?.code) {
    case undefined:
      return m.update_error_unknown();
    case 'network':
      return m.update_error_network();
    case 'manifest':
      return m.update_error_manifest();
    case 'signature':
      return m.update_error_signature();
    case 'identity':
      return m.update_error_identity();
    case 'app-replaced':
      return failure.keptAt.length === 0
        ? m.update_error_app_replaced()
        : m.update_error_app_replaced_kept({ path: failure.keptAt.join(', ') });
    case 'permission':
      return m.update_error_permission();
    case 'install':
      return m.update_error_install();
    case 'file-system':
      return m.update_error_file_system();
    case 'unsupported':
      return m.update_error_unsupported();
    case 'previous-app-not-restored':
      return m.update_error_previous_app_not_restored({
        path: failure.keptAt,
      });
  }
}

/** The status line for `state`. */
export function updateStatusMessage(state: UpdateState): string {
  const version = state.version ?? '';
  switch (state.phase) {
    case 'idle':
      return m.settings_advanced_updates_not_checked();
    case 'up-to-date':
      return m.settings_advanced_updates_uptodate();
    case 'checking':
      return m.settings_advanced_updates_checking();
    case 'check-failed':
      return m.settings_advanced_updates_checkfailed({
        message: updateFailureMessage(state.error),
      });
    case 'available':
      return m.settings_advanced_updates_available({ version });
    case 'downloading':
      return m.settings_advanced_updates_downloading({ version });
    case 'download-failed':
      return m.settings_advanced_updates_downloadfailed({
        message: updateFailureMessage(state.error),
      });
    case 'installing':
      return m.settings_advanced_updates_installing({ version });
    case 'install-failed':
      return m.settings_advanced_updates_installfailed({
        message: updateFailureMessage(state.error),
      });
    case 'install-on-quit':
      return m.settings_advanced_updates_queued({ version });
  }
}

interface UpdateActionsProps {
  state: UpdateState;
  /** Prefix for each button's data-testid, e.g. `update` → `update-install-now-btn`. */
  testIdPrefix: string;
}

/** The actions `state` offers, as small buttons. */
export function UpdateActions({ state, testIdPrefix }: UpdateActionsProps) {
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {canInstall(state) && (
        <Btn
          size="sm"
          variant="primary"
          onClick={() => void run(installUpdateNow)}
          disabled={busy}
          data-testid={`${testIdPrefix}-install-now-btn`}
        >
          {m.settings_advanced_updates_install_now()}
        </Btn>
      )}
      {canInstall(state) && state.phase !== 'install-on-quit' && (
        <Btn
          size="sm"
          onClick={() => void run(installUpdateOnQuit)}
          disabled={busy}
          data-testid={`${testIdPrefix}-install-on-quit-btn`}
        >
          {m.settings_advanced_updates_install_on_quit()}
        </Btn>
      )}
      {state.phase === 'check-failed' && (
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => void run(checkForUpdate)}
          disabled={busy}
          data-testid={`${testIdPrefix}-retry-btn`}
        >
          {m.settings_advanced_updates_check_retry()}
        </Btn>
      )}
      {(state.phase === 'idle' || state.phase === 'up-to-date') && (
        <Btn
          size="sm"
          onClick={() => void run(checkForUpdate)}
          disabled={busy}
          data-testid={`${testIdPrefix}-check-btn`}
        >
          {m.settings_advanced_updates_check_now()}
        </Btn>
      )}
    </>
  );
}
