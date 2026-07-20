// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * InboxSourceGroupDetail — the detail pane for a scanned-but-unclassified
 * folder (spec 058 T013 / FR-016).
 *
 * This is a deliberately inert panel: it states what the folder is and why
 * there is nothing to act on yet. It renders **no** Confirm control — not a
 * disabled one, and not one behind a guard. A source group has no inbox item
 * id, so there is no value `inbox.confirm` could be handed; the absence is
 * structural rather than enforced, which is exactly the FR-016 boundary. A
 * disabled button here would re-introduce the "row claims an action it cannot
 * perform" shape that #711 is about.
 */

import type { InboxSourceGroupListItem } from './store';
import { m } from '@/lib/i18n';

export interface InboxSourceGroupDetailProps {
  group: InboxSourceGroupListItem;
}

export function InboxSourceGroupDetail({ group }: InboxSourceGroupDetailProps) {
  const path = group.relativePath || group.rootAbsolutePath;
  return (
    <div
      className="pv-inbox-detail pv-inbox-detail--source-group"
      data-testid="inbox-source-group-detail"
    >
      <h2 className="pv-inbox-detail__title">
        {m.inbox_source_group_detail_title()}
      </h2>
      <p className="pv-inbox-detail__path" title={path}>
        {path}
      </p>
      <p className="pv-inbox-detail__body">
        {m.inbox_source_group_detail_body()}
      </p>
      <p className="pv-inbox-detail__meta">
        {m.inbox_list_file_count({ count: group.fileCount })}
      </p>
    </div>
  );
}
