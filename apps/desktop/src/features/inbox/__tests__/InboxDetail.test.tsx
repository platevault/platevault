/// <reference types="@testing-library/jest-dom" />
/**
 * Tests for InboxDetail (FR-010: per-file metadata table, FR-011: mixed
 * composition summary).
 *
 * Scope: ONLY InboxDetail.tsx. Uses fixtures; no IPC mocks needed because
 * InboxDetail never fetches — it renders the data it receives.
 *
 * InboxFileMetadata is the generated Specta type (camelCase), re-exported via
 * '@/api/commands' (spec 041 US2/FR-010 — wired in T019):
 *   relativeFilePath, frameTypeEffective, imageTyp, filter, exposureS, binningX,
 *   binningY, gain (string), temperatureC, object, dateObs, instrume, telescop,
 *   naxis1, naxis2, stackCount, isMaster, overrideStale
 */
import React from 'react';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type {
  InboxItemSummary_Serialize as InboxItemSummary,
  InboxClassifyResponse_Serialize as InboxClassifyResponse,
} from '@/bindings';
import type { InboxFileMetadata } from '@/api/commands';

import { InboxDetail } from '../InboxDetail';

// InboxDetail uses the TanStack-Query-backed `useInboxReclassify` hook (spec 042),
// so every render must be wrapped in a QueryClientProvider.
function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

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
    relativeFilePath: 'light_0001.fits',
    frameTypeEffective: 'light',
    imageTyp: 'LIGHT',
    filter: 'Ha',
    exposureS: 300,
    binningX: 1,
    binningY: 1,
    gain: '100',
    temperatureC: -10,
    object: 'NGC7000',
    dateObs: '2025-10-10T22:00:00Z',
    instrume: 'ASI2600MM',
    telescop: null,
    naxis1: 6248,
    naxis2: 4176,
    stackCount: null,
    isMaster: false,
    overrideStale: false,
  },
  {
    relativeFilePath: 'calib_dark_0001.fits',
    frameTypeEffective: 'dark',
    imageTyp: 'DARK',
    filter: null,
    exposureS: null,
    binningX: 1,
    binningY: 1,
    gain: '100',
    temperatureC: null,
    object: null,
    dateObs: null,
    instrume: null,
    telescop: null,
    naxis1: null,
    naxis2: null,
    stackCount: 30,
    isMaster: true,
    overrideStale: false,
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

// ── FR-032 (US9): missing path-load-bearing attribute gate ───────────────────

describe('InboxDetail — FR-032: missing-attribute annotations', () => {
  const withMissing: InboxFileMetadata[] = [
    { ...fileMetadataFixture[0], relativeFilePath: 'light_ok.fits', missingPathAttributes: [] },
    {
      ...fileMetadataFixture[0],
      relativeFilePath: 'light_nodate.fits',
      dateObs: null,
      missingPathAttributes: ['date'],
    },
  ];

  it('annotates only files that are missing a path-load-bearing attribute', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        fileMetadata={withMissing}
      />
    );
    const badge = screen.getByTestId('inbox-missing-attr-light_nodate.fits');
    expect(badge).toHaveTextContent('needs date');
    expect(screen.queryByTestId('inbox-missing-attr-light_ok.fits')).not.toBeInTheDocument();
  });

  it('shows a summary banner counting the blocked files', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        fileMetadata={withMissing}
      />
    );
    expect(screen.getByTestId('inbox-missing-attr-banner')).toHaveTextContent('1 file');
  });

  it('renders no banner when no file is missing attributes', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        fileMetadata={fileMetadataFixture}
      />
    );
    expect(screen.queryByTestId('inbox-missing-attr-banner')).not.toBeInTheDocument();
  });
});

// ── Inspector dock ────────────────────────────────────────────────────────────

describe('InboxDetail — inspector dock', () => {
  it('renders the inspector with empty-state hint when no row is selected', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        fileMetadata={fileMetadataFixture}
      />
    );
    const inspector = screen.getByLabelText('File inspector');
    expect(inspector).toBeInTheDocument();
    expect(inspector).toHaveTextContent('Select a file to inspect');
  });

  it('shows single-file detail after clicking a metadata row', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        fileMetadata={fileMetadataFixture}
      />
    );

    // Click the row containing 'light_0001.fits' (title attribute on the span)
    const fileCell = screen.getByTitle('light_0001.fits');
    fireEvent.click(fileCell);

    const inspector = screen.getByLabelText('File inspector');
    // Filename heading appears in inspector header
    expect(inspector).toHaveTextContent('light_0001.fits');
    // Fields from the fixture: camera=ASI2600MM, filter=Ha, object=NGC7000
    expect(inspector).toHaveTextContent('ASI2600MM');
    expect(inspector).toHaveTextContent('Ha');
    expect(inspector).toHaveTextContent('NGC7000');
    // Exposure 300 s
    expect(inspector).toHaveTextContent('300 s');
  });

  it('deselects a row when clicked again (single click on already-selected row)', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        fileMetadata={fileMetadataFixture}
      />
    );

    const fileCell = screen.getByTitle('light_0001.fits');
    fireEvent.click(fileCell);
    // Now selected — inspector shows the filename
    expect(screen.getByLabelText('File inspector')).toHaveTextContent('light_0001.fits');

    // Click again to deselect
    fireEvent.click(fileCell);
    expect(screen.getByLabelText('File inspector')).toHaveTextContent('Select a file to inspect');
  });

  it('shows multi-select summary when two rows are ctrl-clicked', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        fileMetadata={fileMetadataFixture}
      />
    );

    const cell1 = screen.getByTitle('light_0001.fits');
    const cell2 = screen.getByTitle('calib_dark_0001.fits');

    fireEvent.click(cell1);
    // Ctrl+click second row
    fireEvent.click(cell2, { ctrlKey: true });

    const inspector = screen.getByLabelText('File inspector');
    expect(inspector).toHaveTextContent('2 files selected');
    // Multi-select footer note
    expect(inspector).toHaveTextContent('Multi-select');
  });

  it('does not render the inspector when fileMetadata is absent', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
      />
    );
    expect(screen.queryByLabelText('File inspector')).not.toBeInTheDocument();
  });
});
