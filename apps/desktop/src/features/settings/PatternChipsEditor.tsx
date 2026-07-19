// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/** Chip-based editor for the top-level Project Folder Pattern (`PatternPart[]`). */
import { useState } from 'react';
import { Btn } from '@/ui';
import { m } from '@/lib/i18n';
import type { PatternPart } from './settingsIpc';
import { AVAILABLE_TOKENS, SEPARATORS, nextId } from './naming-model';

export function PatternChipsEditor({
  pattern,
  onChange,
  errorCode,
  warnings,
}: {
  pattern: PatternPart[];
  onChange: (parts: PatternPart[]) => void;
  errorCode?: string;
  warnings: string[];
}) {
  const [showTokenMenu, setShowTokenMenu] = useState(false);
  const [showSepMenu, setShowSepMenu] = useState(false);

  const handleRemove = (id: string) =>
    onChange(pattern.filter((p) => p.id !== id));

  const handleAddToken = (value: string) => {
    onChange([...pattern, { id: nextId(), kind: 'token', value }]);
    setShowTokenMenu(false);
  };

  const handleAddSep = (value: string) => {
    onChange([...pattern, { id: nextId(), kind: 'separator', value }]);
    setShowSepMenu(false);
  };

  return (
    <div>
      {/* Chip row */}
      <div className="alm-naming__chip-row">
        {pattern.map((part) => {
          const isSep = part.kind === 'separator';
          const label = isSep
            ? part.value === ' '
              ? '⎵'
              : part.value
            : `{${part.value}}`;
          return (
            <span
              key={part.id}
              className={isSep ? 'alm-sep-chip' : 'alm-token-chip'}
            >
              {label}
              <span
                className="alm-token-chip__x"
                role="button"
                tabIndex={0}
                aria-label={m.settings_naming_remove_token({ label })}
                onClick={() => handleRemove(part.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleRemove(part.id);
                  }
                }}
              >
                &times;
              </span>
            </span>
          );
        })}

        {/* Add Token menu */}
        <div className="alm-naming__menu-anchor">
          <Btn
            size="sm"
            onClick={() => {
              setShowTokenMenu(!showTokenMenu);
              setShowSepMenu(false);
            }}
          >
            {m.settings_naming_add_token()}
          </Btn>
          {showTokenMenu && (
            <div className="alm-naming__dropdown alm-naming__dropdown--token">
              {AVAILABLE_TOKENS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="alm-naming__menu-item"
                  onClick={() => handleAddToken(t)}
                >
                  {`{${t}}`}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Add Separator menu */}
        <div className="alm-naming__menu-anchor">
          <Btn
            size="sm"
            onClick={() => {
              setShowSepMenu(!showSepMenu);
              setShowTokenMenu(false);
            }}
          >
            {m.settings_naming_add_sep()}
          </Btn>
          {showSepMenu && (
            <div className="alm-naming__dropdown alm-naming__dropdown--sep">
              {SEPARATORS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="alm-naming__menu-item"
                  onClick={() => handleAddSep(s)}
                >
                  {s === '/'
                    ? m.settings_naming_sep_path_label()
                    : s === ' '
                      ? '⎵'
                      : s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Validation feedback */}
      {errorCode && (
        <div className="alm-naming__error" role="alert">
          {}
          {errorCode === 'pattern.empty' && m.settings_naming_invalid_pattern()}
          {}
          {errorCode === 'token.unknown' && m.settings_naming_invalid_pattern()}
          {errorCode &&
            !['pattern.empty', 'token.unknown'].includes(errorCode) &&
            m.settings_naming_invalid_pattern()}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="alm-naming__warning">
          {warnings.includes('no_path_separator') && (
            <span>{m.settings_naming_warn_no_path_sep()} </span>
          )}
          {warnings.includes('consecutive_separators') && (
            <span>{m.settings_naming_consecutive_seps()} </span>
          )}
        </div>
      )}
    </div>
  );
}
