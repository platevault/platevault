/**
 * Spec 020 — stale-id cleanup hook tests (T053 / D-020-H1: fires at most once).
 *
 * The page supplies `clear`, which performs
 * `navigate({ search: prev => ({ ...prev, selected: undefined }), replace: true })`.
 * This suite asserts the hook's guard: it invokes `clear` exactly once per
 * stale id, never when found, and never when nothing is selected.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';

describe('useStaleSelectionCleanup', () => {
  it('clears exactly once when selected is set but missing, across re-renders', () => {
    const clear = vi.fn();
    const { rerender } = renderHook(
      ({ s, f }: { s: number | undefined; f: boolean }) => useStaleSelectionCleanup(s, f, clear),
      { initialProps: { s: 999, f: false } },
    );
    rerender({ s: 999, f: false });
    rerender({ s: 999, f: false });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('does not clear when the entity is found', () => {
    const clear = vi.fn();
    renderHook(() => useStaleSelectionCleanup(3, true, clear));
    expect(clear).not.toHaveBeenCalled();
  });

  it('does not clear when nothing is selected', () => {
    const clear = vi.fn();
    renderHook(() => useStaleSelectionCleanup(undefined, false, clear));
    expect(clear).not.toHaveBeenCalled();
  });

  it('clears again for a different stale id after the param resets', () => {
    const clear = vi.fn();
    const { rerender } = renderHook(
      ({ s, f }: { s: number | undefined; f: boolean }) => useStaleSelectionCleanup(s, f, clear),
      { initialProps: { s: 1 as number | undefined, f: false } },
    );
    rerender({ s: undefined, f: false }); // selection cleared -> guard resets
    rerender({ s: 2, f: false }); // a new stale id
    expect(clear).toHaveBeenCalledTimes(2);
  });
});
