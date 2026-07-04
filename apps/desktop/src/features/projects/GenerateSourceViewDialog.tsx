/**
 * GenerateSourceViewDialog — spec 049 US1 minimal generation dialog.
 *
 * Not a design pass: a minimal functional dialog wired to `sourceview.generate`
 * — a defaulted profile display (WBPP; profile switching is spec 049 US2), a
 * capability/kind hint (the actual per-item kind is resolved server-side and
 * shown on the produced plan, not previewed here), a copy opt-in checkbox
 * (FR-003 — copy is never the silent default), and submit/cancel.
 *
 * On success, routes the caller to plan review via `onPlanCreated`, mirroring
 * `SourceViewsSection`'s remove/regenerate toast convention.
 */

import { useState } from 'react';
import { Modal } from '@/components';
import { Btn, Banner } from '@/ui';
import { m } from '@/lib/i18n';
import { addToast } from '@/shared/toast';
import { generateSourceView } from './source-views';
import { errMessage } from '@/lib/errors';

export interface GenerateSourceViewDialogProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
  /** Called with planId after a plan is created so the parent can navigate. */
  onPlanCreated?: (planId: string) => void;
}

export function GenerateSourceViewDialog({
  projectId,
  open,
  onClose,
  onPlanCreated,
}: GenerateSourceViewDialogProps) {
  const [copyOptIn, setCopyOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const resp = await generateSourceView({ projectId, copyOptIn });
      const warningCount = resp.warnings?.length ?? 0;
      const warning =
        warningCount > 0
          ? m.projects_source_views_generate_warning_count({ count: String(warningCount) })
          : '';
      addToast({
        variant: 'info',
        message: m.projects_source_views_generate_toast({ warning }),
        action: {
          label: m.projects_source_views_view_plan_btn(),
          onClick: () => onPlanCreated?.(resp.planId),
        },
      });
      onPlanCreated?.(resp.planId);
      onClose();
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err ? String((err).code) : 'internal';
      setError(errMessage(err));
      addToast({
        variant: 'warn',
        message: m.projects_source_views_generate_failed({ code }),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={m.projects_source_views_generate_title()}
      size="sm"
      ariaLabel={m.projects_source_views_generate_title()}
      data-testid="generate-source-view-dialog"
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={submitting}>
            {m.common_cancel()}
          </Btn>
          <Btn variant="primary" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? m.common_working() : m.projects_source_views_generate_submit_btn()}
          </Btn>
        </>
      }
    >
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted text-sm">
          {m.projects_source_views_generate_profile_label()}
        </span>
        <span className="text-sm">{m.projects_source_views_generate_profile_default()}</span>
      </div>

      <p className="text-muted text-sm">{m.projects_source_views_generate_kind_hint()}</p>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={copyOptIn}
          onChange={(e) => setCopyOptIn(e.target.checked)}
          disabled={submitting}
          aria-label={m.projects_source_views_generate_copy_opt_in_label()}
          data-testid="generate-view-copy-opt-in"
        />
        {m.projects_source_views_generate_copy_opt_in_label()}
      </label>

      {error && <Banner variant="danger">{error}</Banner>}
    </Modal>
  );
}
