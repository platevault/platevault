#!/usr/bin/env node
/**
 * Theme generator: `pnpm themes` (node scripts/themes.mjs).
 *
 * Maps each theme's published palette onto the prototype's one token set,
 * then raises every text and tone token until it meets WCAG 2.x contrast on
 * every surface of that theme, and writes:
 * - src/themes.css: one `[data-theme]` block per theme (generated; edit here);
 * - design/themes-contrast.md: the computed table.
 *
 * Colour maths: OKLCH -> OKLab -> linear sRGB with Björn Ottosson's OKLab
 * matrices; colours stay inside sRGB by reducing chroma, so what the browser
 * paints is what is measured. Tints (`bg-warning/12` and the like) composite
 * in gamma-encoded sRGB, as the browser blends an alpha fill over its surface.
 */
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { THEMES } from "../src/app/themes.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------

const toLinear = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
const toGamma = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.sign(x) * Math.abs(x) ** (1 / 2.4) - 0.055)
const RAD = Math.PI / 180

function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
}

function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

const lab = (c) => [c.l, c.c * Math.cos(c.h * RAD), c.c * Math.sin(c.h * RAD)]

function fromLab([l, a, b], alpha = 1) {
  const c = Math.hypot(a, b)
  const h = c < 1e-4 ? 0 : (Math.atan2(b, a) / RAD + 360) % 360
  return { l, c, h, alpha }
}

const linearOf = (c) => oklabToLinear(lab(c))
const inGamut = (c) => linearOf(c).every((v) => v >= -1e-4 && v <= 1 + 1e-4)

/** Round to the emitted precision and keep the colour inside sRGB by lowering chroma. */
function settle(c) {
  let out = { l: Math.round(Math.min(1, Math.max(0, c.l)) * 1000) / 1000, c: Math.round(c.c * 1000) / 1000, h: Math.round(c.h * 10) / 10, alpha: c.alpha }
  while (!inGamut(out) && out.c > 0) out = { ...out, c: Math.max(0, Math.round((out.c - 0.001) * 1000) / 1000) }
  if (out.c === 0) out.h = 0
  return out
}

function hex(value) {
  const n = value.replace("#", "")
  const rgb = [0, 2, 4].map((i) => toLinear(parseInt(n.slice(i, i + 2), 16) / 255))
  return settle(fromLab(linearToOklab(rgb)))
}

const ok = (l, c, h, alpha = 1) => settle({ l, c, h, alpha })
const alpha = (c, a) => ({ ...c, alpha: a })
/** Mix in OKLab, `t` of `b` into `a`. */
const mix = (a, b, t) => settle(fromLab(lab(a).map((v, i) => v + (lab(b)[i] - v) * t)))
const shade = (c, dl, chromaScale = 1) => settle({ ...c, l: c.l + dl, c: c.c * chromaScale })

const clip = (v) => Math.min(1, Math.max(0, v))

/** Linear sRGB of a colour painted over an opaque surface (gamma-space blend, as the browser composites). */
function over(fg, bg) {
  const top = linearOf(fg).map(clip)
  if (fg.alpha >= 1) return top
  const base = Array.isArray(bg) ? bg : linearOf(bg).map(clip)
  return top.map((v, i) => toLinear(toGamma(v) * fg.alpha + toGamma(base[i]) * (1 - fg.alpha)))
}

const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const css = (c) => {
  const body = `${+c.l.toFixed(3)} ${+c.c.toFixed(3)} ${+c.h.toFixed(1)}`
  return c.alpha < 1 ? `oklch(${body} / ${Math.round(c.alpha * 100)}%)` : `oklch(${body})`
}

// ---------------------------------------------------------------------------
// Palettes (published values) mapped onto the token set
// ---------------------------------------------------------------------------

/**
 * Each spec names the palette colour for every role. Roles not given take
 * the defaults in `complete()`. PlateVault's two themes carry v4's values.
 */
