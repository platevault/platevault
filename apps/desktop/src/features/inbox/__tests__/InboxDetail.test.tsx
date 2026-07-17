// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Tests for InboxDetail (FR-010: per-file metadata table, FR-011: mixed
 * composition summary).
 *
 * Scope: ONLY InboxDetail.tsx. Uses fixtures; no IPC mocks needed because
 * InboxDetail never fetches — it renders the data it receives.
 *
 * InboxFileMetadata is the generated Specta type (camelCase), re-exported via
 * '@/bindings/index' (spec 041 US2/FR-010 — wired in T019):
 *   relativeFilePath, frameTypeEffective, imageTyp, filter, exposureS, binningX,
 *   binningY, gain (string), temperatureC, object, dateObs, instrume, telescop,
 *   naxis1, naxis2, stackCount, isMaster, overrideStale
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type {
  InboxFileMetadata_Serialize as InboxFileMetadata,
  InboxClassifyResponse_Serialize as InboxClassifyResponse,
  InboxItemSummary_Serialize as InboxItemSummary,
} from '@/bindings';

import { m } from '@/lib/i18n';
import { InboxDetail } from '../InboxDetail';

// InboxDetail uses the TanStack-Query-backed `useInboxReclassify` hook (spec 042),
// so every render must be wrapped in a QueryClientProvider.
function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

// ── Mock reclassify hook ─────────────────────────────────────────────────────
vi.mock('@/bindings/index', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/bindings/index')>();
  return {
    ...mod,
    commands: {
      ...mod.commands,
      inboxReclassify: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          inboxItemId: 'item-001',
          remainingUnclassified: 0,
        },
      }),
    },
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

/** A detected calibration master file (#551 repro: masters never get a
 * per-file `inbox_file_metadata` row — `fileMetadata` is always empty for
 * them — so the required-attribute gate has no data to evaluate). */
const masterItem: InboxItemSummary = {
  inboxItemId: 'item-master-001',
  relativePath: 'masterDark.fit',
  fileCount: 1,
  lane: 'fits',
  format: 'fits',
  state: 'classified',
  contentSignature: 'sig-master-001',
  isMaster: true,
  masterFrameType: 'dark',
  masterFilter: null,
  masterExposureS: 300,
};

/** Classification with three frame types → classType "mixed" */
const mixedClassification: InboxClassifyResponse = {
  inboxItemId: 'item-001',
  type: 'mixed',
  frameType: null,
  contentSignature: 'sig-001',
  breakdown: [
    {
      kind: 'light',
      count: 12,
      destinationPreview: 'NGC7000/Ha/light/',
      sampleFiles: [],
    },
    {
      kind: 'dark',
      count: 4,
      destinationPreview: 'calib/dark/',
      sampleFiles: [],
    },
    {
      kind: 'flat',
      count: 1,
      destinationPreview: 'calib/flat/',
      sampleFiles: [],
    },
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
    {
      kind: 'light',
      count: 17,
      destinationPreview: 'NGC7000/Ha/light/',
      sampleFiles: [],
    },
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
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification}
      />,
    );
    const summary = screen.getByLabelText('Mixed composition summary');
    expect(summary).toBeInTheDocument();
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
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification}
      />,
    );
    expect(
      screen.queryByLabelText('Mixed composition summary'),
    ).not.toBeInTheDocument();
  });

  it('does NOT render a composition summary when classification is null', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={null}
      />,
    );
    expect(
      screen.queryByLabelText('Mixed composition summary'),
    ).not.toBeInTheDocument();
  });
});

// ── FR-010: Per-file metadata popover trigger ─────────────────────────────────
//
// The metadata table now lives inside a portaled Popover. The trigger button
// ("File metadata (N) ▾") is always visible when fileMetadata is provided.
// The table columns are inside the popup (not in the DOM until the popup is
// opened — base-ui portals), so tests assert the trigger and the table content
// that IS rendered in the document (the trigger renders unconditionally).

