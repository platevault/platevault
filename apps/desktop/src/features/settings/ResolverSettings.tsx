// Settings → Target Resolution (spec 035, T031).
//
// Replaces the old "Target Catalogs" pane (catalog manifest/minisign download
// surface, spec 014 — removed). Targets now resolve on demand from SIMBAD,
// backed by a bundled seed index and a growing local cache.
//
// Backed by the `target.resolution.settings` / `.update` commands
// (DTO `ResolverSettings`): online toggle (default ON), SIMBAD endpoint,
// debounce_ms, request_timeout_secs (FR-015).

import { ResolverSettingsControl } from './ResolverSettingsControl';
import { Attribution } from './Attribution';
import { SettingsSection } from './SettingsKit';

interface ResolverSettingsPaneProps {
  /** Retained for compatibility with the Settings page save mechanism. */
  save?: (scope: string, values: Record<string, unknown>) => void;
}

export function ResolverSettings(_props: ResolverSettingsPaneProps) {
  return (
    <>
      <SettingsSection title="ONLINE RESOLUTION">
        <ResolverSettingsControl />
      </SettingsSection>

      <Attribution />
    </>
  );
}
