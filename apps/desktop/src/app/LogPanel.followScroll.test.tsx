// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tests that follow-tail pauses on manual scroll-up and resumes on
 * scroll-to-top (spec 019, T011).
 *
 * jsdom has no real layout, so scrollTop/scrollHeight/clientHeight are 0 by
 * default on every element. We define them explicitly via
 * Object.defineProperty on the scroll container and drive `handleScroll` by
 * firing a native 'scroll' event, which is the standard jsdom technique for
 * scroll-position assertions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { appendLog, resetLogStore } from '@/data/logStore';
import { LogPanelProvider } from '@/app/LogPanelContext';
import { LogPanel } from '@/app/LogPanel';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

// LogPanel / LogPanelContext call commands.settingsGet / settingsUpdate /
// logExport + unwrap now (spec 037); mock the generated bindings' Result shape.
vi.mock('@/bindings/index', () => ({
  commands: {
    settingsGet: vi.fn().mockResolvedValue({
      status: 'ok',
      // Follow-tail on by default so the follow-tail effect is active.
      data: {
        scope: 'advanced',
        values: { logLevel: 'info', rememberFollowLogs: true },
      },
    }),
    settingsUpdate: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    logExport: vi.fn().mockResolvedValue({
      status: 'ok',
      data: {
        contractVersion: '2.0.0',
        requestId: 'r',
        filePath: '/tmp/x.json',
        count: 0,
        status: 'success',
      },
    }),
  },
}));

vi.mock('@/data/logSubscription', () => ({
  startLogSubscription: vi.fn().mockResolvedValue(undefined),
}));

function renderPanel() {
  return render(
    <LogPanelProvider>
      <LogPanel />
    </LogPanelProvider>,
  );
}

function getTrigger() {
  const triggers = screen.getAllByRole('button');
  const trigger = triggers.find((b) =>
    ['Expand log panel', 'Collapse log panel'].includes(
      b.getAttribute('aria-label') ?? '',
    ),
  );
  if (!trigger) throw new Error('log panel trigger not found');
  return trigger;
}

function getFollowButton() {
  return screen.getByRole('button', {
    name: /Follow tail (on|off) \(click to (pause|enable)\)/,
  });
}

function seedEntries() {
  appendLog([
    {
      id: 'aud:1',
      contractVersion: '1',
      time: '2026-01-01T00:00:00Z',
      level: 'info',
      source: 'audit',
      message: 'First entry',
    },
    {
      id: 'aud:2',
      contractVersion: '1',
      time: '2026-01-01T00:00:01Z',
      level: 'info',
      source: 'audit',
      message: 'Second entry',
    },
  ]);
}

