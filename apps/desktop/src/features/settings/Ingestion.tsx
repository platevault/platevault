import { useState } from 'react';
import { Switch } from '@base-ui-components/react/switch';
import { Btn } from '@/ui';

interface IngestionProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

const FILTER_OPTIONS = [
  'None',
  'Ha',
  'OIII',
  'SII',
  'L',
  'R',
  'G',
  'B',
  'Ha-OIII Dual',
] as const;

export function Ingestion({ save }: IngestionProps) {
  const [watcherEnabled, setWatcherEnabled] = useState(false);
  const [scanOnStartup, setScanOnStartup] = useState(true);
  const [followSymlinks, setFollowSymlinks] = useState(false);
  const [followJunctions, setFollowJunctions] = useState(false);
  const [hashingEnabled, setHashingEnabled] = useState(false);
  const [metadataExtraction, setMetadataExtraction] = useState(true);
  const [exposureTolerance, setExposureTolerance] = useState('2');
  const [temperatureTolerance, setTemperatureTolerance] = useState('5');
  const [defaultFilter, setDefaultFilter] = useState('None');

  const persistAll = () => {
    save('ingestion', {
      watcher_enabled: watcherEnabled,
      scan_on_startup: scanOnStartup,
      follow_symlinks: followSymlinks,
      follow_junctions: followJunctions,
      hashing_enabled: hashingEnabled,
      metadata_extraction: metadataExtraction,
      exposure_tolerance: Number(exposureTolerance),
      temperature_tolerance: Number(temperatureTolerance),
      default_filter: defaultFilter,
    });
  };

  const handleToggle = (
    setter: React.Dispatch<React.SetStateAction<boolean>>,
    current: boolean,
  ) => {
    setter(!current);
    // Defer persist to next tick so state is updated
    setTimeout(persistAll, 0);
  };

  const handleRescan = () => {
    console.log('Manual rescan triggered');
  };

  return (
    <div className="alm-ingestion">
      {/* Watcher */}
      <section className="alm-ingestion__section">
        <h3 className="alm-ingestion__subtitle">File Watcher</h3>
        <div className="alm-ingestion__toggle-row">
          <label className="alm-ingestion__toggle-label">
            <Switch.Root
              className="alm-switch"
              checked={watcherEnabled}
              onCheckedChange={() => handleToggle(setWatcherEnabled, watcherEnabled)}
              aria-label="Enable file watcher"
            >
              <Switch.Thumb className="alm-switch__thumb" />
            </Switch.Root>
            <span>Watch source folders for new files</span>
          </label>
        </div>
        <div className="alm-ingestion__toggle-row">
          <label className="alm-ingestion__toggle-label">
            <Switch.Root
              className="alm-switch"
              checked={scanOnStartup}
              onCheckedChange={() => handleToggle(setScanOnStartup, scanOnStartup)}
              aria-label="Scan on startup"
            >
              <Switch.Thumb className="alm-switch__thumb" />
            </Switch.Root>
            <span>Scan all roots on application startup</span>
          </label>
        </div>
        <div className="alm-ingestion__actions">
          <Btn size="sm" onClick={handleRescan}>
            Rescan all roots now
          </Btn>
        </div>
      </section>

      {/* Scan defaults */}
      <section className="alm-ingestion__section">
        <h3 className="alm-ingestion__subtitle">Scan Defaults</h3>
        <div className="alm-ingestion__toggle-row">
          <label className="alm-ingestion__toggle-label">
            <Switch.Root
              className="alm-switch"
              checked={followSymlinks}
              onCheckedChange={() => handleToggle(setFollowSymlinks, followSymlinks)}
              aria-label="Follow symlinks during scan"
            >
              <Switch.Thumb className="alm-switch__thumb" />
            </Switch.Root>
            <span>Follow symbolic links</span>
          </label>
        </div>
        <div className="alm-ingestion__toggle-row">
          <label className="alm-ingestion__toggle-label">
            <Switch.Root
              className="alm-switch"
              checked={followJunctions}
              onCheckedChange={() => handleToggle(setFollowJunctions, followJunctions)}
              aria-label="Follow junctions during scan"
            >
              <Switch.Thumb className="alm-switch__thumb" />
            </Switch.Root>
            <span>Follow NTFS junctions</span>
          </label>
        </div>
        <div className="alm-ingestion__toggle-row">
          <label className="alm-ingestion__toggle-label">
            <Switch.Root
              className="alm-switch"
              checked={hashingEnabled}
              onCheckedChange={() => handleToggle(setHashingEnabled, hashingEnabled)}
              aria-label="Enable file hashing"
            >
              <Switch.Thumb className="alm-switch__thumb" />
            </Switch.Root>
            <span>Compute file hashes (slower, enables duplicate detection)</span>
          </label>
        </div>
        <div className="alm-ingestion__toggle-row">
          <label className="alm-ingestion__toggle-label">
            <Switch.Root
              className="alm-switch"
              checked={metadataExtraction}
              onCheckedChange={() => handleToggle(setMetadataExtraction, metadataExtraction)}
              aria-label="Enable metadata extraction"
            >
              <Switch.Thumb className="alm-switch__thumb" />
            </Switch.Root>
            <span>Extract FITS/XISF metadata on scan</span>
          </label>
        </div>
      </section>

      {/* Grouping tolerances */}
      <section className="alm-ingestion__section">
        <h3 className="alm-ingestion__subtitle">Grouping Tolerances</h3>
        <p className="alm-ingestion__hint">
          Used when grouping frames into acquisition sessions.
        </p>
        <div className="alm-ingestion__field">
          <label className="alm-ingestion__field-label" htmlFor="exposure-tolerance">
            Exposure tolerance (seconds)
          </label>
          <input
            id="exposure-tolerance"
            type="number"
            className="alm-input alm-input--sm"
            value={exposureTolerance}
            min={0}
            max={60}
            onChange={(e) => {
              setExposureTolerance(e.target.value);
              persistAll();
            }}
          />
        </div>
        <div className="alm-ingestion__field">
          <label className="alm-ingestion__field-label" htmlFor="temperature-tolerance">
            Temperature tolerance (°C)
          </label>
          <input
            id="temperature-tolerance"
            type="number"
            className="alm-input alm-input--sm"
            value={temperatureTolerance}
            min={0}
            max={30}
            onChange={(e) => {
              setTemperatureTolerance(e.target.value);
              persistAll();
            }}
          />
        </div>
      </section>

      {/* Default filter */}
      <section className="alm-ingestion__section">
        <h3 className="alm-ingestion__subtitle">Default Filter</h3>
        <p className="alm-ingestion__hint">
          Applied to frames that have no filter metadata in their headers.
        </p>
        <div className="alm-ingestion__field">
          <label className="alm-ingestion__field-label" htmlFor="default-filter">
            Default filter
          </label>
          <select
            id="default-filter"
            className="alm-select"
            value={defaultFilter}
            onChange={(e) => {
              setDefaultFilter(e.target.value);
              persistAll();
            }}
          >
            {FILTER_OPTIONS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
      </section>
    </div>
  );
}
