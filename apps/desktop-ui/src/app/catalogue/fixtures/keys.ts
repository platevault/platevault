/**
 * Key-cap legends the catalogue prints on its shortcut specimens: the
 * modifier is ⌘ on a Mac and Ctrl elsewhere, the same in every locale.
 * Catalogue only.
 */
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

/** The modifier's key-cap legend. */
export const MOD_LABEL = isMac ? "⌘" : "Ctrl"
/** The command palette's chord, as printed on the keys. */
export const PALETTE_SHORTCUT = `${MOD_LABEL} K`
/** Proceed on the step page on screen, as printed on the keys. */
export const PROCEED_SHORTCUT = `${MOD_LABEL} ↩`