describe('InboxDetail — FR-010: file metadata popover trigger', () => {
  it('renders the popover trigger button when fileMetadata is provided', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification}
        fileMetadata={fileMetadataFixture}
      />,
    );
    expect(
      screen.getByTestId('inbox-files-popover-trigger'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('inbox-files-popover-trigger').textContent,
    ).toContain('File metadata (2)');
  });

  it('does NOT render the popover trigger when fileMetadata is absent', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification}
      />,
    );
    expect(
      screen.queryByTestId('inbox-files-popover-trigger'),
    ).not.toBeInTheDocument();
  });

  it('does NOT render the popover trigger when fileMetadata is an empty array', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification}
        fileMetadata={[]}
      />,
    );
    expect(
      screen.queryByTestId('inbox-files-popover-trigger'),
    ).not.toBeInTheDocument();
  });

  it('renders both the FR-011 composition summary and the FR-010 popover trigger simultaneously', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification}
        fileMetadata={fileMetadataFixture}
      />,
    );
    expect(
      screen.getByLabelText('Mixed composition summary'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('inbox-files-popover-trigger'),
    ).toBeInTheDocument();
  });

  it('opens the popup with the metadata table when the trigger is clicked', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification}
        fileMetadata={fileMetadataFixture}
      />,
    );
    fireEvent.click(screen.getByTestId('inbox-files-popover-trigger'));
    // Popup should now be in the DOM (portaled to body).
    expect(screen.getByTestId('inbox-files-popup')).toBeInTheDocument();
    // File paths appear in the popup table.
    expect(screen.getByTitle('light_0001.fits')).toBeInTheDocument();
    expect(screen.getByTitle('calib_dark_0001.fits')).toBeInTheDocument();
  });

  it('popup contains the missing-attr badge for files that need it', () => {
    const withMissing: InboxFileMetadata[] = [
      {
        ...fileMetadataFixture[0],
        relativeFilePath: 'light_ok.fits',
        missingPathAttributes: [],
      },
      {
        ...fileMetadataFixture[0],
        relativeFilePath: 'light_nodate.fits',
        dateObs: null,
        missingPathAttributes: ['date'],
      },
    ];
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification}
        fileMetadata={withMissing}
      />,
    );
    fireEvent.click(screen.getByTestId('inbox-files-popover-trigger'));
    const badge = screen.getByTestId('inbox-missing-attr-light_nodate.fits');
    expect(badge).toHaveTextContent('needs date');
    expect(
      screen.queryByTestId('inbox-missing-attr-light_ok.fits'),
    ).not.toBeInTheDocument();
  });
});

// ── FR-032 (US9): missing path-load-bearing attribute gate ───────────────────

describe('InboxDetail — FR-032: missing-attribute banner', () => {
  const withMissing: InboxFileMetadata[] = [
    {
      ...fileMetadataFixture[0],
      relativeFilePath: 'light_ok.fits',
      missingPathAttributes: [],
    },
    {
      ...fileMetadataFixture[0],
      relativeFilePath: 'light_nodate.fits',
      dateObs: null,
      missingPathAttributes: ['date'],
    },
  ];

  it('shows a summary banner counting the blocked files', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification}
        fileMetadata={withMissing}
      />,
    );
    expect(screen.getByTestId('inbox-missing-attr-banner')).toHaveTextContent(
      '1 file',
    );
  });

  it('renders no banner when no file is missing attributes', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification}
        fileMetadata={fileMetadataFixture}
      />,
    );
    expect(
      screen.queryByTestId('inbox-missing-attr-banner'),
    ).not.toBeInTheDocument();
  });

  // #554: the banner used to be its own trailing `.alm-session-detail2__col`
  // (a separate full-width alert competing with the property tables). It now
  // lives inline inside the Files column, right below the popover trigger it
  // explains.
  it('renders inline in the Files column, not as a separate trailing column', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification}
        fileMetadata={withMissing}
      />,
    );
    const banner = screen.getByTestId('inbox-missing-attr-banner');
    const trigger = screen.getByTestId('inbox-files-popover-trigger');
    // Same `.alm-session-detail2__col` ancestor as the Files trigger — i.e.
    // the banner is NOT its own separate trailing column.
    const filesCol = trigger.closest('.alm-session-detail2__col');
    expect(filesCol).not.toBeNull();
    expect(filesCol?.contains(banner)).toBe(true);
  });
});

