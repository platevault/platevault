// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Destination-root picker (spec 041 US8/FR-029), extracted from `PlanPanel`.
 * Surfaced whenever the last confirm needs a root choice; blocks apply until
 * chosen since the plan isn't generated until confirm succeeds with a rootId.
 */

import { Btn } from '@/ui';
import { m } from '@/lib/i18n';
import type { PendingRootPick } from './PlanPanel';

export interface PlanRootPickerProps {
  pendingRootPick: PendingRootPick;
  onPickDestinationRoot?: (rootId: string) => void;
  rootPickBusy: boolean;
}

export function PlanRootPicker({
  pendingRootPick,
  onPickDestinationRoot,
  rootPickBusy,
}: PlanRootPickerProps) {
  return (
    <div className="pv-plan-panel__root-picker" data-testid="inbox-root-picker">
      <div className="pv-plan-panel__root-picker-title">
        {m.inbox_choose_dest_root_title()}
      </div>
      <div className="pv-plan-panel__root-picker-desc">
        {m.inbox_choose_dest_root_body({ category: pendingRootPick.category })}
      </div>
      <div className="pv-plan-panel__root-picker-options">
        {pendingRootPick.candidates.map((c) => (
          <Btn
            key={c.rootId}
            variant="ghost"
            onClick={() => onPickDestinationRoot?.(c.rootId)}
            disabled={rootPickBusy}
            data-testid={`inbox-root-option-${c.rootId}`}
            aria-label={m.inbox_use_as_destination_root_aria({ path: c.path })}
            className="pv-plan-panel__root-option"
          >
            <span className="pv-plan-panel__root-option-inner">
              <code className="pv-plan-panel__root-option-path">{c.path}</code>
              <span className="pv-plan-panel__root-option-kind">{c.kind}</span>
            </span>
          </Btn>
        ))}
      </div>
    </div>
  );
}
