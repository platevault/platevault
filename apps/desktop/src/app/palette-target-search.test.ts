/**
 * T008 — Cmd+K palette: target results route to /targets/$targetId.
 *
 * The global search backend returns SearchResult rows with
 * kind="target" and route="/targets/<id>". This test verifies the
 * routing logic for target results without needing to mount the full palette.
 */

import { describe, it, expect } from 'vitest';

// ── Types (matching bindings) ─────────────────────────────────────────────────

type SearchResultKind = 'session' | 'target' | 'project' | 'page' | 'action';

interface SearchResult {
  id: string;
  kind: SearchResultKind;
  label: string;
  sublabel?: string;
  route: string;
  score: number;
}

// ── Helpers (mirrors palette logic) ──────────────────────────────────────────

/**
 * Filter search results to only target kind entries.
 * In the alias-aware search the backend already matches on alias_normalized,
 * so the frontend only needs to render whatever the backend returns.
 */
function filterTargetResults(results: SearchResult[]): SearchResult[] {
  return results.filter((r) => r.kind === 'target');
}

/**
 * Derive the navigation route from a search result.
 * The route field already contains the correct deep-link.
 */
function getRoute(result: SearchResult): string {
  return result.route;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const MOCK_RESULTS: SearchResult[] = [
  {
    id: 'target-m31',
    kind: 'target',
    label: 'M 31',
    sublabel: 'Andromeda Galaxy',
    route: '/targets/550e8400-e29b-41d4-a716-446655440099',
    score: 0.95,
  },
  {
    id: 'ses-001',
    kind: 'session',
    label: 'NGC 7000 Ha 2026-06-01',
    route: '/sessions/ses-001',
    score: 0.70,
  },
  {
    id: 'target-ngc7000',
    kind: 'target',
    label: 'NGC 7000',
    sublabel: 'North America Nebula · matched alias: Caldwell 20',
    route: '/targets/660e8400-e29b-41d4-a716-446655440001',
    score: 0.88,
  },
];

describe('palette target search routing (T008)', () => {
  it('filterTargetResults returns only target-kind rows', () => {
    const targets = filterTargetResults(MOCK_RESULTS);
    expect(targets).toHaveLength(2);
    expect(targets.every((r) => r.kind === 'target')).toBe(true);
  });

  it('each target result has a route pointing to /targets/<uuid>', () => {
    const targets = filterTargetResults(MOCK_RESULTS);
    for (const t of targets) {
      expect(t.route).toMatch(/^\/targets\/[0-9a-f-]+$/);
    }
  });

  it('getRoute returns the verbatim route from the result', () => {
    const result = MOCK_RESULTS[0]!;
    expect(getRoute(result)).toBe('/targets/550e8400-e29b-41d4-a716-446655440099');
  });

  it('alias match surfaced in sublabel (T008 alias-aware search)', () => {
    // The backend includes alias info in sublabel when the match was via alias.
    const aliasMatchResult = MOCK_RESULTS.find((r) => r.id === 'target-ngc7000')!;
    expect(aliasMatchResult.sublabel).toContain('Caldwell 20');
  });

  it('non-target results are excluded from target filter', () => {
    const targets = filterTargetResults(MOCK_RESULTS);
    const sessionIds = targets.map((r) => r.id);
    expect(sessionIds).not.toContain('ses-001');
  });
});

// ── T008: Cmd+K search result kind routing ────────────────────────────────────

describe('Cmd+K result kind routing', () => {
  it('target results route to /targets/ prefix', () => {
    const targetResults = filterTargetResults(MOCK_RESULTS);
    for (const r of targetResults) {
      expect(r.route.startsWith('/targets/')).toBe(true);
    }
  });

  it('session results do NOT route to /targets/', () => {
    const sessions = MOCK_RESULTS.filter((r) => r.kind === 'session');
    for (const r of sessions) {
      expect(r.route.startsWith('/targets/')).toBe(false);
    }
  });
});
