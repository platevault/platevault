/**
 * Spec 020 — first-run index gate test (T052) + redirect-loop-fix coverage.
 * When setup is incomplete the index route redirects to /setup; when complete
 * it lands on the app. The DB is the source of truth; localStorage is a cache
 * that must be reconciled to the DB (a stale cache previously caused a /↔/setup
 * redirect loop). Here we assert the underlying decision function.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetPreferences, mockSetPreference, mockFirstrunState } = vi.hoisted(() => ({
  mockGetPreferences: vi.fn(),
  mockSetPreference: vi.fn(),
  mockFirstrunState: vi.fn(),
}));
vi.mock('@/data/preferences', () => ({
  getPreferences: mockGetPreferences,
  setPreference: mockSetPreference,
}));
vi.mock('@/bindings/index', () => ({ commands: { firstrunState: mockFirstrunState } }));

import { checkFirstRunComplete } from '@/app/first-run';

describe('checkFirstRunComplete — mock mode (cache only)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_MOCKS', 'true');
    mockGetPreferences.mockReset();
    mockSetPreference.mockReset();
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

describe('checkFirstRunComplete — real backend (DB is source of truth)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_MOCKS', 'false');
    mockGetPreferences.mockReset();
    mockSetPreference.mockReset();
    mockFirstrunState.mockReset();
  });

  it('uses the DB completedAt (not the cache) and reconciles a stale-false cache up', async () => {
    mockGetPreferences.mockReturnValue({ setupCompleted: false });
    mockFirstrunState.mockResolvedValue({
      status: 'ok',
      data: { completedAt: '2026-06-19T00:00:00Z' },
    });
    await expect(checkFirstRunComplete()).resolves.toBe(true);
    expect(mockSetPreference).toHaveBeenCalledWith('setupCompleted', true);
  });

  it('returns false when the DB has no completedAt and corrects a stale-true cache', async () => {
    // The redirect-loop scenario: cache says done, DB says not done.
    mockGetPreferences.mockReturnValue({ setupCompleted: true });
    mockFirstrunState.mockResolvedValue({ status: 'ok', data: { completedAt: null } });
    await expect(checkFirstRunComplete()).resolves.toBe(false);
    expect(mockSetPreference).toHaveBeenCalledWith('setupCompleted', false);
  });

  it('does not rewrite the cache when it already matches the DB', async () => {
    mockGetPreferences.mockReturnValue({ setupCompleted: true });
    mockFirstrunState.mockResolvedValue({
      status: 'ok',
      data: { completedAt: '2026-06-19T00:00:00Z' },
    });
    await expect(checkFirstRunComplete()).resolves.toBe(true);
    expect(mockSetPreference).not.toHaveBeenCalled();
  });

  it('falls back to the cache when the backend errors', async () => {
    mockGetPreferences.mockReturnValue({ setupCompleted: true });
    mockFirstrunState.mockResolvedValue({ status: 'error', error: 'boom' });
    await expect(checkFirstRunComplete()).resolves.toBe(true);
    expect(mockSetPreference).not.toHaveBeenCalled();
  });
});