const SPECS = {
  "platevault-light": {
    background: ok(0.99, 0.002, 255),
    foreground: ok(0.22, 0.005, 255),
    card: ok(0.975, 0.003, 255),
    popover: ok(1, 0, 0),
    primary: ok(0.52, 0.17, 255),
    primaryForeground: ok(1, 0, 0),
    link: ok(0.47, 0.15, 255),
    secondary: ok(0.945, 0.004, 255),
    muted: ok(0.955, 0.004, 255),
    mutedForeground: ok(0.48, 0.006, 255),
    accent: ok(0.915, 0.006, 255),
    accentForeground: ok(0.2, 0.005, 255),
    destructive: ok(0.5, 0.19, 27),
    destructiveForeground: ok(0.5, 0.19, 27),
    success: ok(0.47, 0.12, 155),
    warning: ok(0.48, 0.12, 65),
    info: ok(0.47, 0.15, 255),
    border: ok(0, 0, 0, 0.11),
    separator: ok(0.86, 0.004, 255),
    input: ok(0.6, 0.004, 255),
    ring: ok(0.55, 0.17, 255),
    chrome: ok(0.935, 0.004, 255),
    selected: ok(0.52, 0.17, 255),
    selectedForeground: ok(1, 0, 0),
    plate: ok(0.16, 0.006, 255),
    mount: ok(0.965, 0.006, 85),
    scrollbar: ok(0, 0, 0, 0.28),
    sidebar: ok(0.95, 0.004, 255),
    sidebarAccent: ok(0.905, 0.006, 255),
    sidebarAccentForeground: ok(0.2, 0.005, 255),
    chart: [ok(0.52, 0.17, 255), ok(0.72, 0.08, 255), ok(0.6, 0, 0), ok(0.8, 0, 0), ok(0.4, 0, 0)],
  },
  "platevault-dark": {
    background: ok(0.225, 0.006, 255),
    foreground: ok(0.94, 0.003, 255),
    card: ok(0.25, 0.006, 255),
    popover: ok(0.29, 0.007, 255),
    primary: ok(0.54, 0.17, 255),
    primaryForeground: ok(1, 0, 0),
    link: ok(0.76, 0.12, 250),
    secondary: ok(0.29, 0.006, 255),
    muted: ok(0.265, 0.006, 255),
    mutedForeground: ok(0.74, 0.006, 255),
    accent: ok(0.33, 0.008, 255),
    accentForeground: ok(0.96, 0.003, 255),
    destructive: ok(0.72, 0.17, 25),
    destructiveForeground: ok(0.82, 0.11, 25),
    success: ok(0.76, 0.14, 155),
    warning: ok(0.82, 0.14, 80),
    info: ok(0.76, 0.12, 250),
    border: ok(1, 0, 0, 0.09),
    separator: ok(0.14, 0.005, 255),
    input: ok(0.58, 0.006, 255),
    ring: ok(0.72, 0.13, 250),
    chrome: ok(0.27, 0.007, 255),
    selected: ok(0.5, 0.15, 255),
    selectedForeground: ok(1, 0, 0),
    plate: ok(0.13, 0.006, 255),
    mount: ok(0.31, 0.008, 255),
    scrollbar: ok(1, 0, 0, 0.26),
    sidebar: ok(0.25, 0.007, 255),
    sidebarForeground: ok(0.92, 0.003, 255),
    sidebarPrimary: ok(0.54, 0.17, 255),
    sidebarAccent: ok(0.32, 0.008, 255),
    sidebarAccentForeground: ok(0.96, 0.003, 255),
    chart: [ok(0.72, 0.13, 250), ok(0.5, 0.08, 250), ok(0.55, 0, 0), ok(0.38, 0, 0), ok(0.8, 0, 0)],
  },

  // Gruvbox (morhetz/gruvbox): dark uses the bright accents, light the faded ones.
  "gruvbox-dark": (() => {
    const g = { bg0h: hex("#1d2021"), bg0: hex("#282828"), bg0s: hex("#32302f"), bg1: hex("#3c3836"), bg2: hex("#504945"), bg4: hex("#7c6f64"), fg1: hex("#ebdbb2"), fg0: hex("#fbf1c7"), fg4: hex("#a89984"), gray: hex("#928374"), red: hex("#fb4934"), green: hex("#b8bb26"), yellow: hex("#fabd2f"), blue: hex("#83a598"), blueDim: hex("#458588"), fg2: hex("#d5c4a1"), bg3: hex("#665c54") }
    return {
      background: g.bg0, card: g.bg0s, popover: g.bg1, secondary: g.bg1, muted: g.bg0s, accent: g.bg2, chrome: g.bg0s, sidebar: g.bg0s, sidebarAccent: g.bg2,
      foreground: g.fg1, mutedForeground: g.fg4, link: g.blue, primary: g.blue, primaryForeground: g.bg0h, selected: g.blue, selectedForeground: g.bg0h,
      destructive: g.red, success: g.green, warning: g.yellow, info: g.blue, ring: g.blue, input: g.bg4, separator: g.bg0h, plate: g.bg0h, mount: g.bg1,
      chart: [g.blue, g.blueDim, g.gray, g.bg3, g.fg2],
    }
  })(),
  "gruvbox-light": (() => {
    const g = { bg0h: hex("#f9f5d7"), bg0: hex("#fbf1c7"), bg0s: hex("#f2e5bc"), bg1: hex("#ebdbb2"), bg2: hex("#d5c4a1"), bg3: hex("#bdae93"), fg: hex("#3c3836"), fg2: hex("#504945"), fg4: hex("#7c6f64"), gray: hex("#928374"), red: hex("#9d0006"), green: hex("#79740e"), yellow: hex("#b57614"), blue: hex("#076678"), blueMid: hex("#458588"), dark: hex("#282828") }
    return {
      background: g.bg0, card: g.bg0s, popover: g.bg0h, secondary: g.bg1, muted: g.bg0s, accent: g.bg2, chrome: g.bg1, sidebar: g.bg0s, sidebarAccent: g.bg2,
      foreground: g.fg, mutedForeground: g.fg4, link: g.blue, primary: g.blue, primaryForeground: g.bg0, selected: g.blue, selectedForeground: g.bg0,
      destructive: g.red, success: g.green, warning: g.yellow, info: g.blue, ring: g.blue, input: g.gray, separator: g.bg2, plate: g.dark, mount: g.bg1,
      chart: [g.blue, g.blueMid, g.gray, g.bg3, g.fg2],
    }
  })(),

  // Nord (arcticicestudio): Polar Night surfaces, Snow Storm text, Frost accents, Aurora tones.
  nord: (() => {
    const n = ["#2E3440", "#3B4252", "#434C5E", "#4C566A", "#D8DEE9", "#E5E9F0", "#ECEFF4", "#8FBCBB", "#88C0D0", "#81A1C1", "#5E81AC", "#BF616A", "#D08770", "#EBCB8B", "#A3BE8C", "#B48EAD"].map(hex)
    const between = mix(n[0], n[1], 0.5)
    return {
      background: n[0], card: between, popover: n[1], secondary: n[1], muted: between, accent: n[2], chrome: n[1], sidebar: between, sidebarAccent: n[2],
      foreground: n[4], mutedForeground: mix(n[3], n[4], 0.65), link: n[8], primary: n[8], primaryForeground: n[0], selected: n[8], selectedForeground: n[0],
      destructive: n[11], success: n[14], warning: n[13], info: n[9], ring: n[8], input: n[3], separator: shade(n[0], -0.05), plate: shade(n[0], -0.09), mount: n[1],
      chart: [n[8], n[10], n[7], n[3], n[4]],
    }
  })(),

  // Dracula (draculatheme.com spec, including its BG Lighter / Dark / Darker UI shades).
  dracula: (() => {
    const d = { bg: hex("#282A36"), lighter: hex("#343746"), dark: hex("#21222C"), darker: hex("#191A21"), line: hex("#44475A"), fg: hex("#F8F8F2"), comment: hex("#6272A4"), cyan: hex("#8BE9FD"), green: hex("#50FA7B"), orange: hex("#FFB86C"), purple: hex("#BD93F9"), red: hex("#FF5555") }
    return {
      background: d.bg, card: mix(d.bg, d.lighter, 0.5), popover: d.lighter, secondary: d.lighter, muted: mix(d.bg, d.lighter, 0.5), accent: d.line, chrome: d.dark, sidebar: d.dark, sidebarAccent: d.lighter,
      foreground: d.fg, mutedForeground: d.comment, link: d.purple, primary: d.purple, primaryForeground: d.bg, selected: d.purple, selectedForeground: d.bg,
      destructive: d.red, success: d.green, warning: d.orange, info: d.cyan, ring: d.purple, input: d.comment, separator: d.darker, plate: d.darker, mount: d.lighter,
      chart: [d.purple, d.comment, d.cyan, d.line, d.fg],
    }
  })(),

  // Solarized (ethanschoonover.com/solarized): base03..base3 plus the eight accents.
  "solarized-dark": (() => {
    const s = solarized()
    const between = mix(s.base03, s.base02, 0.5)
    return {
      background: s.base03, card: between, popover: s.base02, secondary: s.base02, muted: between, accent: mix(s.base02, s.base01, 0.3), chrome: s.base02, sidebar: between, sidebarAccent: mix(s.base02, s.base01, 0.3),
      foreground: s.base1, mutedForeground: s.base0, link: s.blue, primary: s.blue, primaryForeground: s.base3, selected: s.blue, selectedForeground: s.base3,
      destructive: s.red, success: s.green, warning: s.yellow, info: s.blue, ring: s.blue, input: s.base01, separator: shade(s.base03, -0.05), plate: shade(s.base03, -0.08), mount: s.base02,
      chart: [s.blue, s.cyan, s.green, s.base01, s.base1],
    }
  })(),
  "solarized-light": (() => {
    const s = solarized()
    const between = mix(s.base3, s.base2, 0.5)
    return {
      background: s.base3, card: between, popover: s.base3, secondary: s.base2, muted: between, accent: mix(s.base2, s.base1, 0.25), chrome: s.base2, sidebar: s.base2, sidebarAccent: mix(s.base2, s.base1, 0.3),
      foreground: s.base01, mutedForeground: s.base00, link: s.blue, primary: s.blue, primaryForeground: s.base3, selected: s.blue, selectedForeground: s.base3,
      destructive: s.red, success: s.green, warning: s.yellow, info: s.blue, ring: s.blue, input: s.base1, separator: mix(s.base2, s.base1, 0.4), plate: s.base03, mount: s.base2,
      chart: [s.blue, s.cyan, s.green, s.base1, s.base01],
    }
  })(),

  // Catppuccin (catppuccin/palette v1): base/mantle/crust surfaces, surface0-2, overlay and subtext text.
  "catppuccin-mocha": (() => {
    const m = { base: hex("#1e1e2e"), mantle: hex("#181825"), crust: hex("#11111b"), surface0: hex("#313244"), surface1: hex("#45475a"), surface2: hex("#585b70"), text: hex("#cdd6f4"), subtext0: hex("#a6adc8"), subtext1: hex("#bac2de"), blue: hex("#89b4fa"), lavender: hex("#b4befe"), sapphire: hex("#74c7ec"), red: hex("#f38ba8"), green: hex("#a6e3a1"), yellow: hex("#f9e2af"), mauve: hex("#cba6f7"), teal: hex("#94e2d5") }
    return {
      background: m.base, card: m.mantle, popover: m.surface0, secondary: m.surface0, muted: m.mantle, accent: m.surface1, chrome: m.mantle, sidebar: m.mantle, sidebarAccent: m.surface0,
      foreground: m.text, mutedForeground: m.subtext0, link: m.blue, primary: m.blue, primaryForeground: m.crust, selected: m.blue, selectedForeground: m.crust,
      destructive: m.red, success: m.green, warning: m.yellow, info: m.sapphire, ring: m.lavender, input: m.surface2, separator: m.crust, plate: m.crust, mount: m.surface0,
      chart: [m.blue, m.mauve, m.teal, m.surface2, m.subtext1],
    }
  })(),
  "catppuccin-latte": (() => {
    const l = { base: hex("#eff1f5"), mantle: hex("#e6e9ef"), crust: hex("#dce0e8"), surface0: hex("#ccd0da"), surface2: hex("#acb0be"), overlay0: hex("#9ca0b0"), text: hex("#4c4f69"), subtext0: hex("#6c6f85"), subtext1: hex("#5c5f77"), blue: hex("#1e66f5"), lavender: hex("#7287fd"), sapphire: hex("#209fb5"), red: hex("#d20f39"), green: hex("#40a02b"), yellow: hex("#df8e1d"), mauve: hex("#8839ef"), teal: hex("#179299"), mochaBase: hex("#1e1e2e") }
    return {
      background: l.base, card: l.mantle, popover: l.base, secondary: l.crust, muted: l.mantle, accent: l.surface0, chrome: l.mantle, sidebar: l.mantle, sidebarAccent: l.surface0,
      foreground: l.text, mutedForeground: l.subtext0, link: l.blue, primary: l.blue, primaryForeground: l.base, selected: l.blue, selectedForeground: l.base,
      destructive: l.red, success: l.green, warning: l.yellow, info: l.sapphire, ring: l.lavender, input: l.overlay0, separator: l.surface0, plate: l.mochaBase, mount: l.mantle,
      chart: [l.blue, l.mauve, l.teal, l.surface2, l.subtext1],
    }
  })(),

  // Tokyo Night (folke/tokyonight.nvim, "night" style; float and highlight shades from "storm").
  "tokyo-night": (() => {
    const t = { bg: hex("#1a1b26"), bgDark: hex("#16161e"), storm: hex("#24283b"), stormDark: hex("#1f2335"), highlight: hex("#292e42"), terminalBlack: hex("#414868"), fg: hex("#c0caf5"), fgDark: hex("#a9b1d6"), dark5: hex("#737aa2"), blue: hex("#7aa2f7"), cyan: hex("#7dcfff"), magenta: hex("#bb9af7"), orange: hex("#ff9e64"), yellow: hex("#e0af68"), green: hex("#9ece6a"), red: hex("#f7768e") }
    return {
      background: t.bg, card: t.stormDark, popover: t.storm, secondary: t.storm, muted: t.stormDark, accent: t.highlight, chrome: t.bgDark, sidebar: t.bgDark, sidebarAccent: t.highlight,
      foreground: t.fg, mutedForeground: t.dark5, link: t.blue, primary: t.blue, primaryForeground: t.bg, selected: t.blue, selectedForeground: t.bg,
      destructive: t.red, success: t.green, warning: t.yellow, info: t.cyan, ring: t.blue, input: t.terminalBlack, separator: shade(t.bgDark, -0.04), plate: shade(t.bgDark, -0.05), mount: t.storm,
      chart: [t.blue, t.magenta, t.cyan, t.terminalBlack, t.fgDark],
    }
  })(),

  // One Dark (Atom one-dark-syntax and one-dark-ui).
  "one-dark": (() => {
    const o = { bg: hex("#282c34"), ui: hex("#21252b"), border: hex("#181a1f"), line: hex("#2c313c"), selection: hex("#3e4451"), mono1: hex("#abb2bf"), mono2: hex("#828997"), mono3: hex("#5c6370"), blue: hex("#61afef"), accent: hex("#528bff"), purple: hex("#c678dd"), cyan: hex("#56b6c2"), green: hex("#98c379"), red: hex("#e06c75"), yellow: hex("#e5c07b") }
    return {
      background: o.bg, card: o.line, popover: mix(o.line, o.selection, 0.5), secondary: o.line, muted: o.line, accent: o.selection, chrome: o.ui, sidebar: o.ui, sidebarAccent: o.line,
      foreground: o.mono1, mutedForeground: o.mono2, link: o.blue, primary: o.blue, primaryForeground: o.ui, selected: o.blue, selectedForeground: o.ui,
      destructive: o.red, success: o.green, warning: o.yellow, info: o.blue, ring: o.accent, input: o.mono3, separator: o.border, plate: o.border, mount: o.line,
      chart: [o.blue, o.purple, o.cyan, o.mono3, o.mono1],
    }
  })(),

  // Rosé Pine (rosepinetheme.com, main variant).
  "rose-pine": (() => {
    const r = { base: hex("#191724"), surface: hex("#1f1d2e"), overlay: hex("#26233a"), muted: hex("#6e6a86"), subtle: hex("#908caa"), text: hex("#e0def4"), love: hex("#eb6f92"), gold: hex("#f6c177"), pine: hex("#31748f"), foam: hex("#9ccfd8"), iris: hex("#c4a7e7"), hlMed: hex("#403d52") }
    return {
      background: r.base, card: r.surface, popover: r.overlay, secondary: r.overlay, muted: r.surface, accent: r.hlMed, chrome: r.surface, sidebar: r.surface, sidebarAccent: r.overlay,
      foreground: r.text, mutedForeground: r.subtle, link: r.iris, primary: r.iris, primaryForeground: r.base, selected: r.iris, selectedForeground: r.base,
      destructive: r.love, success: r.foam, warning: r.gold, info: r.iris, ring: r.iris, input: r.muted, separator: shade(r.base, -0.04), plate: shade(r.base, -0.06), mount: r.overlay,
      chart: [r.iris, r.pine, r.foam, r.muted, r.text],
    }
  })(),
}

