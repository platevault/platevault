# Frontend transition and recovery

## Temporary production frontend

The production rebuild lives in the frontend-only workspace `apps/desktop-ui`, package `@platevault/desktop-ui`. It keeps the approved v5 React, Tailwind v4, base-nova/Base UI, and DTCG stack separate from `apps/desktop`. The legacy app's Vite config, scripts, runtime default, and test gates stay unchanged. This is a temporary location, not a finished product shell.

At the `astro-plan-qnv6v` cutover, promote the replacement from `apps/desktop-ui/src` to `apps/desktop/src`. The cutover changes the default runtime, build, and validation selection. It also removes the temporary package. Until that change lands, legacy desktop commands and runtime remain unchanged. The initial `src/` entry exists only to compile and exercise the configuration; it is not an accepted product shell.

The bootstrap manifest owner maintains the `apps/desktop-ui` manifest and its root `pnpm-lock.yaml` importer. Request additional direct dependencies or version changes from that owner. Include the package, requested range, consumer, and reason. Feature workers do not edit the manifest or lockfile. The owner checks each request against existing workspace and prototype dependencies. The owner publishes any lockfile update the request needs.

The initial configuration and port anchor is prototype branch `ui-harness-v5` at commit `5dc24524434a6ce15ed8ebfd1422267a64f21311`.

The `census` script in `apps/desktop-ui/package.json` measures composition per route.

## Legacy recovery reference

The annotated tag `legacy-ui-before-rebuild` points to commit `3bb56c5909263920f840e8b48a4620c450f4265b`. The epic `astro-plan-ocyuc` records it as `legacy_ui_ref`. Use this tag to recover legacy source. It does not copy catalogue data.

The legacy app used a separate catalogue. Restoring its source does not revert catalogue decisions or restore files moved by new filesystem operations. The reference does not contain work that was uncommitted at the anchor. Preserve any such work separately before cutover. Use existing recovery journals or an explicit data-restore procedure for later catalogue or filesystem changes. Never let the legacy runtime open the rebuilt catalogue.
