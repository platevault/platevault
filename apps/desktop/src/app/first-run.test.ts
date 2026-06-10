/**
 * Spec 020 — first-run index gate test (T052).
 * When setup is incomplete the index route redirects to /setup; when complete
 * it lands on the app. Here we assert the underlying decision function.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetPreferences } = vi.hoisted(() => ({ mockGetPreferences: vi.fn() }));
vi.mock('@/data/preferences', () => ({ getPreferences: mockGetPreferences }));

import { checkFirstRunComplete } from '@/app/first-run';

describe('checkFirstRunComplete (T052)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_MOCKS', 'true');
    mockGetPreferences.mockReset();
  });

  it('returns true when setup is completed (index lands on the app)', async () => {
    mockGetPreferences.mockReturnValue({ setupCompleted: true });
    await expect(checkFirstRunComplete()).resolves.toBe(true);
  });

  it('returns false when setup is incomplete (index redirects to /setup)', async () => {
    mockGetPreferences.mockReturnValue({ setupCompleted: false });
    await expect(checkFirstRunComplete()).resolves.toBe(false);
  });
});
