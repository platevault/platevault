/**
 * Vitest tests for tool-launch helpers (spec 011 T013/T018/T021).
 *
 * Tests pure functions only (no process spawning):
 * - toolIdFromProjectTool()
 * - toolLaunchDisabledReason()
 * - toolLaunchDisabledTooltip()
 * - hasSeenCwdAnchoredHint() / markCwdAnchoredHintSeen()
 *
 * These cover T017/T018 acceptance scenarios (disabled-state copy matrix)
 * and T021 (one-time cwd-anchored hint seen-state).
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  toolIdFromProjectTool,
  toolLaunchDisabledReason,
  toolLaunchDisabledTooltip,
  hasSeenCwdAnchoredHint,
  markCwdAnchoredHintSeen,
  useToolLaunch,
  type LaunchDisabledReason,
} from './tool-launch';
import type { ToolProfileSummary, ToolLaunchResponse } from '@/bindings/index';

const { toolLaunchMock, addToastMock } = vi.hoisted(() => ({
  toolLaunchMock: vi.fn(),
  addToastMock: vi.fn(),
}));

// tool-launch.ts calls commands.toolsList / commands.toolsLaunch + unwrap
// (spec 037). Mock the generated bindings and let the real unwrap run.
vi.mock('@/bindings/index', () => ({
  commands: {
    toolsList: vi.fn(),
    toolsLaunch: toolLaunchMock,
  },
}));

vi.mock('@/shared/toast', () => ({
  addToast: addToastMock,
}));

// ── toolIdFromProjectTool ──────────────────────────────────────────────────────

describe('toolIdFromProjectTool', () => {
  it('converts PixInsight to pixinsight', () => {
    expect(toolIdFromProjectTool('PixInsight')).toBe('pixinsight');
  });

  it('converts Siril to siril', () => {
    expect(toolIdFromProjectTool('Siril')).toBe('siril');
  });

  it('handles already lowercase input', () => {
    expect(toolIdFromProjectTool('pixinsight')).toBe('pixinsight');
  });

  it('collapses multiple spaces to single underscore', () => {
    // \s+ collapses any whitespace run into one underscore
    expect(toolIdFromProjectTool('My  Tool')).toBe('my_tool');
  });
});

// ── toolLaunchDisabledReason ──────────────────────────────────────────────────

function makeProfile(
  overrides: Partial<ToolProfileSummary> = {},
): ToolProfileSummary {
  return {
    id: 'pixinsight',
    name: 'PixInsight',
    configured: true,
    available: true,
    supportsOpenFolder: true,
    enabled: true,
    autoDetected: false,
    executablePath: '/usr/bin/pixinsight',
    watchExtensions: ['.xisf', '.fits'],
    ...overrides,
  };
}

describe('toolLaunchDisabledReason', () => {
  it('returns null when profile is fully ready', () => {
    expect(toolLaunchDisabledReason(makeProfile())).toBeNull();
  });

  it('returns not_configured when profile is undefined', () => {
    expect(toolLaunchDisabledReason(undefined)).toBe('not_configured');
  });

  it('returns not_configured when enabled=false', () => {
    expect(toolLaunchDisabledReason(makeProfile({ enabled: false }))).toBe(
      'not_configured',
    );
  });

  it('returns not_configured when configured=false', () => {
    expect(toolLaunchDisabledReason(makeProfile({ configured: false }))).toBe(
      'not_configured',
    );
  });

  it('returns not_available when configured but not available', () => {
    expect(
      toolLaunchDisabledReason(
        makeProfile({ configured: true, available: false }),
      ),
    ).toBe('not_available');
  });
});

// ── toolLaunchDisabledTooltip ─────────────────────────────────────────────────

describe('toolLaunchDisabledTooltip', () => {
  const cases: [LaunchDisabledReason, string][] = [
    ['not_configured', 'Tool path not configured'],
    ['not_available', 'Tool executable missing'],
    [null, ''],
  ];

  it.each(cases)('reason=%s → tooltip=%s', (reason, expected) => {
    expect(toolLaunchDisabledTooltip(reason)).toBe(expected);
  });
});

// ── hasSeenCwdAnchoredHint / markCwdAnchoredHintSeen (T021) ───────────────────

describe('hasSeenCwdAnchoredHint / markCwdAnchoredHintSeen', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns false when the hint has never been shown for a tool', () => {
    expect(hasSeenCwdAnchoredHint('siril')).toBe(false);
  });

  it('returns true after marking the hint seen', () => {
    markCwdAnchoredHintSeen('siril');
    expect(hasSeenCwdAnchoredHint('siril')).toBe(true);
  });

  it('tracks seen-state independently per tool id', () => {
    markCwdAnchoredHintSeen('siril');
    expect(hasSeenCwdAnchoredHint('siril')).toBe(true);
    expect(hasSeenCwdAnchoredHint('pixinsight')).toBe(false);
  });
});

// ── useToolLaunch cwd-anchored hint (T021) ────────────────────────────────────

function successResponse(): ToolLaunchResponse {
  return { status: 'success', launchId: 'launch-1' } as ToolLaunchResponse;
}

describe('useToolLaunch — one-time cwd-anchored hint', () => {
  beforeEach(() => {
    localStorage.clear();
    toolLaunchMock.mockReset();
    addToastMock.mockReset();
    toolLaunchMock.mockResolvedValue({ status: 'ok', data: successResponse() });
  });

  it('shows the hint toast on the first successful launch of a no-folder-chooser tool', async () => {
    const { result } = renderHook(() =>
      useToolLaunch('project-1', 'siril', 'Siril', false),
    );

    await act(async () => {
      await result.current.launch();
    });

    await waitFor(() => {
      expect(addToastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'info', duration: 0 }),
      );
    });
    expect(hasSeenCwdAnchoredHint('siril')).toBe(true);
  });

  it('does not show the hint again on a second launch of the same tool', async () => {
    const { result } = renderHook(() =>
      useToolLaunch('project-1', 'siril', 'Siril', false),
    );

    await act(async () => {
      await result.current.launch();
    });
    addToastMock.mockClear();

    await act(async () => {
      await result.current.launch();
    });

    const infoCalls = addToastMock.mock.calls.filter(
      (call: unknown[]) => (call[0] as { variant?: string }).variant === 'info',
    );
    expect(infoCalls).toHaveLength(0);
  });

  it('never shows the hint for a tool that supports opening a folder', async () => {
    const { result } = renderHook(() =>
      useToolLaunch('project-1', 'pixinsight', 'PixInsight', true),
    );

    await act(async () => {
      await result.current.launch();
    });

    const infoCalls = addToastMock.mock.calls.filter(
      (call: unknown[]) => (call[0] as { variant?: string }).variant === 'info',
    );
    expect(infoCalls).toHaveLength(0);
  });
});
