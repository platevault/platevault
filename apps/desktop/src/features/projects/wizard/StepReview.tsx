import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { createProjectPlan } from '@/api/commands';
import type { FilesystemPlan } from '@/api/types';
import { ApprovalGate } from '@/features/plans/ApprovalGate';
import { PlanTable } from '@/features/plans/PlanTable';
import { Btn } from '@/ui';

export interface StepReviewProps {
  wizardState: Record<string, unknown>;
}

export function StepReview({ wizardState }: StepReviewProps) {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<FilesystemPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  async function generatePlan() {
    setLoading(true);
    setError(null);
    try {
      const result = await createProjectPlan({ wizard_state: wizardState });
      setPlan(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove() {
    if (!plan) return;
    setCreated(true);
    // Navigate to the new project's plan review
    navigate({ to: '/plans/$id', params: { id: plan.id } });
  }

  // Auto-generate plan on first render
  if (!plan && !loading && !error) {
    void generatePlan();
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--alm-space-7)', color: 'var(--alm-text-muted)' }}>
        Generating filesystem plan...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-3)', padding: 'var(--alm-space-5)' }}>
        <p style={{ color: 'var(--alm-danger)', fontSize: 'var(--alm-text-sm)' }}>
          Failed to generate plan: {error}
        </p>
        <Btn onClick={generatePlan}>Retry</Btn>
      </div>
    );
  }

  if (!plan) return null;

  if (created) {
    return (
      <div style={{ padding: 'var(--alm-space-5)', textAlign: 'center', color: 'var(--alm-ok)' }}>
        Project created successfully. Redirecting...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 'var(--alm-space-4)' }}>
      <h3 style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 600, margin: 0 }}>
        Review Filesystem Plan
      </h3>
      <p style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', margin: 0 }}>
        The following filesystem operations will be performed to set up your project structure.
      </p>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <PlanTable items={plan.items} />
      </div>

      <ApprovalGate plan={plan} onApprove={handleApprove} />
    </div>
  );
}
