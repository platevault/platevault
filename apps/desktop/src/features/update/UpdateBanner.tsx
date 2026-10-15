// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * UpdateBanner — the in-app update notice (astro-plan-mkkgi).
 *
 * Shown in the shell once the startup check finds an update: version, release
 * notes, and the owner-decided choice of Install now or Install on quit.
 * Nothing downloads until one of those is clicked. It follows the download,
 * install and failure phases afterwards, and "Later" hides it for that version
 * for the rest of the session (Settings > Advanced keeps the same actions).
 */

import { useState, useSyncExternalStore } from 'react';
import { Banner, Btn } from '@/ui';
import { m } from '@/lib/i18n';
import {
  getUpdateSnapshot,
  subscribeUpdate,
  type UpdatePhase,
} from '@/data/updateSubscription';
import { UpdateActions, updateStatusMessage } from './UpdateControls';
import { actions, banner, notes, text } from './UpdateBanner.css';

/** Phases worth interrupting the user's view for; check states stay in Settings. */
const SHOWN: ReadonlySet<UpdatePhase> = new Set([
  'available',
  'downloading',
  'download-failed',
  'installing',
  'install-failed',
  'install-on-quit',
]);

export function UpdateBanner() {
  const state = useSyncExternalStore(subscribeUpdate, getUpdateSnapshot);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  const version = state.version ?? '';
  if (!SHOWN.has(state.phase) || version === dismissedVersion) return null;

  return (
    <Banner
      variant="info"
      role="status"
      className={banner}
      data-testid="update-banner"
    >
      <div className={text}>
        <span data-testid="update-banner-status">
          {updateStatusMessage(state)}
        </span>
        {state.phase === 'available' && state.body && (
          <details>
            <summary>{m.update_banner_notes()}</summary>
            <p className={notes} data-testid="update-banner-notes">
              {state.body}
            </p>
          </details>
        )}
      </div>
      <span className={actions}>
        <UpdateActions state={state} testIdPrefix="update-banner" />
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => setDismissedVersion(version)}
          data-testid="update-banner-later-btn"
        >
          {m.update_banner_later()}
        </Btn>
      </span>
    </Banner>
  );
}
