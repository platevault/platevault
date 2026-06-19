/**
 * Vitest tests for tool-launch helpers (spec 011 T013/T018).
 *
 * Tests pure functions only (no process spawning):
 * - toolIdFromProjectTool()
 * - toolLaunchDisabledReason()
 * - toolLaunchDisabledTooltip()
 *
 * These cover T017/T018 acceptance scenarios (disabled-state copy matrix).
 */
import { describe, it, expect } from 'vitest';
import {
  toolIdFromProjectTool,
  toolLaunchDisabledReason,
  toolLaunchDisabledTooltip,
  type LaunchDisabledReason,
} from './tool-launch';
import type { ToolProfileSummary } from '@/api/commands';

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

function makeProfile(overrides: Partial<ToolProfileSummary> = {}): ToolProfileSummary {
  return {
    id: 'pixinsight',
    name: 'PixInsight',
    configured: true,
    available: true,
    supportsOpenFolder: true,
    enabled: true,
    autoDetected: false,
    executablePath: '/usr/bin/pixinsight',
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
    expect(toolLaunchDisabledReason(makeProfile({ enabled: false }))).toBe('not_configured');
  });

  it('returns not_configured when configured=false', () => {
    expect(toolLaunchDisabledReason(makeProfile({ configured: false }))).toBe('not_configured');
  });

  it('returns not_available when configured but not available', () => {
    expect(
      toolLaunchDisabledReason(makeProfile({ configured: true, available: false })),
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
