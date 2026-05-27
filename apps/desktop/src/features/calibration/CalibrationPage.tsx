import { useState } from 'react';
import { MASTERS_DATA } from '@/data/fixtures/calibration';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { MastersList } from './MastersList';
import { MasterDetail } from './MasterDetail';

const darks = MASTERS_DATA.filter(m => m.kind === 'dark').length;
const flats = MASTERS_DATA.filter(m => m.kind === 'flat').length;
const bias = MASTERS_DATA.filter(m => m.kind === 'bias').length;
const aging = MASTERS_DATA.filter(m => m.aging).length;

export function CalibrationPage() {
  const [selected, setSelected] = useState<number | null>(null);
  const master = MASTERS_DATA.find(m => m.id === selected) ?? null;

  return (
    <PageShell>
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Calibration"
            subtitle={`${MASTERS_DATA.length} masters · ${darks} darks · ${flats} flats · ${bias} bias · ${aging} aging`}
          />
        }
        list={<MastersList masters={MASTERS_DATA} selected={selected} onSelect={setSelected} />}
        detail={<MasterDetail master={master} />}
      />
    </PageShell>
  );
}