// ── #551: item-detail gating parity with the "batch"/list view ───────────────
//
// Master items never get a per-file `inbox_file_metadata` row (they bypass
// classify()'s persist_file_metadata path — see
// crates/app/inbox/src/metadata.rs), so `fileMetadata` is always empty for
// them and the FR-032 missing-attribute gate has no data to evaluate. Before
// this fix that silently rendered as "No file metadata" with no caveat,
// which read as "nothing to worry about" even though `inbox.confirm` can
// still reject the file server-side (`inbox.missing_path_attributes`) —
// the exact item-view-vs-batch-view mismatch reported in #551.
describe('InboxDetail — #551: honest "unknown" state when no per-file metadata is available', () => {
  it('appends a caveat explaining the gate is unverified, instead of implying "all clear"', () => {
    render(
      <InboxDetail
        item={masterItem}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification}
      />,
    );
    const empty = screen.getByText(/No file metadata/);
    expect(empty.textContent).toContain('Required-attribute status');
  });
});

// ── task #34: mixed-folder — banner in body, action in header ────────────────

describe('InboxDetail — task #34: mixed-folder banner + header confirm action', () => {
  it('renders the mixed banner AND the confirm button (labelled "Generate split plan") in the header', () => {
    const onConfirm = vi.fn();
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification}
        onConfirm={onConfirm}
        confirmLabel="Generate split plan"
      />,
    );
    expect(screen.getByTestId('inbox-mixed-alert')).toBeInTheDocument();
    const btn = screen.getByTestId('inbox-confirm-btn');
    expect(btn).toHaveTextContent('Generate split plan');
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // Button is NOT inside the banner.
    const banner = screen.getByTestId('inbox-mixed-alert');
    expect(
      banner.querySelector('[data-testid="inbox-confirm-btn"]'),
    ).toBeNull();
  });

  it('disables the header confirm button while busy', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification}
        onConfirm={vi.fn()}
        confirmLabel="Generate split plan"
        confirmBusy
      />,
    );
    expect(screen.getByTestId('inbox-confirm-btn')).toBeDisabled();
  });

  it('does not render the header confirm button when no callback is supplied', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification}
      />,
    );
    expect(screen.getByTestId('inbox-mixed-alert')).toBeInTheDocument();
    expect(screen.queryByTestId('inbox-confirm-btn')).not.toBeInTheDocument();
  });

  it('does NOT render the mixed banner for single-type folders, but DOES render the confirm button', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('inbox-mixed-alert')).not.toBeInTheDocument();
    // The unified confirm action (default label "Confirm to inventory") is the
    // per-detection primary action for single-type folders.
    expect(screen.getByTestId('inbox-confirm-btn')).toHaveTextContent(
      'Confirm to inventory',
    );
  });

  // #552/#569: the banner used to say "Confirm to produce a reviewable split
  // plan" — but Confirm is disabled entirely for mixed rows (spec 041
  // FR-050/T071/T072: the backend "split" action was removed), so that
  // promised a click that could never do anything. The folder is actually
  // ALREADY auto-split into separate single-type sub-items by the time this
  // banner renders (classify() materializes them — T066); the copy must
  // point there instead of a nonexistent "Confirm"-triggered split.
  it('#552/#569: does not promise a Confirm-triggered split; explains the automatic split instead', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification}
      />,
    );
    const banner = screen.getByTestId('inbox-mixed-alert');
    expect(banner.textContent).toContain(m.inbox_mixed_folder_body());
    expect(banner.textContent).not.toMatch(/Confirm to produce/i);
  });
});

