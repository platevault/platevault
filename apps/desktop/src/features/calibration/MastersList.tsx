/**
 * MastersList — spec 007 wired.
 *
 * Renders calibration masters from the real `calibration.masters.list` backend
 * response. Grouped by kind (dark / flat / bias). Dark-flat is not shown in v1
 * (FR-001).
 */

import { ListSidebar, ListItem } from '@/components';
import { Pill, EmptyState } from '@/ui';
import type { CalibrationMaster_Serialize as CalibrationMaster } from '@/bindings/index';

type Kind = 'dark' | 'flat' | 'bias';

const KIND_ORDER: Kind[] = ['dark', 'flat', 'bias'];
const GROUP_LABELS: Record<Kind, string> = {
  dark: 'DARKS',
  flat: 'FLATS',
  bias: 'BIAS',
};

function kindLabel(kind: string): Kind | null {
  if (kind === 'dark' || kind === 'flat' || kind === 'bias') return kind;
  return null;
}

interface Props {
  masters: CalibrationMaster[];
  loading: boolean;
  error: string | undefined;
  selected: string | null;
  onSelect: (id: string) => void;
  /** Days threshold for the "aging" warning pill. Comes from persisted settings (FR-023). */
  agingThresholdDays: number;
}

export function MastersList({ masters, loading, error, selected, onSelect, agingThresholdDays }: Props) {
  if (loading) {
    return (
      <ListSidebar footer="Loading…">
        <div
          style={{ padding: 'var(--alm-sp-2)', fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)' }}
          data-testid="masters-loading"
        >
          Loading calibration masters…
        </div>
      </ListSidebar>
    );
  }

  if (error) {
    return (
      <ListSidebar footer="Error">
        <EmptyState title="Failed to load" desc={error} data-testid="masters-error" />
      </ListSidebar>
    );
  }

  if (masters.length === 0) {
    return (
      <ListSidebar footer="0 items">
        <EmptyState
          title="No calibration masters"
          desc="Run a scan to import calibration frames."
          data-testid="masters-empty"
        />
      </ListSidebar>
    );
  }

  const grouped = KIND_ORDER.map((k) => ({
    kind: k,
    items: masters.filter((m) => kindLabel(m.kind.toLowerCase()) === k),
  })).filter((g) => g.items.length > 0);

  return (
    <ListSidebar
      placeholder="Search camera, kind…"
      controls={
        <>
          <select defaultValue="kind">
            <option value="kind">Group: kind</option>
            <option value="camera">camera</option>
          </select>
          <select defaultValue="name">
            <option value="name">Sort: name</option>
            <option value="age">age</option>
          </select>
        </>
      }
      footer={`${masters.length} items`}
    >
      {grouped.map((group) => (
        <div key={group.kind}>
          <div className="alm-group-header">{GROUP_LABELS[group.kind]}</div>
          {group.items.map((m) => {
            const isAging = m.ageDays > agingThresholdDays;
            // Fingerprint may be absent on real master rows (e.g. metadata not yet
            // extracted); guard every field rather than assuming it is populated.
            // Human-readable fingerprint identity (was an opaque id hash).
            const fp = m.fingerprint;
            const kindCap = group.kind.charAt(0).toUpperCase() + group.kind.slice(1);
            const expStr = fp?.exposureS != null ? `${fp.exposureS}s` : '';
            const filterStr = fp?.filter ?? '';
            const discriminator = group.kind === 'dark' ? expStr : group.kind === 'flat' ? filterStr : '';
            const titleText = discriminator ? `Master ${kindCap} · ${discriminator}` : `Master ${kindCap}`;
            const metaParts = [
              fp?.tempC != null ? `${fp.tempC}°C` : '',
              fp?.gain != null ? `g${fp.gain}` : '',
              fp?.binning ? fp.binning.replace('x', '×') : '',
              fp?.camera ? fp.camera.replace('ASI', '') : '',
            ].filter(Boolean);

            return (
              <ListItem
                key={m.id}
                selected={selected === m.id}
                onClick={() => onSelect(m.id)}
                title={titleText}
                meta={
                  <>
                    {metaParts.join(' · ')}
                    {isAging && (
                      <>
                        {metaParts.length > 0 && <span className="alm-list-item__meta-sep">·</span>}
                        <Pill variant="warn">aging {m.ageDays}d</Pill>
                      </>
                    )}
                  </>
                }
              />
            );
          })}
        </div>
      ))}
    </ListSidebar>
  );
}
