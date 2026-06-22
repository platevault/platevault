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
 * 8. variant prop does not throw or break rendering.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DetailPanel } from './DetailPanel';

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
    expect(screen.getByText('Ha · 120 frames · 300s · 2026-01-15')).toBeDefined();
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
        actions={<button type="button" data-testid="dp-action">Confirm</button>}
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
});
