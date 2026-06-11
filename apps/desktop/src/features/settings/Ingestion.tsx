// TODO(spec 030 (ingestion settings)): wire to backend when owning spec implements its command.
import { useState } from 'react';
import { Toggle, RadioGroup } from '@/ui';

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
      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Scan Defaults</div>

        <div className="alm-settings__row">
          <div className="alm-settings__row-label">Scan on startup</div>
          <div className="alm-settings__row-content">
            <Toggle
              checked={scanOnStartup}
              onChange={(v) => { setScanOnStartup(v); persist({ scan_on_startup: v }); }}
            />
          </div>
          <div className="alm-settings__row-desc">Scan all roots each time the application opens.</div>
        </div>

        <div className="alm-settings__row">
          <div className="alm-settings__row-label">Follow symbolic links</div>
          <div className="alm-settings__row-content">
            <Toggle
              checked={followSymlinks}
              onChange={(v) => { setFollowSymlinks(v); persist({ follow_symlinks: v }); }}
            />
          </div>
          <div className="alm-settings__row-desc">
            Follow symlinks during filesystem scans. Disabled by default to prevent loops.
          </div>
        </div>

        <div className="alm-settings__row">
          <div className="alm-settings__row-label">Follow NTFS junctions</div>
          <div className="alm-settings__row-content">
            <Toggle
              checked={followJunctions}
              onChange={(v) => { setFollowJunctions(v); persist({ follow_junctions: v }); }}
            />
          </div>
          <div className="alm-settings__row-desc">
            Follow NTFS directory junctions on Windows. Enable if your library uses junctions for external drives.
          </div>
        </div>
      </div>

      <div className="alm-settings__group">
        <div className="alm-settings__group-title">File Hashing</div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-content">
            <RadioGroup
              options={[
                { value: 'lazy', label: 'Lazy', desc: 'Hash only when needed (e.g. duplicate detection)' },
                { value: 'eager', label: 'Eager', desc: 'Hash every file on first scan — slower but complete' },
                { value: 'off', label: 'Off', desc: 'Never hash — fastest, no duplicate detection' },
              ]}
              value={hashingMode}
              onChange={(v) => { setHashingMode(v as HashingMode); persist({ hashing_mode: v }); }}
            />
          </div>
          <div className="alm-settings__row-desc">
            Large-file hashing is optional. Lazy hashing defers work until a feature requires it.
          </div>
        </div>
      </div>
    </>
  );
}
