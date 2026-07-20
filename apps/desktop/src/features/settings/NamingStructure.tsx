// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// spec 015 — Token Pattern Builder: backend-wired resolver, validator, preview.
// spec 018 — pattern + autoApplyPattern keys persisted via settings transport.
// spec 041 (T051, FR-026b) — per-frame-type destination patterns.
// package P11 — per-type path-string preview wired to the real `pattern.path_preview`
// backend command (crates/patterns::resolver::resolve_pattern_str), replacing the
// former client-side token-substitution stub.
import { m } from '@/lib/i18n';
import { NAMING_KEYS } from './naming-model';
import { PatternChipsEditor } from './PatternChipsEditor';
import { PerTypeDestinationPatterns } from './PerTypeDestinationPatterns';
import { RestoreDefaultsBtn, SettingsSection } from './SettingsKit';
import { useNamingPattern } from './useNamingPattern';

// Re-exported so existing tests/consumers that import the per-type pattern
// model directly from this module keep working (see `PerTypePatternChips.test.ts`).
export type { PathChip } from './naming-model';
export { parsePathPattern, serializePathPattern } from './naming-model';

interface NamingStructureProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

export function NamingStructure({ save }: NamingStructureProps) {
  const {
    pattern,
    autoApplyPattern,
    preview,
    previewError,
    validateResult,
    applyValues,
    handlePatternChange,
    handleAutoApplyChange,
    canSave,
  } = useNamingPattern(save);

  return (
    <>
      <SettingsSection
        title={m.settings_naming_project_title()}
        action={
          <RestoreDefaultsBtn
            scope="naming"
            keys={NAMING_KEYS}
            onRestored={applyValues}
            scopeLabel={m.settings_naming_project_restore_scope()}
          />
        }
      >
        <div className="pv-settings__row">
          <div className="pv-settings__row-content">
            <PatternChipsEditor
              pattern={pattern}
              onChange={handlePatternChange}
              errorCode={
                validateResult?.valid === false
                  ? validateResult.errorCode
                  : undefined
              }
              warnings={validateResult?.warnings ?? []}
            />
          </div>
        </div>
      </SettingsSection>

      <PerTypeDestinationPatterns />

      <div className="pv-settings__group">
        <div className="pv-settings__row">
          <label className="pv-settings__row-label" htmlFor="naming-auto-apply">
            {/* eslint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by the wrapping <label> (htmlFor + id + visible text); rule misses the wrapping-label association */}
            <input
              id="naming-auto-apply"
              type="checkbox"
              className="pv-naming__checkbox"
              checked={autoApplyPattern}
              onChange={(e) => handleAutoApplyChange(e.target.checked)}
            />
            {m.settings_naming_auto_apply()}
          </label>
        </div>
      </div>

      <SettingsSection title={m.settings_naming_live_preview_title()}>
        <div className="pv-naming__preview-sample">
          {m.settings_naming_live_preview_sample()}
        </div>
        {!canSave && (
          <div className="pv-naming__preview-empty">
            {m.settings_naming_invalid_pattern()}
          </div>
        )}
        {previewError && (
          <div className="pv-naming__preview-error">{previewError}</div>
        )}
        {preview && canSave && (
          <div className="pv-naming__preview-path-row">
            <code className="pv-mono pv-naming__preview-code">
              {preview.missingTokens.length > 0
                ? // Render path with fallback segments dimmed.
                  preview.resolvedPath
                : preview.resolvedPath}
            </code>
            {preview.missingTokens.length > 0 && (
              <span className="pv-naming__preview-fallback">
                {m.settings_naming_fallback_used({
                  tokens: preview.missingTokens.join(', '),
                })}
              </span>
            )}
          </div>
        )}
      </SettingsSection>
    </>
  );
}
