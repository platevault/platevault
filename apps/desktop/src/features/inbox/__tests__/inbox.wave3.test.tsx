// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * inbox.wave3 — tests for tasks #32 / #35 (wave 3 Inbox polish).
 *
 * task 32: InboxRow renders a classification-forward grid with four columns
 *   (classification label, path, count, format).
 * task 35: InboxPage top-bar shows a "Confirm all (N)" ghost button when
 *   classified items exist; it is hidden when none exist.
 *
 * Removed (spec 043 §4 redesign):
 *   task 33 — breakdown-filter interaction tests: the interactive breakdown
 *     table no longer exists in InboxDetail. The mixed-summary is a compact
 *     muted text line; there is no row-click filter.
 *   task 6  — breakdown destination ellipsis: breakdown table is gone.
 */

import { render as rtlRender, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InboxListItem } from '@/bindings/index';

import { InboxList } from '../InboxList';

// ── Mock reclassify (still imported transitively via InboxList store) ─────────

vi.mock('@/bindings/index', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/bindings/index')>();
  return {
    ...mod,
    commands: {
      ...mod.commands,
      inboxReclassify: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          inboxItemId: 'item-001',
          remainingUnclassified: 0,
        },
      }),
    },
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeListItem(overrides: Partial<InboxListItem> = {}): InboxListItem {
  return {
    inboxItemId: 'item-001',
    groupId: 'item-001',
    groupKey: '',
    rootId: 'root-001',
    rootAbsolutePath: '/astro',
    relativePath: 'lights/NGC7000',
    fileCount: 18,
    lane: 'fits',
    format: 'fits',
    state: 'classified',
    contentSignature: 'sig-001',
    isMaster: false,
    masterFrameType: null,
    masterFilter: null,
    masterExposureS: null,
    organizationState: 'unorganized',
    ...overrides,
  };
}

// ── task 32: InboxRow grid layout ─────────────────────────────────────────────

describe('task 32: InboxRow classification-forward grid', () => {
  it('renders classification column with frame type when groupFrameType is set', () => {
    const item = makeListItem({ groupFrameType: 'light', state: 'classified' });
    rtlRender(
      <InboxList
        items={[item]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    expect(screen.getByText('light')).toBeInTheDocument();
  });

  it('renders classification column with state label when no groupFrameType', () => {
    const item = makeListItem({
      groupFrameType: null,
      state: 'pending_classification',
    });
    rtlRender(
      <InboxList
        items={[item]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('renders master frame type in classification column for master items', () => {
    const item = makeListItem({
      isMaster: true,
      masterFrameType: 'dark',
      state: 'classified',
    });
    rtlRender(
      <InboxList
        items={[item]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    const darks = screen.getAllByText(/dark/i);
    expect(darks.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the row path in its own element (not strong-wrapped)', () => {
    const item = makeListItem({ relativePath: 'lights/NGC7000' });
    rtlRender(
      <InboxList
        items={[item]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    const row = screen.getByTestId('inbox-item-item-001');
    expect(row.querySelector('.alm-inbox-cell__path')).not.toBeNull();
    expect(row.querySelector('.alm-inbox-cell__path')?.textContent).toBe(
      'lights/NGC7000',
    );
  });

  it('applies the shared-Table inbox row class (not the old alm-list-item)', () => {
    const item = makeListItem();
    rtlRender(
      <InboxList
        items={[item]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    const row = screen.getByTestId('inbox-item-item-001');
    expect(row.classList.contains('alm-inbox-table__row')).toBe(true);
    expect(row.classList.contains('alm-list-item')).toBe(false);
  });

  it('adds alm-inbox-table__row--selected when item is selected', () => {
    const item = makeListItem();
    rtlRender(
      <InboxList
        items={[item]}
        selectedId="item-001"
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    const row = screen.getByTestId('inbox-item-item-001');
    expect(row.classList.contains('alm-inbox-table__row--selected')).toBe(true);
  });

  it('adds alm-inbox-table__row--muted for plan_open items', () => {
    const item = makeListItem({ state: 'plan_open' });
    rtlRender(
      <InboxList
        items={[item]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    const row = screen.getByTestId('inbox-item-item-001');
    expect(row.classList.contains('alm-inbox-table__row--muted')).toBe(true);
  });
});
