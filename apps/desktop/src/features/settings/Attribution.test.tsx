// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Attribution tests — spec 035 T036 / FR-012.
 *
 * Confirms the static data-source credits for SIMBAD (CDS) and OpenNGC render.
 */

import { render, screen } from '@testing-library/react';
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
});
