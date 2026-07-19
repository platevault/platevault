// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Settings.noContracts — verifies API Contracts is absent from Settings under
 * any devMode state (spec 021 T030, FR-001).
 *
 * The developer diagnostics surface is reachable only via Cmd+K, NOT from the
 * Settings tree. This renders the real SettingsPage (with its pane bodies
 * stubbed out — only the nav list built from the actual, unexported
 * `PANES`/`NAV_GROUPS` constants is under test) so a new pane added to
 * production can't silently drift out of sync with a hand-copied mirror, the
 * way the previous hardcoded 11-entry `SETTINGS_PANES` array did (it missed
 * the later-added 'planner', 'framing', 'source-views' panes).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({}),
}));

vi.mock('@/features/settings/useAutoSave', () => ({
  useAutoSave: () => ({ save: vi.fn(), saved: false }),
}));

// Pane bodies are irrelevant to nav construction and pull in their own
// backend/IPC dependencies — stub them so only SettingsPage's real
// PANES/NAV_GROUPS nav-building logic is exercised.
vi.mock('@/features/settings/DataSources', () => ({
  DataSources: () => null,
}));
vi.mock('@/features/settings/Equipment', () => ({ Equipment: () => null }));
vi.mock('@/features/settings/Ingestion', () => ({ Ingestion: () => null }));
vi.mock('@/features/settings/NamingStructure', () => ({
  NamingStructure: () => null,
}));
vi.mock('@/features/settings/ProcessingTools', () => ({
  ProcessingTools: () => null,
}));
vi.mock('@/features/settings/CalibrationMatching', () => ({
  CalibrationMatching: () => null,
}));
vi.mock('@/features/settings/ResolverSettings', () => ({
  ResolverSettings: () => null,
}));
vi.mock('@/features/settings/PlannerSettings', () => ({
  PlannerSettings: () => null,
}));
vi.mock('@/features/settings/Framing', () => ({ Framing: () => null }));
vi.mock('@/features/settings/Cleanup', () => ({ Cleanup: () => null }));
vi.mock('@/features/settings/SourceViews', () => ({
  SourceViews: () => null,
}));
vi.mock('@/features/settings/General', () => ({ General: () => null }));
vi.mock('@/features/settings/Advanced', () => ({ Advanced: () => null }));
vi.mock('@/features/settings/AuditLog', () => ({ AuditLog: () => null }));

import { SettingsPage } from '@/features/settings/SettingsPage';

describe('Settings.noContracts (T030, FR-001)', () => {
  it('does not render an API Contracts nav item', () => {
    render(<SettingsPage />);
    const nav = screen.getByRole('navigation');
    expect(within(nav).queryAllByText(/contract/i)).toHaveLength(0);
  });

  it('does not render a Developer nav item', () => {
    render(<SettingsPage />);
    const nav = screen.getByRole('navigation');
    expect(within(nav).queryAllByText(/developer/i)).toHaveLength(0);
  });
});
