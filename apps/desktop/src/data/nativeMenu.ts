// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Native menu labels (astro-plan-bw4s6).
//
// The native application menu is built by the Rust shell, but its text lives
// in this catalogue like every other visible string. The shell builds the menu
// behind the splash in the locale saved in the settings DB; `LocaleProvider`
// then sends these labels through `native_menu_set_labels` at startup and on
// every locale change.

import type { NativeMenuLabels } from '@/bindings/index';
import { m } from '@/paraglide/messages';
import type { Locale } from '@/paraglide/runtime';

/** Every native menu label, resolved in `locale`. */
export function nativeMenuLabels(locale: Locale): NativeMenuLabels {
  const options = { locale };
  return {
    about: m.menu_about({}, options),
    settings: m.menu_settings({}, options),
    quit: m.menu_quit({}, options),
    edit: m.menu_edit({}, options),
    undo: m.menu_undo({}, options),
    redo: m.menu_redo({}, options),
    cut: m.menu_cut({}, options),
    copy: m.menu_copy({}, options),
    paste: m.menu_paste({}, options),
    selectAll: m.menu_select_all({}, options),
    window: m.menu_window({}, options),
    minimise: m.menu_minimise({}, options),
    closeWindow: m.menu_close_window({}, options),
  };
}
