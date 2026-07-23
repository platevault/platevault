// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * TwoColDetailLayout / DetailLinkedGroup (#813) — the shared two-col-
 * properties + linked-entity detail recipe consumed by SessionDetail,
 * MasterDetail, and (via `DetailLinkedGroup`) SessionListPopover.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TwoColDetailLayout, DetailLinkedGroup } from './TwoColDetailLayout';

describe('TwoColDetailLayout', () => {
  it('renders colA/colB and omits the linked slot when absent', () => {
    const { container } = render(
      <TwoColDetailLayout colA={<span>A</span>} colB={<span>B</span>} />,
    );
    const wrapper = container.querySelector('.pv-session-detail2');
    expect(
      wrapper?.querySelectorAll(':scope > .pv-session-detail2__col'),
    ).toHaveLength(2);
    expect(wrapper?.querySelector('.pv-session-detail2__linked')).toBeNull();
  });

  it('omits the colB slot entirely when colB is null', () => {
    // An empty `__col` still claims `min-width: 340px` in the flex row, so
    // rendering one for absent content reads as a gap, not as nothing.
    const { container } = render(
      <TwoColDetailLayout colA={<span>A</span>} colB={null} />,
    );
    const wrapper = container.querySelector('.pv-session-detail2');
    expect(
      wrapper?.querySelectorAll(':scope > .pv-session-detail2__col'),
    ).toHaveLength(1);
  });

  it('renders extraCols as full __col slots, skipping null entries', () => {
    const { container } = render(
      <TwoColDetailLayout
        colA={<span>A</span>}
        colB={<span>B</span>}
        extraCols={[<span key="c">C</span>, null, <span key="d">D</span>]}
      />,
    );
    const wrapper = container.querySelector('.pv-session-detail2');
    // A, B, C, D — the null entry contributes nothing.
    expect(
      wrapper?.querySelectorAll(':scope > .pv-session-detail2__col'),
    ).toHaveLength(4);
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
  });

  it('renders extraCols as __col, never as the narrow __linked slot', () => {
    // Guards the regression this API exists to prevent: `__linked` is
    // `flex: 0 0 auto; min-width: 160px` and squeezes table-shaped content.
    const { container } = render(
      <TwoColDetailLayout
        colA={<span>A</span>}
        colB={<span>B</span>}
        extraCols={[<span key="t">table</span>]}
      />,
    );
    expect(container.querySelector('.pv-session-detail2__linked')).toBeNull();
    expect(screen.getByText('table').closest('div')).toHaveClass(
      'pv-session-detail2__col',
    );
  });

  it('renders the linked slot with an optional modifier class', () => {
    const { container } = render(
      <TwoColDetailLayout
        colA={<span>A</span>}
        colB={<span>B</span>}
        linked={<span>linked</span>}
        linkedClassName="pv-session-detail2__linked--stack"
      />,
    );
    const linked = container.querySelector(
      '.pv-session-detail2__linked.pv-session-detail2__linked--stack',
    );
    expect(linked).toBeInTheDocument();
    expect(linked).toHaveTextContent('linked');
  });
});

describe('DetailLinkedGroup', () => {
  it('renders the head label plus children when not empty', () => {
    render(
      <DetailLinkedGroup label="Used by">
        <span>content</span>
      </DetailLinkedGroup>,
    );
    expect(screen.getByText('Used by')).toHaveClass('pv-session-detail2__head');
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('renders the muted emptyLabel instead of children when empty', () => {
    render(
      <DetailLinkedGroup label="Compatible" empty emptyLabel="None">
        <span>content</span>
      </DetailLinkedGroup>,
    );
    expect(screen.queryByText('content')).not.toBeInTheDocument();
    expect(screen.getByText('None')).toHaveClass('pv-session-detail2__muted');
  });
});