function solarized() {
  const names = ["base03", "base02", "base01", "base00", "base0", "base1", "base2", "base3", "yellow", "orange", "red", "magenta", "violet", "blue", "cyan", "green"]
  const values = ["#002b36", "#073642", "#586e75", "#657b83", "#839496", "#93a1a1", "#eee8d5", "#fdf6e3", "#b58900", "#cb4b16", "#dc322f", "#d33682", "#6c71c4", "#268bd2", "#2aa198", "#859900"]
  return Object.fromEntries(names.map((name, i) => [name, hex(values[i])]))
}

/**
 * Fill in the roles a palette leaves to the token set's own rules. A role
 * left out follows its source (`follow`), so an adjusted foreground moves its
 * card, popover and sidebar text and its hairlines with it.
 */
function complete(spec, scheme) {
  const dark = scheme === "dark"
  const follow = {
    cardForeground: (t) => t.foreground,
    popoverForeground: (t) => t.foreground,
    secondaryForeground: (t) => t.foreground,
    accentForeground: (t) => t.foreground,
    sidebarForeground: (t) => t.foreground,
    sidebarAccentForeground: (t) => t.accentForeground,
    sidebarPrimary: (t) => t.selected,
    sidebarPrimaryForeground: (t) => t.selectedForeground,
    sidebarBorder: (t) => t.separator,
    sidebarRing: (t) => t.ring,
    border: (t) => alpha(t.foreground, dark ? 0.1 : 0.13),
    scrollbar: (t) => alpha(t.foreground, dark ? 0.26 : 0.3),
  }
  for (const key of Object.keys(follow)) if (spec[key] !== undefined) delete follow[key]
  const tokens = { ...spec }
  // Destructive-button text starts from the tone and is then raised on its own.
  tokens.destructiveForeground ??= dark ? shade(spec.destructive, 0.08, 0.7) : spec.destructive
  for (const [key, source] of Object.entries(follow)) tokens[key] = source(tokens)
  return { tokens, follow }
}

