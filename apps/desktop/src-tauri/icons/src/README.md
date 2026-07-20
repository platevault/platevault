# App icon source

`pv-mark.svg`, `pv-mark-favicon.svg`, `pv-mark-two-tone.svg` are copied
verbatim from the design handoff — never hand-edit; regenerate the
rasterized icons via the script below instead.

The generated outputs (`../32x32.png`, `../128x128.png`, `../128x128@2x.png`,
`../icon.png`, `../icon.ico`, `../icon.icns`) are byte-for-byte reproducible
from these sources — the generator prints their sha256 digests on every run
so drift is detectable in review. `icon.icns` (the macOS bundle icon,
required by `tauri.conf.json`'s `bundle.icon` since its `targets` include
macOS) is built from the same 1024px raster via `png2icons`.

`pv-mark-two-tone.svg` is also the source for the generated horizontal
lockup (mark + outlined "PlateVault" wordmark) — see
`../../../public/brand/README.md` for what it's for and how to regenerate
it.

## Regenerating

From `apps/desktop/`: `pnpm icons:generate` (or
`node scripts/generate-app-icons.mjs`).
