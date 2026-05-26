import { useState } from 'react';
import { Checkbox } from '@base-ui-components/react/checkbox';
import { Button } from '@base-ui-components/react/button';

interface ProtectionProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

interface CategoryProtection {
  id: string;
  label: string;
  protected: boolean;
}

const INITIAL_CATEGORIES: CategoryProtection[] = [
  { id: 'raw_lights', label: 'Raw light frames', protected: true },
  { id: 'calibration_masters', label: 'Calibration masters', protected: true },
  { id: 'accepted_outputs', label: 'Accepted outputs', protected: true },
  { id: 'project_files', label: 'Project structure files', protected: false },
  { id: 'processing_intermediates', label: 'Processing intermediates', protected: false },
];

const INITIAL_EXTENSIONS = ['.fit', '.fits', '.xisf', '.tif', '.tiff', '.ser', '.avi'];

export function Protection({ save }: ProtectionProps) {
  const [categories, setCategories] = useState(INITIAL_CATEGORIES);
  const [extensions, setExtensions] = useState(INITIAL_EXTENSIONS);
  const [newExt, setNewExt] = useState('');
  const [ageThreshold, setAgeThreshold] = useState(7);

  const handleCategoryToggle = (id: string) => {
    const updated = categories.map((c) =>
      c.id === id ? { ...c, protected: !c.protected } : c,
    );
    setCategories(updated);
    save('protection', {
      categories: updated.filter((c) => c.protected).map((c) => c.id),
      extensions,
      age_threshold_days: ageThreshold,
    });
  };

  const handleAddExt = () => {
    const ext = newExt.startsWith('.') ? newExt : `.${newExt}`;
    if (!ext || extensions.includes(ext)) return;
    const updated = [...extensions, ext];
    setExtensions(updated);
    setNewExt('');
    save('protection', {
      categories: categories.filter((c) => c.protected).map((c) => c.id),
      extensions: updated,
      age_threshold_days: ageThreshold,
    });
  };

  const handleRemoveExt = (ext: string) => {
    const updated = extensions.filter((e) => e !== ext);
    setExtensions(updated);
    save('protection', {
      categories: categories.filter((c) => c.protected).map((c) => c.id),
      extensions: updated,
      age_threshold_days: ageThreshold,
    });
  };

  const handleAgeChange = (days: number) => {
    setAgeThreshold(days);
    save('protection', {
      categories: categories.filter((c) => c.protected).map((c) => c.id),
      extensions,
      age_threshold_days: days,
    });
  };

  return (
    <div className="alm-protection">
      {/* Category protection */}
      <section>
        <h3 className="alm-protection__subtitle">Category Protection</h3>
        <p className="alm-protection__hint">
          Protected categories are excluded from cleanup plans.
        </p>
        <ul className="alm-protection__list">
          {categories.map((cat) => (
            <li key={cat.id} className="alm-protection__item">
              <label className="alm-protection__label">
                <Checkbox.Root
                  className="alm-checkbox"
                  checked={cat.protected}
                  onCheckedChange={() => handleCategoryToggle(cat.id)}
                  aria-label={cat.label}
                >
                  <Checkbox.Indicator className="alm-checkbox__indicator">
                    &#x2713;
                  </Checkbox.Indicator>
                </Checkbox.Root>
                <span>{cat.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      {/* File type protection */}
      <section>
        <h3 className="alm-protection__subtitle">File Type Protection</h3>
        <p className="alm-protection__hint">
          Files with these extensions are always protected.
        </p>
        <div className="alm-protection__extensions">
          {extensions.map((ext) => (
            <span key={ext} className="alm-protection__ext-chip">
              <code>{ext}</code>
              <Button
                onClick={() => handleRemoveExt(ext)}
                aria-label={`Remove ${ext}`}
                className="alm-protection__ext-remove"
              >
                &times;
              </Button>
            </span>
          ))}
        </div>
        <div className="alm-protection__add-ext">
          <input
            className="alm-input alm-input--sm"
            value={newExt}
            onChange={(e) => setNewExt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddExt();
            }}
            placeholder=".ext"
            aria-label="New extension"
          />
          <Button
            className="alm-btn alm-btn--sm"
            onClick={handleAddExt}
            disabled={!newExt}
          >
            Add
          </Button>
        </div>
      </section>

      {/* Age threshold */}
      <section>
        <h3 className="alm-protection__subtitle">Age Threshold</h3>
        <p className="alm-protection__hint">
          Files newer than this threshold are always protected from cleanup.
        </p>
        <div className="alm-protection__age">
          <label htmlFor="age-threshold">
            Protect files newer than
          </label>
          <input
            id="age-threshold"
            type="number"
            className="alm-input alm-input--sm"
            value={ageThreshold}
            min={0}
            max={365}
            onChange={(e) => handleAgeChange(parseInt(e.target.value, 10) || 0)}
          />
          <span>days</span>
        </div>
      </section>
    </div>
  );
}
