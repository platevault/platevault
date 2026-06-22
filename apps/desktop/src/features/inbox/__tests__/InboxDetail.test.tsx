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
    // Column headers — some labels now also appear in the PropertyTable (e.g. "Filter"),
    // so use getAllByText and check at least one match exists per label.
    for (const col of ['File', 'Type', 'Filter', 'Exposure', 'Binning', 'Gain', 'Temp', 'Object', 'Date']) {
      expect(screen.getAllByText(col).length).toBeGreaterThan(0);
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
    // Populated field values from row 1 — "Ha" appears in both PropertyTable (filter)
    // and the metadata table; "NGC7000" appears in both (object). Use getAllByText.
    expect(screen.getAllByText('Ha').length).toBeGreaterThan(0);       // filter
    expect(screen.getAllByText('NGC7000').length).toBeGreaterThan(0);  // object
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

// ── task #34: mixed-folder — banner in body, action in header ────────────────
//
// Redesign: "Generate split plan" moved from the banner body to the header
// titleExtra (inline-left, alm-session-detail2__actions). The banner stays as
// an informational summary; the button is NOT inside it.

describe('InboxDetail — task #34: mixed-folder banner + header action button', () => {
  it('renders the mixed banner AND the "Generate split plan" button in the header', () => {
    const onGenerateSplitPlan = vi.fn();
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        onGenerateSplitPlan={onGenerateSplitPlan}
      />
    );
    // Banner (body) — informational summary only, no action child.
    expect(screen.getByTestId('inbox-mixed-alert')).toBeInTheDocument();
    // Button in header titleExtra — fires the callback.
    const btn = screen.getByTestId('inbox-mixed-split-btn');
    fireEvent.click(btn);
    expect(onGenerateSplitPlan).toHaveBeenCalledTimes(1);
    // Button is NOT inside the banner.
    const banner = screen.getByTestId('inbox-mixed-alert');
    expect(banner.querySelector('[data-testid="inbox-mixed-split-btn"]')).toBeNull();
  });

  it('disables the header split button while busy', () => {
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

  it('does not render the header split button when no callback is supplied', () => {
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

  it('does NOT render the mixed banner for single-type folders', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        onGenerateSplitPlan={vi.fn()}
      />
    );
    expect(screen.queryByTestId('inbox-mixed-alert')).not.toBeInTheDocument();
    // No split button for non-mixed items.
    expect(screen.queryByTestId('inbox-mixed-split-btn')).not.toBeInTheDocument();
  });
});

// ── layout rework: SessionDetail-style left-packed columns ───────────────────
//
// spec 043 §4 redesign — InboxDetail now follows SessionDetail:
//   - No facts/aux props; body is a .alm-session-detail2 flex row.
//   - Col A: PropertyTable with detection facts.
//   - Breakdown block: inside its own .alm-session-detail2__col.
//   - File metadata: .alm-inbox-detail__meta-col inside .alm-session-detail2.
//   - FileInspector: .alm-inbox-inspector inside .alm-session-detail2.
//   - "Generate split plan" button is in the header titleExtra, not the banner.

describe('InboxDetail — SessionDetail-style layout: left-packed columns', () => {
  it('renders the alm-session-detail2 row wrapper in the body', () => {
    const { container } = render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        fileMetadata={fileMetadataFixture}
      />
    );
    // New layout: session-detail2 row (not detailpanel__cols / facts / aux).
    const row = container.querySelector('.alm-session-detail2');
    expect(row).not.toBeNull();

    // No old 3-zone wrappers.
    expect(container.querySelector('.alm-detailpanel__facts')).toBeNull();
    expect(container.querySelector('.alm-detailpanel__aux')).toBeNull();
  });

  it('places the breakdown table inside the alm-session-detail2 row', () => {
    const { container } = render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        fileMetadata={fileMetadataFixture}
      />
    );
    const row = container.querySelector('.alm-session-detail2');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('Frame type breakdown');
  });

  it('renders the file metadata block inside alm-session-detail2 when fileMetadata provided', () => {
    const { container } = render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        fileMetadata={fileMetadataFixture}
      />
    );
    const metaCol = container.querySelector('.alm-inbox-detail__meta-col');
    expect(metaCol).not.toBeNull();
    expect(metaCol).toHaveAttribute('aria-label', 'File metadata');
    expect(metaCol?.textContent).toContain('File metadata (2)');
  });

  it('does not render the metadata col when fileMetadata is absent', () => {
    const { container } = render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
      />
    );
    expect(container.querySelector('.alm-inbox-detail__meta-col')).toBeNull();
  });

  it('renders the FileInspector inside alm-session-detail2 when metadata exists', () => {
    const { container } = render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
        fileMetadata={fileMetadataFixture}
      />
    );
    const row = container.querySelector('.alm-session-detail2');
    expect(row?.querySelector('[data-testid="file-inspector"]')).not.toBeNull();
  });

  it('renders a PropertyTable col with detection classification', () => {
    const { container } = render(
      <InboxDetail
        item={sampleItem as unknown as Parameters<typeof InboxDetail>[0]['item']}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification as unknown as Parameters<typeof InboxDetail>[0]['classification']}
      />
    );
    // Detection col head
    expect(container.querySelector('.alm-session-detail2__head')).not.toBeNull();
    expect(screen.getByText('Detection')).toBeInTheDocument();
    // Classification value from singleTypeClassification.frameType = 'light'
    expect(screen.getAllByText(/light/).length).toBeGreaterThan(0);
  });
});
