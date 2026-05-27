/**
 * LifecycleSidebar -- right sidebar for Projects page.
 * Vertical pipeline visualization + phase actions + quick stats.
 * Design V3 rewrite (inline VerticalPipeline, no LifecycleStrip dependency).
 */

import { Section, KV, Btn, Pill } from '@/ui';
import type { ProjectFixture } from '@/data/fixtures/projects';
import type { PillVariant } from '@/ui';

// ─── Lifecycle pipeline ──────────────────────────────────────────────────────

const LIFECYCLE_STEPS = ['setup', 'ready', 'prepared', 'processing', 'completed', 'archived'] as const;

const stateToIdx: Record<string, number> = {
  setup_incomplete: 0,
  ready: 1,
  prepared: 2,
  processing: 3,
  completed: 4,
  archived: 5,
  blocked: -1,
};

function VerticalPipeline({ currentState }: { currentState: string }) {
  const currentIdx = stateToIdx[currentState] ?? -1;
  const isBlocked = currentState === 'blocked';

  return (
    <div className="alm-vpipeline" role="list" aria-label="Project lifecycle stages">
      {LIFECYCLE_STEPS.map((step, i) => {
        const isDone = !isBlocked && i < currentIdx;
        const isCurrent = !isBlocked && i === currentIdx;
        const isFuture = isBlocked || i > currentIdx;

        return (
          <div
            key={step}
            className="alm-vpipeline__row"
            role="listitem"
            style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 0 }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 16 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: isDone
                    ? 'var(--alm-color-ok)'
                    : isCurrent
                    ? 'transparent'
                    : 'var(--alm-color-border)',
                  border: isCurrent
                    ? '2px solid var(--alm-color-accent)'
                    : isDone
                    ? 'none'
                    : '2px solid var(--alm-color-border)',
                  flexShrink: 0,
                }}
                aria-current={isCurrent ? 'step' : undefined}
              />
              {i < LIFECYCLE_STEPS.length - 1 && (
                <div
                  style={{
                    width: 2,
                    height: 14,
                    background: isDone ? 'var(--alm-color-ok)' : 'var(--alm-color-border)',
                    marginTop: 2,
                  }}
                />
              )}
            </div>
            <span
              style={{
                fontSize: 'var(--alm-text-xs)',
                color: isCurrent
                  ? 'var(--alm-color-fg)'
                  : isDone
                  ? 'var(--alm-color-fg-muted)'
                  : 'var(--alm-color-fg-subtle)',
                fontWeight: isCurrent ? 600 : undefined,
                textTransform: 'capitalize',
                paddingBottom: i < LIFECYCLE_STEPS.length - 1 ? 14 : 0,
              }}
            >
              {step}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Phase actions ───────────────────────────────────────────────────────────

type ActionDef = { label: string; variant?: 'primary' | 'accent' | 'danger' | 'ghost' };

function phaseActions(state: ProjectFixture['state']): ActionDef[] {
  switch (state) {
    case 'setup_incomplete':
      return [{ label: 'Continue setup', variant: 'primary' }];
    case 'ready':
      return [
        { label: 'Generate source view', variant: 'primary' },
        { label: 'Add sessions' },
        { label: 'Mark sources complete' },
      ];
    case 'prepared':
      return [
        { label: 'Reveal source views', variant: 'primary' },
        { label: 'Re-generate view' },
      ];
    case 'processing':
      return [
        { label: 'Mark complete', variant: 'primary' },
        { label: 'Re-generate view' },
      ];
    case 'completed':
      return [
        { label: 'Generate cleanup plan', variant: 'primary' },
        { label: 'Archive project' },
      ];
    case 'archived':
      return [{ label: 'Unarchive' }];
    case 'blocked':
      return [{ label: 'Resolve block', variant: 'danger' }];
    default:
      return [{ label: 'Generate source view' }];
  }
}

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

// ─── Props ───────────────────────────────────────────────────────────────────

export interface LifecycleSidebarProps {
  project: ProjectFixture;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function LifecycleSidebar({ project }: LifecycleSidebarProps) {
  const actions = phaseActions(project.state);

  return (
    <aside
      className="alm-lifecycle-sidebar"
      aria-label="Project lifecycle sidebar"
      style={{ width: 220, flexShrink: 0, overflowY: 'auto' }}
    >
      {/* Lifecycle */}
      <Section title="Lifecycle">
        <div style={{ padding: '8px 16px 4px' }}>
          <Pill variant={projectVariant(project.state)}>{stateLabel(project.state)}</Pill>
        </div>
        <div style={{ padding: '8px 16px' }}>
          <VerticalPipeline currentState={project.state} />
        </div>
      </Section>

      {/* Actions */}
      <Section title="Actions">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 16px 8px' }}>
          {actions.map((action) => (
            <Btn
              key={action.label}
              variant={action.variant}
              size="sm"
              style={{ width: '100%', justifyContent: 'flex-start' }}
            >
              {action.label}
            </Btn>
          ))}
        </div>
      </Section>

      {/* Quick stats */}
      <Section title="Quick stats">
        <div style={{ padding: '4px 0 8px' }}>
          <KV label="Integration" value={<span className="alm-mono">{project.hours}h</span>} />
          <KV label="On disk" value={<span className="alm-mono">{project.size}</span>} />
          <KV label="Profile" value={project.profile} />
          <KV label="Targets" value={project.target} />
          <KV label="Outputs" value={project.outputs} />
          <KV label="Notes" value="2" />
        </div>
      </Section>
    </aside>
  );
}