/** The token an adjustment moves: a following role moves its source. */
const SOURCE = { cardForeground: "foreground", popoverForeground: "foreground", secondaryForeground: "foreground", accentForeground: "foreground", sidebarForeground: "foreground", sidebarAccentForeground: "accentForeground", sidebarPrimary: "selected", sidebarPrimaryForeground: "selectedForeground", sidebarRing: "ring" }

// ---------------------------------------------------------------------------
// Checks and adjustment
// ---------------------------------------------------------------------------

const TEXT_TARGET = 4.5
const GLYPH_TARGET = 3
/** Emitted values are rounded; aim a little above the floor so the rounded value still passes. */
const MARGIN = 0.06
/** Visible hover: the hover fill sits this far from the surface it hovers on, in OKLCH lightness. */
const STATE_DELTA_L = 0.05
/** Text hierarchy: body text stays this far above secondary text in OKLCH lightness. */
const HIERARCHY_DELTA_L = 0.08

const SURFACES = ["background", "card", "popover", "secondary", "muted", "accent", "chrome", "sidebar", "sidebarAccent", "mount"]
const TEXT = ["foreground", "accentForeground", "sidebarForeground", "mutedForeground", "link", "success", "warning", "info", "destructive"]
const FILLS = [
  ["primaryForeground", "primary"],
  ["selectedForeground", "selected"],
  ["sidebarPrimaryForeground", "sidebarPrimary"],
]
/** Status pills and tinted badges: tone text over its own tint at hover strength (Pill rests at 12%, hovers at 16%) on the shell surfaces. */
const TINT = { tones: ["success", "warning", "info", "destructive"], alpha: 0.16, surfaces: ["background", "card", "popover", "sidebar", "chrome"] }
/** Destructive buttons: their text over the strongest destructive tint they draw (dark hover, 30%). */
const DESTRUCTIVE_BUTTON = { alpha: 0.3, surfaces: ["background", "card", "popover", "chrome"] }
const GLYPHS = [
  ["input", ["background", "card", "popover"]],
  ["ring", ["background", "card", "popover", "sidebar", "chrome"]],
]

