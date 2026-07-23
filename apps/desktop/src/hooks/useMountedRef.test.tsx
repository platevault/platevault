// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { StrictMode } from 'react';
import { render } from '@testing-library/react';
import { useMountedRef } from './useMountedRef';
import { assertDefined } from '@/test/assertDefined';

describe('useMountedRef', () => {
  function Probe({ seen }: { seen: { value: boolean | null } }) {
    const mountedRef = useMountedRef();
    // Read in a callback the way real consumers do: after the effects have
    // settled, which is exactly when StrictMode's extra cleanup has already run.
    queueMicrotask(() => {
      seen.value = mountedRef.current;
    });
    return null;
  }

  it('re-arms after the StrictMode mount/cleanup/mount cycle', async () => {
    const seen: { value: boolean | null } = { value: null };
    render(
      <StrictMode>
        <Probe seen={seen} />
      </StrictMode>,
    );
    await new Promise((r) => setTimeout(r, 0));
    // Without the mount-time `mountedRef.current = true`, StrictMode's cleanup
    // latches `false` here and every guarded response is silently dropped.
    expect(seen.value).toBe(true);
  });

  it('reports false once the component really unmounts', async () => {
    const seen: { value: boolean | null } = { value: null };
    let captured: { current: boolean } | null = null;
    function Capture() {
      captured = useMountedRef() as { current: boolean };
      return null;
    }
    const { unmount } = render(<Capture />);
    // Explicit type argument: `captured` is reassigned inside `Capture`, a
    // nested closure TS's control-flow analysis can't see through, so it
    // still treats the read as the initializer type (`null`) even though
    // `render` always invokes `Capture` synchronously — inference off that
    // stale flow type would infer T as `null` instead of the real shape.
    const ref = assertDefined<{ current: boolean }>(
      captured,
      'Capture did not run useMountedRef',
    );
    unmount();
    expect(ref.current).toBe(false);
    expect(seen.value).toBeNull();
  });
});
