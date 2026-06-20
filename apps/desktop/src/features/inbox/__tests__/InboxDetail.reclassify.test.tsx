/// <reference types="@testing-library/jest-dom" />
/**
 * T028 — Vitest tests for multi-select bulk reclassify overrides (T027 UI).
 *
 * Tests:
 * 1. Selecting multiple files + applying a bulk override calls `reclassify`
 *    with one override per selected file carrying only the chosen fields
 *    (e.g. frameType="dark" + filter="Ha"), omitting unset fields.
 * 2. Selecting none disables / no-ops the bulk apply button (it is only
 *    rendered when >=1 file is selected, so the button is absent).
 * 3. Bulk apply clears selection and input fields on success.
 * 4. Per-file single override flow (existing behaviour) still calls reclassify
 *    correctly — regression guard.
 *
 * Mocking pattern mirrors InboxDetail.test.tsx:
 * - Mock '@/api/commands' (inboxReclassify vi.fn()) so the real store hook
 *   picks it up; classifyStore.invalidateAll() is harmless in jsdom.
 * - Render InboxDetail directly with fixture props — no InboxPage wrapper
 *   (avoids OOM from the full page tree).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type {
  InboxItemSummary_Serialize as InboxItemSummary,
  InboxClassifyResponse_Serialize as InboxClassifyResponse,
} from '@/bindings';

import { InboxDetail } from '../InboxDetail';

// ── Mock reclassify command ───────────────────────────────────────────────────

const mockInboxReclassify = vi.fn().mockResolvedValue({
  inboxItemId: 'item-001',
  updatedType: 'unclassified',
  frameType: null,
  remainingUnclassified: 2,
});

vi.mock('@/api/commands', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/commands')>();
  return {
    ...mod,
    inboxReclassify: (...args: unknown[]) => mockInboxReclassify(...args),
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

describe('InboxDetail — T027/T028: multi-select bulk reclassify', () => {
  beforeEach(() => {
    mockInboxReclassify.mockClear();
    mockInboxReclassify.mockResolvedValue({
      inboxItemId: 'item-001',
      updatedType: 'unclassified',
      frameType: null,
      remainingUnclassified: 2,
    });
  });

  // ── Test 1: select multiple files + apply bulk override ──────────────────

  it('calls reclassify with one override per selected file carrying only filled fields', async () => {
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

    // Bulk controls should now be visible
    const bulkFrameType = screen.getByTestId('bulk-frame-type');
    const bulkFilter = screen.getByTestId('bulk-filter');

    // Set frame type to "dark", filter to "Ha" — leave exposure + binning empty
    fireEvent.change(bulkFrameType, { target: { value: 'dark' } });
    fireEvent.change(bulkFilter, { target: { value: 'Ha' } });

    // Click "Apply to selected (2)"
    const applyBtn = screen.getByTestId('bulk-apply-btn');
    fireEvent.click(applyBtn);

    await waitFor(() => expect(mockInboxReclassify).toHaveBeenCalledTimes(1));

    const callArg = mockInboxReclassify.mock.calls[0][0] as {
      inboxItemId: string;
      overrides: Array<{ filePath: string; frameType?: string; filter?: string; exposureS?: number; binning?: string }>;
    };

    expect(callArg.inboxItemId).toBe('item-001');
    expect(callArg.overrides).toHaveLength(2);

    // Both overrides must carry frameType + filter; exposureS + binning must be absent
    for (const ov of callArg.overrides) {
      expect(ov.frameType).toBe('dark');
      expect(ov.filter).toBe('Ha');
      expect(ov).not.toHaveProperty('exposureS');
      expect(ov).not.toHaveProperty('binning');
    }

    // Both files must be present (order may vary)
    const paths = callArg.overrides.map((o) => o.filePath).sort();
    expect(paths).toEqual(['file_A.fits', 'file_B.fits']);
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
    fireEvent.change(screen.getByTestId('bulk-frame-type'), { target: { value: 'light' } });

    // Apply
    fireEvent.click(screen.getByTestId('bulk-apply-btn'));

    // After success: bulk controls disappear (because selectedFiles.size === 0)
    await waitFor(() =>
      expect(screen.queryByTestId('bulk-apply-btn')).not.toBeInTheDocument(),
    );

    // Checkboxes should be unchecked again
    expect((screen.getByTestId('reclassify-select-0') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('reclassify-select-1') as HTMLInputElement).checked).toBe(false);
  });

  // ── Test 4: only selected files appear in overrides ───────────────────────

  it('only includes selected files in the bulk override, not unselected ones', async () => {
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
    fireEvent.change(screen.getByTestId('bulk-frame-type'), { target: { value: 'bias' } });

    fireEvent.click(screen.getByTestId('bulk-apply-btn'));

    await waitFor(() => expect(mockInboxReclassify).toHaveBeenCalledTimes(1));

    const callArg = mockInboxReclassify.mock.calls[0][0] as {
      overrides: Array<{ filePath: string }>;
    };

    expect(callArg.overrides).toHaveLength(1);
    expect(callArg.overrides[0].filePath).toBe('frame_0001.fits');
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
    fireEvent.change(screen.getByTestId('bulk-frame-type'), { target: { value: 'flat' } });
    fireEvent.click(screen.getByTestId('bulk-apply-btn'));

    await waitFor(() => expect(mockInboxReclassify).toHaveBeenCalledTimes(1));

    const callArg = mockInboxReclassify.mock.calls[0][0] as {
      overrides: Array<{ filePath: string }>;
    };

    // All three unclassified files should appear
    expect(callArg.overrides).toHaveLength(3);
    const paths = callArg.overrides.map((o) => o.filePath).sort();
    expect(paths).toEqual(['frame_0001.fits', 'frame_0002.fits', 'frame_0003.fits']);
  });

  // ── Test 6: exposureS included as number when filled in ──────────────────

  it('includes exposureS as a number and binning as string when filled', async () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as ItemProp}
        rootAbsolutePath="/astro/inbox"
        classification={twoFileClassification as unknown as ClassProp}
      />,
    );

    fireEvent.click(screen.getByTestId('reclassify-select-0'));

    fireEvent.change(screen.getByTestId('bulk-exposure-s'), { target: { value: '300' } });
    fireEvent.change(screen.getByTestId('bulk-binning'), { target: { value: '2x2' } });

    fireEvent.click(screen.getByTestId('bulk-apply-btn'));

    await waitFor(() => expect(mockInboxReclassify).toHaveBeenCalledTimes(1));

    const callArg = mockInboxReclassify.mock.calls[0][0] as {
      overrides: Array<{ exposureS?: number; binning?: string }>;
    };

    expect(callArg.overrides[0].exposureS).toBe(300);
    expect(callArg.overrides[0].binning).toBe('2x2');
  });

  // ── Test 7: regression — single-file per-row override still works ─────────

  it('regression: single-file per-row frame type override calls reclassify with frameType only', async () => {
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

    await waitFor(() => expect(mockInboxReclassify).toHaveBeenCalledTimes(1));

    const callArg = mockInboxReclassify.mock.calls[0][0] as {
      inboxItemId: string;
      overrides: Array<{ filePath: string; frameType: string }>;
    };

    expect(callArg.inboxItemId).toBe('item-001');
    expect(callArg.overrides).toHaveLength(1);
    expect(callArg.overrides[0]).toEqual({ filePath: 'file_A.fits', frameType: 'light' });
  });
});
