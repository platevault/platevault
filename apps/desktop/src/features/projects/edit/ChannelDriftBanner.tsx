// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Channel drift banner for EditProjectPane (US1c, extracted #1000).
 *
 * Shown when `channelDrift.hasNewSources == true`. Primary action re-infers
 * channels; secondary dismisses the banner. Renders nothing otherwise — the
 * caller does not need to guard.
 */

import { m } from '@/lib/i18n';
import { Btn, Banner } from '@/ui';

export interface ChannelDriftBannerProps {
  show: boolean;
  channelWorking: boolean;
  onReinfer: () => void;
  onDismiss: () => void;
}

export function ChannelDriftBanner({
  show,
  channelWorking,
  onReinfer,
  onDismiss,
}: ChannelDriftBannerProps) {
  if (!show) return null;

  return (
    <Banner variant="warn" role="status" aria-live="polite">
      <span>{m.projects_edit_drift_banner()}</span>
      <div className="pv-edit-project__drift-actions">
        <Btn
          size="sm"
          variant="primary"
          onClick={onReinfer}
          disabled={channelWorking}
        >
          {m.projects_detail_reinfer_btn()}
        </Btn>
        <Btn
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          disabled={channelWorking}
        >
          {m.projects_detail_dismiss_btn()}
        </Btn>
      </div>
    </Banner>
  );
}
