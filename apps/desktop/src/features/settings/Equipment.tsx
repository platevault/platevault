import { useState, useEffect } from 'react';
import { listEquipment } from '@/api/commands';
import type { Equipment as EquipmentType } from '@/api/types';
import { Btn } from '@/ui';

interface EquipmentProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

interface OpticalTrain {
  id: string;
  name: string;
  telescope: string;
  camera: string;
  filterWheel: string;
}

function makeId() {
  return `train-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

const EMPTY_TRAIN: Omit<OpticalTrain, 'id'> = {
  name: '',
  telescope: '',
  camera: '',
  filterWheel: '',
};

export function Equipment({ save }: EquipmentProps) {
  const [items, setItems] = useState<EquipmentType[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Optical train state
  const [trains, setTrains] = useState<OpticalTrain[]>([]);
  const [editingTrainId, setEditingTrainId] = useState<string | null>(null);
  const [trainDraft, setTrainDraft] = useState<Omit<OpticalTrain, 'id'>>(EMPTY_TRAIN);

  useEffect(() => {
    listEquipment().then(setItems);
  }, []);

  const handleAliasClick = (item: EquipmentType) => {
    setEditingId(item.id);
    setEditValue(item.aliases.join(', '));
  };

  const handleAliasCommit = (item: EquipmentType) => {
    const newAliases = editValue
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const updated = items.map((i) =>
      i.id === item.id ? { ...i, aliases: newAliases } : i,
    );
    setItems(updated);
    setEditingId(null);
    save('equipment', {
      equipment: updated.map((i) => ({ id: i.id, aliases: i.aliases })),
    });
  };

  const handleAddTrain = () => {
    const id = makeId();
    setEditingTrainId(id);
    setTrainDraft({ ...EMPTY_TRAIN });
  };

  const handleEditTrain = (train: OpticalTrain) => {
    setEditingTrainId(train.id);
    setTrainDraft({ name: train.name, telescope: train.telescope, camera: train.camera, filterWheel: train.filterWheel });
  };

  const handleTrainCommit = () => {
    if (!editingTrainId) return;
    const existing = trains.find((t) => t.id === editingTrainId);
    let updated: OpticalTrain[];
    if (existing) {
      updated = trains.map((t) =>
        t.id === editingTrainId ? { ...t, ...trainDraft } : t,
      );
    } else {
      updated = [...trains, { id: editingTrainId, ...trainDraft }];
    }
    setTrains(updated);
    setEditingTrainId(null);
    setTrainDraft({ ...EMPTY_TRAIN });
    save('equipment', {
      equipment: items.map((i) => ({ id: i.id, aliases: i.aliases })),
      optical_trains: updated,
    });
  };

  const handleTrainCancel = () => {
    setEditingTrainId(null);
    setTrainDraft({ ...EMPTY_TRAIN });
  };

  const handleDeleteTrain = (id: string) => {
    const updated = trains.filter((t) => t.id !== id);
    setTrains(updated);
    save('equipment', {
      equipment: items.map((i) => ({ id: i.id, aliases: i.aliases })),
      optical_trains: updated,
    });
  };

  return (
    <div className="alm-equipment">
      {/* Auto-detected equipment */}
      <section>
        <h3 className="alm-equipment__subtitle">Detected Equipment</h3>
        <table className="alm-equipment__table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Aliases</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.kind}</td>
                <td>
                  {editingId === item.id ? (
                    <input
                      className="alm-input alm-input--sm"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => handleAliasCommit(item)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAliasCommit(item);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                      aria-label={`Aliases for ${item.name}`}
                    />
                  ) : (
                    <span
                      className="alm-equipment__aliases"
                      onClick={() => handleAliasClick(item)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAliasClick(item);
                      }}
                      aria-label={`Edit aliases for ${item.name}`}
                    >
                      {item.aliases.length > 0
                        ? item.aliases.join(', ')
                        : 'Click to add aliases'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Optical train configurations */}
      <section>
        <h3 className="alm-equipment__subtitle">Optical Train Configurations</h3>

        {trains.length > 0 && (
          <table className="alm-equipment__table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Telescope</th>
                <th>Camera</th>
                <th>Filter Wheel</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {trains.map((train) => (
                <tr key={train.id}>
                  <td>{train.name}</td>
                  <td>{train.telescope}</td>
                  <td>{train.camera}</td>
                  <td>{train.filterWheel || '—'}</td>
                  <td className="alm-equipment__row-actions">
                    <Btn size="sm" variant="ghost" onClick={() => handleEditTrain(train)}>
                      Edit
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => handleDeleteTrain(train.id)}>
                      Remove
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {editingTrainId !== null && (
          <div className="alm-equipment__train-form">
            <div className="alm-logs__field">
              <label className="alm-logs__label" htmlFor="train-name">Name</label>
              <input
                id="train-name"
                className="alm-input"
                value={trainDraft.name}
                placeholder="e.g. Main Rig"
                onChange={(e) => setTrainDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
            <div className="alm-logs__field">
              <label className="alm-logs__label" htmlFor="train-telescope">Telescope</label>
              <input
                id="train-telescope"
                className="alm-input"
                value={trainDraft.telescope}
                placeholder="e.g. Esprit 100ED"
                onChange={(e) => setTrainDraft((d) => ({ ...d, telescope: e.target.value }))}
              />
            </div>
            <div className="alm-logs__field">
              <label className="alm-logs__label" htmlFor="train-camera">Camera</label>
              <input
                id="train-camera"
                className="alm-input"
                value={trainDraft.camera}
                placeholder="e.g. ASI2600MM Pro"
                onChange={(e) => setTrainDraft((d) => ({ ...d, camera: e.target.value }))}
              />
            </div>
            <div className="alm-logs__field">
              <label className="alm-logs__label" htmlFor="train-filterwheel">Filter Wheel</label>
              <input
                id="train-filterwheel"
                className="alm-input"
                value={trainDraft.filterWheel}
                placeholder="e.g. EFW 7x36mm (optional)"
                onChange={(e) => setTrainDraft((d) => ({ ...d, filterWheel: e.target.value }))}
              />
            </div>
            <div className="alm-logs__actions">
              <Btn onClick={handleTrainCommit} disabled={!trainDraft.name.trim()}>
                Save train
              </Btn>
              <Btn variant="ghost" onClick={handleTrainCancel}>
                Cancel
              </Btn>
            </div>
          </div>
        )}

        {editingTrainId === null && (
          <div className="alm-logs__actions">
            <Btn size="sm" onClick={handleAddTrain}>
              Add optical train
            </Btn>
          </div>
        )}
      </section>
    </div>
  );
}
