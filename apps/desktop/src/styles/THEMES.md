# Adding a theme

A theme is **one `[data-theme="name"]` block that overrides only the ~30 raw
palette tokens** (ink1–4, rule/rule2, bg/surface/bg3/surface-raised, accent
set, status set, hover/selected, shadow-sm). Never redeclare semantic
aliases, the type scale, spacing, radius, or layout — those are
theme-invariant and resolve at use-site. Add the name to the theme registry
with `enabled: true`, grouped by family (warm/cool) and mode (light/dark).
CI enforces token completeness + AA contrast; a theme that fails either does
not ship.

See `apps/desktop/src/data/theme.ts` (`THEMES`, `ThemeMeta`) for the registry
and `apps/desktop/scripts/check-theme-completeness.mjs` /
`check-contrast.mjs` for the CI gates (run via `scripts/check-tokens.sh`,
checks 5/6).
