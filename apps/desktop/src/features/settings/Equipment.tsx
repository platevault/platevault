import { useState } from 'react';
import clsx from 'clsx';
import { Btn, Pill } from '@/ui';

interface EquipmentProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

/* ---------- types ---------- */

interface Camera {
  id: string;
  name: string;
  sensor: string;
  pixelSize: string;
}

interface Telescope {
  id: string;
  name: string;
  focalLength: string;
  aperture: string;
}

interface OpticalTrain {
  id: string;
  name: string;
  cameraId: string;
  telescopeId: string;
}

type FilterCategory = 'narrowband' | 'broadband' | 'dual_band' | 'other' | 'custom';

interface Filter {
  id: string;
  name: string;
  category: FilterCategory;
  bandwidth: string;
}

/* ---------- mock data ---------- */

const MOCK_CAMERAS: Camera[] = [
  { id: 'cam-1', name: 'ZWO ASI2600MM Pro', sensor: 'IMX571', pixelSize: '3.76 um' },
  { id: 'cam-2', name: 'ZWO ASI533MC Pro', sensor: 'IMX533', pixelSize: '3.76 um' },
  { id: 'cam-3', name: 'ZWO ASI290MM', sensor: 'IMX290', pixelSize: '2.9 um' },
];

const MOCK_TELESCOPES: Telescope[] = [
  { id: 'tel-1', name: 'Sky-Watcher Esprit 100ED', focalLength: '550mm', aperture: '100mm' },
  { id: 'tel-2', name: 'Celestron C11 EdgeHD', focalLength: '2800mm', aperture: '280mm' },
];

const MOCK_TRAINS: OpticalTrain[] = [
  { id: 'train-1', name: 'Main Imaging Rig', cameraId: 'cam-1', telescopeId: 'tel-1' },
  { id: 'train-2', name: 'Planetary Rig', cameraId: 'cam-3', telescopeId: 'tel-2' },
];

const MOCK_FILTERS: Filter[] = [
  { id: 'f-1', name: 'Ha 3nm', category: 'narrowband', bandwidth: '3nm' },
  { id: 'f-2', name: 'OIII 3nm', category: 'narrowband', bandwidth: '3nm' },
  { id: 'f-3', name: 'SII 3nm', category: 'narrowband', bandwidth: '3nm' },
  { id: 'f-4', name: 'L', category: 'broadband', bandwidth: '~300nm' },
  { id: 'f-5', name: 'R', category: 'broadband', bandwidth: '~100nm' },
  { id: 'f-6', name: 'G', category: 'broadband', bandwidth: '~100nm' },
  { id: 'f-7', name: 'B', category: 'broadband', bandwidth: '~100nm' },
  { id: 'f-8', name: 'Ha-OIII Dual', category: 'dual_band', bandwidth: '~7nm+7nm' },
  { id: 'f-9', name: 'UV/IR Cut', category: 'other', bandwidth: '~350nm' },
];

const FILTER_CATEGORIES: FilterCategory[] = ['narrowband', 'broadband', 'dual_band', 'other', 'custom'];

const CATEGORY_VARIANT: Record<FilterCategory, 'ok' | 'info' | 'warn' | 'neutral' | 'ghost'> = {
  narrowband: 'ok',
  broadband: 'info',
  dual_band: 'warn',
  other: 'neutral',
  custom: 'ghost',
};

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/* ---------- component ---------- */

