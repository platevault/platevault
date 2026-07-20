# Generated brand collateral

Both files here are generated, not hand-edited — sources live in
`../../src-tauri/icons/src/` (marks) and `@fontsource/space-grotesk` (wordmark
glyphs, outlined so there's no font dependency at the point of use).

- `og-image.png` — 1200x630 Open Graph / Twitter share image, referenced by
  `index.html`'s `og:image` meta tag. Regenerate: `pnpm og:generate` (or
  `node scripts/generate-og-image.mjs`).
- `lockup.svg` — horizontal mark + "PlateVault" wordmark lockup. Not wired
  into any in-app UI surface — it exists for marketing/docs use (README,
  release notes, a future hosted page) so those contexts have one canonical
  asset instead of hand-assembling the mark and wordmark separately.
  Regenerate: `pnpm lockup:generate` (or `node scripts/generate-lockup.mjs`).
  Colors are baked to the brand's dark-background palette (frame `#f4efe6`,
  accent `#e0913f`) — like the rest of this repo's generated marks, it reads
  correctly on dark/warm surfaces, not on plain white.

Both scripts print the output's sha256 digest on every run so drift is
detectable in review, matching `../../src-tauri/icons/src/README.md`'s
convention.
