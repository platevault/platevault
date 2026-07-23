// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * T028 — Vitest tests for multi-select bulk reclassify overrides (T027 UI).
 *
 * Migrated to `reclassify_v2` (spec 041 R-13/T068, issue #755): InboxDetail no
 * longer calls the fixed-4-field v1 `inbox.reclassify`. Bulk edits now build
 * one `InboxReclassifyBulk` entry per filled field (frameType + any
 * registry-driven property), each carrying `filePaths` = the selection; the
 * single-file "Needs review" flow sends one `InboxReclassifyFileOverride`
 * per file with a `properties` map.
 *
 * Tests:
 * 1. Selecting multiple files + applying a bulk override calls
 *    `inboxReclassifyV2` with one `bulk` entry per filled field, each scoped
 *    to the selected file paths.
 * 2. Selecting none disables / no-ops the bulk apply button (it is only
 *    rendered when >=1 file is selected, so the button is absent).
 * 3. Bulk apply clears selection and input fields on success.
 * 4. Per-file single override flow (existing behaviour) still calls
 *    `inboxReclassifyV2` correctly — regression guard.
 *
 * Mocking pattern mirrors InboxDetail.test.tsx:
 * - Mock '@/bindings/index' (commands.inboxReclassifyV2 / inboxPropertyRegistry
 *   vi.fn()) so the component's local `useInboxReclassifyV2` hook picks them
 *   up; queryClient invalidation is harmless in jsdom.
 * - Render InboxDetail directly with fixture props — no InboxPage wrapper
 *   (avoids OOM from the full page tree).
 */
import type React from 'react';
import {
  render as rtlRender,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// InboxDetail uses TanStack-Query-backed hooks (spec 042 / issue #755), so
// every render must be wrapped in a QueryClientProvider.
function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

import type {
  InboxFileMetadata_Serialize as InboxFileMetadata,
  InboxItemSummary_Serialize as InboxItemSummary,
  InboxClassifyResponse_Serialize as InboxClassifyResponse,
  PropertyRegistryEntry_Serialize as PropertyRegistryEntry,
} from '@/bindings';

import { InboxDetail } from '../InboxDetail';

// ── Mock reclassify_v2 + property registry commands ───────────────────────────

const mockInboxReclassifyV2 = vi.fn().mockResolvedValue({
  sourceGroupId: 'item-001',
  subItems: [],
  needsReviewCount: 2,
});

const mockPropertyRegistry: PropertyRegistryEntry[] = [
  {
    key: 'filter',
    kind: 'string',
    unit: null,
    sourceHeaders: ['FILTER'],
    overridable: true,
    appliesTo: ['light', 'flat'],
    validation: null,
  },
  {
    key: 'exposureS',
    kind: 'number',
    unit: 's',
    sourceHeaders: ['EXPTIME'],
    overridable: true,
    appliesTo: ['light', 'dark', 'flat'],
    validation: null,
  },
  {
    key: 'binning',
    kind: 'string',
    unit: null,
    sourceHeaders: ['XBINNING'],
    overridable: true,
    appliesTo: ['light', 'dark', 'bias', 'flat', 'dark_flat'],
    validation: null,
  },
];

vi.mock('@/bindings/index', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/bindings/index')>();
  return {
    ...mod,
    commands: {
      ...mod.commands,
      inboxReclassifyV2: async (...args: unknown[]) => ({
        status: 'ok',
        data: await mockInboxReclassifyV2(...args),
      }),
      inboxPropertyRegistry: () => ({
        status: 'ok',
        data: mockPropertyRegistry,
      }),
    },
  };
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const sampleItem: InboxItemSummary = {
  inboxItemId: 'item-001',
  relativePath: '2025-11-01/NGC891',
  fileCount: 4,
  lane: 'fits',
  format: 'fits',
  state: 'classified',
  contentSignature: 'sig-002',
  isMaster: false,
  masterFrameType: null,
  masterFilter: null,
  masterExposureS: null,
};

/** Classification with three unclassified files — triggers "Needs review" section. */
const unclassifiedClassification: InboxClassifyResponse = {
  inboxItemId: 'item-001',
  type: 'unclassified',
  frameType: null,
  contentSignature: 'sig-002',
  breakdown: [],
  unclassifiedFiles: ['frame_0001.fits', 'frame_0002.fits', 'frame_0003.fits'],
  sampleFiles: [],
  computedAt: '2025-11-01T20:00:00Z',
};

/** Two unclassified files — for a simpler two-file selection test. */
const twoFileClassification: InboxClassifyResponse = {
  inboxItemId: 'item-001',
  type: 'unclassified',
  frameType: null,
  contentSignature: 'sig-003',
  breakdown: [],
  unclassifiedFiles: ['file_A.fits', 'file_B.fits'],
  sampleFiles: [],
  computedAt: '2025-11-01T20:00:00Z',
};

// Helper: cast fixture to the component's prop type (avoids TS noise from
// _Serialize vs _Deserialize variants — same shape at runtime).
type ItemProp = Parameters<typeof InboxDetail>[0]['item'];
type ClassProp = Parameters<typeof InboxDetail>[0]['classification'];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('InboxDetail — T027/T028/#755: multi-select bulk reclassify (v2)', () => {
  beforeEach(() => {
    mockInboxReclassifyV2.mockClear();
    mockInboxReclassifyV2.mockResolvedValue({
      sourceGroupId: 'item-001',
      subItems: [],
      needsReviewCount: 2,
    });
  });

  // ── Test 1: select multiple files + apply bulk override ──────────────────

  it('calls inboxReclassifyV2 with one bulk entry per filled field, scoped to selected files', async () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as ItemProp}
        rootAbsolutePath="/astro/inbox"
        classification={twoFileClassification as unknown as ClassProp}
      />,
    );

    // Select file_A.fits (index 0) by clicking its checkbox
    const cbA = screen.getByTestId('reclassify-select-0');
    fireEvent.click(cbA);

    // Select file_B.fits (index 1)
    const cbB = screen.getByTestId('reclassify-select-1');
    fireEvent.click(cbB);

    // Bulk controls should now be visible (registry-driven fields render once
    // `inboxPropertyRegistry` resolves)
    const bulkFrameType = screen.getByTestId('bulk-frame-type');
    const bulkFilter = await screen.findByTestId('bulk-filter');

    // Set frame type to "dark", filter to "Ha" — leave exposure + binning empty
    fireEvent.change(bulkFrameType, { target: { value: 'dark' } });
    fireEvent.change(bulkFilter, { target: { value: 'Ha' } });

    // Click "Apply to selected (2)"
    const applyBtn = screen.getByTestId('bulk-apply-btn');
    fireEvent.click(applyBtn);

    await waitFor(() => expect(mockInboxReclassifyV2).toHaveBeenCalledTimes(1));

    const callArg = mockInboxReclassifyV2.mock.calls[0][0] as {
      inboxItemId: string;
      overrides: unknown[];
      bulk: Array<{ property: string; value: unknown; filePaths: string[] }>;
    };

    expect(callArg.inboxItemId).toBe('item-001');
    expect(callArg.overrides).toEqual([]);
    expect(callArg.bulk).toHaveLength(2);

    const byProperty = Object.fromEntries(
      callArg.bulk.map((b) => [b.property, b]),
    );
    expect(byProperty.frameType.value).toBe('dark');
    expect(byProperty.frameType.filePaths.slice().sort()).toEqual([
      'file_A.fits',
      'file_B.fits',
    ]);
    expect(byProperty.filter.value).toBe('Ha');
    expect(byProperty.filter.filePaths.slice().sort()).toEqual([
      'file_A.fits',
      'file_B.fits',
    ]);
    expect(byProperty.exposureS).toBeUndefined();
    expect(byProperty.binning).toBeUndefined();
  });

  // ── Test 1b: sourceGroupId prop scopes the request to the source group ────
  //
  // Sub-item ids are purged/recreated across re-splits (the first classify
  // replaces the placeholder row), so a request scoped to the mounted item id
  // can hit `inbox.item.not_found` mid-churn. When the caller provides the
  // stable sourceGroupId, the request must be scoped to IT and the volatile
  // item id must be withheld (Layer-2 journey regression:
  // `inbox_ui_unclassified_gate_bulk_reclassify_unblocks_confirm`).

  it('scopes reclassifyV2 to sourceGroupId (not the volatile item id) when provided', async () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as ItemProp}
        rootAbsolutePath="/astro/inbox"
        classification={twoFileClassification as unknown as ClassProp}
        sourceGroupId="sg-stable-001"
      />,
    );

    fireEvent.click(screen.getByTestId('reclassify-select-0'));
    fireEvent.change(screen.getByTestId('bulk-frame-type'), {
      target: { value: 'dark' },
    });
    fireEvent.click(screen.getByTestId('bulk-apply-btn'));

    await waitFor(() => expect(mockInboxReclassifyV2).toHaveBeenCalledTimes(1));

    const callArg = mockInboxReclassifyV2.mock.calls[0][0] as {
      sourceGroupId?: string;
      inboxItemId?: string;
    };
    expect(callArg.sourceGroupId).toBe('sg-stable-001');
    expect(callArg.inboxItemId).toBeUndefined();
  });

  // ── Test 2: no selection → bulk apply button absent ──────────────────────

  it('does not render the bulk apply button when no files are selected', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as ItemProp}
        rootAbsolutePath="/astro/inbox"
        classification={twoFileClassification as unknown as ClassProp}
      />,
    );

    // With no selection, the bulk controls section should not exist
    expect(screen.queryByTestId('bulk-apply-btn')).not.toBeInTheDocument();
  });

  // ── Test 3: bulk apply clears selection and inputs on success ─────────────

  it('clears selection and bulk input fields after successful apply', async () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as ItemProp}
        rootAbsolutePath="/astro/inbox"
        classification={twoFileClassification as unknown as ClassProp}
      />,
    );

    // Select both files
    fireEvent.click(screen.getByTestId('reclassify-select-0'));
    fireEvent.click(screen.getByTestId('reclassify-select-1'));

    // Fill in frame type
    fireEvent.change(screen.getByTestId('bulk-frame-type'), {
      target: { value: 'light' },
    });

    // Apply
    fireEvent.click(screen.getByTestId('bulk-apply-btn'));

    // After success: bulk controls disappear (because selectedFiles.size === 0)
    await waitFor(() =>
      expect(screen.queryByTestId('bulk-apply-btn')).not.toBeInTheDocument(),
    );

    // Checkboxes should be unchecked again
    expect(
      (screen.getByTestId('reclassify-select-0') as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByTestId('reclassify-select-1') as HTMLInputElement).checked,
    ).toBe(false);
  });

  // ── Test 4: only selected files appear in the bulk filePaths ──────────────

  it('only includes selected files in the bulk filePaths, not unselected ones', async () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as ItemProp}
        rootAbsolutePath="/astro/inbox"
        classification={unclassifiedClassification as unknown as ClassProp}
      />,
    );

    // Select only the first file (index 0 = frame_0001.fits)
    fireEvent.click(screen.getByTestId('reclassify-select-0'));

    // Set frame type
    fireEvent.change(screen.getByTestId('bulk-frame-type'), {
      target: { value: 'bias' },
    });

    fireEvent.click(screen.getByTestId('bulk-apply-btn'));

    await waitFor(() => expect(mockInboxReclassifyV2).toHaveBeenCalledTimes(1));

    const callArg = mockInboxReclassifyV2.mock.calls[0][0] as {
      bulk: Array<{ property: string; filePaths: string[] }>;
    };

    expect(callArg.bulk).toHaveLength(1);
    expect(callArg.bulk[0].property).toBe('frameType');
    expect(callArg.bulk[0].filePaths).toEqual(['frame_0001.fits']);
  });

  // ── Test 5: select-all / deselect-all affordance ─────────────────────────

  it('selects all files when the select-all checkbox is clicked', async () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as ItemProp}
        rootAbsolutePath="/astro/inbox"
        classification={unclassifiedClassification as unknown as ClassProp}
      />,
    );

    const selectAll = screen.getByTestId('reclassify-select-all');
    fireEvent.click(selectAll);

    // Set frame type + apply
    fireEvent.change(screen.getByTestId('bulk-frame-type'), {
      target: { value: 'flat' },
    });
    fireEvent.click(screen.getByTestId('bulk-apply-btn'));

    await waitFor(() => expect(mockInboxReclassifyV2).toHaveBeenCalledTimes(1));

    const callArg = mockInboxReclassifyV2.mock.calls[0][0] as {
      bulk: Array<{ property: string; filePaths: string[] }>;
    };

    // All three unclassified files should appear in the frameType bulk entry
    expect(callArg.bulk).toHaveLength(1);
    const paths = callArg.bulk[0].filePaths.slice().sort();
    expect(paths).toEqual([
      'frame_0001.fits',
      'frame_0002.fits',
      'frame_0003.fits',
    ]);
  });

  // ── Test 6: exposureS included as number and binning as string when filled ─

  it('includes exposureS as a number and binning as string in the bulk entries', async () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as ItemProp}
        rootAbsolutePath="/astro/inbox"
        classification={twoFileClassification as unknown as ClassProp}
      />,
    );

    fireEvent.click(screen.getByTestId('reclassify-select-0'));

    const bulkExposure = await screen.findByTestId('bulk-exposure-s');
    const bulkBinning = screen.getByTestId('bulk-binning');

    fireEvent.change(bulkExposure, { target: { value: '300' } });
    fireEvent.change(bulkBinning, { target: { value: '2x2' } });

    fireEvent.click(screen.getByTestId('bulk-apply-btn'));

    await waitFor(() => expect(mockInboxReclassifyV2).toHaveBeenCalledTimes(1));

    const callArg = mockInboxReclassifyV2.mock.calls[0][0] as {
      bulk: Array<{ property: string; value: unknown; filePaths: string[] }>;
    };

    const byProperty = Object.fromEntries(
      callArg.bulk.map((b) => [b.property, b]),
    );
    expect(byProperty.exposureS.value).toBe(300);
    expect(byProperty.exposureS.filePaths).toEqual(['file_A.fits']);
    expect(byProperty.binning.value).toBe('2x2');
    expect(byProperty.binning.filePaths).toEqual(['file_A.fits']);
  });

  // ── Test 7: regression — single-file per-row override still works ─────────

  it('regression: single-file per-row frame type override calls inboxReclassifyV2 with a properties map', async () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as ItemProp}
        rootAbsolutePath="/astro/inbox"
        classification={twoFileClassification as unknown as ClassProp}
      />,
    );

    // Use the per-row override select for file_A.fits
    const perRowSelect = screen.getByTestId('override-select-file_A.fits');
    fireEvent.change(perRowSelect, { target: { value: 'light' } });

    // The single-file apply button should appear
    const applyBtn = screen.getByLabelText('Apply manual overrides');
    fireEvent.click(applyBtn);

    await waitFor(() => expect(mockInboxReclassifyV2).toHaveBeenCalledTimes(1));

    const callArg = mockInboxReclassifyV2.mock.calls[0][0] as {
      inboxItemId: string;
      overrides: Array<{
        filePath: string;
        properties: Record<string, unknown>;
      }>;
      bulk: unknown[];
    };

    expect(callArg.inboxItemId).toBe('item-001');
    expect(callArg.bulk).toEqual([]);
    expect(callArg.overrides).toHaveLength(1);
    expect(callArg.overrides[0]).toEqual({
      filePath: 'file_A.fits',
      properties: { frameType: 'light' },
    });
  });
});