function textChecks(t) {
  const rows = []
  for (const token of TEXT) for (const surface of SURFACES) rows.push({ kind: "text", token, surface, value: ratio(over(t[token], t[surface]), over(t[surface], [1, 1, 1])) })
  for (const [token, fill] of FILLS) rows.push({ kind: "fill", token, surface: fill, value: ratio(over(t[token], t[fill]), over(t[fill], [1, 1, 1])) })
  for (const tone of TINT.tones) {
    for (const surface of TINT.surfaces) {
      const base = over(t[surface], [1, 1, 1])
      const tint = over(alpha(t[tone], TINT.alpha), base)
      rows.push({ kind: "tint", token: tone, surface: `${tone}/${TINT.alpha * 100}% on ${surface}`, value: ratio(over(t[tone], tint), tint) })
    }
  }
  for (const surface of DESTRUCTIVE_BUTTON.surfaces) {
    const base = over(t[surface], [1, 1, 1])
    const tint = over(alpha(t.destructive, DESTRUCTIVE_BUTTON.alpha), base)
    rows.push({ kind: "tint", token: "destructiveForeground", surface: `destructive/${DESTRUCTIVE_BUTTON.alpha * 100}% on ${surface}`, value: ratio(over(t.destructiveForeground, tint), tint) })
  }
  for (const [token, surfaces] of GLYPHS) for (const surface of surfaces) rows.push({ kind: "glyph", token, surface, value: ratio(over(t[token], t[surface]), over(t[surface], [1, 1, 1])) })
  return rows
}

