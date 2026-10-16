// Stylelint is adopted for ONE invariant: every `var(--pv-*)` in CSS resolves
// to a token that actually exists. No style preset — the repo is biome-first and
// this is not a second opinion on formatting.
//
// A CSS parser rather than a grep: 3,000+ `var()` references live in CSS, and
// the rule has to understand same-file scoping (component-local custom
// properties are legitimately declared next to their use), fallback syntax
// (`var(--x, 8px)`), and comments.
//
// A reference carrying a resolvable fallback is accepted by the rule even when
// the property is undefined. Component parameters therefore get an @property
// registration (tokens/properties.json) instead of an inline fallback, which is
// what makes them visible here.
export default {
  // TOP-LEVEL option, not a secondary option on the rule — globs here are
  // absolutized relative to this config file, which is what makes it work from
  // any cwd. Nesting it under the rule silently does nothing: the rule then
  // knows only same-file properties and reports every token as unknown.
  //
  // These are the GENERATED token artifacts, so the valid set is whatever the
  // design-token pipeline emitted; there is no second list to drift.
  referenceFiles: ['src/styles/tokens.css', '../../packages/tokens/tokens-docs.css'],
  rules: {
    'no-unknown-custom-properties': true,
    // Hand-written CSS takes colour from tokens only (#1334): a raw literal
    // bypasses theming and the contrast checks run on the token set.
    'color-no-hex': true,
    // Regex with /i: CSS function names are case-insensitive, so RGB() is rgb().
    'function-disallowed-list': ['/^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)$/i'],
    // Named colours (`red`, `black`) are raw literals too. The rule leaves
    // transparent, currentColor and the CSS-wide keywords alone.
    'color-named': 'never',
    // CSS system colours (Canvas, CanvasText, Highlight and the rest, deprecated
    // ones included) are raw colours too, and color-named does not know them.
    'declaration-property-value-disallowed-list': {
      '/^(color|background(-color|-image)?|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|border-image(-source)?|outline(-color)?|box-shadow|text-shadow|text-decoration(-color)?|text-emphasis(-color)?|caret-color|accent-color|column-rule(-color)?|fill|stroke|stop-color|flood-color|lighting-color|scrollbar-color|filter|backdrop-filter|mask(-image|-border(-source)?)?|list-style(-image)?|shape-outside|-webkit-text-fill-color|-webkit-text-stroke(-color)?|-webkit-tap-highlight-color|--.+)$/i': ['/(^|[\\s,(])(accentcolor|accentcolortext|activetext|buttonborder|buttonface|buttontext|canvas|canvastext|field|fieldtext|graytext|highlight|highlighttext|linktext|mark|marktext|selecteditem|selecteditemtext|visitedtext|activeborder|activecaption|appworkspace|background|buttonhighlight|buttonshadow|captiontext|inactiveborder|inactivecaption|inactivecaptiontext|infobackground|infotext|menu|menutext|scrollbar|threeddarkshadow|threedface|threedhighlight|threedlightshadow|threedshadow|window|windowframe|windowtext)(?=$|[\\s,);!])/i'],
    },
  },
  ignoreFiles: ['dist/**', 'node_modules/**', '.ds-css/**'],
  overrides: [
    {
      // The generated token stylesheet is where raw colour values live.
      files: ['src/styles/tokens.css'],
      rules: {
        'color-no-hex': null,
        'function-disallowed-list': null,
        'color-named': null,
        'declaration-property-value-disallowed-list': null,
      },
    },
  ],
};
