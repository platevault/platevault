import { DetailHeader, DetailPane } from '@/components';
import { Pill, Btn, Section, Banner, Table, Box, KV, CoverageBar } from '@/ui';
import { PROJECTS_DATA } from '@/data/fixtures/projects';
import type { ProjectFixture } from '@/data/fixtures/projects';
import type { PillVariant } from '@/ui';

// ─── Helpers ────────────────────────────────────────────────────────────────

function projectVariant(state: ProjectFixture['state']): PillVariant {
  const map: Record<string, PillVariant> = {
    completed: 'ok', archived: 'ok', processing: 'info', prepared: 'accent',
    ready: 'neutral', blocked: 'danger', setup_incomplete: 'ghost',
  };
  return map[state] ?? 'neutral';
}

function stateLabel(state: ProjectFixture['state']): string {
  const map: Record<string, string> = {
    setup_incomplete: 'Setup', ready: 'Ready', prepared: 'Prepared',
    processing: 'Processing', completed: 'Completed', archived: 'Archived',
    blocked: 'Blocked',
  };
  return map[state] ?? state;
}

function sourceTypeVariant(type: string): PillVariant {
  const map: Record<string, PillVariant> = { light: 'info', dark: 'neutral', flat: 'accent', bias: 'ghost' };
  return map[type] ?? 'neutral';
}

function sourceStatusVariant(status: string): PillVariant {
  const map: Record<string, PillVariant> = { selected: 'ok', candidate: 'warn', aging: 'warn', rejected: 'danger' };
  return map[status] ?? 'neutral';
}

// ─── Phase actions ──────────────────────────────────────────────────────────

type ActionDef = { label: string; variant?: 'primary' | 'accent' | 'danger' };

function phaseActions(state: ProjectFixture['state']): ActionDef[] {
  switch (state) {
    case 'setup_incomplete': return [{ label: 'Continue setup', variant: 'primary' }];
    case 'ready': return [{ label: 'Generate source view', variant: 'primary' }, { label: 'Add sessions' }];
    case 'prepared': return [{ label: 'Reveal source views', variant: 'primary' }];
    case 'processing': return [{ label: 'Mark complete', variant: 'primary' }];
    case 'completed': return [{ label: 'Generate cleanup plan', variant: 'primary' }, { label: 'Archive project' }];
    case 'archived': return [{ label: 'Unarchive' }];
    case 'blocked': return [{ label: 'Resolve block', variant: 'danger' }];
    default: return [];
  }
}

// ─── Lifecycle flowchart ────────────────────────────────────────────────────

const LIFECYCLE_STEPS = ['setup', 'ready', 'prepared', 'processing', 'completed', 'archived'] as const;
const stateToIdx: Record<string, number> = {
  setup_incomplete: 0, ready: 1, prepared: 2, processing: 3, completed: 4, archived: 5, blocked: -1,
};

function LifecycleFlowchart({ currentState }: { currentState: string }) {
  const currentIdx = stateToIdx[currentState] ?? -1;
  const isBlocked = currentState === 'blocked';

  return (
    <div className="alm-lifecycle">
      {LIFECYCLE_STEPS.map((step, i) => {
        const isDone = !isBlocked && i < currentIdx;
        const isCurrent = !isBlocked && i === currentIdx;

        const dotClass = [
          'alm-lifecycle__dot',
          isDone && 'alm-lifecycle__dot--done',
          isCurrent && 'alm-lifecycle__dot--active',
          isBlocked && isCurrent && 'alm-lifecycle__dot--blocked',
        ].filter(Boolean).join(' ');

        const labelClass = [
          'alm-lifecycle__label',
          isDone && 'alm-lifecycle__label--done',
          isCurrent && 'alm-lifecycle__label--active',
        ].filter(Boolean).join(' ');

        return (
          <div key={step} className="alm-lifecycle__step">
            <div className="alm-lifecycle__connector">
              {i > 0 && <div className={`alm-lifecycle__line${isDone || isCurrent ? ' alm-lifecycle__line--done' : ''}`} />}
              <div className={dotClass} />
              {i < LIFECYCLE_STEPS.length - 1 && <div className={`alm-lifecycle__line${isDone ? ' alm-lifecycle__line--done' : ''}`} />}
            </div>
            <span className={labelClass}>{step}</span>
          </div>
        );
      })}
      {isBlocked && (
        <div className="alm-lifecycle__step">
          <div className="alm-lifecycle__connector">
            <div className="alm-lifecycle__line" />
            <div className="alm-lifecycle__dot alm-lifecycle__dot--blocked" />
          </div>
          <span className="alm-lifecycle__label" style={{ color: 'var(--alm-danger)' }}>blocked</span>
        </div>
      )}
    </div>
  );
}

// ─── Mock sub-data ──────────────────────────────────────────────────────────

const SOURCE_DATA = [
  { type: 'light', name: 'NGC 7000 · Ha · 2024-11', detail: '3054 frames · 4.5h', status: 'selected' },
  { type: 'light', name: 'NGC 7000 · OIII · 2024-11', detail: '3038 frames · 3.2h', status: 'selected' },
  { type: 'light', name: 'NGC 7000 · Ha · 2024-12', detail: '1530 frames · 2.5h', status: 'candidate' },
  { type: 'dark', name: 'MasterDark_300s_-10C_g100', detail: '1 master', status: 'selected' },
  { type: 'flat', name: 'MasterFlat_Ha_2024-11', detail: '1 master', status: 'selected' },
  { type: 'flat', name: 'MasterFlat_OIII_2024-11', detail: '1 master', status: 'selected' },
  { type: 'bias', name: 'MasterBias_g100', detail: '1 master', status: 'aging' },
];