// ── Compact layout: SessionDetail-style left-packed col ───────────────────────
//
// The body is a .alm-session-detail2 flex row.
// Col A: PropertyTable with detection facts + mixed-summary line + Files popover trigger.
// No breakdown table. No inline metadata col. No FileInspector in the row.

describe('InboxDetail — compact layout: detection col + popover trigger', () => {
  it('renders the alm-session-detail2 row wrapper', () => {
    const { container } = render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification}
        fileMetadata={fileMetadataFixture}
      />,
    );
    expect(container.querySelector('.alm-session-detail2')).not.toBeNull();
    // No old 3-zone wrappers.
    expect(container.querySelector('.alm-detailpanel__facts')).toBeNull();
    expect(container.querySelector('.alm-detailpanel__aux')).toBeNull();
    // No inline metadata col (it lives in the popover).
    expect(container.querySelector('.alm-inbox-detail__meta-col')).toBeNull();
  });

  // #553: DetailPanel's content-only mode renders `children` with no scroll
  // wrapper (that mode assumes a self-scrolling child like a virtualized
  // Table). InboxDetail's body isn't one — it wraps everything in
  // `.alm-inbox-detail__scroll`, the sole scroll region (see detail-panes.css
  // `:has()` rule pinning the header above it), so FILES/Needs-review content
  // taller than the docked panel's max-height scrolls instead of being
  // clipped by the ancestor `.alm-listpage__detail-body`'s `overflow:hidden`.
  it('#553: wraps the body in the sole scroll region, containing the session-detail2 row', () => {
    const { container } = render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification}
        fileMetadata={fileMetadataFixture}
      />,
    );
    const scroll = container.querySelector('.alm-inbox-detail__scroll');
    expect(scroll).not.toBeNull();
    expect(
      scroll?.contains(container.querySelector('.alm-session-detail2')),
    ).toBe(true);
  });

  it('renders detection facts spread across multiple property columns', () => {
    const { container } = render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification}
        fileMetadata={fileMetadataFixture}
      />,
    );
    // Left-packed multi-column body (Sessions convention): ≥2 columns.
    expect(
      container.querySelectorAll('.alm-session-detail2__col').length,
    ).toBeGreaterThanOrEqual(2);
    // The Files column carries a head label (scoped to the head element —
    // "Files" also appears as a PropertyTable row label).
    const heads = [...container.querySelectorAll('.alm-session-detail2__head')];
    expect(heads.some((h) => h.textContent === 'Files')).toBe(true);
    // 'light' from frameType appears in the PropertyTable value.
    expect(screen.getAllByText(/light/).length).toBeGreaterThan(0);
  });

  it('mixed composition summary renders inside a detail column', () => {
    const { container } = render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification}
      />,
    );
    const cols = [...container.querySelectorAll('.alm-session-detail2__col')];
    expect(cols.length).toBeGreaterThan(0);
    // Summary lives within one of the left-packed columns (the Files column).
    expect(
      cols.some(
        (c) =>
          c.querySelector('[aria-label="Mixed composition summary"]') != null,
      ),
    ).toBe(true);
  });

  it('files popover trigger renders inside a detail column', () => {
    const { container } = render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification}
        fileMetadata={fileMetadataFixture}
      />,
    );
    const cols = [...container.querySelectorAll('.alm-session-detail2__col')];
    expect(
      cols.some(
        (c) =>
          c.querySelector('[data-testid="inbox-files-popover-trigger"]') !=
          null,
      ),
    ).toBe(true);
  });

  it('no breakdown table is rendered in the detail body', () => {
    const { container } = render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification}
      />,
    );
    // The old frame-type breakdown table buttons are gone.
    expect(
      container.querySelector('[data-testid^="breakdown-filter-"]'),
    ).toBeNull();
    expect(screen.queryByText('Frame type breakdown')).not.toBeInTheDocument();
  });
});

