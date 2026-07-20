// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Chip-based editor for a single per-type destination pattern string.
 * Supports three chip kinds: 'token' ({name}), 'literal' (bare segment),
 * and 'sep' (/). Visually matches PatternChipsEditor but persists as a path
 * string rather than PatternPart[].
 */
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useRef,
  useState,
} from 'react';
import { Btn } from '@/ui';
import { m } from '@/lib/i18n';
import {
  AVAILABLE_TOKENS,
  type PathChip,
  nextPathId,
  parsePathPattern,
} from './naming-model';

export function PerTypePatternChipsEditor({
  chips,
  onChange,
  error,
  defaultPlaceholder,
  rowId,
}: {
  chips: PathChip[];
  onChange: (chips: PathChip[]) => void;
  error?: string;
  defaultPlaceholder: string;
  rowId: string;
}) {
  const [showTokenMenu, setShowTokenMenu] = useState(false);
  const [literalInput, setLiteralInput] = useState('');
  const [showLiteralInput, setShowLiteralInput] = useState(false);
  const literalInputRef = useRef<HTMLInputElement>(null);

  const handleRemove = (id: string) =>
    onChange(chips.filter((c) => c.id !== id));

  // #820: an empty `chips` array means "using the built-in default" — the row
  // shows `defaultPlaceholder` (e.g. `bias/`) as static text, but that text
  // was never captured into chip state. Adding the first chip to such a row
  // must seed from the default pattern first, or the add silently discards
  // it instead of appending to it.
  const baseChips = (): PathChip[] =>
    chips.length === 0 && defaultPlaceholder.trim() !== ''
      ? parsePathPattern(defaultPlaceholder)
      : chips;

  const handleAddToken = (value: string) => {
    onChange([...baseChips(), { id: nextPathId(), kind: 'token', value }]);
    setShowTokenMenu(false);
  };

  const handleAddSep = () => {
    onChange([...baseChips(), { id: nextPathId(), kind: 'sep', value: '/' }]);
  };

  const handleAddLiteral = () => {
    const trimmed = literalInput.trim();
    if (trimmed === '') return;
    onChange([
      ...baseChips(),
      { id: nextPathId(), kind: 'literal', value: trimmed },
    ]);
    setLiteralInput('');
    setShowLiteralInput(false);
  };

  const handleLiteralKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddLiteral();
    }
    if (e.key === 'Escape') {
      setShowLiteralInput(false);
      setLiteralInput('');
    }
  };

  // Show placeholder when no chips yet
  const isEmpty = chips.length === 0;

  return (
    <div>
      {/* Chip row */}
      <div className="pv-naming__chip-row">
        {isEmpty && (
          <span className="pv-naming__chip-placeholder">
            {defaultPlaceholder}
          </span>
        )}

        {chips.map((chip) => {
          const label =
            chip.kind === 'token'
              ? `{${chip.value}}`
              : chip.kind === 'sep'
                ? '/'
                : chip.value;
          const chipClass =
            chip.kind === 'token'
              ? 'pv-token-chip'
              : chip.kind === 'sep'
                ? 'pv-sep-chip'
                : 'pv-literal-chip';
          return (
            <span key={chip.id} className={chipClass}>
              {label}
              <span
                className="pv-token-chip__x"
                role="button"
                tabIndex={0}
                aria-label={m.settings_naming_remove_token({ label })}
                onClick={() => handleRemove(chip.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleRemove(chip.id);
                  }
                }}
              >
                &times;
              </span>
            </span>
          );
        })}

        {/* Add Token menu */}
        <div className="pv-naming__menu-anchor">
          <Btn
            size="sm"
            onClick={() => {
              setShowTokenMenu(!showTokenMenu);
              setShowLiteralInput(false);
            }}
          >
            {m.settings_naming_add_token()}
          </Btn>
          {showTokenMenu && (
            <div className="pv-naming__dropdown pv-naming__dropdown--token">
              {AVAILABLE_TOKENS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="pv-naming__menu-item"
                  onClick={() => handleAddToken(t)}
                >
                  {`{${t}}`}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Add / separator */}
        <Btn size="sm" onClick={handleAddSep}>
          {m.settings_naming_add_path_sep()}
        </Btn>

        {/* Add Literal segment */}
        <div className="pv-naming__menu-anchor">
          <Btn
            size="sm"
            onClick={() => {
              setShowLiteralInput(!showLiteralInput);
              setShowTokenMenu(false);
              if (!showLiteralInput) {
                // focus the input on next tick
                setTimeout(() => literalInputRef.current?.focus(), 0);
              }
            }}
          >
            {m.settings_naming_add_literal()}
          </Btn>
          {showLiteralInput && (
            <div className="pv-naming__dropdown pv-naming__dropdown--literal">
              <input
                ref={literalInputRef}
                type="text"
                className="pv-naming__literal-input"
                value={literalInput}
                placeholder={m.settings_naming_literal_placeholder()}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                aria-label={m.settings_naming_literal_aria()}
                onChange={(e) => setLiteralInput(e.target.value)}
                onKeyDown={handleLiteralKeyDown}
              />
              <button
                type="button"
                className="pv-naming__literal-add-btn"
                onClick={handleAddLiteral}
              >
                {m.common_add()}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Validation / error feedback */}
      {error && (
        <div id={`${rowId}-error`} role="alert" className="pv-naming__error">
          {error}
        </div>
      )}
    </div>
  );
}
