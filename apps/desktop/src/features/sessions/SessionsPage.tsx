import { useNavigate, useSearch } from '@tanstack/react-router';
import { SESSIONS_DATA } from '@/data/fixtures/sessions';
import type { SessionFixture } from '@/data/fixtures/sessions';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { Btn } from '@/ui';
import type { BtnVariant } from '@/ui';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { SessionsList } from './SessionsList';
import { SessionDetail } from './SessionDetail';

interface ContextualAction {
  label: string;
  variant?: BtnVariant;
}

// Contextual actions for the selected session, driven by its state.
function sessionActions(state: SessionFixture['state']): ContextualAction[] {
  switch (state) {
    case 'confirmed':
      return [{ label: 'Use in project', variant: 'primary' }, { label: 'Re-open to review' }];
    case 'needs_review':
      return [{ label: 'Confirm', variant: 'primary' }, { label: 'Reject', variant: 'danger' }];
    case 'discovered':
    case 'candidate':
      return [{ label: 'Review', variant: 'primary' }];
    case 'rejected':
      return [{ label: 'Restore' }];
    case 'ignored':
      return [{ label: 'Unignore' }];
    default:
      return [];
  }
}

export function SessionsPage() {
  const { selected } = useSearch({ from: '/shell/sessions' });
  const navigate = useNavigate({ from: '/sessions' });
  const session = SESSIONS_DATA.find((s) => s.id === selected);

  useStaleSelectionCleanup(selected, session !== undefined, () =>
    navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true }),
  );

  const onSelect = (id: number) => navigate({ search: (prev) => ({ ...prev, selected: id }) });

  return (
    <PageShell>
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Sessions"
            subtitle={`${SESSIONS_DATA.length} sessions · ${SESSIONS_DATA.filter((s) => s.state === 'confirmed').length} confirmed · ${SESSIONS_DATA.filter((s) => s.state === 'needs_review').length} needs review`}
            right={
              <>
                {session &&
                  sessionActions(session.state).map((a) => (
                    <Btn key={a.label} size="sm" variant={a.variant}>
                      {a.label}
                    </Btn>
                  ))}
                <Btn size="sm">Calendar</Btn>
              </>
            }
          />
        }
        list={<SessionsList sessions={SESSIONS_DATA} selected={selected ?? null} onSelect={onSelect} />}
        detail={<SessionDetail session={session ?? null} />}
      />
    </PageShell>
  );
}
