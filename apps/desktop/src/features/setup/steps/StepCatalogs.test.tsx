/// <reference types="@testing-library/jest-dom" />
/**
 * StepCatalogs tests — select-then-download flow + graceful unavailable state.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useState } from 'react';

const { mockManifestFetch, mockCatalogDownload } = vi.hoisted(() => ({
  mockManifestFetch: vi.fn(),
  mockCatalogDownload: vi.fn(),
}));

vi.mock('@/api/commands', () => ({
  catalogManifestFetch: mockManifestFetch,
  catalogDownload: mockCatalogDownload,
}));

import { StepCatalogs, DEFAULT_CATALOG_SETTINGS } from './StepCatalogs';
import type { CatalogSettings } from './StepCatalogs';

// A small manifest fixture matching the ManifestCatalogEntry shape.
const MANIFEST = {
  version: '1',
  signature: 'sig',
  catalogs: [
    { catalogId: 'common', version: '1', url: 'u', checksum: 'c', license: 'CC0', sizeBytes: 2048 },
    { catalogId: 'openngc', version: '1', url: 'u', checksum: 'c', license: 'CC-BY', sizeBytes: 1048576 },
  ],
};

/** Harness that owns CatalogSettings state so onSettingsChange round-trips. */
function Harness() {
  const [settings, setSettings] = useState<CatalogSettings>(DEFAULT_CATALOG_SETTINGS);
  return <StepCatalogs settings={settings} onSettingsChange={setSettings} />;
}

async function renderReady() {
  mockManifestFetch.mockResolvedValueOnce({ status: 'fetched', manifest: MANIFEST, etag: 'e1', error: null });
  await act(async () => {
    render(<Harness />);
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  mockManifestFetch.mockReset();
  mockCatalogDownload.mockReset();
});

describe('StepCatalogs', () => {
  it('renders a selectable row per manifest catalog, all pre-selected by default', async () => {
    await renderReady();

    expect(screen.getByTestId('catalog-row-common')).toBeInTheDocument();
    expect(screen.getByTestId('catalog-row-openngc')).toBeInTheDocument();

    // Both pre-selected → "Download selected (2)".
    const dl = screen.getByRole('button', { name: /download selected/i });
    expect(dl).toHaveTextContent('Download selected (2)');
    expect(dl).not.toBeDisabled();
  });

  it('downloads only the selected catalogs and shows per-row success', async () => {
    await renderReady();

    // Deselect openngc so only common downloads.
    fireEvent.click(screen.getByLabelText('Select openngc'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /download selected/i })).toHaveTextContent('(1)');
    });

    mockCatalogDownload.mockResolvedValue({ status: 'success', auditId: 'a', error: null });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /download selected/i }));
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(() => {
      expect(screen.getByTestId('catalog-row-common')).toHaveTextContent(/installed/i);
    });
    // Only the selected catalog was downloaded.
    expect(mockCatalogDownload).toHaveBeenCalledTimes(1);
    expect(mockCatalogDownload).toHaveBeenCalledWith(expect.objectContaining({ catalogId: 'common' }));
  });

  it('disables "Download selected" when nothing is selected', async () => {
    await renderReady();

    fireEvent.click(screen.getByLabelText('Select common'));
    fireEvent.click(screen.getByLabelText('Select openngc'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /download selected/i })).toBeDisabled();
    });
  });

  it('shows a failed badge with Retry when a download fails', async () => {
    await renderReady();

    fireEvent.click(screen.getByLabelText('Select openngc')); // leave only common
    mockCatalogDownload.mockResolvedValue({ status: 'failure', auditId: null, error: { code: 'x', message: 'boom' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /download selected/i }));
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(() => {
      expect(screen.getByTestId('catalog-row-common')).toHaveTextContent(/failed/i);
    });
    expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument();
  });

  it('shows a graceful unavailable state (not a raw error) when the manifest fails', async () => {
    mockManifestFetch.mockResolvedValueOnce({ status: 'failed', manifest: null, etag: null, error: { code: 'http', message: '404 Not Found' } });
    await act(async () => {
      render(<Harness />);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.getByTestId('catalogs-unavailable')).toBeInTheDocument();
    expect(screen.getByText(/isn.t available yet/i)).toBeInTheDocument();
    // No raw 404 / error message surfaced.
    expect(screen.queryByText(/404/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('retries the manifest fetch from the unavailable state and recovers', async () => {
    mockManifestFetch.mockResolvedValueOnce({ status: 'failed', manifest: null, etag: null, error: null });
    await act(async () => {
      render(<Harness />);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByTestId('catalogs-unavailable')).toBeInTheDocument();

    mockManifestFetch.mockResolvedValueOnce({ status: 'fetched', manifest: MANIFEST, etag: 'e1', error: null });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(() => {
      expect(screen.getByTestId('catalogs-list')).toBeInTheDocument();
    });
  });
});
