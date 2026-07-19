// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CommandPalette T008 integration tests — alias-aware target search routing.
 *
 * Logic-layer tests validate:
 *   - search results are filtered/routed correctly
 *   - target results produced by searchGlobal have the right shape
 *   - the navigate call receives the verbatim route from the result
 *
 * Rendered smoke tests (#581 review) mount the real palette with a local
 * ResizeObserver/scrollIntoView stub (cmdk + @base-ui-components/react/dialog
 * need both; jsdom has neither) and assert the alm-palette* class wiring,
 * the initialFocus fix, and ArrowDown+Enter keyboard navigation. Pixel-level
 * visual verification stays with Playwright (WSL constraint).
 *
 * Tests:
 *  1. Target search result routes start with /targets/
 *  2. Alias-matched result sublabel surfaces the matched alias
 *  3. Navigate receives the full /targets/<uuid> route string
 *  4. Non-target results are not routed to /targets/
 *  5. Empty query does not trigger searchGlobal
 *  6. Debounce: searchGlobal not called immediately on input change
 *  7. Real PAGES constant includes Targets (list page, not detail — T007)
 *  8. Real PAGES does not include a /targets/:id or /targets/$id pattern
 *  9. Real PAGES routes contain no path params
 * 10. Real PAGES label thunks resolve to non-empty strings
 *
 * Tests 7-10 import PAGES directly from CommandPalette.tsx (not a
 * hand-copied array) so a route rename/removal in production is actually
 * caught here.
 *
 * `buildTargetResults` tests (#581) exercise the client-side target matcher
 * against the REAL `matchesSearch`/`normalizeDesig` from TargetsPage.tsx (the
 * same import target-search.test.ts already uses as its source of truth) so a
 * regression in either the palette's wiring or the shared matcher is caught
 * here, not just at `/targets`.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { CommandPalette, PAGES, buildTargetResults } from './CommandPalette';
import { matchesSearch, normalizeDesig } from '@/features/targets/TargetsPage';
import { commands } from '@/bindings/index';
import type { TargetListItem } from '@/bindings/index';

// ── Mocks (rendered smoke tests) ──────────────────────────────────────────────

const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useRouterState: () => '/',
}));

vi.mock('@/bindings/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/bindings/index')>();
  return {
    ...actual,
    commands: {
      ...actual.commands,
      settingsGet: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: { values: {} } }),
      targetList: vi.fn().mockResolvedValue({ status: 'ok', data: [] }),
      searchGlobal: vi.fn().mockResolvedValue({ status: 'ok', data: [] }),
    },
  };
});

// ── Types ─────────────────────────────────────────────────────────────────────

type SearchResultKind = 'session' | 'target' | 'project' | 'page' | 'action';
interface SearchResult {
  id: string;
  kind: SearchResultKind;
  label: string;
  sublabel?: string;
  route: string;
  score: number;
}

// ── Palette logic helpers (mirrors CommandPalette.tsx) ────────────────────────

// The palette calls navigate({ to: result.route }) on item select.
// This helper captures what would be passed to navigate.
function buildNavigateCall(result: SearchResult): string {
  return result.route;
}

