/// <reference types="@testing-library/jest-dom" />
/**
 * OutputsCleanupSections tests — spec 043 §4 (task #44).
 *
 * Verifies the Outputs + Cleanup-preview sections render correctly, including:
 * - Outputs teaching empty state when no accepted outputs exist (STUB path).
 * - Outputs table + verification pills when outputs are present.
 * - Cleanup-preview themed alert + LOCKED protected categories.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { OutputsSection, CleanupPreviewSection } from './OutputsCleanupSections';

describe('OutputsSection (spec 043 §4)', () => {
  it('renders a teaching empty state when no outputs exist (STUB path)', () => {
    render(<OutputsSection />);
    expect(screen.getByTestId('project-outputs')).toBeInTheDocument();
    expect(screen.getByText('No accepted outputs yet')).toBeInTheDocument();
    // No fabricated table rows.
    expect(screen.queryByText('VERIFICATION')).not.toBeInTheDocument();
  });

  it('renders a verification pill per output when outputs are supplied', () => {
    render(
      <OutputsSection
        outputs={[
          { id: 'o1', name: 'NGC7000_HOO.xisf', format: 'XISF', verified: true },
          { id: 'o2', name: 'NGC7000_draft.tif', format: 'TIFF', verified: false },
        ]}
      />,
    );
    expect(screen.getByText('NGC7000_HOO.xisf')).toBeInTheDocument();
    expect(screen.getByText('verified')).toBeInTheDocument();
    expect(screen.getByText('unverified')).toBeInTheDocument();
    expect(screen.queryByText('No accepted outputs yet')).not.toBeInTheDocument();
  });
});

describe('CleanupPreviewSection (spec 043 §4)', () => {
  it('renders a themed alert and LOCKED protected categories (STUB path)', () => {
    render(<CleanupPreviewSection />);
    expect(screen.getByTestId('project-cleanup-preview')).toBeInTheDocument();
    // Themed alert is present (Banner with role=status).
    expect(screen.getByRole('status')).toBeInTheDocument();
    // Protected categories block is present and shown locked.
    const protectedBlock = screen.getByTestId('cleanup-protected');
    expect(protectedBlock).toBeInTheDocument();
    expect(screen.getByText('Accepted outputs')).toBeInTheDocument();
    expect(screen.getByText('Master calibration frames')).toBeInTheDocument();
    expect(screen.getByText('Source acquisition frames')).toBeInTheDocument();
  });

  it('summarises candidate count when a preview is supplied', () => {
    render(<CleanupPreviewSection preview={{ candidateCount: 1, reclaimableBytes: 1024 }} />);
    expect(screen.getByText(/1 candidate/)).toBeInTheDocument();
  });
});
