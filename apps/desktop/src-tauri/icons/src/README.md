# App icon source

`pv-mark.svg`, `pv-mark-favicon.svg`, `pv-mark-two-tone.svg` are copied
verbatim from the design handoff — never hand-edit; regenerate the
rasterized icons via the script below instead.

The generated outputs (`../32x32.png`, `../128x128.png`, `../128x128@2x.png`,
`../icon.png`, `../icon.ico`) are byte-for-byte reproducible from these
sources — the generator prints their sha256 digests on every run so drift is
detectable in review.

## Regenerating

From `apps/desktop/`: `pnpm icons:generate` (or
`node scripts/generate-app-icons.mjs`).
