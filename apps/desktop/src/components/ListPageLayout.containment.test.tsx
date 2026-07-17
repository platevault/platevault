// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Container-level scroll containment tests — spec 054 T004 (the #816
 * regression pin).
 *
 * jsdom has no real layout engine, so this can't assert actual pixel
 * scrolling; it asserts the STRUCTURAL contract that CSS containment (T008)
 * depends on: a plain overflowing block passed as `DetailPanel` children —
 * with NO facts/aux slots and no scroll markup of its own — still ends up
 * inside `.alm-detailpanel__content` (the one CSS-guaranteed scroll surface,
 * tables-lists.css/merges-2.css/app-shell.css), in EVERY ListPageLayout
 * placement (bottom/side/split). Before T008, content-only `DetailPanel`
 * rendered bare children with no such wrapper at all.
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ListPageLayout } from './ListPageLayout';
import { DetailPanel } from './DetailPanel';
import type { EffectivePlacement } from './useDetailDock';

function PlainOverflowingBlock() {
  // No facts/aux, no own overflow/scroll styling — exactly the "hand-rolled
  // consumer" shape #816 broke on.
  return <div data-testid="plain-block">tall unstructured content</div>;
}

describe('DetailPanel container-level containment (#816)', () => {
  it.each<EffectivePlacement>([
    'bottom',
    'side',
    'split',
  ])('wraps content-only children in .alm-detailpanel__content in %s placement', (placement) => {
    const { container, getByTestId } = render(
      <ListPageLayout
        topBar={<div>bar</div>}
        dockPage="sessions"
        forcedPlacement={placement}
        detail={
          <DetailPanel title="Selected item">
            <PlainOverflowingBlock />
          </DetailPanel>
        }
      >
        <div>main</div>
      </ListPageLayout>,
    );

    // The shared scroll surface exists and contains the plain block.
    const scroller = container.querySelector('.alm-detailpanel__content');
    expect(scroller).toBeInTheDocument();
    expect(scroller).toContainElement(getByTestId('plain-block'));

    // `.alm-listpage__detail` (the existing e2e locator, T009) resolves in
    // every placement, alongside the placement-specific modifier class.
    const detailRegion = container.querySelector('.alm-listpage__detail');
    expect(detailRegion).toBeInTheDocument();
    if (placement === 'side') {
      expect(detailRegion).toHaveClass('alm-listpage__detail--side');
    } else if (placement === 'split') {
      expect(detailRegion).toHaveClass('alm-listpage__detail--split');
    }

    // The shared-component marker (T012a) is present on the panel root.
    expect(container.querySelector('[data-shared-detail]')).toBeInTheDocument();
  });

  it('also wraps 3-zone (facts + content) children in .alm-detailpanel__content', () => {
    const { container, getByTestId } = render(
      <ListPageLayout
        topBar={<div>bar</div>}
        detail={
          <DetailPanel title="Selected item" facts={<div>facts</div>}>
            <PlainOverflowingBlock />
          </DetailPanel>
        }
      >
        <div>main</div>
      </ListPageLayout>,
    );
    const scroller = container.querySelector('.alm-detailpanel__content');
    expect(scroller).toBeInTheDocument();
    expect(scroller).toContainElement(getByTestId('plain-block'));
  });
});
