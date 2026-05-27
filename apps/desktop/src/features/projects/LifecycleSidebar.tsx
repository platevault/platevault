/**
 * LifecycleSidebar -- right sidebar for Projects page.
 * Horizontal pill-based lifecycle visualization + integration time per channel.
 * Design V3 rewrite.
 */

import { Section, Pill, CoverageBar } from '@/ui';
import type { ProjectFixture } from '@/data/fixtures/projects';
import type { PillVariant } from '@/ui';

// ─── Lifecycle pipeline ──────────────────────────────────────────────────────

const LIFECYCLE_STEPS = ['setup', 'ready', 'prepared', 'processing', 'completed', 'archived'] as const;
type LifecycleStep = typeof LIFECYCLE_STEPS[number];

const stateToIdx: Record<string, number> = {
  setup_incomplete: 0,
  ready: 1,
  prepared: 2,
  processing: 3,
  completed: 4,
  archived: 5,
  blocked: -1,
};

function HorizontalPipeline({ currentState }: { currentState: string }) {
  const currentIdx = stateToIdx[currentState] ?? -1;
  const isBlocked = currentState === 'blocked';

  return (
    <div
      className="alm-hpipeline"
      role="list"
      aria-label="Project lifecycle stages"
    >
      {isBlocked && (
        <span role="listitem"><Pill variant="danger">Blocked</Pill></span>
      )}
      {LIFECYCLE_STEPS.map((step: LifecycleStep, i) => {
        const isDone = !isBlocked && i < currentIdx;
        const isCurrent = !isBlocked && i === currentIdx;
        const variant: PillVariant = isDone ? 'ok' : isCurrent ? 'accent' : 'ghost';

        return (
          <span
            key={step}
            role="listitem"
            aria-current={isCurrent ? 'step' : undefined}
            style={isCurrent ? { fontWeight: 600 } : undefined}
          >
            <Pill variant={variant}>{step}</Pill>
          </span>
        );
      })}
    </div>
  );
}

// ─── Phase actions ───────────────────────────────────────────────────────────

export type ActionDef = { label: string; variant?: 'primary' | 'accent' | 'danger' | 'ghost' };

export function phaseActions(state: ProjectFixture['state']): ActionDef[] {
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

// ─── Channel data ─────────────────────────────────────────────────────────────

const CHANNEL_DATA = [
  { filter: 'Ha', hours: 4.5, max: 10 },
  { filter: 'OIII', hours: 3.2, max: 10 },
  { filter: 'SII', hours: 2.5, max: 10 },
];

// ─── Props ───────────────────────────────────────────────────────────────────

export interface LifecycleSidebarProps {
  project: ProjectFixture;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function LifecycleSidebar({ project }: LifecycleSidebarProps) {
  return (
    <aside
      className="alm-lifecycle-sidebar"
      aria-label="Project lifecycle sidebar"
      style={{ width: 220, flexShrink: 0 }}
    >
      {/* Lifecycle */}
      <Section title="Lifecycle">
        <div style={{ padding: '8px 16px 12px' }}>
          <HorizontalPipeline currentState={project.state} />
        </div>
      </Section>

      {/* Integration time per channel */}
      <Section title="Integration per channel">
        <div style={{ padding: '8px 16px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {CHANNEL_DATA.map(({ filter, hours, max }) => (
            <CoverageBar key={filter} label={filter} value={hours} max={max} />
          ))}
        </div>
      </Section>
    </aside>
  );
}
