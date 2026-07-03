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
import { m } from '@/lib/i18n';

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

/**
 * How many sessions / projects reference this master.
 *
 * Real usage figures: `usedBySessionIds` / `usedByProjectIds` are populated by
 * the `calibration.masters.list` backend response (the master's reuse links).
 * No STUB needed — these are real fields. Renders "3 sessions · 1 project",
 * collapsing to the non-zero parts, or "unused" when nothing references it.
 */
function usageSummary(master: CalibrationMaster): string {
  const sessions = (master.usedBySessionIds ?? []).length;
  const projects = (master.usedByProjectIds ?? []).length;
  const parts: string[] = [];
  if (sessions > 0) parts.push(m.calibration_usage_sessions({ count: sessions }));
  if (projects > 0) parts.push(m.calibration_usage_projects({ count: projects }));
  return parts.length > 0 ? parts.join(' · ') : 'unused';
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
      <ListSidebar footer={m.common_loading()}>
        <div
          className="alm-masters-list__status"
          data-testid="masters-loading"
        >
          {m.calibration_loading()}
        </div>
      </ListSidebar>
    );
  }

  if (error) {
    return (
      <ListSidebar footer={m.calibration_load_error_title()}>
        <EmptyState title={m.calibration_load_error_title()} desc={error} data-testid="masters-error" />
      </ListSidebar>
    );
  }

  if (masters.length === 0) {
    return (
      <ListSidebar footer="0 items">
        <EmptyState
          title={m.calibration_empty_title()}
          desc={m.calibration_empty_desc()}
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
      placeholder={m.calibration_search_placeholder()}
      controls={
        <>
          <select defaultValue="kind">
            <option value="kind">{m.calibration_masters_group_kind()}</option>
            <option value="camera">{m.calibration_masters_group_camera()}</option>
          </select>
          <select defaultValue="name">
            <option value="name">{m.targets_legacy_sort_name()}</option>
            <option value="age">{m.calibration_masters_sort_age()}</option>
          </select>
        </>
      }
      footer={`${masters.length} items`}
    >
      {grouped.map((group) => (
        <div key={group.kind}>
          <div className="alm-group-header">{GROUP_LABELS[group.kind]}</div>
          {group.items.map((master) => {
            const isAging = master.ageDays > agingThresholdDays;
            // Fingerprint may be absent on real master rows (e.g. metadata not yet
            // extracted); guard every field rather than assuming it is populated.
            // Human-readable fingerprint identity (was an opaque id hash).
            const fp = master.fingerprint;
            const kindCap = group.kind.charAt(0).toUpperCase() + group.kind.slice(1);
            const expStr = fp?.exposureS != null ? `${fp.exposureS}s` : '';
            const filterStr = fp?.filter ?? '';
            const discriminator = group.kind === 'dark' ? expStr : group.kind === 'flat' ? filterStr : '';
            const titleText = discriminator ? m.calibration_master_title_disc({ kind: kindCap, disc: discriminator }) : m.calibration_master_title({ kind: kindCap });
            const metaParts = [
              fp?.tempC != null ? `${fp.tempC}°C` : '',
              fp?.gain != null ? `g${fp.gain}` : '',
              fp?.binning ? fp.binning.replace('x', '×') : '',
              fp?.camera ? fp.camera.replace('ASI', '') : '',
            ].filter(Boolean);

            return (
              <ListItem
                key={master.id}
                selected={selected === master.id}
                onClick={() => onSelect(master.id)}
                title={titleText}
                meta={
                  <>
                    {metaParts.join(' · ')}
                    <span className="alm-masters-list__usage" data-testid={`master-usage-${master.id}`}>
                      {metaParts.length > 0 && <span className="alm-list-item__meta-sep">·</span>}
                      {usageSummary(master)}
                    </span>
                    {isAging && (
                      <>
                        <span className="alm-list-item__meta-sep">·</span>
                        <Pill variant="warn">{m.calibration_aging_days({ days: master.ageDays })}</Pill>
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
