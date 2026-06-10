import { useNavigate, useSearch } from '@tanstack/react-router';
import { MASTERS_DATA } from '@/data/fixtures/calibration';
import type { MasterFixture } from '@/data/fixtures/calibration';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { Btn } from '@/ui';
import type { BtnVariant } from '@/ui';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { MastersList } from './MastersList';
import { MasterDetail } from './MasterDetail';

interface ContextualAction {
  label: string;
  variant?: BtnVariant;
}

// Contextual toolbar actions for the selected master, driven by kind/aging state.
function masterActions(master: MasterFixture): ContextualAction[] {
  const actions: ContextualAction[] = [{ label: 'Use in project', variant: 'primary' }];
  if (master.aging) {
    actions.push({ label: 'Replace master', variant: 'danger' });
  }
  actions.push({ label: 'Reveal in Explorer' });
  return actions;
}

const darks = MASTERS_DATA.filter((m) => m.kind === 'dark').length;
const flats = MASTERS_DATA.filter((m) => m.kind === 'flat').length;
const bias = MASTERS_DATA.filter((m) => m.kind === 'bias').length;
const aging = MASTERS_DATA.filter((m) => m.aging).length;

export function CalibrationPage() {
  const { selected } = useSearch({ from: '/shell/calibration' });
  const navigate = useNavigate({ from: '/calibration' });
  const master = MASTERS_DATA.find((m) => m.id === selected) ?? null;

  useStaleSelectionCleanup(selected, master !== null, () =>
    navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true }),
  );

  const onSelect = (id: number) => navigate({ search: (prev) => ({ ...prev, selected: id }) });

  return (
    <PageShell>
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Calibration"
            subtitle={`${MASTERS_DATA.length} masters · ${darks} darks · ${flats} flats · ${bias} bias · ${aging} aging`}
            right={
              master && (
                <>
                  {masterActions(master).map((a) => (
                    <Btn key={a.label} size="sm" variant={a.variant}>
                      {a.label}
                    </Btn>
                  ))}
                </>
              )
            }
          />
        }
        list={<MastersList masters={MASTERS_DATA} selected={selected ?? null} onSelect={onSelect} />}
        detail={<MasterDetail master={master} />}
      />
    </PageShell>
  );
}
