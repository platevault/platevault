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

// ── task #34: warnings = alert with inline action ────────────────────────────

describe('InboxDetail — task #34: mixed-folder alert with inline action', () => {
  it('renders the mixed alert with an inline "Generate split plan" button that fires the callback', () => {
    const onGenerateSplitPlan = vi.fn();
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        onGenerateSplitPlan={onGenerateSplitPlan}
      />
    );
    expect(screen.getByTestId('inbox-mixed-alert')).toBeInTheDocument();
    const btn = screen.getByTestId('inbox-mixed-split-btn');
    fireEvent.click(btn);
    expect(onGenerateSplitPlan).toHaveBeenCalledTimes(1);
  });

  it('disables the inline split action while busy', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        onGenerateSplitPlan={vi.fn()}
        splitPlanBusy
      />
    );
    expect(screen.getByTestId('inbox-mixed-split-btn')).toBeDisabled();
  });

  it('renders the mixed alert without an action button when no callback is supplied', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
      />
    );
    expect(screen.getByTestId('inbox-mixed-alert')).toBeInTheDocument();
    expect(screen.queryByTestId('inbox-mixed-split-btn')).not.toBeInTheDocument();
  });

  it('does NOT render the mixed alert for single-type folders', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        onGenerateSplitPlan={vi.fn()}
      />
    );
    expect(screen.queryByTestId('inbox-mixed-alert')).not.toBeInTheDocument();
  });
});

// ── detail rework: 3-zone layout (facts | content | aux) ─────────────────────
//
// Updated to the redesign-ui-platevault 3-zone skeleton:
//   facts = breakdown column (.alm-inbox-detail__facts-col)
//   content = file metadata table (.alm-inbox-detail__meta-col, aria-label="File metadata")
//   aux = FileInspector in DetailPanel aux rail (.alm-detailpanel__aux)

describe('InboxDetail — 3-zone: breakdown-facts / file-content / inspector-aux', () => {
  it('uses the 3-zone cols wrapper and places breakdown in facts, metadata in content', () => {
    const { container } = render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        fileMetadata={fileMetadataFixture}
      />
    );
    // Cols wrapper rendered by DetailPanel (facts + aux both provided → 3-zone).
    const cols = container.querySelector('.alm-detailpanel__cols');
    expect(cols).not.toBeNull();

    // Facts column (left): contains breakdown.
    const factsAside = container.querySelector('.alm-detailpanel__facts');
    expect(factsAside).not.toBeNull();
    expect(factsAside?.textContent).toContain('Frame type breakdown');

    // Content column (center): file metadata table.
    const metaCol = container.querySelector('.alm-inbox-detail__meta-col');
    expect(metaCol).not.toBeNull();
    expect(metaCol).toHaveAttribute('aria-label', 'File metadata');
    expect(metaCol?.textContent).toContain('File metadata (2)');
    expect(metaCol?.textContent).toContain('File');
  });

  it('does not render the content or aux columns when fileMetadata is absent', () => {
    const { container } = render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
      />
    );
    // facts col present (breakdown always shown); content + aux absent when no metadata.
    const cols = container.querySelector('.alm-detailpanel__cols');
    expect(cols).not.toBeNull();
    expect(container.querySelector('.alm-inbox-detail__meta-col')).toBeNull();
    expect(container.querySelector('.alm-detailpanel__aux')).toBeNull();
  });

  it('renders the file inspector in the aux rail when metadata exists', () => {
    const { container } = render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        fileMetadata={fileMetadataFixture}
      />
    );
    // Inspector is in the aux aside (empty state: no row clicked yet).
    const auxAside = container.querySelector('.alm-detailpanel__aux');
    expect(auxAside).not.toBeNull();
    expect(auxAside?.querySelector('[data-testid="file-inspector"]')).not.toBeNull();
  });

  it('file metadata table is inside the content column', () => {
    const { container } = render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        fileMetadata={fileMetadataFixture}
      />
    );
    // Table is inside the content column, NOT in the facts or aux aside.
    const contentDiv = container.querySelector('.alm-detailpanel__content');
    expect(contentDiv).not.toBeNull();
    expect(contentDiv?.querySelector('table')).not.toBeNull();

    const factsAside = container.querySelector('.alm-detailpanel__facts');
    const auxAside = container.querySelector('.alm-detailpanel__aux');
    expect(factsAside?.querySelector('table')).toBeDefined();
    // aux should contain the inspector, NOT a metadata table
    expect(auxAside?.querySelector('.alm-inbox-detail__meta-col')).toBeNull();
  });
});
