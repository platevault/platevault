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

  it('10. facts prop: renders facts content', () => {
    render(
      <DetailPanel
        title="NGC 7000"
        facts={<span data-testid="facts-content">Facts KV here</span>}
      >
        <span data-testid="content-body">Content here</span>
      </DetailPanel>,
    );
    expect(screen.getByTestId('facts-content')).toBeDefined();
    expect(screen.getByTestId('content-body')).toBeDefined();
  });

  it('11. facts prop: facts column and children column are in separate DOM regions', () => {
    const { container } = render(
      <DetailPanel
        title="NGC 7000"
        facts={<span data-testid="facts-node">Facts</span>}
      >
        <span data-testid="content-node">Content</span>
      </DetailPanel>,
    );
    const factsEl = container.querySelector('[data-testid="facts-node"]');
    const contentEl = container.querySelector('[data-testid="content-node"]');
    expect(factsEl).not.toBeNull();
    expect(contentEl).not.toBeNull();
    // The cols wrapper must be present.
    const cols = container.querySelector('.pv-detailpanel__cols');
    expect(cols).not.toBeNull();
    // Facts must be inside the facts aside; content must NOT be inside it.
    const factsAside = container.querySelector('.pv-detailpanel__facts');
    expect(factsAside).not.toBeNull();
    expect(factsAside?.contains(factsEl)).toBe(true);
    expect(factsAside?.contains(contentEl)).toBe(false);
  });

  it('12. without facts or aux prop, no cols wrapper is rendered', () => {
    const { container } = render(
      <DetailPanel title="NGC 7000">
        <span>just children</span>
      </DetailPanel>,
    );
    expect(container.querySelector('.pv-detailpanel__cols')).toBeNull();
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

  it('16. aux prop: renders aux content', () => {
    render(
      <DetailPanel
        title="NGC 7000"
        aux={<span data-testid="aux-content">Aux here</span>}
      >
        <span data-testid="content-body">Content here</span>
      </DetailPanel>,
    );
    expect(screen.getByTestId('aux-content')).toBeDefined();
    expect(screen.getByTestId('content-body')).toBeDefined();
  });

  it('17. aux prop: aux column is structurally separate from content', () => {
    const { container } = render(
      <DetailPanel
        title="NGC 7000"
        aux={<span data-testid="aux-node">Aux</span>}
      >
        <span data-testid="content-node">Content</span>
      </DetailPanel>,
    );
    const auxEl = container.querySelector('[data-testid="aux-node"]');
    const contentEl = container.querySelector('[data-testid="content-node"]');
    expect(auxEl).not.toBeNull();
    expect(contentEl).not.toBeNull();
    // The cols wrapper and aux aside must be present.
    const cols = container.querySelector('.pv-detailpanel__cols');
    expect(cols).not.toBeNull();
    const auxAside = container.querySelector('.pv-detailpanel__aux');
    expect(auxAside).not.toBeNull();
    expect(auxAside?.contains(auxEl)).toBe(true);
    // Content must NOT be inside the aux aside.
    expect(auxAside?.contains(contentEl)).toBe(false);
  });

  it('18. aux only (no facts): renders cols wrapper with has-aux modifier', () => {
    const { container } = render(
      <DetailPanel
        title="NGC 7000"
        aux={<span data-testid="aux-node">Aux</span>}
      >
        <span data-testid="content-node">Content</span>
      </DetailPanel>,
    );
    const cols = container.querySelector('.pv-detailpanel__cols');
    expect(cols).not.toBeNull();
    expect(cols?.classList.contains('pv-detailpanel--has-aux')).toBe(true);
    expect(cols?.classList.contains('pv-detailpanel--has-facts')).toBe(false);
  });

  it('19. 3-zone: facts + children + aux are all in separate DOM regions', () => {
    const { container } = render(
      <DetailPanel
        title="NGC 7000"
        facts={<span data-testid="facts-node">Facts</span>}
        aux={<span data-testid="aux-node">Aux</span>}
      >
        <span data-testid="content-node">Content</span>
      </DetailPanel>,
    );
    const factsEl = container.querySelector('[data-testid="facts-node"]');
    const contentEl = container.querySelector('[data-testid="content-node"]');
    const auxEl = container.querySelector('[data-testid="aux-node"]');
    expect(factsEl).not.toBeNull();
    expect(contentEl).not.toBeNull();
    expect(auxEl).not.toBeNull();

    const factsAside = container.querySelector('.pv-detailpanel__facts');
    const contentDiv = container.querySelector('.pv-detailpanel__content');
    const auxAside = container.querySelector('.pv-detailpanel__aux');

    expect(factsAside).not.toBeNull();
    expect(contentDiv).not.toBeNull();
    expect(auxAside).not.toBeNull();

    // Each node is in exactly its own region.
    expect(factsAside?.contains(factsEl)).toBe(true);
    expect(factsAside?.contains(contentEl)).toBe(false);
    expect(factsAside?.contains(auxEl)).toBe(false);

    expect(contentDiv?.contains(contentEl)).toBe(true);
    expect(contentDiv?.contains(factsEl)).toBe(false);
    expect(contentDiv?.contains(auxEl)).toBe(false);

    expect(auxAside?.contains(auxEl)).toBe(true);
    expect(auxAside?.contains(factsEl)).toBe(false);
    expect(auxAside?.contains(contentEl)).toBe(false);

    // Both modifiers present.
    const cols = container.querySelector('.pv-detailpanel__cols');
    expect(cols?.classList.contains('pv-detailpanel--has-facts')).toBe(true);
    expect(cols?.classList.contains('pv-detailpanel--has-aux')).toBe(true);
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
  // silently clipped by DetailPane fill-mode overflow:hidden". The fix (#1035)
  // is a CSS rule in redesign-detail.css:
  //
  //     .pv-detail--fill > .pv-planner__scroll { flex:1; min-height:0; overflow-y:auto }
  //
  // That is a DIRECT-CHILD selector, which makes it a structural contract on
  // DetailPanel rather than a mere stylesheet detail: nest the scroll wrapper
  // one level deeper and the selector silently stops matching — no test fails,
  // no type breaks, the content just starts getting clipped again.
  //
  // This became load-bearing in #1067, when TargetDetailV2 migrated onto
  // DetailPanel and deliberately kept content-only mode instead of the facts
  // slot, precisely because facts nests children one level too deep.
  //
  // jsdom has no layout engine, so these assert the STRUCTURAL contract the
  // CSS depends on, not actual pixel scrolling.

  it('19. content-only children stay direct children of .pv-detail--fill (#816)', () => {
    const { container } = render(
      <DetailPanel fill title="Selected target">
        <div className="pv-planner__scroll">tall unstructured content</div>
      </DetailPanel>,
    );
    // The exact selector redesign-detail.css relies on.
    expect(
      container.querySelector('.pv-detail--fill > .pv-planner__scroll'),
    ).not.toBeNull();
  });

  it('20. the facts slot does NOT satisfy that selector — why TargetDetailV2 avoids it', () => {
    const { container } = render(
      <DetailPanel fill title="Selected target" facts={<dl>identity</dl>}>
        <div className="pv-planner__scroll">tall unstructured content</div>
      </DetailPanel>,
    );
    // Present in the tree, but nested under .pv-detailpanel__content — the
    // direct-child rule no longer applies and #816's clipping would return.
    expect(container.querySelector('.pv-planner__scroll')).not.toBeNull();
    expect(
      container.querySelector('.pv-detail--fill > .pv-planner__scroll'),
    ).toBeNull();
  });
});