// ── spec-030 Q16 (#620, #619): missing vs not-applicable per-row ────────────

describe('InboxDetail — missing-value semantics (Q16 / #620)', () => {
  it('detection facts (col A/B) render the unresolved chip for a missing applicable value, never a bare dash', () => {
    // singleTypeClassification is 'light' — filter/target/exposure are all
    // applicable to light, so a null repFile field must render the chip.
    const noFilter: InboxFileMetadata[] = [
      { ...fileMetadataFixture[0], filter: null },
    ];
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification}
        fileMetadata={noFilter}
      />,
    );
    expect(screen.getAllByTestId('unresolved-chip').length).toBeGreaterThan(0);
  });

  it('per-file metadata popup: filter/target cells are blank (not-applicable) on a dark row, never the unresolved chip', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification}
        fileMetadata={fileMetadataFixture}
      />,
    );
    fireEvent.click(screen.getByTestId('inbox-files-popover-trigger'));
    // calib_dark_0001.fits (frameTypeEffective: 'dark') has filter=null and
    // object=null — both not-applicable to dark (data-model.md matrix), so
    // those specific cells must render blank, never the unresolved chip.
    // Column order (metadataColumns): file, type, filter, exposure, binning,
    // gain, temp, object, date.
    const darkRow = screen.getByTitle('calib_dark_0001.fits').closest('tr');
    expect(darkRow).not.toBeNull();
    const cells = darkRow?.querySelectorAll('td') ?? [];
    const filterCell = cells[2];
    const objectCell = cells[7];
    expect(
      filterCell.querySelector('[data-testid="unresolved-chip"]'),
    ).toBeNull();
    expect(
      objectCell.querySelector('[data-testid="unresolved-chip"]'),
    ).toBeNull();
    // Exposure/temp/date ARE applicable to dark and are absent on this
    // fixture row — they DO get the unresolved chip (the contrast that
    // proves filter/object are genuinely not-applicable, not just "also
    // missing").
    const exposureCell = cells[3];
    expect(
      exposureCell.querySelector('[data-testid="unresolved-chip"]'),
    ).not.toBeNull();
  });

  it('per-file metadata popup: a missing-but-applicable value on a light row renders the unresolved chip', () => {
    const lightMissingGain: InboxFileMetadata[] = [
      { ...fileMetadataFixture[0], gain: null },
    ];
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification}
        fileMetadata={lightMissingGain}
      />,
    );
    fireEvent.click(screen.getByTestId('inbox-files-popover-trigger'));
    const row = screen.getByTitle('light_0001.fits').closest('tr');
    expect(row).not.toBeNull();
    expect(
      row?.querySelector('[data-testid="unresolved-chip"]'),
    ).not.toBeNull();
  });

  it('FileInspector: telescope is not-applicable (blank) for a dark file, never the unresolved chip', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification}
        fileMetadata={fileMetadataFixture}
      />,
    );
    fireEvent.click(screen.getByTestId('inbox-files-popover-trigger'));
    // Click the dark row to inspect it (telescop is null on that fixture row).
    fireEvent.click(screen.getByTitle('calib_dark_0001.fits'));
    const telescopeRow = screen.getByTestId('inspector-telescop');
    expect(
      telescopeRow.querySelector('[data-testid="unresolved-chip"]'),
    ).toBeNull();
  });

  it('FileInspector: instrument (always-applicable) missing on the dark file renders the unresolved chip', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification}
        fileMetadata={fileMetadataFixture}
      />,
    );
    fireEvent.click(screen.getByTestId('inbox-files-popover-trigger'));
    fireEvent.click(screen.getByTitle('calib_dark_0001.fits'));
    const instrumeRow = screen.getByTestId('inspector-instrume');
    expect(
      instrumeRow.querySelector('[data-testid="unresolved-chip"]'),
    ).not.toBeNull();
  });
});
