// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { ThemePicker } from '@/components/ThemePicker';
import { m } from '@/lib/i18n';
import { RequirementStatus } from '../RequirementStatus';

/**
 * First-run Theme step.
 *
 * Selection is delegated to the same live picker as Settings. The specimen is
 * deliberately illustrative rather than interactive: it demonstrates the
 * active token system without inserting fake controls into the tab order or
 * announcing decorative status changes.
 */
export function StepTheme() {
  return (
    <div className="pv-step-theme">
      <ThemePicker includeVariants />

      <section
        className="pv-theme-specimen"
        aria-labelledby="setup-theme-preview-heading"
      >
        <div className="pv-theme-specimen__heading-row">
          <div>
            <div className="pv-theme-specimen__eyebrow">
              {m.settings_naming_live_preview_title()}
            </div>
            <h2
              id="setup-theme-preview-heading"
              className="pv-theme-specimen__heading"
            >
              {m.setup_theme_preview_heading()}
            </h2>
          </div>
        </div>

        <p className="pv-theme-specimen__description">
          {m.setup_theme_preview_desc()}
        </p>

        <div className="pv-theme-specimen__body" aria-hidden="true">
          <div className="pv-theme-specimen__source-row">
            <div>
              <div className="pv-theme-specimen__source-title">
                {m.setup_kind_light_frames()}
              </div>
              <div className="pv-theme-specimen__source-meta">
                {m.setup_theme_preview_source_meta()}
              </div>
            </div>
            <RequirementStatus required met />
          </div>

          <div className="pv-theme-specimen__controls">
            <span className="pv-input pv-theme-specimen__input">
              {m.setup_theme_preview_input()}
            </span>
            <span className="pv-btn">{m.common_cancel()}</span>
            <span className="pv-btn pv-btn--primary">{m.common_save()}</span>
          </div>

          <div className="pv-theme-specimen__feedback">
            <span className="pv-theme-specimen__feedback-mark">✓</span>
            {m.setup_theme_preview_feedback()}
          </div>
        </div>
      </section>
    </div>
  );
}