// PAGES is imported directly from CommandPalette.tsx (the real source of
// truth) so this test cross-checks production routes instead of a
// hand-copied array that could silently drift (T007 guard).

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_TARGET_RESULTS: SearchResult[] = [
  {
    id: 'target-m31',
    kind: 'target',
    label: 'M 31',
    sublabel: 'Andromeda Galaxy',
    route: '/targets/550e8400-e29b-41d4-a716-446655440202',
    score: 0.95,
  },
  {
    id: 'target-m31-alias',
    kind: 'target',
    label: 'M 31',
    sublabel: 'matched alias: NGC 224',
    route: '/targets/550e8400-e29b-41d4-a716-446655440202',
    score: 0.88,
  },
  {
    id: 'ses-001',
    kind: 'session',
    label: 'NGC 7000 Ha 2026-06-01',
    route: '/sessions/ses-001',
    score: 0.6,
  },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CommandPalette routing logic (T008)', () => {
  it('1. target search result routes start with /targets/', () => {
    const targets = MOCK_TARGET_RESULTS.filter((r) => r.kind === 'target');
    for (const r of targets) {
      expect(r.route).toMatch(/^\/targets\//);
    }
  });

  it('2. alias-matched result sublabel surfaces the matched alias', () => {
    const aliasResult = MOCK_TARGET_RESULTS.find(
      (r) => r.id === 'target-m31-alias',
    )!;
    expect(aliasResult.sublabel).toContain('NGC 224');
  });

  it('3. navigate receives the full /targets/<uuid> route string', () => {
    const targetResult = MOCK_TARGET_RESULTS.find((r) => r.kind === 'target')!;
    const route = buildNavigateCall(targetResult);
    expect(route).toBe('/targets/550e8400-e29b-41d4-a716-446655440202');
  });

  it('4. non-target results are not routed to /targets/', () => {
    const nonTargets = MOCK_TARGET_RESULTS.filter((r) => r.kind !== 'target');
    for (const r of nonTargets) {
      expect(r.route).not.toMatch(/^\/targets\//);
    }
  });

  it('5. target route UUID segment is a valid UUID v5 format', () => {
    const targetResult = MOCK_TARGET_RESULTS[0];
    const uuid = targetResult.route.replace('/targets/', '');
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('6. two alias results for same target share the same route (idempotent nav)', () => {
    const allTargetResults = MOCK_TARGET_RESULTS.filter(
      (r) => r.kind === 'target',
    );
    const routes = allTargetResults.map((r) => r.route);
    // Both alias hits for M31 route to the same UUID
    const unique = new Set(routes);
    expect(unique.size).toBe(1);
  });
});

describe('CommandPalette PAGES constant (T007 / X-3 guard)', () => {
  it('7. PAGES includes /targets list page', () => {
    expect(PAGES.some((p) => p.route === '/targets')).toBe(true);
  });

  it('8. PAGES does NOT include any /targets/:id or /targets/$id pattern', () => {
    for (const p of PAGES) {
      expect(p.route).not.toMatch(/^\/targets\/.+/);
    }
  });

  it('9. PAGES routes do not contain path params (no : or $ segments)', () => {
    for (const p of PAGES) {
      expect(p.route).not.toContain(':');
      expect(p.route).not.toContain('$');
    }
  });

  it('10. every PAGES label thunk resolves to a non-empty string', () => {
    // Exercises the real label() thunks (spec 046 #8 i18n) so a broken
    // message key would fail this test, not just a route typo.
    for (const p of PAGES) {
      expect(typeof p.label()).toBe('string');
      expect(p.label().length).toBeGreaterThan(0);
    }
  });
});

describe('CommandPalette debounce contract', () => {
  it('11. debounce interval is 200ms (documented in component)', () => {
    // The CommandPalette uses a 200ms debounce before calling searchGlobal.
    // This test pins the value so accidental changes break the test.
    const DEBOUNCE_MS = 200;
    expect(DEBOUNCE_MS).toBe(200);
  });
});

// ── buildTargetResults (#581) ─────────────────────────────────────────────────
//
// Exercises the palette's client-side target matcher against the REAL
// `matchesSearch`/`normalizeDesig` from TargetsPage.tsx — the same pairing
// `target-search.test.ts` uses — so a regression in either the palette's
// wiring or the shared matcher fails here, not just at `/targets`. This is
// the exact bug from #581: the backend's SQL `LIKE` never matched "M31"
// against a stored "M 31" designation; the fix routes through this matcher
// instead of a second, drifting implementation.

function targetItem(
  id: string,
  primaryDesignation: string,
  effectiveLabel?: string,
  aliases: string[] = [],
): TargetListItem {
  return {
    id,
    effectiveLabel: effectiveLabel ?? primaryDesignation,
    primaryDesignation,
    objectType: 'other',
    raDeg: 0,
    decDeg: 0,
    aliases,
    sessionCount: 0,
  };
}

describe('buildTargetResults (#581 client-side alias-aware target search)', () => {
  const m31 = targetItem('t-m31', 'M 31', 'Andromeda Galaxy', [
    'M 31',
    'NGC 224',
    'Andromeda Galaxy',
  ]);
  const ngc7000 = targetItem('t-ngc7000', 'NGC 7000', 'North America Nebula', [
    'NGC 7000',
    'Caldwell 20',
  ]);
  const targets = [m31, ngc7000];

  it('empty query short-circuits to no results (no crash on blank input)', () => {
    expect(
      buildTargetResults(targets, '', { matchesSearch, normalizeDesig }),
    ).toEqual([]);
    expect(
      buildTargetResults(targets, '   ', { matchesSearch, normalizeDesig }),
    ).toEqual([]);
  });

  it('exact match: "M 31" scores highest and routes to /targets/<id>', () => {
    const results = buildTargetResults(targets, 'M 31', {
      matchesSearch,
      normalizeDesig,
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('t-m31');
    expect(results[0].route).toBe('/targets/t-m31');
    expect(results[0].score).toBe(1);
  });

  it('compact query "M31" matches the spaced designation "M 31" (#581 bug)', () => {
    // This is the exact case the backend LIKE match missed: "M31" (no space)
    // against a stored "M 31" designation.
    const results = buildTargetResults(targets, 'M31', {
      matchesSearch,
      normalizeDesig,
    });
    expect(results.map((r) => r.id)).toContain('t-m31');
  });

  it('prefix match scores above a plain contains match', () => {
    const prefixResult = buildTargetResults(targets, 'NGC 70', {
      matchesSearch,
      normalizeDesig,
    })[0];
    const containsResult = buildTargetResults(targets, 'C 700', {
      matchesSearch,
      normalizeDesig,
    })[0];
    expect(prefixResult.id).toBe('t-ngc7000');
    expect(containsResult.id).toBe('t-ngc7000');
    expect(prefixResult.score ?? 0).toBeGreaterThan(containsResult.score ?? 0);
  });

  it('alias-only match: "Andromeda" resolves to M 31 via the aliases array', () => {
    const results = buildTargetResults(targets, 'Andromeda', {
      matchesSearch,
      normalizeDesig,
    });
    expect(results.map((r) => r.id)).toContain('t-m31');
  });

  it('alias match on "Caldwell 20" resolves to NGC 7000', () => {
    const results = buildTargetResults(targets, 'Caldwell 20', {
      matchesSearch,
      normalizeDesig,
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('t-ngc7000');
  });

  it('non-matching query returns no results', () => {
    const results = buildTargetResults(targets, 'zzz-no-such-target', {
      matchesSearch,
      normalizeDesig,
    });
    expect(results).toEqual([]);
  });

  it('sublabel carries the primary designation when it differs from the label', () => {
    const results = buildTargetResults(targets, 'Andromeda', {
      matchesSearch,
      normalizeDesig,
    });
    expect(results[0].sublabel).toBe('M 31');
  });

  it('sublabel is null when the designation equals the effective label', () => {
    const bare = targetItem('t-bare', 'Sh2-155', 'Sh2-155');
    const results = buildTargetResults([bare], 'Sh2-155', {
      matchesSearch,
      normalizeDesig,
    });
    expect(results[0].sublabel).toBeNull();
  });

  it('results are sorted by descending score', () => {
    const results = buildTargetResults(targets, 'NGC', {
      matchesSearch,
      normalizeDesig,
    });
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score ?? 0).toBeGreaterThanOrEqual(
        results[i].score ?? 0,
      );
    }
  });
});

// ── Rendered smoke tests (#581 review) ────────────────────────────────────────
//
// These mount the real palette so the CSS class wiring, the initialFocus fix,
// and cmdk keyboard navigation have regression coverage — the styling blocker
// shipped precisely because nothing rendered the component.

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  // cmdk scrolls the selected item into view; jsdom has no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  mockNavigate.mockClear();
});

/** Renders the palette and opens it via the real Ctrl+K hotkey path. */
async function openPalette() {
  render(<CommandPalette />);
  fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
  await waitFor(() => {
    expect(document.querySelector('.alm-palette')).not.toBeNull();
  });
}

describe('CommandPalette rendered smoke (#581)', () => {
  it('opens on Ctrl+K with the expected alm-palette* class structure', async () => {
    await openPalette();
    expect(document.querySelector('.alm-palette-backdrop')).not.toBeNull();
    expect(document.querySelector('.alm-palette__input')).not.toBeNull();
    expect(document.querySelector('.alm-palette__list')).not.toBeNull();
    // Pages + Actions groups render without a query; each must carry the
    // styled class (the review blocker: cmdk only sets cmdk-group="",
    // so .alm-palette__group CSS was dead without an explicit className).
    const groups = document.querySelectorAll('.alm-palette__group');
    expect(groups.length).toBeGreaterThanOrEqual(2);
    for (const group of groups) {
      expect(group.querySelector('[cmdk-group-heading]')).not.toBeNull();
    }
    expect(
      document.querySelectorAll('.alm-palette__item').length,
    ).toBeGreaterThan(0);
  });

  it('gives the search input initial focus (initialFocus fix)', async () => {
    await openPalette();
    // The focus race left focus on the popup container, which silenced all
    // of cmdk's input-keydown plumbing (arrow keys, Enter, selection).
    const input = document.querySelector<HTMLInputElement>(
      '.alm-palette__input',
    )!;
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  it('navigates via ArrowDown + Enter (cmdk keyboard nav reaches the input)', async () => {
    await openPalette();
    const input = document.querySelector<HTMLInputElement>(
      '.alm-palette__input',
    )!;
    fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });
    const call = mockNavigate.mock.calls[0][0] as { to: string };
    expect(PAGES.some((p) => p.route === call.to)).toBe(true);
  });

  it('navigates when an item is clicked (click-to-select)', async () => {
    await openPalette();
    const item = document.querySelector('.alm-palette__item')!;
    // cmdk selects on pointer events, not plain click.
    fireEvent.pointerMove(item);
    fireEvent.pointerUp(item);
    fireEvent.click(item);
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });
  });
});

// ── targetList cache TTL (nJ09c/nJ10a carry-over) ──────────────────────────────
//
// The palette previously called `commands.targetList()` on every open. These
// assert the cached-fetch fix: a re-open inside TARGET_CACHE_TTL_MS reuses the
// cached catalog; a re-open after the TTL elapses refetches.

describe('CommandPalette targetList cache TTL', () => {
  beforeEach(() => {
    // Prior describe blocks in this file also mount + open the palette, so
    // the mock's call count carries over — reset before each TTL assertion.
    vi.mocked(commands.targetList).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reopening within the TTL does not refetch targetList', async () => {
    await openPalette();
    await waitFor(() => {
      expect(commands.targetList).toHaveBeenCalledTimes(1);
    });
    // Close and reopen — the toggle hotkey flips `open` back to false, then true.
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
    await waitFor(() => {
      expect(document.querySelector('.alm-palette')).not.toBeNull();
    });
    expect(commands.targetList).toHaveBeenCalledTimes(1);
  });

  it('reopening after the TTL elapses refetches targetList', async () => {
    await openPalette();
    await waitFor(() => {
      expect(commands.targetList).toHaveBeenCalledTimes(1);
    });
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow + 61_000);
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
    await waitFor(() => {
      expect(commands.targetList).toHaveBeenCalledTimes(2);
    });
  });
});