const target = (row) => (row.kind === "glyph" ? GLYPH_TARGET : TEXT_TARGET)

/** Move one token's lightness away from what it sits on, keeping hue and as much chroma as sRGB allows. */
function step(c, direction) {
  return settle({ ...c, l: c.l + direction * 0.004 })
}

function adjust(id, scheme, spec) {
  const { tokens: t, follow } = complete(spec, scheme)
  const original = { ...t }
  const away = scheme === "dark" ? 1 : -1
  const pass = (rows) => rows.every((row) => row.value >= target(row) + MARGIN)
  const sync = () => {
    for (const [key, source] of Object.entries(follow)) t[key] = source(t)
  }
  const owner = (token) => (follow[token] && SOURCE[token] ? owner(SOURCE[token]) : token)

  // Hover fills stay visible against the surfaces they hover on.
  const hover = [
    ["accent", ["background", "popover", "card"]],
    ["sidebarAccent", ["sidebar"]],
  ]
  for (const [token, under] of hover) {
    for (let i = 0; i < 60; i += 1) {
      const nearest = Math.min(...under.map((s) => Math.abs(t[token].l - t[s].l)))
      if (nearest >= STATE_DELTA_L) break
      t[token] = step(t[token], away)
    }
  }

  for (let round = 0; round < 150; round += 1) {
    sync()
    const rows = textChecks(t)
    const flat = Math.abs(t.foreground.l - t.mutedForeground.l) < HIERARCHY_DELTA_L
    if (pass(rows) && !flat) break
    const failing = new Set(rows.filter((row) => row.value < target(row) + MARGIN).map((row) => owner(row.kind === "fill" ? row.surface : row.token)))
    if (flat) failing.add("foreground")
    for (const token of failing) {
      const fill = FILLS.find(([, f]) => owner(f) === token)
      if (fill) {
        // A fill moves away from its own text colour.
        const lighterText = t[fill[0]].l > t[token].l
        t[token] = step(t[token], lighterText ? -1 : 1)
      } else {
        t[token] = step(t[token], away)
      }
    }
  }
  sync()
  const rows = textChecks(t)
  const changed = Object.keys(t).filter((key) => key !== "chart" && !follow[key] && css(t[key]) !== css(original[key]))
  return { id, scheme, tokens: t, rows, changed, original, ok: pass(rows) && Math.abs(t.foreground.l - t.mutedForeground.l) >= HIERARCHY_DELTA_L }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const kebab = (key) => key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)