const SOURCE_VIEWS = [
  { name: 'wbpp_input', strategy: 'junction', files: 92, plan: 'plan #18' },
  { name: 'wbpp_input_p2', strategy: 'symlink', files: 92, plan: 'plan #21' },
];

const CHANNEL_DATA = [
  { filter: 'Ha', hours: 4.5, max: 10 },
  { filter: 'OIII', hours: 3.2, max: 10 },
  { filter: 'SII', hours: 2.5, max: 10 },
];

const NOTES = [
  'Reduced star FWHM from 2.8 to 2.4 with drizzle',
  'Color balance adjusted per PixInsight STF',
];

// ─── Component ──────────────────────────────────────────────────────────────

export interface ProjectDetailContentProps {
  project: ProjectFixture;
}

export function ProjectDetailContent({ project }: ProjectDetailContentProps) {
  const projectPath = `D:\\Astrophotography\\Projects\\${project.name.replace(/\s·\s/g, '_').replace(/\s/g, '')}`;
  const actions = phaseActions(project.state);

  return (
    <DetailPane>
      <DetailHeader
        title={project.name}
        titleExtra={
          <Pill variant={projectVariant(project.state)}>{stateLabel(project.state)}</Pill>
        }
        subtitle={projectPath}
        actions={<>
          {actions.map(a => (
            <Btn key={a.label} size="sm" variant={a.variant}>{a.label}</Btn>
          ))}
          <Btn size="sm">Reveal in Explorer</Btn>
        </>}
      />

      {/* Blocked banner */}
      {project.state === 'blocked' && project.blockedReason && (
        <Banner variant="danger" style={{ marginBottom: 'var(--alm-sp-3)' }}>
          {project.blockedReason}
        </Banner>
      )}

      {/* Lifecycle + Integration per channel */}
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 'var(--alm-sp-3)', marginBottom: 'var(--alm-sp-4)' }}>
        <Box title="Lifecycle">
          <LifecycleFlowchart currentState={project.state} />
        </Box>
        <Box title="Integration per channel">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-2)' }}>
            {CHANNEL_DATA.map(c => (
              <CoverageBar key={c.filter} label={c.filter} value={c.hours} max={c.max} />
            ))}
          </div>
          <div style={{ marginTop: 'var(--alm-sp-3)', fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
            Total: {project.hours}h · {project.size} on disk · Profile: {project.profile}
          </div>
        </Box>
      </div>

      {/* Source map */}
      <Section title="Source map" count={SOURCE_DATA.length}>
        <Table
          columns={[
            { key: 'type', label: 'Type', style: { width: 72 } },
            { key: 'name', label: 'Name' },
            { key: 'detail', label: 'Detail' },
            { key: 'status', label: 'Status', style: { width: 96 } },
          ]}
          rows={SOURCE_DATA.map(row => ({
            type: <Pill variant={sourceTypeVariant(row.type)}>{row.type}</Pill>,
            name: <span style={{ fontFamily: 'var(--alm-font-mono)', fontSize: 'var(--alm-text-xs)' }}>{row.name}</span>,
            detail: row.detail,
            status: <Pill variant={sourceStatusVariant(row.status)}>{row.status}</Pill>,
          }))}
        />
      </Section>

      {/* Source views */}
      <Section title="Source views" count={SOURCE_VIEWS.length}>
        <Table
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'strategy', label: 'Strategy', style: { width: 96 } },
            { key: 'files', label: 'Files', style: { width: 64 } },
            { key: 'plan', label: 'Plan', style: { width: 80 } },
            { key: 'actions', label: '', style: { width: 80 } },
          ]}
          rows={SOURCE_VIEWS.map(view => ({
            name: <>
              <span style={{ fontFamily: 'var(--alm-font-mono)', fontSize: 'var(--alm-text-xs)' }}>{view.name}</span>{' '}
              <Pill variant="ghost">generated</Pill>
            </>,
            strategy: view.strategy,
            files: view.files,
            plan: view.plan,
            actions: <Btn size="sm">Reveal</Btn>,
          }))}
        />
      </Section>

      {/* Notes */}
      <Section title="Notes" count={NOTES.length} right={<Btn size="sm">+ Add note</Btn>}>
        {NOTES.map((note, i) => (
          <div
            key={i}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 0',
              borderBottom: i < NOTES.length - 1 ? '1px solid var(--alm-border-subtle)' : undefined,
            }}
          >
            <span style={{ fontSize: 'var(--alm-text-sm)' }}>{note}</span>
            <span style={{ display: 'flex', gap: 4 }}>
              <Btn size="sm">Edit</Btn>
              <Btn size="sm" variant="danger">Delete</Btn>
            </span>
          </div>
        ))}
      </Section>
    </DetailPane>
  );
}

export function ProjectDetail() {
  const project = PROJECTS_DATA[0];
  return <ProjectDetailContent project={project} />;
}
