import {
  DetailHeader,
  DetailPane,
  MetricLine,
  DetailGrid,
  Rail,
  RailCard,
  Lifecycle,
} from '@/components';
import { Pill, Btn, Section, Banner, Table, CoverageBar } from '@/ui';
import { projectStateLabel, projectStateVariant } from '@/lib/lifecycle';
import { PROJECTS_DATA } from '@/data/fixtures/projects';
import type { ProjectFixture } from '@/data/fixtures/projects';
import type { PillVariant } from '@/ui';

// ─── Source-specific variants (project-local) ────────────────────────────────

function sourceTypeVariant(type: string): PillVariant {
  const map: Record<string, PillVariant> = { light: 'info', dark: 'neutral', flat: 'accent', bias: 'ghost' };
  return map[type] ?? 'neutral';
}

function sourceStatusVariant(status: string): PillVariant {
  const map: Record<string, PillVariant> = { selected: 'ok', candidate: 'warn', aging: 'warn', rejected: 'danger' };
  return map[status] ?? 'neutral';
}

// ─── Mock sub-data ───────────────────────────────────────────────────────────

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

const HISTORY = [
  { ts: '04-16', detail: 'source view generated' },
  { ts: '04-15', detail: 'marked processing' },
  { ts: '04-14', detail: '2 sessions linked' },
  { ts: '04-13', detail: 'project created' },
];

// ─── Component ───────────────────────────────────────────────────────────────

export interface ProjectDetailContentProps {
  project: ProjectFixture;
}

export function ProjectDetailContent({ project }: ProjectDetailContentProps) {
  const projectPath = `D:\\Astrophotography\\Projects\\${project.name.replace(/\s·\s/g, '_').replace(/\s/g, '')}`;

  return (
    <DetailPane fill>
      <DetailHeader
        title={project.name}
        titleExtra={<Pill variant={projectStateVariant(project.state)}>{projectStateLabel(project.state)}</Pill>}
        subtitle={projectPath}
      />

      {project.state === 'blocked' && project.blockedReason && (
        <Banner variant="danger" style={{ marginTop: 'var(--alm-sp-3)' }}>
          {project.blockedReason}
        </Banner>
      )}

      <MetricLine
        metrics={[
          { value: `${project.hours}h`, label: 'integration' },
          { value: CHANNEL_DATA.length, label: 'channels' },
          { value: project.size, label: 'on disk' },
          { value: project.profile, label: 'profile' },
        ]}
      />

      <DetailGrid
        rail={
          <Rail>
            <RailCard title="Lifecycle">
              <Lifecycle state={project.state} />
            </RailCard>
            <RailCard title="Integration / channel">
              {CHANNEL_DATA.map((c) => (
                <CoverageBar key={c.filter} label={c.filter} value={c.hours} max={c.max} />
              ))}
              <div style={{ marginTop: 'var(--alm-sp-2)', fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
                Total {project.hours}h
              </div>
            </RailCard>
            <RailCard title="Recent history">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-1)', fontSize: 'var(--alm-text-xs)' }}>
                {HISTORY.map((h, i) => (
                  <div key={i} style={{ color: 'var(--alm-text-secondary)' }}>
                    <span className="alm-mono" style={{ color: 'var(--alm-text-faint)' }}>{h.ts}</span> · {h.detail}
                  </div>
                ))}
              </div>
            </RailCard>
          </Rail>
        }
      >
        <Section title="Source map" count={SOURCE_DATA.length}>
          <Table
            columns={[
              { key: 'type', label: 'Type', style: { width: 72 } },
              { key: 'name', label: 'Name' },
              { key: 'detail', label: 'Detail' },
              { key: 'status', label: 'Status', style: { width: 96 } },
            ]}
            rows={SOURCE_DATA.map((row) => ({
              type: <Pill variant={sourceTypeVariant(row.type)}>{row.type}</Pill>,
              name: <span className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>{row.name}</span>,
              detail: row.detail,
              status: <Pill variant={sourceStatusVariant(row.status)}>{row.status}</Pill>,
            }))}
          />
        </Section>

        <Section title="Source views" count={SOURCE_VIEWS.length}>
          <Table
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'strategy', label: 'Strategy', style: { width: 96 } },
              { key: 'files', label: 'Files', style: { width: 64 } },
              { key: 'plan', label: 'Plan', style: { width: 80 } },
              { key: 'actions', label: '', style: { width: 80 } },
            ]}
            rows={SOURCE_VIEWS.map((view) => ({
              name: (
                <>
                  <span className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>{view.name}</span>{' '}
                  <Pill variant="ghost">generated</Pill>
                </>
              ),
              strategy: view.strategy,
              files: view.files,
              plan: view.plan,
              actions: <Btn size="sm">Reveal</Btn>,
            }))}
          />
        </Section>

        <Section title="Notes" count={NOTES.length} right={<Btn size="sm">+ Add note</Btn>}>
          {NOTES.map((note, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
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
      </DetailGrid>
    </DetailPane>
  );
}

export function ProjectDetail() {
  const project = PROJECTS_DATA[0];
  return <ProjectDetailContent project={project} />;
}