const ORDER = [
  "background", "foreground", "card", "cardForeground", "popover", "popoverForeground", "primary", "primaryForeground", "link", "secondary", "secondaryForeground",
  "muted", "mutedForeground", "accent", "accentForeground", "destructive", "destructiveForeground", "success", "warning", "info", "border", "separator", "input", "ring",
  "chrome", "selected", "selectedForeground", "plate", "mount", "scrollbar", "sidebar", "sidebarForeground", "sidebarPrimary", "sidebarPrimaryForeground", "sidebarAccent",
  "sidebarAccentForeground", "sidebarBorder", "sidebarRing",
]

function block(result) {
  const selector = result.id === "platevault-light" ? `:root,\n[data-theme="platevault-light"]` : `[data-theme="${result.id}"]`
  const lines = ORDER.map((key) => `  --${kebab(key)}: ${css(result.tokens[key])};`)
  result.tokens.chart.forEach((c, i) => lines.push(`  --chart-${i + 1}: ${css(c)};`))
  lines.push(`  color-scheme: ${result.scheme};`)
  return `${selector} {\n${lines.join("\n")}\n}`
}

const results = THEMES.map((theme) => {
  const spec = SPECS[theme.id]
  if (!spec) throw new Error(`No palette for theme ${theme.id}`)
  return adjust(theme.id, theme.scheme, spec)
})
for (const id of Object.keys(SPECS)) if (!THEMES.some((theme) => theme.id === id)) throw new Error(`Palette ${id} is not in src/app/themes.ts`)

const header = `/*
 * Theme tokens: generated by scripts/themes.mjs from each theme's published
 * palette. Do not edit by hand; change the script and run \`pnpm themes\`.
 * Every text and tone token meets 4.5:1 on every surface of its theme (UI
 * glyphs 3:1); the computed table is design/themes-contrast.md.
 */`
// `:root` (PlateVault Light) comes first: every `[data-theme]` block has the same specificity and must win by order.
const cssOrder = [...results].sort((a, b) => Number(b.id === "platevault-light") - Number(a.id === "platevault-light"))
writeFileSync(join(ROOT, "src/themes.css"), `${header}\n\n${cssOrder.map(block).join("\n\n")}\n`)

