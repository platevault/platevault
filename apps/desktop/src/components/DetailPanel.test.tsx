// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * DetailPanel unit tests — tasks #100/#99/#101, spec 043 §4.
 *
 * Verifies:
 * 1. Renders provided title text.
 * 2. Renders optional subtitle text.
 * 3. Renders titleExtra alongside the title.
 * 4. Renders action buttons in the header area.
 * 5. Renders children in the body.
 * 6. Empty-state: renders without title/subtitle/actions (graceful empty).
 * 7. Row-data contract: actions slot is structurally separate from title slot
 *    (title and actions render in distinct DOM regions, not collapsed together).
 * 8. variant="sessions" renders without error.
 * 9. variant="calibration" renders without error.
 * 10. facts prop: renders facts content in a distinct left column.
 * 11. facts prop: facts column and children column are structurally separate.
 * 12. facts prop: when omitted, children render without two-column wrapper.
 * 13. variant="inbox" renders without error.
 * 14. FactsKV: renders label and value.
 * 15. FactsKV: renders optional provenance label.
 * 16. aux prop: renders aux content in a distinct right column.
 * 17. aux prop: aux column is structurally separate from facts and content.
 * 18. aux prop only (no facts): renders two-column wrapper with content + aux.
 * 19. 3-zone (facts + children + aux): all three are structurally separate.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DetailPanel, FactsKV } from './DetailPanel';

describe('DetailPanel — tasks #100/#99/#101', () => {
  it('1. renders provided title text', () => {
    render(<DetailPanel title="NGC 7000">body</DetailPanel>);
    expect(screen.getByText('NGC 7000')).toBeDefined();
  });

  it('2. renders optional subtitle text', () => {
    render(
      <DetailPanel title="M31" subtitle="Ha · 120 frames · 300s · 2026-01-15">
        body
      </DetailPanel>,
    );
    expect(
      screen.getByText('Ha · 120 frames · 300s · 2026-01-15'),
    ).toBeDefined();
  });

  it('3. renders titleExtra alongside the title', () => {
    render(
      <DetailPanel title="Master Dark" titleExtra={<span>DARK</span>}>
        body
      </DetailPanel>,
    );
    expect(screen.getByText('Master Dark')).toBeDefined();
    expect(screen.getByText('DARK')).toBeDefined();
  });

  it('4. renders action buttons in the header area', () => {
    render(
      <DetailPanel
        title="NGC 7000"
        actions={
          <>
            <button type="button">Confirm</button>
            <button type="button">Reject</button>
          </>
        }
      >
        body
      </DetailPanel>,
    );
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDefined();
  });

  it('5. renders children in the body', () => {
    render(
      <DetailPanel title="NGC 7000">
        <p>Facts section content</p>
      </DetailPanel>,
    );
    expect(screen.getByText('Facts section content')).toBeDefined();
  });

  it('6. renders without subtitle, actions, or children (graceful)', () => {
    expect(() => render(<DetailPanel title="NGC 7000" />)).not.toThrow();
    expect(screen.getByText('NGC 7000')).toBeDefined();
  });

  it('7. title and actions are structurally separate — actions not nested inside title', () => {
    const { container } = render(
      <DetailPanel
        title={<span data-testid="dp-title">NGC 7000</span>}
        actions={
          <button type="button" data-testid="dp-action">
            Confirm
          </button>
        }
      >
        body
      </DetailPanel>,
    );
    const titleEl = container.querySelector('[data-testid="dp-title"]');
    const actionEl = container.querySelector('[data-testid="dp-action"]');
    expect(titleEl).not.toBeNull();
    expect(actionEl).not.toBeNull();
    // Action must not be a descendant of the title element.
    expect(titleEl?.contains(actionEl)).toBe(false);
  });

  it('8. variant="sessions" renders without error', () => {
    expect(() =>
      render(
        <DetailPanel title="NGC 7000" variant="sessions">
          body
        </DetailPanel>,
      ),
    ).not.toThrow();
  });

  it('9. variant="calibration" renders without error', () => {
    expect(() =>
      render(
        <DetailPanel title="Master Dark · 300s" variant="calibration">
          body
        </DetailPanel>,
      ),
    ).not.toThrow();
  });

  // ── The scroll-region contract (#1107) ────────────────────────────────────
  //
  // These replace the old facts/aux slot tests. Those slots were withdrawn
  // (spec 054): no caller ever passed one, so the wrapper they gated — the
  // panel's ONLY scroll region — was never rendered in production and content
  // overflowing a docked panel became unreachable. The tests passed anyway,
  // because they exercised a code path the app never took. Pin the real
  // contract instead: the content region is ALWAYS present.

  it('10. always renders the content region, with no slots passed', () => {
    const { container } = render(
      <DetailPanel title="NGC 7000">
        <span data-testid="content-body">Content here</span>
      </DetailPanel>,
    );
    const content = container.querySelector('.pv-detailpanel__content');
    expect(content).not.toBeNull();
    expect(
      content?.contains(container.querySelector('[data-testid="content-body"]')),
    ).toBe(true);
  });

  it('11. the content region wraps children — it is not bypassed (#1107)', () => {
    // The regression this pins: children rendered as a bare sibling of the
    // header, with nothing establishing overflow, so the ancestor
    // .pv-listpage__detail-body (overflow:hidden) silently clipped them.
    const { container } = render(
      <DetailPanel title="NGC 7000">
        <span data-testid="content-node">Content</span>
      </DetailPanel>,
    );
    const node = container.querySelector('[data-testid="content-node"]');
    const content = container.querySelector('.pv-detailpanel__content');
    expect(node).not.toBeNull();
    expect(content?.contains(node)).toBe(true);
    // Exactly one content region — a second would mean nested scrollbars.
    expect(container.querySelectorAll('.pv-detailpanel__content')).toHaveLength(
      1,
    );
  });

  it('12. the withdrawn facts/aux grid is gone (#1107)', () => {
    const { container } = render(
      <DetailPanel title="NGC 7000">
        <span>just children</span>
      </DetailPanel>,
    );
    expect(container.querySelector('.pv-detailpanel__cols')).toBeNull();
    expect(container.querySelector('.pv-detailpanel__facts')).toBeNull();
    expect(container.querySelector('.pv-detailpanel__aux')).toBeNull();
    expect(screen.getByText('just children')).toBeDefined();
  });

  it('13. variant="inbox" renders without error', () => {
    expect(() =>
      render(
        <DetailPanel title="2025-10-10/NGC7000" variant="inbox">
          body
        </DetailPanel>,
      ),
    ).not.toThrow();
  });

  it('16. variant modifier lands on the content region', () => {
    const { container } = render(
      <DetailPanel title="NGC 7000" variant="inbox">
        <span data-testid="content-node">Content</span>
      </DetailPanel>,
    );
    const content = container.querySelector('.pv-detailpanel__content');
    expect(content?.classList.contains('pv-detailpanel--inbox')).toBe(true);
  });

  it('17. fill mode still renders exactly one content region', () => {
    const { container } = render(
      <DetailPanel fill title="NGC 7000">
        <span data-testid="content-node">Content</span>
      </DetailPanel>,
    );
    expect(container.querySelector('.pv-detail--fill')).not.toBeNull();
    expect(container.querySelectorAll('.pv-detailpanel__content')).toHaveLength(
      1,
    );
  });
});

