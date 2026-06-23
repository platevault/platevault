// TODO(spec 030 (ingestion settings)): wire to backend when owning spec implements its command.
import { useState } from 'react';
import { Toggle } from '@/ui';
import { m } from '@/lib/i18n';
import { SettingsSection, SettingsRow } from './SettingsKit';

interface IngestionProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

type HashingMode = 'lazy' | 'eager' | 'off';

export function Ingestion({ save }: IngestionProps) {
  const [followSymlinks, setFollowSymlinks] = useState(false);
  const [followJunctions, setFollowJunctions] = useState(false);
  const [scanOnStartup, setScanOnStartup] = useState(true);
  const [hashingMode, setHashingMode] = useState<HashingMode>('lazy');

  const persist = (patch: Record<string, unknown>) => {
    save('ingestion', {
      follow_symlinks: followSymlinks,
      follow_junctions: followJunctions,
      scan_on_startup: scanOnStartup,
      hashing_mode: hashingMode,
      ...patch,
    });
  };

  return (
    <>
      <SettingsSection title={m.settings_ingestion_scan_title()}>
        <SettingsRow
          label={m.settings_ingestion_scan_startup()}
          info={m.settings_ingestion_scan_info()}
        >
          <Toggle
            checked={scanOnStartup}
            onChange={(v) => { setScanOnStartup(v); persist({ scan_on_startup: v }); }}
          />
        </SettingsRow>

        <SettingsRow
          label={m.settings_ingestion_follow_symlinks()}
          info={m.settings_ingestion_symlinks_info()}
        >
          <Toggle
            checked={followSymlinks}
            onChange={(v) => { setFollowSymlinks(v); persist({ follow_symlinks: v }); }}
          />
        </SettingsRow>

        <SettingsRow
          label={m.settings_ingestion_follow_junctions()}
          info={m.settings_ingestion_junctions_info()}
        >
          <Toggle
            checked={followJunctions}
            onChange={(v) => { setFollowJunctions(v); persist({ follow_junctions: v }); }}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={m.settings_ingestion_hashing_title()}>
        <SettingsRow
          label={m.settings_ingestion_hashing_mode()}
          info={m.settings_ingestion_hashing_info()}
        >
          <select
            className="alm-select"
            value={hashingMode}
            onChange={(e) => {
              const v = e.target.value as HashingMode;
              setHashingMode(v);
              persist({ hashing_mode: v });
            }}
          >
            <option value="lazy">{m.settings_ingestion_hashing_lazy()}</option>
            <option value="eager">{m.settings_ingestion_hashing_eager()}</option>
            <option value="off">{m.settings_ingestion_hashing_off()}</option>
          </select>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
