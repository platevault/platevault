// Stylelint is adopted for exactly ONE invariant: every `var(--pv-*)` must
// resolve to a token that actually exists. Deliberately no style preset — the
// repo is biome-first and this is not a second opinion on formatting.
//
// Why a CSS parser rather than a grep: 3,000+ `var()` references live in CSS,
// and the rule has to understand same-file scoping (component-local custom
// properties are legitimately declared next to their use), fallback syntax
// (`var(--x, 8px)`), and comments. A regex gets all three wrong.
//
// referenceFiles are the GENERATED token artifacts, so the set of valid tokens
// is whatever the design-token pipeline actually emitted — there is no second
// hand-maintained list to drift.
export default {
  // TOP-LEVEL option, not a secondary option on the rule — globs here are
  // absolutized relative to this config file, which is what makes it work from
  // any cwd. Nesting it under the rule silently does nothing: the rule then
  // knows only same-file properties and reports every token as unknown.
  referenceFiles: ['src/styles/tokens.css', '../../packages/tokens/tokens-docs.css'],
  rules: {
    'no-unknown-custom-properties': true,
  },
  ignoreFiles: ['dist/**', 'node_modules/**', '.ds-css/**'],
};
