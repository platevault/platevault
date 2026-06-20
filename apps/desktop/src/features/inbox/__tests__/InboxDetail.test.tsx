/// <reference types="@testing-library/jest-dom" />
/**
 * Tests for InboxDetail (FR-010: per-file metadata table, FR-011: mixed
 * composition summary).
 *
 * Scope: ONLY InboxDetail.tsx. Uses fixtures; no IPC mocks needed because
 * InboxDetail never fetches — it renders the data it receives.
 *
 * InboxFileMetadata field names in the local interface (snake_case, pending
 * T019 regenerating bindings):
 *   relative_file_path, frame_type_effective, filter, exposure_s, binning_x,
 *   binning_y, gain, temperature_c, object, date_obs, instrume, telescop,
 *   naxis1, naxis2, stack_count, is_master, override_stale
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import type {
  InboxItemSummary_Serialize as InboxItemSummary,
  InboxClassifyResponse_Serialize as InboxClassifyResponse,
} from '@/bindings';

import {
  InboxDetail,
  type InboxFileMetadata,
} from '../InboxDetail';

// ── Mock reclassify hook ─────────────────────────────────────────────────────
vi.mock('@/api/commands', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/commands')>();
  return {
    ...mod,
    inboxReclassify: vi.fn().mockResolvedValue({
      inboxItemId: 'item-001',
      remainingUnclassified: 0,
    }),
  };
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const sampleItem: InboxItemSummary = {
  inboxItemId: 'item-001',
  relativePath: '2025-10-10/NGC7000',
  fileCount: 17,
  lane: 'fits',
  format: 'fits',
  state: 'classified',
  contentSignature: 'sig-001',
  isMaster: false,
  masterFrameType: null,
  masterFilter: null,
  masterExposureS: null,
};

/** Classification with three frame types → classType "mixed" */
const mixedClassification: InboxClassifyResponse = {
  inboxItemId: 'item-001',
  type: 'mixed',
  frameType: null,
  contentSignature: 'sig-001',
  breakdown: [
    { kind: 'light', count: 12, destinationPreview: 'NGC7000/Ha/light/', sampleFiles: [] },
    { kind: 'dark',  count: 4,  destinationPreview: 'calib/dark/',       sampleFiles: [] },
    { kind: 'flat',  count: 1,  destinationPreview: 'calib/flat/',       sampleFiles: [] },
  ],
  unclassifiedFiles: [],
  sampleFiles: [],
  computedAt: '2025-10-10T22:00:00Z',
};

/** Classification with a single frame type */
const singleTypeClassification: InboxClassifyResponse = {
  inboxItemId: 'item-001',
  type: 'single_type',
  frameType: 'light',
  contentSignature: 'sig-001',
  breakdown: [
    { kind: 'light', count: 17, destinationPreview: 'NGC7000/Ha/light/', sampleFiles: [] },
  ],
  unclassifiedFiles: [],
  sampleFiles: [],
  computedAt: '2025-10-10T22:00:00Z',
};

/** Two-row fixture for the per-file metadata table (FR-010). */
const fileMetadataFixture: InboxFileMetadata[] = [
  {
    relative_file_path: 'light_0001.fits',
    frame_type_effective: 'light',
    image_typ: 'LIGHT',
    filter: 'Ha',
    exposure_s: 300,
    binning_x: 1,
    binning_y: 1,
    gain: 100,
    temperature_c: -10,
    object: 'NGC7000',
    date_obs: '2025-10-10T22:00:00Z',
    instrume: 'ASI2600MM',
    telescop: null,
    naxis1: 6248,
    naxis2: 4176,
    stack_count: null,
    is_master: false,
    override_stale: false,
  },
  {
    relative_file_path: 'calib_dark_0001.fits',
    frame_type_effective: 'dark',
    image_typ: 'DARK',
    filter: null,
    exposure_s: null,
    binning_x: 1,
    binning_y: 1,
    gain: 100,
    temperature_c: null,
    object: null,
    date_obs: null,
    instrume: null,
    telescop: null,
    naxis1: null,
    naxis2: null,
    stack_count: 30,
    is_master: true,
    override_stale: false,
  },
];

// ── FR-011: Mixed composition summary ────────────────────────────────────────

describe('InboxDetail — FR-011: mixed composition summary', () => {
  it('renders an explicit per-type count string for mixed folders', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
      />
    );
    const summary = screen.getByLabelText('Mixed composition summary');
    expect(summary).toBeInTheDocument();
    // Should mention each frame type count joined with "·"
    expect(summary.textContent).toContain('12');
    expect(summary.textContent).toContain('light');
    expect(summary.textContent).toContain('4');
    expect(summary.textContent).toContain('dark');
    expect(summary.textContent).toContain('1');
    expect(summary.textContent).toContain('flat');
  });

  it('does NOT render a composition summary for single-type folders', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
      />
    );
    expect(
      screen.queryByLabelText('Mixed composition summary')
    ).not.toBeInTheDocument();
  });

  it('does NOT render a composition summary when classification is null', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={null}
      />
    );
    expect(
      screen.queryByLabelText('Mixed composition summary')
    ).not.toBeInTheDocument();
  });
});

// ── FR-010: Per-file metadata table ──────────────────────────────────────────

describe('InboxDetail — FR-010: per-file metadata table', () => {
  it('renders the section heading and column headers when fileMetadata is provided', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        fileMetadata={fileMetadataFixture}
      />
    );
    expect(screen.getByText('File metadata (2)')).toBeInTheDocument();
    // Column headers
    for (const col of ['File', 'Type', 'Filter', 'Exposure', 'Binning', 'Gain', 'Temp', 'Object', 'Date']) {
      expect(screen.getByText(col)).toBeInTheDocument();
    }
  });

  it('renders file basenames as title attributes and shows populated values', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        fileMetadata={fileMetadataFixture}
      />
    );
    // File cell titles contain the relative path
    expect(screen.getByTitle('light_0001.fits')).toBeInTheDocument();
    expect(screen.getByTitle('calib_dark_0001.fits')).toBeInTheDocument();
    // Populated field values from row 1
    expect(screen.getByText('Ha')).toBeInTheDocument();       // filter
    expect(screen.getByText('NGC7000')).toBeInTheDocument();  // object
  });

  it('renders muted "—" placeholder for null fields', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        fileMetadata={fileMetadataFixture}
      />
    );
    // Row 2 has several null fields; at least one "—" must appear
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('does NOT render the metadata section when fileMetadata prop is absent', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
      />
    );
    expect(screen.queryByText(/File metadata/)).not.toBeInTheDocument();
  });

  it('does NOT render the metadata section when fileMetadata is an empty array', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        fileMetadata={[]}
      />
    );
    expect(screen.queryByText(/File metadata/)).not.toBeInTheDocument();
  });

  it('renders both the FR-011 composition summary and the FR-010 table simultaneously', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        fileMetadata={fileMetadataFixture}
      />
    );
    expect(screen.getByLabelText('Mixed composition summary')).toBeInTheDocument();
    expect(screen.getByText('File metadata (2)')).toBeInTheDocument();
  });
});
