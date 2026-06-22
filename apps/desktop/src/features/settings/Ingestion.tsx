// TODO(spec 030 (ingestion settings)): wire to backend when owning spec implements its command.
import { useState } from 'react';
import { Toggle } from '@/ui';
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
      <SettingsSection title="Scan defaults">
        <SettingsRow
          label="Scan on startup"
          info="Scan all roots each time the application opens."
        >
          <Toggle
            checked={scanOnStartup}
            onChange={(v) => { setScanOnStartup(v); persist({ scan_on_startup: v }); }}
          />
        </SettingsRow>

        <SettingsRow
          label="Follow symbolic links"
          info="Follow symlinks during filesystem scans. Disabled by default to prevent scan loops."
        >
          <Toggle
            checked={followSymlinks}
            onChange={(v) => { setFollowSymlinks(v); persist({ follow_symlinks: v }); }}
          />
        </SettingsRow>

        <SettingsRow
          label="Follow NTFS junctions"
          info="Follow NTFS directory junctions on Windows. Enable if your library uses junctions for external drives."
        >
          <Toggle
            checked={followJunctions}
            onChange={(v) => { setFollowJunctions(v); persist({ follow_junctions: v }); }}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="File hashing">
        <SettingsRow
          label="Hashing mode"
          info="Lazy defers hashing until a feature needs it (e.g. duplicate detection). Eager hashes every file on first scan. Off disables hashing entirely."
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
            <option value="lazy">Lazy — hash only when needed</option>
            <option value="eager">Eager — hash every file on first scan</option>
            <option value="off">Off — never hash</option>
          </select>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
