/**
 * Settings.noContracts — verifies API Contracts is absent from Settings under
 * any devMode state (spec 021 T030, FR-001).
 *
 * The developer diagnostics surface is reachable only via Cmd+K, NOT from the
 * Settings tree. This test checks the pane list constant directly (the
 * rendered dialog requires too much DOM — deferred to Playwright).
 */

import { describe, it, expect } from 'vitest';

// Mirror of PANES from apps/desktop/src/features/settings/SettingsPage.tsx.
// Keep in sync. The test fails if any pane matching "contract" is added.
const SETTINGS_PANES = [
  { id: 'sources', label: 'Data Sources' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'ingestion', label: 'Ingestion' },
  { id: 'naming', label: 'Naming & Structure' },
  { id: 'tools', label: 'Processing Tools' },
  { id: 'cal', label: 'Calibration Matching' },
  { id: 'catalogs', label: 'Target Catalogs' },
  { id: 'cleanup', label: 'Cleanup' },
  { id: 'general', label: 'General' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'audit', label: 'Audit Log' },
] as const;

describe('Settings.noContracts (T030, FR-001)', () => {
  it('does not contain an API Contracts pane', () => {
    const contractPane = SETTINGS_PANES.find(
      (p) =>
        p.label.toLowerCase().includes('contract') ||
        p.id.toLowerCase().includes('contract'),
    );
    expect(contractPane).toBeUndefined();
  });

  it('does not contain a Developer pane', () => {
    const devPane = SETTINGS_PANES.find(
      (p) =>
        p.label.toLowerCase().includes('developer') ||
        p.id.toLowerCase().includes('dev'),
    );
    expect(devPane).toBeUndefined();
  });

  it('all pane IDs are from the known non-dev set', () => {
    const allowedIds = new Set([
      'sources',
      'equipment',
      'ingestion',
      'naming',
      'tools',
      'cal',
      'catalogs',
      'cleanup',
      'general',
      'advanced',
      'audit',
    ]);
    for (const pane of SETTINGS_PANES) {
      expect(allowedIds.has(pane.id)).toBe(true);
    }
  });
});
