/**
 * CalibrationPage — spec 007 wired.
 *
 * Replaces fixture data (MASTERS_DATA) with real `calibration.masters.list`
 * backend data. The selected master's compatible-sessions accordion uses
 * `calibration.match.suggest` to fetch ranked candidates with confidence +
 * dimension breakdown.
 *
 * URL state: `?selected=<master-id>` (string UUID from the real backend).
 * The route parameter is kept as-is; MastersList receives string IDs now.
 */

import { useNavigate, useSearch } from '@tanstack/react-router';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { Btn } from '@/ui';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { MastersList } from './MastersList';
import { MasterDetail } from './MasterDetail';
import { useCalibrationMasters, useCalibrationSettings } from './useCalibration';
import type { CalibrationMaster_Serialize as CalibrationMaster } from '@/bindings/index';

// ── Contextual toolbar actions for the selected master ────────────────────────

interface ContextualAction {
  label: string;
  variant?: 'primary' | 'danger' | 'ghost';
}

function masterActions(master: CalibrationMaster, agingThresholdDays: number): ContextualAction[] {
  const isAging = master.ageDays > agingThresholdDays;
  const actions: ContextualAction[] = [{ label: 'Use in project', variant: 'primary' }];
  if (isAging) actions.push({ label: 'Replace master', variant: 'danger' });
  actions.push({ label: 'Reveal in Explorer' });
  return actions;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CalibrationPage() {
  const { selected } = useSearch({ from: '/shell/calibration' });
  const navigate = useNavigate({ from: '/calibration' });
  const { masters, loading, error } = useCalibrationMasters();
  const { prefillSuggestion, agingThresholdDays } = useCalibrationSettings();

  const master = masters.find((m) => m.id === selected) ?? null;

  useStaleSelectionCleanup(selected, master !== null, () =>
    navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true }),
  );

  const onSelect = (id: string) =>
    navigate({ search: (prev) => ({ ...prev, selected: id }) });

  const darks = masters.filter((m) => m.kind === 'dark').length;
  const flats = masters.filter((m) => m.kind === 'flat').length;
  const bias = masters.filter((m) => m.kind === 'bias').length;
  const aging = masters.filter((m) => m.ageDays > agingThresholdDays).length;

  // Pluralize counted nouns by count ("1 dark" / "2 darks"); "bias" and "masters"
  // are invariant in this vocabulary.
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const subtitle = loading
    ? 'Loading…'
    : error
      ? 'Failed to load masters'
      : `${masters.length} masters · ${plural(darks, 'dark')} · ${plural(flats, 'flat')} · ${bias} bias${aging > 0 ? ` · ${aging} aging` : ''}`;

  return (
    <PageShell>
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Calibration"
            subtitle={subtitle}
            right={
              master && (
                <>
                  {masterActions(master, agingThresholdDays).map((a) => (
                    <Btn key={a.label} size="sm" variant={a.variant}>
                      {a.label}
                    </Btn>
                  ))}
                </>
              )
            }
          />
        }
        list={
          <MastersList
            masters={masters}
            loading={loading}
            error={error}
            selected={selected ?? null}
            onSelect={onSelect}
            agingThresholdDays={agingThresholdDays}
          />
        }
        detail={<MasterDetail master={master} prefillSuggestion={prefillSuggestion} agingThresholdDays={agingThresholdDays} />}
      />
    </PageShell>
  );
}
