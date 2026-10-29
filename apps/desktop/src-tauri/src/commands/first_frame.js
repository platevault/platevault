// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// The first frame's appearance (spec 064 LIB-FR-21, D-W166). `appearance.rs`
// calls this function with the stored `PreferencesView` and the registry's
// dark themes in each webview's initialization script, before the document
// is parsed. It publishes the view as `window.__PLATEVAULT_PREFERENCES__`
// and sets the document root's theme, `dark` class and language as
// `apps/desktop-ui/src/app/preferences.ts` does; with no root element yet,
// it waits for one. `apps/desktop-ui/src/app/first-frame.test.ts` runs it.
(function paintFirstFrame(view, darkThemes) {
  window.__PLATEVAULT_PREFERENCES__ = view
  const p = view.preferences
  const theme =
    p.theme.mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? p.systemThemes.dark
        : p.systemThemes.light
      : p.theme.theme
  const paint = (root) => {
    root.dataset.theme = theme
    root.classList.toggle("dark", darkThemes.includes(theme))
    root.lang = p.language
  }
  if (document.documentElement) {
    paint(document.documentElement)
    return
  }
  const watch = new MutationObserver(() => {
    if (!document.documentElement) return
    watch.disconnect()
    paint(document.documentElement)
  })
  watch.observe(document, { childList: true })
})
