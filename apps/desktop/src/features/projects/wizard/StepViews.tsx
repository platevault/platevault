// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from 'react';
import { m } from '@/lib/i18n';
import { Pill, Box, Btn, Section } from '@/ui';

export type SourceViewStrategy = 'symlink' | 'hardlink' | 'copy' | 'junction';
export type ConflictPolicy = 'fail' | 'rename' | 'skip' | 'manual';

export interface StepViewsData {
  strategy: SourceViewStrategy;
  conflictPolicy?: ConflictPolicy;
}

export interface StepViewsProps {
  data: StepViewsData;
  onChange: (data: StepViewsData) => void;
}

// ── Mock view row (matches wireframe table) ─────────────────────────────────

interface ViewRow {
  name: string;
  strategy: string;
  scope: string;
  items: string;
  estimatedSize: string;
}

const DEFAULT_VIEWS: ViewRow[] = [
  {
    name: 'wbpp_input',
    strategy: 'junction',
    scope: 'all sources (3 lights + 4 masters)',
    items: '126 items',
    estimatedSize: '12 KB',
  },
];

// ── Component ───────────────────────────────────────────────────────────────

export function StepViews({ data, onChange }: StepViewsProps) {
  const [viewName, setViewName] = useState('wbpp_input');
  const conflictPolicy = data.conflictPolicy ?? 'fail';

  return (
    <div className="alm-wizard-views">
      {/* Step description */}
      <div className="alm-wizard-views__desc">
        {m.projects_wizard_views_desc()}{' '}
        <button
          type="button"
          onClick={(e) => e.preventDefault()}
          className="alm-wizard-views__link"
        >
          {m.projects_wizard_views_settings_link()}
        </button>{' '}
        {m.projects_wizard_views_override_note()}
      </div>

      {/* ── Strategy (from settings) ── */}
      <Box title={m.projects_wizard_strategy_title()}>
        <div className="alm-wizard-views__box-header">
          <button
            type="button"
            onClick={(e) => e.preventDefault()}
            className="alm-wizard-views__box-link"
          >
            {m.projects_wizard_strategy_override_link()}
          </button>
        </div>
        <div className="alm-wizard-views__strategy-row">
          <Pill variant="ok">{m.projects_wizard_strategy_ntfs()}</Pill>
          <span className="alm-wizard-views__strategy-label">
            {m.projects_wizard_strategy_ntfs_label()}
          </span>
          <span className="alm-wizard-views__strategy-meta">
            {m.projects_wizard_strategy_ntfs_meta()}
          </span>
        </div>
        <div className="alm-wizard-views__strategy-note">
          {m.projects_wizard_strategy_fallback_note()}
        </div>
      </Box>

      {/* ── Views to generate ── */}
      <Section title={m.projects_wizard_views_title()}>
        <div className="alm-wizard-views__table-hint">
          {m.projects_wizard_views_hint()}
        </div>
        <table className="alm-simple-table">
          <thead>
            <tr>
              <th>{m.projects_wizard_col_view_name()}</th>
              <th>{m.projects_wizard_col_strategy()}</th>
              <th>{m.projects_wizard_col_scope()}</th>
              <th>{m.projects_wizard_col_items()}</th>
              <th>{m.projects_wizard_col_est_size()}</th>
            </tr>
          </thead>
          <tbody>
            {DEFAULT_VIEWS.map((row) => (
              <tr key={row.name}>
                <td className="alm-mono">
                  <input
                    value={viewName}
                    onChange={(e) => setViewName(e.target.value)}
                    className="alm-wizard-views__name-input"
                    aria-label={m.projects_wizard_col_view_name()}
                  />
                </td>
                <td>
                  <Pill variant="ok">{row.strategy}</Pill>
                </td>
                <td className="alm-wizard-views__td-scope">{row.scope}</td>
                <td className="alm-mono alm-wizard-views__td-small">
                  {row.items}
                </td>
                <td className="alm-mono alm-wizard-views__td-small">
                  {row.estimatedSize}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Btn size="sm" className="alm-wizard-views__add-btn">
          {m.projects_wizard_add_view_btn()}
        </Btn>
      </Section>

      {/* ── Conflict policy ── */}
      <Box title={m.projects_wizard_conflict_title()}>
        <div className="alm-wizard-views__box-header">
          <button
            type="button"
            onClick={(e) => e.preventDefault()}
            className="alm-wizard-views__box-link"
          >
            {m.projects_wizard_conflict_defaults_link()}
          </button>
        </div>
        <div className="alm-wizard-views__radio-group">
          <label
            className="alm-wizard-views__radio-label"
            htmlFor="conflict-policy-fail"
          >
            <input
              id="conflict-policy-fail"
              type="radio"
              name="conflict-policy"
              aria-label={m.projects_wizard_conflict_fail()}
              checked={conflictPolicy === 'fail'}
              onChange={() => onChange({ ...data, conflictPolicy: 'fail' })}
            />{' '}
            {m.projects_wizard_conflict_fail()}
          </label>
          <label
            className="alm-wizard-views__radio-label"
            htmlFor="conflict-policy-rename"
          >
            <input
              id="conflict-policy-rename"
              type="radio"
              name="conflict-policy"
              aria-label={m.projects_wizard_conflict_rename()}
              checked={conflictPolicy === 'rename'}
              onChange={() => onChange({ ...data, conflictPolicy: 'rename' })}
            />{' '}
            {m.projects_wizard_conflict_rename()}
          </label>
          <label
            className="alm-wizard-views__radio-label"
            htmlFor="conflict-policy-skip"
          >
            <input
              id="conflict-policy-skip"
              type="radio"
              name="conflict-policy"
              aria-label={m.projects_wizard_conflict_skip()}
              checked={conflictPolicy === 'skip'}
              onChange={() => onChange({ ...data, conflictPolicy: 'skip' })}
            />{' '}
            {m.projects_wizard_conflict_skip()}
          </label>
          <label
            className="alm-wizard-views__radio-label"
            htmlFor="conflict-policy-manual"
          >
            <input
              id="conflict-policy-manual"
              type="radio"
              name="conflict-policy"
              aria-label={m.projects_wizard_conflict_manual()}
              checked={conflictPolicy === 'manual'}
              onChange={() => onChange({ ...data, conflictPolicy: 'manual' })}
            />{' '}
            {m.projects_wizard_conflict_manual()}
          </label>
        </div>
      </Box>
    </div>
  );
}
