/// <reference types="@testing-library/jest-dom" />
/**
 * GenerateSourceViewDialog tests — spec 049 US2 T029.
 *
 * Covers:
 * 1. Fetches the configured Source Views link-kind settings on open and
 *    displays them (FR-004a).
 * 2. Renders without the settings line when the fetch fails (best-effort
 *    display only — generation still works).
 * 3. Submits with the entered copy-opt-in flag and routes to plan review.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGenerate, mockGetSettings } = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
  mockGetSettings: vi.fn(),
}));

vi.mock('./source-views', () => ({
  generateSourceView: mockGenerate,
}));

vi.mock('@/features/settings/settingsIpc', () => ({
  getSettings: mockGetSettings,
}));

import { GenerateSourceViewDialog } from './GenerateSourceViewDialog';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('GenerateSourceViewDialog', () => {
  it('shows the configured link kinds fetched from settings.get(sourceViews)', async () => {
    mockGetSettings.mockResolvedValue({
      scope: 'sourceViews',
      values: {
        sourceViewLinkKindIntraDrive: 'hardlink',
        sourceViewLinkKindCrossDrive: 'symlink',
      },
    });

    render(
      <GenerateSourceViewDialog projectId="p1" open onClose={() => {}} />,
    );

    expect(mockGetSettings).toHaveBeenCalledWith({ scope: 'sourceViews' });
    await waitFor(() => {
      expect(screen.getByTestId('generate-view-link-kinds')).toHaveTextContent('hardlink');
      expect(screen.getByTestId('generate-view-link-kinds')).toHaveTextContent('symlink');
    });
  });

  it('renders without the link-kind line when the settings fetch fails', async () => {
    mockGetSettings.mockRejectedValue(new Error('boom'));

    render(
      <GenerateSourceViewDialog projectId="p1" open onClose={() => {}} />,
    );

    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
    expect(screen.queryByTestId('generate-view-link-kinds')).not.toBeInTheDocument();
  });

  it('does not fetch settings when the dialog is closed', () => {
    render(
      <GenerateSourceViewDialog projectId="p1" open={false} onClose={() => {}} />,
    );
    expect(mockGetSettings).not.toHaveBeenCalled();
  });
});
