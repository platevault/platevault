// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * LogPanel export failure: an export that failed after claiming its
 * destination leaves its own incomplete file there, and a retry to that name
 * is refused until the user deletes it, so the error names the file. It names
 * the path the backend wrote (under the canonicalized parent), which the path
 * the dialog returned may no longer reach once a symlink in it is retargeted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { resetLogStore } from '@/data/logStore';
import { LogPanelProvider } from '@/app/LogPanelContext';
import { LogPanel } from '@/app/LogPanel';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn().mockResolvedValue('/Volumes/STICK/link/log-export.json'),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    settingsGet: vi.fn().mockResolvedValue({
      status: 'ok',
      data: {
        scope: 'advanced',
        values: { logLevel: 'info', rememberFollowLogs: false },
      },
    }),
    settingsUpdate: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    logExport: vi.fn().mockResolvedValue({
      status: 'error',
      error: {
        code: 'export.unfinished_file',
        message: 'backend diagnostic',
        severity: 'blocking',
        retryable: false,
        details: { path: '/Volumes/STICK/real/log-export.json' },
      },
    }),
  },
}));

vi.mock('@/data/logSubscription', () => ({
  startLogSubscription: vi.fn().mockResolvedValue(undefined),
}));

describe('LogPanel export failure', () => {
  beforeEach(() => {
    resetLogStore();
  });

  it('names the incomplete file at the path the backend wrote', async () => {
    render(
      <LogPanelProvider>
        <LogPanel />
      </LogPanelProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Expand log panel' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Export log to JSON file' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not export: An incomplete export file remains at /Volumes/STICK/real/log-export.json. Delete it before exporting again.',
    );
  });
});
