// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Attribution tests — spec 035 T036 / FR-012.
 *
 * Confirms the static data-source credits for SIMBAD (CDS) and OpenNGC render.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { Attribution } from './Attribution';

describe('Attribution', () => {
  it('credits SIMBAD (CDS) and OpenNGC', () => {
    render(<Attribution />);
    expect(screen.getByText('SIMBAD')).toBeInTheDocument();
    expect(
      screen.getByText(/CDS, Université de Strasbourg/),
    ).toBeInTheDocument();
    expect(screen.getByText('OpenNGC')).toBeInTheDocument();
  });

  it('links to the source homepages', () => {
    render(<Attribution />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs.some((h) => h?.includes('simbad'))).toBe(true);
    expect(hrefs.some((h) => h?.includes('OpenNGC'))).toBe(true);
  });

  // SIL OFL 1.1 clause 2: a bundled font must travel with its copyright notice
  // and licence, viewable by the user. Spec 055 made Inter redistributed rather
  // than CDN-linked, so this credit is a licence obligation, not a courtesy.
  it('credits Inter and names its licence', () => {
    render(<Attribution />);
    expect(screen.getByText('Inter')).toBeInTheDocument();
    expect(screen.getByText(/SIL Open Font License 1\.1/)).toBeInTheDocument();
  });

  // Under vitest (and in mock mode) there is no Tauri runtime, so resolving the
  // bundled resource throws. The button must degrade to a notice naming where
  // the licence lives rather than dead-ending — without this the fallback
  // branch would never execute anywhere, which is how it would rot unnoticed.
  it('falls back to naming the licence path when it cannot be opened', async () => {
    render(<Attribution />);
    fireEvent.click(screen.getByRole('button', { name: /view licence/i }));
    await waitFor(() =>
      expect(screen.getByText(/licenses\/Inter-OFL\.txt/)).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: /view licence/i }),
    ).not.toBeInTheDocument();
  });
});