const fmt = (v) => v.toFixed(2)
const min = (rows, kinds) => Math.min(...rows.filter((r) => kinds.includes(r.kind)).map((r) => r.value))
const md = []
md.push("# Theme contrast")
md.push("")
md.push("Generated by `scripts/themes.mjs` (`pnpm themes`); do not edit by hand. Each theme maps its published palette onto the prototype's token set, then the script raises any text or tone token that misses its floor, moving its OKLCH lightness away from the surfaces and keeping its hue.")
md.push("")
md.push(`Method: OKLCH to linear sRGB through OKLab (Ottosson's matrices), chroma reduced until the colour is inside sRGB, WCAG 2.x relative luminance and contrast ratio. Tints are composited over their surface in gamma-encoded sRGB, as the browser blends an alpha fill. Floors: 4.5:1 for every text and tone token on every surface, for fill text (primary, selection), for tone text on its own ${TINT.alpha * 100}% tint (status pills and tinted badges at hover strength) and for destructive-button text on a ${DESTRUCTIVE_BUTTON.alpha * 100}% destructive tint; 3:1 for UI glyphs and control boundaries (\`--input\`, \`--ring\`). Hover fills sit at least ${STATE_DELTA_L} OKLCH lightness from the surface they hover on.`)
md.push("")
md.push(`Surfaces: ${SURFACES.map((s) => `\`--${kebab(s)}\``).join(", ")}. The frame plate is an image well and carries no text.`)
md.push("")
md.push("## Summary")
md.push("")
md.push("| Theme | Scheme | Min text | Min fill text | Min tint text | Min UI glyph | Passes | Adjusted from the palette |")
md.push("|---|---|---|---|---|---|---|---|")
for (const r of results) {
  const label = THEMES.find((theme) => theme.id === r.id).name
  const adjusted = r.changed.filter((key) => SPECS[r.id][key] !== undefined).map((key) => `\`--${kebab(key)}\``).join(", ") || "none"
  md.push(`| ${label} | ${r.scheme} | ${fmt(min(r.rows, ["text"]))} | ${fmt(min(r.rows, ["fill"]))} | ${fmt(min(r.rows, ["tint"]))} | ${fmt(min(r.rows, ["glyph"]))} | ${r.ok ? "yes" : "**no**"} | ${adjusted} |`)
}
for (const r of results) {
  const label = THEMES.find((theme) => theme.id === r.id).name
  md.push("")
  md.push(`## ${label} (\`${r.id}\`)`)
  md.push("")
  md.push(`| Text token | ${SURFACES.map((s) => kebab(s)).join(" | ")} |`)
  md.push(`|---|${SURFACES.map(() => "---").join("|")}|`)
  for (const token of TEXT) {
    const cells = SURFACES.map((surface) => fmt(r.rows.find((row) => row.kind === "text" && row.token === token && row.surface === surface).value))
    md.push(`| \`--${kebab(token)}\` | ${cells.join(" | ")} |`)
  }
  md.push("")
  md.push(`Fill text: ${r.rows.filter((row) => row.kind === "fill").map((row) => `\`--${kebab(row.token)}\` on \`--${kebab(row.surface)}\` ${fmt(row.value)}`).join("; ")}.`)
  md.push("")
  const tints = r.rows.filter((row) => row.kind === "tint")
  md.push(`Tint text (minimum per tone): ${[...TINT.tones, "destructiveForeground"].map((tone) => `\`--${kebab(tone)}\` ${fmt(Math.min(...tints.filter((row) => row.token === tone).map((row) => row.value)))}`).join("; ")}.`)
  md.push("")
  md.push(`UI glyphs: ${r.rows.filter((row) => row.kind === "glyph").map((row) => `\`--${kebab(row.token)}\` on \`--${kebab(row.surface)}\` ${fmt(row.value)}`).join("; ")}.`)
  if (r.changed.length > 0) {
    md.push("")
    md.push(`Adjusted: ${r.changed.map((key) => `\`--${kebab(key)}\` ${css(r.original[key])} → ${css(r.tokens[key])}`).join("; ")}.`)
  }
}
writeFileSync(join(ROOT, "design/themes-contrast.md"), `${md.join("\n")}\n`)

const failures = results.filter((r) => !r.ok)
for (const r of results) console.log(`${r.id.padEnd(18)} text ${fmt(min(r.rows, ["text", "fill", "tint"]))}  glyph ${fmt(min(r.rows, ["glyph"]))}  ${r.ok ? "ok" : "FAIL"}  adjusted: ${r.changed.length}`)
if (failures.length > 0) {
  console.error(`Contrast floor missed: ${failures.map((r) => r.id).join(", ")}`)
  process.exit(1)
}
