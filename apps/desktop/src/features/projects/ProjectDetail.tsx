/**
 * ProjectDetail -- center pane for Projects page.
 * Uses fixture data + hardcoded mock sub-data.
 * Design V3 rewrite.
 */

import { DetailHeader, DetailPane } from '@/components';
import { Pill, Btn, Section, Banner, Table } from '@/ui';
import { PROJECTS_DATA } from '@/data/fixtures/projects';
import type { ProjectFixture } from '@/data/fixtures/projects';
import type { PillVariant } from '@/ui';

// ─── Helpers ────────────────────────────────────────────────────────────────

function projectVariant(state: ProjectFixture['state']): PillVariant {
  switch (state) {
    case 'completed':
    case 'archived':
      return 'ok';
    case 'processing':
      return 'info';
    case 'prepared':
      return 'accent';
    case 'ready':
      return 'neutral';
    case 'blocked':
      return 'danger';
    case 'setup_incomplete':
      return 'ghost';
    default:
      return 'neutral';
  }
}

function stateLabel(state: ProjectFixture['state']): string {
  switch (state) {
    case 'setup_incomplete': return 'Setup';
    case 'ready': return 'Ready';
    case 'prepared': return 'Prepared';
    case 'processing': return 'Processing';
    case 'completed': return 'Completed';
    case 'archived': return 'Archived';
    case 'blocked': return 'Blocked';
    default: return state;
  }
}

function sourceTypeVariant(type: string): PillVariant {
  switch (type) {
    case 'light': return 'info';
    case 'dark': return 'neutral';
    case 'flat': return 'accent';
    case 'bias': return 'ghost';
    default: return 'neutral';
  }
}

function sourceStatusVariant(status: string): PillVariant {
  switch (status) {
    case 'selected': return 'ok';
    case 'candidate': return 'warn';
    case 'aging': return 'warn';
    case 'rejected': return 'danger';
    default: return 'neutral';
  }
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

const NOTES = [
  'Reduced star FWHM from 2.8 to 2.4 with drizzle',
  'Color balance adjusted per PixInsight STF',
];

// ─── Source map columns ──────────────────────────────────────────────────────

const SOURCE_COLUMNS = [
  { key: 'type', label: 'Type', style: { width: 72 } },
  { key: 'name', label: 'Name' },
  { key: 'detail', label: 'Detail' },
  { key: 'status', label: 'Status', style: { width: 96 } },
];

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ProjectDetailContentProps {
  project: ProjectFixture;
}

// ─── Inner content component (used by ProjectsPage) ──────────────────────────

export function ProjectDetailContent({ project }: ProjectDetailContentProps) {
  const projectPath = `D:\\Astrophotography\\Projects\\${project.name.replace(/\s·\s/g, '_').replace(/\s/g, '')}`;

  return (
    <DetailPane>
      <DetailHeader
        title={project.name}
        titleExtra={
          <span style={{ marginLeft: 8 }}>
            <Pill variant={projectVariant(project.state)}>
              {stateLabel(project.state)}
            </Pill>
          </span>
        }
        subtitle={projectPath}
        actions={<Btn size="sm">Reveal in Explorer</Btn>}
      />

      {/* Pipeline stats bar */}
      <div
        className="alm-detail__stats-bar"
        style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--alm-color-border)' }}
      >
        {[
          { label: 'Sources', value: project.sources },
          { label: 'Views', value: project.views },
          { label: 'On disk', value: project.size },
          { label: 'Outputs', value: project.outputs },
        ].map((stat) => (
          <div key={stat.label} className="alm-detail__stat">
            <span className="alm-detail__stat-value">{stat.value}</span>
            <span className="alm-detail__stat-label">{stat.label}</span>
          </div>
        ))}
      </div>

      {/* Blocked banner */}
      {project.state === 'blocked' && project.blockedReason && (
        <Banner variant="danger" style={{ margin: '12px 16px 0' }}>
          {project.blockedReason}
        </Banner>
      )}

      {/* Source map */}
      <Section title="Source map" count={SOURCE_DATA.length}>
        <Table
          columns={SOURCE_COLUMNS}
          rows={SOURCE_DATA.map((row) => ({
            type: <Pill variant={sourceTypeVariant(row.type)}>{row.type}</Pill>,
            name: <span className="alm-mono">{row.name}</span>,
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
          rows={SOURCE_VIEWS.map((view) => ({
            name: (
              <span>
                <span className="alm-mono">{view.name}</span>{' '}
                <Pill variant="ghost">generated</Pill>
              </span>
            ),
            strategy: view.strategy,
            files: view.files,
            plan: view.plan,
            actions: <Btn size="sm">Reveal</Btn>,
          }))}
        />
      </Section>

      {/* Notes */}
      <Section
        title="Notes"
        count={NOTES.length}
        right={<Btn size="sm">+ Add note</Btn>}
      >
        {NOTES.map((note, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 16px',
              borderBottom: i < NOTES.length - 1 ? '1px solid var(--alm-color-border)' : undefined,
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

/**
 * Route-level component for /projects/$id.
 * Uses the first fixture project as a fallback (fixture data, no real routing).
 */
export function ProjectDetail() {
  const project = PROJECTS_DATA[0];
  return <ProjectDetailContent project={project} />;
}
