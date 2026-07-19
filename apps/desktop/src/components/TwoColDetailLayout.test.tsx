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
    const wrapper = container.querySelector('.alm-session-detail2');
    expect(
      wrapper?.querySelectorAll(':scope > .alm-session-detail2__col'),
    ).toHaveLength(2);
    expect(wrapper?.querySelector('.alm-session-detail2__linked')).toBeNull();
  });

  it('renders the linked slot with an optional modifier class', () => {
    const { container } = render(
      <TwoColDetailLayout
        colA={<span>A</span>}
        colB={<span>B</span>}
        linked={<span>linked</span>}
        linkedClassName="alm-session-detail2__linked--stack"
      />,
    );
    const linked = container.querySelector(
      '.alm-session-detail2__linked.alm-session-detail2__linked--stack',
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
    expect(screen.getByText('Used by')).toHaveClass(
      'alm-session-detail2__head',
    );
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('renders the muted emptyLabel instead of children when empty', () => {
    render(
      <DetailLinkedGroup label="Compatible" empty emptyLabel="None">
        <span>content</span>
      </DetailLinkedGroup>,
    );
    expect(screen.queryByText('content')).not.toBeInTheDocument();
    expect(screen.getByText('None')).toHaveClass('alm-session-detail2__muted');
  });
});
