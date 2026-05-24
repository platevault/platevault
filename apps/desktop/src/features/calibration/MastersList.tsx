import { clsx } from 'clsx';
import type { CalibrationMaster, CalibrationKind } from '@/api/types';
import { Section } from '@/ui';

export interface MastersListProps {
  masters: CalibrationMaster[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

const KIND_LABELS: Record<CalibrationKind, string> = {
  dark: 'Darks',
  flat: 'Flats',
  bias: 'Bias',
  dark_flat: 'Dark Flats',
  bad_pixel_map: 'Bad Pixel Maps',
};

const KIND_ORDER: CalibrationKind[] = ['dark', 'flat', 'bias', 'dark_flat', 'bad_pixel_map'];

function formatAge(days: number): string {
  if (days >= 365) return `${Math.floor(days / 365)}y`;
  if (days >= 30) return `${Math.floor(days / 30)}mo`;
  return `${days}d`;
}

export function MastersList({ masters, selectedId, onSelect }: MastersListProps) {
  const grouped = new Map<CalibrationKind, CalibrationMaster[]>();

  for (const master of masters) {
    const list = grouped.get(master.kind) ?? [];
    list.push(master);
    grouped.set(master.kind, list);
  }

  return (
    <nav className="alm-masters-list" aria-label="Calibration masters">
      {KIND_ORDER.filter((kind) => grouped.has(kind)).map((kind) => (
        <Section key={kind} title={KIND_LABELS[kind]} defaultOpen>
          <ul className="alm-masters-list__group">
            {grouped.get(kind)!.map((master) => {
              const isAging = master.age_days >= 90;
              const isSelected = master.id === selectedId;

              return (
                <li key={master.id}>
                  <button
                    type="button"
                    className={clsx(
                      'alm-masters-list__item',
                      isSelected && 'alm-masters-list__item--selected',
                    )}
                    onClick={() => onSelect(master.id)}
                    aria-current={isSelected ? 'true' : undefined}
                  >
                    <span className="alm-masters-list__summary">
                      {master.fingerprint.camera}
                      {master.fingerprint.binning && ` ${master.fingerprint.binning}`}
                    </span>
                    <span
                      className={clsx(
                        'alm-masters-list__age',
                        isAging && 'alm-masters-list__age--warn',
                      )}
                      title={`${master.age_days} days old`}
                    >
                      {isAging && '⚠ '}
                      {formatAge(master.age_days)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      ))}
      {masters.length === 0 && (
        <div className="alm-page__empty">No calibration masters found.</div>
      )}
    </nav>
  );
}