/** Sets jsdom scroll metrics on the given element (jsdom leaves them at 0). */
function setScrollMetrics(
  el: HTMLElement,
  {
    scrollTop,
    scrollHeight = 500,
    clientHeight = 200,
  }: { scrollTop: number; scrollHeight?: number; clientHeight?: number },
) {
  Object.defineProperty(el, 'scrollTop', {
    value: scrollTop,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(el, 'scrollHeight', {
    value: scrollHeight,
    configurable: true,
  });
  Object.defineProperty(el, 'clientHeight', {
    value: clientHeight,
    configurable: true,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('LogPanel follow-tail scroll pause/resume (T011)', () => {
  // Captured directly at assignment (never re-read off `Element.prototype`
  // later) so tests avoid `@typescript-eslint/unbound-method` — referencing
  // a prototype method as a value elsewhere is exactly what that rule flags.
  let scrollToMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetLogStore();
    vi.clearAllMocks();
    // #842 persists `expanded` to localStorage; these tests assume a fresh
    // collapsed panel on every render.
    localStorage.removeItem('alm-log-panel-expanded');
    // jsdom does not implement `Element.scrollTo` — the follow-tail effect
    // calls it directly (smooth-scroll path) whenever reduced-motion is not
    // active. Stub it so the effect doesn't throw and unmount the tree.
    scrollToMock = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollTo', {
      value: scrollToMock,
      writable: true,
      configurable: true,
    });
  });

  it('pauses follow when the user scrolls up, and resumes at the top', async () => {
    seedEntries();
    renderPanel();

    fireEvent.click(getTrigger());
    await waitFor(() => {
      expect(screen.getByText('Second entry')).toBeInTheDocument();
    });

    // Follow-tail starts on (persisted via rememberFollowLogs: true).
    await waitFor(() => {
      expect(getFollowButton()).toHaveAttribute(
        'aria-label',
        'Follow tail on (click to pause)',
      );
    });
    expect(getFollowButton().title).toBeFalsy();

    const list = document.querySelector<HTMLUListElement>(
      '.pv-logpanel__events',
    );
    expect(list).not.toBeNull();
    if (!list) throw new Error('scroll list not found');

    // Simulate the user scrolling away from the top (newest entries are at
    // scrollTop 0, so scrolling down/away pauses follow per handleScroll).
    setScrollMetrics(list, { scrollTop: 120 });
    fireEvent.scroll(list);

    await waitFor(() => {
      expect(getFollowButton().title).toBe(
        'Paused (scroll to bottom to resume)',
      );
    });
    // Follow-tail preference itself remains "on"; only the temporary
    // scroll-pause indicator changes the button label to the paused variant.
    expect(getFollowButton().textContent).toBe('⏸ Follow');

    // Scroll back to the top — follow resumes (scrollPaused clears).
    setScrollMetrics(list, { scrollTop: 0 });
    fireEvent.scroll(list);

    await waitFor(() => {
      expect(getFollowButton().title).toBeFalsy();
    });
    expect(getFollowButton().textContent).toBe('↓ Follow');
  });

  it('does not pause when scrollTop stays within the near-top threshold', async () => {
    seedEntries();
    renderPanel();

    fireEvent.click(getTrigger());
    await waitFor(() => {
      expect(screen.getByText('Second entry')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(getFollowButton()).toHaveAttribute(
        'aria-label',
        'Follow tail on (click to pause)',
      );
    });

    const list = document.querySelector<HTMLUListElement>(
      '.pv-logpanel__events',
    );
    if (!list) throw new Error('scroll list not found');

    // handleScroll pauses only when scrollTop > 20; 10 stays "at top".
    setScrollMetrics(list, { scrollTop: 10 });
    fireEvent.scroll(list);

    // Give any state update a tick, then assert still unpaused.
    await waitFor(() => {
      expect(getFollowButton().textContent).toBe('↓ Follow');
    });
    expect(getFollowButton().title).toBeFalsy();
  });

  it('re-enabling Follow resumes at the newest row even after a stale scroll-pause (#832)', async () => {
    seedEntries();
    renderPanel();

    fireEvent.click(getTrigger());
    await waitFor(() => {
      expect(screen.getByText('Second entry')).toBeInTheDocument();
    });

    // Gate on the HYDRATED follow state before toggling it (#1249).
    //
    // `followLogs` initialises to `false` (LogPanelContext.tsx:83) and is then
    // hydrated asynchronously from `settings.get('advanced')` on mount
    // (`:88`). Waiting for 'Second entry' above says nothing about that: it is
    // an independent async path. On a loaded runner the click below could land
    // while `followLogs` was still the pre-hydration `false`, toggling it to
    // `true`, after which the late hydration confirmed `true` — leaving
    // '↓ Follow' where this test expects '— Follow'. That is this file's
    // long-standing flake, which #1118 reduced but did not remove.
    //
    // This is `waitFor` used correctly — "the state has not arrived yet" —
    // rather than the vacuous "this must never happen" shape the
    // alm/no-vacuous-waitfor rule rejects.
    await waitFor(() => {
      expect(getFollowButton().textContent).toBe('↓ Follow');
    });

    // Turn follow off first (repro starts with Follow inactive).
    fireEvent.click(getFollowButton());
    await waitFor(() => {
      expect(getFollowButton().textContent).toBe('— Follow');
    });

    const list = document.querySelector<HTMLUListElement>(
      '.pv-logpanel__events',
    );
    if (!list) throw new Error('scroll list not found');

    // Scroll away from the top while follow is off — `handleScroll` sets
    // `scrollPaused` regardless of `followLogs`.
    setScrollMetrics(list, { scrollTop: 400 });
    fireEvent.scroll(list);

    scrollToMock.mockClear();

    // Re-enable Follow — before the fix, the leftover `scrollPaused` from
    // the earlier scroll silently blocked the follow-tail effect's guard.
    fireEvent.click(getFollowButton());

    await waitFor(() => {
      expect(getFollowButton().textContent).toBe('↓ Follow');
    });
    expect(getFollowButton().title).toBeFalsy();
    // The follow-tail effect must actually run and scroll back to the
    // newest row, not silently no-op.
    //
    // waitFor, not a sync expect: the waitFor above gates on the button
    // LABEL, which flips in the same render commit as `followLogs`. The
    // follow-tail effect that calls scrollTo runs *after* that commit, so a
    // sync assertion races it — passing on a fast machine and failing on a
    // contended runner (#1115). Polling preserves the assertion exactly.
    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });
  });
});
