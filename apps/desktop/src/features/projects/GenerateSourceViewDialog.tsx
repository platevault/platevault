/**
 * GenerateSourceViewDialog — spec 049 US1 minimal generation dialog, extended
 * for US2 T029 (FR-004a/FR-004c).
 *
 * Not a design pass: a minimal functional dialog wired to `sourceview.generate`
 * — a defaulted profile display (WBPP; profile switching is spec 049 US2), the
 * two *configured* Source Views link-kind settings (read-only here — editing
 * them is the spec 049 T030 Settings pane), a copy opt-in checkbox (FR-003 —
 * copy is never the silent default), and submit/cancel.
 *
 * There is no live per-drive-scope filesystem-capability probe exposed to the
 * frontend yet (that would require a new contract/command, out of this
 * dialog's scope) — the actual per-item kind is still resolved server-side and
 * reported via the `capability_drift` plan warning after generation. This
 * dialog surfaces the *configured* kinds up front plus a note explaining the
 * drift-fallback behavior, rather than fabricating a pre-submit
 * achievability check.
 *
 * On success, routes the caller to plan review via `onPlanCreated`, mirroring
 * `SourceViewsSection`'s remove/regenerate toast convention.
 */

import { useEffect, useState } from 'react';
import { Modal } from '@/components';
import { Btn, Banner } from '@/ui';
import { m } from '@/lib/i18n';
import { addToast } from '@/shared/toast';
import { generateSourceView } from './source-views';
import { getSettings } from '@/features/settings/settingsIpc';
import { errMessage } from '@/lib/errors';

interface SourceViewLinkKindSettings {
  sourceViewLinkKindIntraDrive?: string;
  sourceViewLinkKindCrossDrive?: string;
}

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
  const [linkKinds, setLinkKinds] = useState<SourceViewLinkKindSettings | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getSettings({ scope: 'sourceViews' })
      .then((data) => {
        if (!cancelled) setLinkKinds(data.values ?? {});
      })
      .catch(() => {
        // Best-effort display only — generation still works without it.
        if (!cancelled) setLinkKinds(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const resp = await generateSourceView({ projectId, copyOptIn });
      const warningCount = resp.warnings?.length ?? 0;
      const warning =
        warningCount > 0
          ? m.projects_source_views_generate_warning_count({
              count: String(warningCount),
            })
          : '';
      // Distinguish the materialization path actually taken (FR-003/FR-004b) —
      // a copy fallback is a meaningfully different outcome from a link, not
      // just another warning to skim past.
      const toastMessage = resp.usedCopyFallback
        ? m.projects_source_views_generate_toast_copy_fallback({ warning })
        : m.projects_source_views_generate_toast({ warning });
      addToast({
        variant: 'info',
        message: toastMessage,
        action: {
          label: m.projects_source_views_view_plan_btn(),
          onClick: () => onPlanCreated?.(resp.planId),
        },
      });
      onPlanCreated?.(resp.planId);
      onClose();
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String(err.code)
          : 'internal';
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
          <Btn
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            data-testid="generate-source-view-submit"
          >
            {submitting
              ? m.common_working()
              : m.projects_source_views_generate_submit_btn()}
          </Btn>
        </>
      }
    >
      <div className="alm-source-views__profile-row">
        <span className="alm-text-sm alm-text-muted">
          {m.projects_source_views_generate_profile_label()}
        </span>
        <span className="alm-text-sm">
          {m.projects_source_views_generate_profile_default()}
        </span>
      </div>

      <p className="alm-text-sm alm-text-muted">
        {m.projects_source_views_generate_kind_hint()}
      </p>

      {linkKinds &&
        (linkKinds.sourceViewLinkKindIntraDrive ??
          linkKinds.sourceViewLinkKindCrossDrive) && (
          <div className="alm-text-sm" data-testid="generate-view-link-kinds">
            <span className="alm-text-muted">
              {m.projects_source_views_generate_kind_settings_label()}:
            </span>{' '}
            {linkKinds.sourceViewLinkKindIntraDrive && (
              <span>
                {m.projects_source_views_generate_kind_intra_drive({
                  kind: linkKinds.sourceViewLinkKindIntraDrive,
                })}
              </span>
            )}
            {linkKinds.sourceViewLinkKindIntraDrive &&
              linkKinds.sourceViewLinkKindCrossDrive &&
              ' · '}
            {linkKinds.sourceViewLinkKindCrossDrive && (
              <span>
                {m.projects_source_views_generate_kind_cross_drive({
                  kind: linkKinds.sourceViewLinkKindCrossDrive,
                })}
              </span>
            )}
          </div>
        )}

      <p className="alm-text-xs alm-text-muted">
        {m.projects_source_views_generate_kind_drift_note()}
      </p>

      <label className="alm-source-views__copy-label">
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
