// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * useHotkeys — shared keyboard-shortcut hook built on `tinykeys` (spec 042 / T183).
 *
 * Consolidates the three previously hand-rolled `document.addEventListener
 * ('keydown', …)` handlers (CommandPalette ⌘/Ctrl+K, LogPanel Escape,
 * Inbox ActionSidebar c/o) onto one declarative binding map. tinykeys owns the
 * key-combo parsing (`$mod` = Cmd on macOS / Ctrl elsewhere) and the
 * add/removeEventListener lifecycle; this wrapper adds:
 *
 *   - a default "skip when typing in an input" guard (opt-out via
 *     `ignoreFormFields: false`) so global single-key shortcuts don't fire
 *     while the user is editing text;
 *   - re-binding whenever `deps` change, so handlers always see fresh closures.
 *
 * Each handler receives the raw `KeyboardEvent` and is responsible for calling
 * `preventDefault()` where the prior handler did.
 */

import { useEffect } from 'react';
import { tinykeys, type KeybindingsMap } from 'tinykeys';

export interface UseHotkeysOptions {
  /** Bind target. Defaults to `window`. */
  target?: Window | HTMLElement | null;
  /** Master enable flag — when false, no bindings are attached. */
  enabled?: boolean;
  /**
   * When true (default), shortcuts are suppressed if the event originated from
   * an `<input>`, `<textarea>`, `<select>`, or a contentEditable element.
   */
  ignoreFormFields?: boolean;
}

/** True when the keyboard event originates from an editable form control. */
function isFormFieldEvent(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

export function useHotkeys(
  bindings: KeybindingsMap,
  deps: React.DependencyList,
  options: UseHotkeysOptions = {},
): void {
  const {
    target = typeof window !== 'undefined' ? window : null,
    enabled = true,
    ignoreFormFields = true,
  } = options;

  useEffect(() => {
    if (!enabled || !target) return;

    const guarded: KeybindingsMap = {};
    for (const [combo, handler] of Object.entries(bindings)) {
      guarded[combo] = (event: KeyboardEvent) => {
        if (ignoreFormFields && isFormFieldEvent(event)) return;
        handler(event);
      };
    }

    const unsubscribe = tinykeys(target, guarded);
    return unsubscribe;
    // `bindings` is intentionally excluded — callers pass a fresh object each
    // render; `deps` controls re-binding so handler closures stay current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, enabled, ignoreFormFields, ...deps]);
}
