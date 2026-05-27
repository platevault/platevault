import { useState } from 'react';
import { SESSIONS_DATA } from '@/data/fixtures/sessions';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { Btn } from '@/ui';
import { SessionsList } from './SessionsList';
import { SessionDetail } from './SessionDetail';

export function SessionsPage() {
  const [selected, setSelected] = useState<number | null>(null);
  const session = SESSIONS_DATA.find(s => s.id === selected);
  return (
    <PageShell>
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Sessions"
            subtitle={`${SESSIONS_DATA.length} sessions · ${SESSIONS_DATA.filter(s => s.state === 'confirmed').length} confirmed · ${SESSIONS_DATA.filter(s => s.state === 'needs_review').length} needs review`}
            right={<Btn>Calendar</Btn>}
          />
        }
        list={<SessionsList sessions={SESSIONS_DATA} selected={selected} onSelect={setSelected} />}
        detail={<SessionDetail session={session ?? null} />}
      />
    </PageShell>
  );
}
