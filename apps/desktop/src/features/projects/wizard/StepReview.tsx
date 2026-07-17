// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * #599 (Constitution-II): this step used to render a static `NGC7000_HOO/`
 * fixture plan + disk tree regardless of the project actually being created
 * — "reviewing the plan" meant reviewing fiction. The backend has no
 * plan-preview endpoint (the scaffolding plan is generated and, for
 * mkdir-only plans, auto-applied at `projects.create` time), so this step
 * now shows only facts the wizard actually knows pre-create — the real
 * selections from steps 1-5 — plus the fixed, always-identical top-level
 * layout every project gets. The itemized junction/copy plan itself remains
 * reviewable after creation via the project's audit trail, per Constitution
 * II ("every filesystem plan MUST be represented as a reviewable plan").
 */

import { m } from '@/lib/i18n';
import { Pill, Box } from '@/ui';

export interface StepReviewState {
  name: string;
  path: string;
  profileLabel: string;
  targetLabel: string | null;
  sessionCount: number;
  frameCount: number;
  masterCount: number;
  viewStrategy: string;
}

export interface StepReviewProps {
  wizardState: StepReviewState;
}

export function StepReview({ wizardState }: StepReviewProps) {
  const {
    name,
    path,
    profileLabel,
    targetLabel,
    sessionCount,
    frameCount,
    masterCount,
    viewStrategy,
  } = wizardState;

  return (
    <div className="alm-wizard-review">
      {/* ── Green success banner ── */}
      <div className="alm-wizard-review__banner">
        <div className="alm-wizard-review__banner-row">
          <span className="alm-wizard-review__banner-icon">&#10003;</span>
          <div className="alm-wizard-review__banner-text">
            <strong>{m.projects_wizard_review_no_destructive()}</strong>{' '}
            {m.projects_wizard_review_safe_desc()}
          </div>
        </div>
      </div>

      <div className="alm-wizard-review__grid">
        {/* Left: real selections summary */}
        <Box title={m.projects_wizard_review_summary_title()}>
          <table className="alm-simple-table">
            <tbody>
              <tr>
                <td>{m.projects_name_label()}</td>
                <td className="alm-mono">{name}</td>
              </tr>
              <tr>
                <td>{m.projects_wizard_col_destination()}</td>
                <td className="alm-mono">{path}</td>
              </tr>
              <tr>
                <td>{m.projects_wizard_workflow_label()}</td>
                <td>{profileLabel}</td>
              </tr>
              <tr>
                <td>{m.projects_create_target_label()}</td>
                <td>
                  {targetLabel ?? (
                    <span className="alm-wizard-review__source-none">
                      &mdash;
                    </span>
                  )}
                </td>
              </tr>
              <tr>
                <td>{m.projects_wizard_summary_lights_label()}</td>
                <td>
                  {m.projects_wizard_review_sources_summary({
                    sessions: sessionCount,
                    frames: frameCount,
                  })}
                </td>
              </tr>
              <tr>
                <td>{m.projects_wizard_shared_calib_title()}</td>
                <td>
                  {m.projects_wizard_views_item_count({ count: masterCount })}
                </td>
              </tr>
              <tr>
                <td>{m.projects_wizard_strategy_title()}</td>
                <td>
                  <Pill variant="ok">{viewStrategy}</Pill>
                </td>
              </tr>
            </tbody>
          </table>
        </Box>

        {/* Right column */}
        <div className="alm-wizard-review__right">
          {/* Always-identical top-level layout every project gets. */}
          <Box title={m.projects_wizard_disk_title()}>
            <pre className="alm-mono alm-wizard-review__disk-tree">
              {
                // eslint-disable-next-line alm/no-user-string -- ASCII directory-tree preview (folder names, not translatable prose); `path` is the real derived project path (#599)
                `${path}/
├── .alm/
│   └── project.json
├── sources/
│   ├── manifests/
│   └── views/
├── processing/
├── outputs/
└── notes/`
              }
            </pre>
            <div className="alm-wizard-review__disk-tree-note">
              {m.projects_wizard_review_plan_note()}
            </div>
          </Box>

          {/* After creating */}
          <Box title={m.projects_wizard_after_title()}>
            <ol className="alm-wizard-review__after-list">
              <li>
                {m.projects_wizard_lifecycle_label()}{' '}
                <span className="alm-mono">
                  {m.projects_wizard_lifecycle_setup()}
                </span>{' '}
                &rarr;{' '}
                <span className="alm-mono">
                  {m.projects_wizard_lifecycle_prepared()}
                </span>
              </li>
              <li>
                {m.projects_wizard_open_in_wbpp()}{' '}
                <span className="alm-mono">
                  {m.projects_wizard_open_in_wbpp_target({ path })}
                </span>{' '}
                {m.projects_wizard_open_in_wbpp_app()}
              </li>
              <li>{m.projects_wizard_after_process()}</li>
              <li>{m.projects_wizard_after_record()}</li>
            </ol>
          </Box>
        </div>
      </div>
    </div>
  );
}