describe('FactsKV', () => {
  it('14. renders label and value', () => {
    render(
      <dl>
        <FactsKV label="Target" value="NGC 7000" />
      </dl>,
    );
    expect(screen.getByText('Target')).toBeDefined();
    expect(screen.getByText('NGC 7000')).toBeDefined();
  });

  it('15. renders optional provenance label', () => {
    render(
      <dl>
        <FactsKV label="Filter" value="Ha" provenance="Inferred" />
      </dl>,
    );
    expect(screen.getByText('Inferred')).toBeDefined();
  });

  // ── Scroll-containment contract — the #816 regression pin (T004, #1069) ───
  //
  // #816 was "Target detail panel: aliases/notes/coverage/links/back-button
  // silently clipped by DetailPane fill-mode overflow:hidden". Its original fix
  // was a DIRECT-CHILD CSS rule in redesign-detail.css:
  //
  //     .pv-detail--fill > .pv-planner__scroll { flex:1; min-height:0; overflow-y:auto }
  //
  // #1107 moved that contract OUT one level. The root cause of #816 was that
  // DetailPanel rendered `children` as a bare sibling of the header with no
  // scroll region, so each feature had to supply its own — Targets via
  // .pv-planner__scroll, Inbox via .pv-inbox-detail__scroll. DetailPanel now
  // always renders .pv-detailpanel__content and that region owns the scrolling
  // for every page, so the per-feature rules were retired (keeping them would
  // nest a second scroller inside the shared one).
  //
  // So the invariant is no longer "planner scroll is a direct child of fill",
  // it is "SOME single region between the panel root and the content owns the
  // scrolling". Pin that, and pin that it is exactly one.
  //
  // jsdom has no layout engine, so these assert the STRUCTURAL contract the CSS
  // depends on, not actual pixel scrolling. Live measurement at a 390px side
  // dock is in the #1107 PR: Calibration 191px, Sessions 522px, Projects 1216px
  // of previously unreachable content, all 0 after.

  it('19. fill-mode content is wrapped by the shared scroll region (#816 → #1107)', () => {
    const { container } = render(
      <DetailPanel fill title="Selected target">
        <div className="pv-planner__scroll">tall unstructured content</div>
      </DetailPanel>,
    );
    const content = container.querySelector(
      '.pv-detail--fill > .pv-detailpanel__content',
    );
    // The shared region is a direct child of the fill pane, so it inherits the
    // bounded flex height the old direct-child rule depended on.
    expect(content).not.toBeNull();
    // The feature's own wrapper still exists, but now INSIDE that region.
    expect(content?.querySelector('.pv-planner__scroll')).not.toBeNull();
  });

  it('20. exactly one scroll region — no nested scrollbars (#1107)', () => {
    const { container } = render(
      <DetailPanel fill title="Selected target">
        <div className="pv-planner__scroll">tall unstructured content</div>
      </DetailPanel>,
    );
    // Regression guard: reinstating a per-feature scroll rule alongside the
    // shared one is what would produce double scrollbars.
    expect(container.querySelectorAll('.pv-detailpanel__content')).toHaveLength(
      1,
    );
  });
});
