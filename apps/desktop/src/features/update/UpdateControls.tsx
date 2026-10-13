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
import {
  canInstall,
  checkForUpdate,
  installUpdateNow,
  installUpdateOnQuit,
  restartPendingUpdate,
  type UpdateState,
} from '@/data/updateSubscription';

/** The status line for `state`. */
export function updateStatusMessage(state: UpdateState): string {
  const version = state.version ?? '';
  const message = state.error ?? '';
  switch (state.phase) {
    case 'idle':
      return m.settings_advanced_updates_not_checked();
    case 'up-to-date':
      return m.settings_advanced_updates_uptodate();
    case 'checking':
      return m.settings_advanced_updates_checking();
    case 'check-failed':
      return m.settings_advanced_updates_checkfailed({ message });
    case 'available':
      return m.settings_advanced_updates_available({ version });
    case 'downloading':
      return m.settings_advanced_updates_downloading({ version });
    case 'download-failed':
      return m.settings_advanced_updates_downloadfailed({ message });
    case 'installing':
      return m.settings_advanced_updates_installing({ version });
    case 'install-failed':
      return m.settings_advanced_updates_installfailed({ message });
    case 'install-on-quit':
      return m.settings_advanced_updates_queued({ version });
    case 'restart-failed':
      return m.settings_advanced_updates_restartfailed();
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
      {state.phase === 'restart-failed' && (
        <Btn
          size="sm"
          onClick={() => void run(restartPendingUpdate)}
          disabled={busy}
          data-testid={`${testIdPrefix}-restart-btn`}
        >
          {busy ? m.common_restarting() : m.settings_advanced_updates_restart()}
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
