/// <reference types="@testing-library/jest-dom" />
/**
 * MasterDetail — platform-native Reveal label (shared revealLabel()).
 *
 * The Reveal action previously hardcoded one Windows-flavoured catalog key on
 * every OS; it now renders the shared platform-native revealLabel(). jsdom
 * reports no platform → the Linux-generic label; one Windows case proves the
 * platform source is actually consulted.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MasterDetail } from './MasterDetail';
import type { CalibrationMaster_Serialize as CalibrationMaster } from '@/bindings/index';

// Detail data-loading is not under test — resolve both commands empty.
vi.mock('@/bindings/index', () => ({
  commands: {
    calibrationMastersGet: vi.fn().mockResolvedValue({
      status: 'ok',
      data: { usedBySessionIds: [], compatibleSessions: [] },
    }),
    sessionsList: vi.fn().mockResolvedValue({ status: 'ok', data: { sources: [] } }),
  },
}));

function makeMaster(): CalibrationMaster {
  return {
    id: 'm-1',
    kind: 'dark',
    fingerprint: { camera: 'ASI2600MM', exposureS: 300, tempC: -10, gain: 100, binning: '1x1' },
    sourceSessionId: 'cal-ses-001',
    createdAt: '2026-01-01T00:00:00Z',
    ageDays: 30,
    sizeBytes: 128 * 1024 * 1024,
    usedBySessionIds: [],
    usedByProjectIds: [],
  };
}

afterEach(() => {
  // Drop any instance-level platform override (prototype default returns).
  delete (window.navigator as unknown as Record<string, unknown>).platform;
});

describe('MasterDetail — Reveal label', () => {
  it('renders the Linux-generic label under jsdom (no platform)', () => {
    render(<MasterDetail master={makeMaster()} prefillSuggestion={false} agingThresholdDays={90} />);
    expect(screen.getByRole('button', { name: 'Show in file manager' })).toBeInTheDocument();
  });

  it('renders the Windows label when the platform reports Win32', () => {
    Object.defineProperty(window.navigator, 'platform', { value: 'Win32', configurable: true });
    render(<MasterDetail master={makeMaster()} prefillSuggestion={false} agingThresholdDays={90} />);
    expect(screen.getByRole('button', { name: 'Show in File Explorer' })).toBeInTheDocument();
  });
});
