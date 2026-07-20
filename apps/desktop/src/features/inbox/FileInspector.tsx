// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { InboxFileMetadata_Serialize as InboxFileMetadata } from '@/bindings/index';
import { renderValue } from '@/components';
import { fieldApplicability } from '@/lib/field-applicability';
import { m } from '@/lib/i18n';
import { basename } from './inboxDetailHelpers';

/**
 * Compact inspector for per-file fields NOT already shown in the metadata table:
 *   instrume, telescop, naxis1×naxis2, stackCount, imageTyp.
 *
 * Rendered inside the Files popover when a row is clicked.
 */
export function FileInspector({ file }: { file: InboxFileMetadata | null }) {
  if (!file) {
    return (
      <div
        className="pv-inbox-inspector pv-inbox-inspector--empty"
        data-testid="file-inspector"
      />
    );
  }

  const rows: Array<{ label: string; value: React.ReactNode; testid: string }> =
    [
      {
        label: m.inbox_field_instrument(),
        value: renderValue(file.instrume ?? null, {
          applicability: 'applicable',
        }),
        testid: 'inspector-instrume',
      },
      {
        label: m.inbox_field_telescope(),
        value: renderValue(file.telescop ?? null, {
          applicability: fieldApplicability(
            file.frameTypeEffective,
            'telescope',
          ),
        }),
        testid: 'inspector-telescop',
      },
      {
        label: m.inbox_field_dimensions(),
        value: renderValue(
          file.naxis1 != null || file.naxis2 != null
            ? `${file.naxis1 ?? '?'}×${file.naxis2 ?? '?'}`
            : null,
          { applicability: 'applicable' },
        ),
        testid: 'inspector-dims',
      },
      {
        label: m.inbox_field_stack_count(),
        value: renderValue(file.stackCount ?? null, {
          applicability: 'applicable',
        }),
        testid: 'inspector-stackcount',
      },
      {
        label: m.inbox_field_raw_imagetyp(),
        value: renderValue(file.imageTyp ?? null, {
          applicability: 'applicable',
        }),
        testid: 'inspector-imagetyp',
      },
    ];

  return (
    <div className="pv-inbox-inspector" data-testid="file-inspector">
      <div className="pv-inbox-inspector__name" title={file.relativeFilePath}>
        {basename(file.relativeFilePath)}
      </div>
      <dl className="pv-inbox-inspector__dl">
        {rows.map((r) => (
          <div
            key={r.label}
            className="pv-inbox-inspector__row"
            data-testid={r.testid}
          >
            <dt className="pv-inbox-inspector__label">{r.label}</dt>
            <dd className="pv-inbox-inspector__value">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