// ── #611: bulk frame-type override heterogeneity warning + undo ─────────────

function fileMeta(
  relativeFilePath: string,
  frameTypeEffective: string | null,
): InboxFileMetadata {
  return {
    relativeFilePath,
    frameTypeEffective,
    imageTyp: null,
    filter: null,
    exposureS: null,
    binningX: null,
    binningY: null,
    gain: null,
    temperatureC: null,
    object: null,
    dateObs: null,
    instrume: null,
    telescop: null,
    naxis1: null,
    naxis2: null,
    stackCount: null,
    isMaster: false,
    overrideStale: false,
  };
}

describe('InboxDetail — #611: bulk frame-type heterogeneity warning + undo', () => {
  beforeEach(() => {
    mockInboxReclassifyV2.mockClear();
    mockInboxReclassifyV2.mockResolvedValue({
      sourceGroupId: 'item-001',
      subItems: [],
      needsReviewCount: 0,
    });
  });

  it('warns and blocks Apply when the selection spans different detected frame types, until acknowledged', async () => {
    const heterogeneousMetadata = [
      fileMeta('file_A.fits', 'dark'),
      fileMeta('file_B.fits', 'bias'),
    ];
    render(
      <InboxDetail
        item={sampleItem as unknown as ItemProp}
        rootAbsolutePath="/astro/inbox"
        classification={twoFileClassification as unknown as ClassProp}
        fileMetadata={heterogeneousMetadata}
      />,
    );

    fireEvent.click(screen.getByTestId('reclassify-select-0'));
    fireEvent.click(screen.getByTestId('reclassify-select-1'));
    fireEvent.change(screen.getByTestId('bulk-frame-type'), {
      target: { value: 'light' },
    });

    expect(
      screen.getByTestId('bulk-heterogeneous-warning'),
    ).toBeInTheDocument();
    const applyBtn = screen.getByTestId('bulk-apply-btn');
    expect(applyBtn).toBeDisabled();

    fireEvent.click(applyBtn);
    expect(mockInboxReclassifyV2).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('bulk-heterogeneous-ack'));
    expect(applyBtn).not.toBeDisabled();

    fireEvent.click(applyBtn);
    await waitFor(() => expect(mockInboxReclassifyV2).toHaveBeenCalledTimes(1));
  });

  it('does not warn when the selection is a single detected frame type', () => {
    const homogeneousMetadata = [
      fileMeta('file_A.fits', 'dark'),
      fileMeta('file_B.fits', 'dark'),
    ];
    render(
      <InboxDetail
        item={sampleItem as unknown as ItemProp}
        rootAbsolutePath="/astro/inbox"
        classification={twoFileClassification as unknown as ClassProp}
        fileMetadata={homogeneousMetadata}
      />,
    );

    fireEvent.click(screen.getByTestId('reclassify-select-0'));
    fireEvent.click(screen.getByTestId('reclassify-select-1'));
    fireEvent.change(screen.getByTestId('bulk-frame-type'), {
      target: { value: 'light' },
    });

    expect(
      screen.queryByTestId('bulk-heterogeneous-warning'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('bulk-apply-btn')).not.toBeDisabled();
  });

  it('offers Undo after a bulk frame-type override, restoring each file to its prior detected type', async () => {
    const heterogeneousMetadata = [
      fileMeta('file_A.fits', 'dark'),
      fileMeta('file_B.fits', 'bias'),
    ];
    render(
      <InboxDetail
        item={sampleItem as unknown as ItemProp}
        rootAbsolutePath="/astro/inbox"
        classification={twoFileClassification as unknown as ClassProp}
        fileMetadata={heterogeneousMetadata}
      />,
    );

    fireEvent.click(screen.getByTestId('reclassify-select-0'));
    fireEvent.click(screen.getByTestId('reclassify-select-1'));
    fireEvent.change(screen.getByTestId('bulk-frame-type'), {
      target: { value: 'light' },
    });
    fireEvent.click(screen.getByTestId('bulk-heterogeneous-ack'));
    fireEvent.click(screen.getByTestId('bulk-apply-btn'));

    await waitFor(() => expect(mockInboxReclassifyV2).toHaveBeenCalledTimes(1));

    const undoBtn = await screen.findByTestId('bulk-undo-btn');
    fireEvent.click(undoBtn);

    await waitFor(() => expect(mockInboxReclassifyV2).toHaveBeenCalledTimes(2));
    const undoCallArg = mockInboxReclassifyV2.mock.calls[1][0] as {
      overrides: Array<{
        filePath: string;
        properties: Record<string, unknown>;
      }>;
      bulk: unknown[];
    };
    expect(undoCallArg.bulk).toEqual([]);
    expect(
      undoCallArg.overrides
        .slice()
        .sort((a, b) => a.filePath.localeCompare(b.filePath)),
    ).toEqual([
      { filePath: 'file_A.fits', properties: { frameType: 'dark' } },
      { filePath: 'file_B.fits', properties: { frameType: 'bias' } },
    ]);
  });
});
