import { useState, useEffect } from 'react';
import { listEquipment } from '@/api/commands';
import type { Equipment as EquipmentType } from '@/api/types';

interface EquipmentProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

export function Equipment({ save }: EquipmentProps) {
  const [items, setItems] = useState<EquipmentType[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

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

      {/* Optical trains placeholder */}
      <section>
        <h3 className="alm-equipment__subtitle">Optical Train Configurations</h3>
        <p className="alm-equipment__empty">
          Named optical trains will be configurable after equipment detection is complete.
        </p>
      </section>
    </div>
  );
}