export function Equipment({ save }: EquipmentProps) {
  const [cameras, setCameras] = useState<Camera[]>(MOCK_CAMERAS);
  const [telescopes, setTelescopes] = useState<Telescope[]>(MOCK_TELESCOPES);
  const [trains, setTrains] = useState<OpticalTrain[]>(MOCK_TRAINS);
  const [filters, setFilters] = useState<Filter[]>(MOCK_FILTERS);
  const [filterCategoryFilter, setFilterCategoryFilter] = useState<FilterCategory | 'all'>('all');

  /* -- inline editing state -- */
  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  const [editingCellField, setEditingCellField] = useState<string>('');
  const [editingCellValue, setEditingCellValue] = useState<string>('');

  const startEdit = (id: string, field: string, currentValue: string) => {
    setEditingCellId(id);
    setEditingCellField(field);
    setEditingCellValue(currentValue);
  };

  const commitEdit = () => {
    if (!editingCellId) return;
    // Apply edit based on which table the id belongs to
    if (editingCellId.startsWith('cam-')) {
      setCameras((prev) =>
        prev.map((c) =>
          c.id === editingCellId ? { ...c, [editingCellField]: editingCellValue } : c,
        ),
      );
    } else if (editingCellId.startsWith('tel-')) {
      setTelescopes((prev) =>
        prev.map((t) =>
          t.id === editingCellId ? { ...t, [editingCellField]: editingCellValue } : t,
        ),
      );
    }
    setEditingCellId(null);
  };

  const cancelEdit = () => {
    setEditingCellId(null);
  };

  const persistAll = () => {
    save('equipment', { cameras, telescopes, trains, filters });
  };

  /* -- train management -- */
  const handleAddTrain = () => {
    const id = makeId('train');
    setTrains((prev) => [
      ...prev,
      { id, name: 'New Train', cameraId: cameras[0]?.id ?? '', telescopeId: telescopes[0]?.id ?? '' },
    ]);
    persistAll();
  };

  const handleRemoveTrain = (id: string) => {
    setTrains((prev) => prev.filter((t) => t.id !== id));
    persistAll();
  };

  const handleTrainFieldChange = (id: string, field: keyof OpticalTrain, value: string) => {
    setTrains((prev) =>
      prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)),
    );
    persistAll();
  };

  /* -- camera / telescope add/remove -- */
  const handleAddCamera = () => {
    const id = makeId('cam');
    setCameras((prev) => [...prev, { id, name: 'New Camera', sensor: '', pixelSize: '' }]);
    startEdit(id, 'name', 'New Camera');
  };

  const handleRemoveCamera = (id: string) => {
    setCameras((prev) => prev.filter((c) => c.id !== id));
    persistAll();
  };

  const handleAddTelescope = () => {
    const id = makeId('tel');
    setTelescopes((prev) => [...prev, { id, name: 'New Telescope', focalLength: '', aperture: '' }]);
    startEdit(id, 'name', 'New Telescope');
  };

  const handleRemoveTelescope = (id: string) => {
    setTelescopes((prev) => prev.filter((t) => t.id !== id));
    persistAll();
  };

  /* -- editable cell helper -- */
  function EditableCell({ id, field, value }: { id: string; field: string; value: string }) {
    const isEditing = editingCellId === id && editingCellField === field;
    if (isEditing) {
      return (
        <input
          className="alm-input alm-input--sm"
          value={editingCellValue}
          onChange={(e) => setEditingCellValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') cancelEdit();
          }}
          autoFocus
          aria-label={`Edit ${field}`}
        />
      );
    }
    return (
      <span
        className="alm-equipment__editable"
        role="button"
        tabIndex={0}
        onClick={() => startEdit(id, field, value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') startEdit(id, field, value);
        }}
        aria-label={`Edit ${field}: ${value || 'empty'}`}
      >
        {value || <span className="alm-equipment__placeholder">Click to edit</span>}
      </span>
    );
  }

  const cameraName = (id: string) => cameras.find((c) => c.id === id)?.name ?? '(unknown)';
  const telescopeName = (id: string) => telescopes.find((t) => t.id === id)?.name ?? '(unknown)';

  const filteredFilters = filterCategoryFilter === 'all'
    ? filters
    : filters.filter((f) => f.category === filterCategoryFilter);

  return (
    <div className="alm-equipment">
      {/* Optical trains */}
      <section className="alm-equipment__section">
        <div className="alm-equipment__section-header">
          <h3 className="alm-equipment__subtitle">Optical Trains</h3>
          <Btn size="sm" onClick={handleAddTrain}>Add train</Btn>
        </div>
        <table className="alm-equipment__table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Camera</th>
              <th>Telescope</th>
              <th className="alm-equipment__col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {trains.map((train) => (
              <tr key={train.id}>
                <td>
                  <EditableCell id={train.id} field="name" value={train.name} />
                </td>
                <td>
                  <select
                    className="alm-select alm-select--sm"
                    value={train.cameraId}
                    onChange={(e) => handleTrainFieldChange(train.id, 'cameraId', e.target.value)}
                    aria-label={`Camera for ${train.name}`}
                  >
                    {cameras.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="alm-select alm-select--sm"
                    value={train.telescopeId}
                    onChange={(e) => handleTrainFieldChange(train.id, 'telescopeId', e.target.value)}
                    aria-label={`Telescope for ${train.name}`}
                  >
                    {telescopes.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </td>
                <td className="alm-equipment__row-actions">
                  <Btn size="sm" variant="ghost" onClick={() => handleRemoveTrain(train.id)}>
                    Remove
                  </Btn>
                </td>
              </tr>
            ))}
            {trains.length === 0 && (
              <tr>
                <td colSpan={4} className="alm-equipment__empty">
                  No optical trains configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Cameras */}
      <section className="alm-equipment__section">
        <div className="alm-equipment__section-header">
          <h3 className="alm-equipment__subtitle">Cameras</h3>
          <Btn size="sm" onClick={handleAddCamera}>Add camera</Btn>
        </div>
        <table className="alm-equipment__table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Sensor</th>
              <th>Pixel Size</th>
              <th className="alm-equipment__col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {cameras.map((cam) => (
              <tr key={cam.id}>
                <td><EditableCell id={cam.id} field="name" value={cam.name} /></td>
                <td><EditableCell id={cam.id} field="sensor" value={cam.sensor} /></td>
                <td><EditableCell id={cam.id} field="pixelSize" value={cam.pixelSize} /></td>
                <td className="alm-equipment__row-actions">
                  <Btn size="sm" variant="ghost" onClick={() => handleRemoveCamera(cam.id)}>
                    Remove
                  </Btn>
                </td>
              </tr>
            ))}
            {cameras.length === 0 && (
              <tr>
                <td colSpan={4} className="alm-equipment__empty">
                  No cameras registered.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Telescopes */}
      <section className="alm-equipment__section">
        <div className="alm-equipment__section-header">
          <h3 className="alm-equipment__subtitle">Telescopes</h3>
          <Btn size="sm" onClick={handleAddTelescope}>Add telescope</Btn>
        </div>
        <table className="alm-equipment__table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Focal Length</th>
              <th>Aperture</th>
              <th className="alm-equipment__col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {telescopes.map((tel) => (
              <tr key={tel.id}>
                <td><EditableCell id={tel.id} field="name" value={tel.name} /></td>
                <td><EditableCell id={tel.id} field="focalLength" value={tel.focalLength} /></td>
                <td><EditableCell id={tel.id} field="aperture" value={tel.aperture} /></td>
                <td className="alm-equipment__row-actions">
                  <Btn size="sm" variant="ghost" onClick={() => handleRemoveTelescope(tel.id)}>
                    Remove
                  </Btn>
                </td>
              </tr>
            ))}
            {telescopes.length === 0 && (
              <tr>
                <td colSpan={4} className="alm-equipment__empty">
                  No telescopes registered.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Filter Library */}
      <section className="alm-equipment__section">
        <div className="alm-equipment__section-header">
          <h3 className="alm-equipment__subtitle">Filter Library</h3>
          <div className="alm-equipment__filter-controls">
            {(['all', ...FILTER_CATEGORIES] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                className={clsx(
                  'alm-equipment__filter-btn',
                  filterCategoryFilter === cat && 'alm-equipment__filter-btn--active',
                )}
                onClick={() => setFilterCategoryFilter(cat)}
              >
                {cat === 'all' ? 'All' : cat.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>
        <table className="alm-equipment__table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Bandwidth</th>
            </tr>
          </thead>
          <tbody>
            {filteredFilters.map((f) => (
              <tr key={f.id}>
                <td>{f.name}</td>
                <td>
                  <Pill
                    label={f.category.replace('_', ' ')}
                    variant={CATEGORY_VARIANT[f.category]}
                    size="sm"
                  />
                </td>
                <td className="alm-mono">{f.bandwidth}</td>
              </tr>
            ))}
            {filteredFilters.length === 0 && (
              <tr>
                <td colSpan={3} className="alm-equipment__empty">
                  No filters match this category.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
