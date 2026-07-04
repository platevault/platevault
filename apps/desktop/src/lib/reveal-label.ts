/**
 * Platform-native file-manager Reveal label — the SINGLE shared helper for
 * the product convention:
 *
 *   Windows → reveal_label_windows   (File Explorer wording; primary platform)
 *   macOS   → reveal_label_macos     (Finder wording)
 *   Linux   → reveal_label_linux     (generic file-manager wording)
 *
 * Strings live in the Paraglide catalog (the three keys above, selected at
 * runtime by platform). Never hardcode a per-feature reveal label; call
 * `revealLabel()`.
 *
 * Platform detection reads the webview's navigator (userAgentData.platform
 * with a navigator.platform fallback) — identical in the Tauri webview and
 * the browser dev server, with no plugin-os dependency. There was no existing
 * platform mechanism in the frontend when this was added; if one appears
 * (e.g. @tauri-apps/plugin-os), fold it in HERE, not at call sites.
 */

import { m } from '@/lib/i18n';

export type OsFamily = 'windows' | 'macos' | 'linux';

/** Best-effort OS family from the webview navigator. Exported for tests. */
export function osFamily(
  nav: Navigator & { userAgentData?: { platform?: string } } = navigator,
): OsFamily {
  const p = (nav.userAgentData?.platform ?? nav.platform ?? '').toLowerCase();
  if (p.startsWith('win')) return 'windows';
  if (p.startsWith('mac')) return 'macos';
  return 'linux';
}

/** The platform-native reveal-action label (locale-aware, render-time). */
export function revealLabel(family: OsFamily = osFamily()): string {
  switch (family) {
    case 'windows':
      return m.reveal_label_windows();
    case 'macos':
      return m.reveal_label_macos();
    case 'linux':
      return m.reveal_label_linux();
  }
}
