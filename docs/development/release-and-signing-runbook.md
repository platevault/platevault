# Release & signing runbook

How PlateVault (repo `nightwatch-astro/alm`) cuts a signed, auto-updatable
desktop release. Written 2026-07-09 when the pipeline was brought fully online
and the version baseline was reset from 1.0.0 back to 0.x.

## The short version

1. Land Conventional-Commit `feat:` / `fix:` commits on `main`.
2. `release-please` keeps an open **release PR** (`chore: release main`) with the
   next version + changelog. Review it; **merge it** (squash).
3. Merging tags `vX.Y.Z`, publishes the GitHub Release, and the `build` job in
   `.github/workflows/release-please.yml` builds + **signs** the bundles on all
   three OS and uploads them plus `latest.json`.
4. `tauri-plugin-updater` clients poll
   `https://github.com/nightwatch-astro/alm/releases/latest/download/latest.json`
   and verify each bundle's `.sig` against the pubkey embedded in
   `apps/desktop/src-tauri/tauri.conf.json`.

Never hand-cut a tag or `gh release create` — that desyncs release-please. See
the `release-please` skill.

## Authentication — the `nightwatch-astro-ci` GitHub App (not a PAT)

release-please authenticates with a **GitHub App installation token**, minted in
the workflow from the org-wide (visibility=all) credentials
`RELEASE_APP_CLIENT_ID` (Actions variable) / `RELEASE_APP_PRIVATE_KEY` (Actions
secret) (app slug `nightwatch-astro-ci`, permissions `contents: write` +
`pull_requests: write`):

```yaml
- uses: actions/create-github-app-token@v1
  id: app-token
  with:
    app-id: ${{ vars.RELEASE_APP_CLIENT_ID }}
    private-key: ${{ secrets.RELEASE_APP_PRIVATE_KEY }}
- uses: googleapis/release-please-action@v5
  with:
    token: ${{ steps.app-token.outputs.token }}
```

Why not the alternatives:

- **`GITHUB_TOKEN` (default):** its tags/releases do **not** trigger downstream
  workflows, and its bot-authored PR has its checks held as `action_required`
  (they never run, so the Release Gate can't go green). This is why the very
  first v1.0.0 cut had no gate verdict.
- **Personal PAT:** a personal token can't act on org resources without org
  approval, and this org rejects fine-grained PATs whose lifetime exceeds 366
  days (`the 'nightwatch-astro' organization forbids access via a fine-grained
  personal access token if the token's lifetime is greater than 366 days`). A
  PAT is also a human's credential with its own expiry to babysit.
- **App token:** org-scoped, short-lived, self-minted each run, needs no
  approval, and its tags **do** trigger downstream workflows (Release Gate on
  `push: tags`) and its PR checks run normally. Requires the app installed on
  the repo and the two org secrets visible to it.

A stale `RELEASE_TOKEN` secret may still exist from the PAT phase; it is unused
and can be deleted.

## Signing — minisign updater keys

- Keypair lives in 1Password item **"minisign key platevault"** (Personal
  vault): the tauri-format base64 secret key (field `key`) + its password.
- The **public** key is at `~/.tauri/platevault_updater.key.pub` and is embedded
  verbatim in `apps/desktop/src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
  (key ID `C332EF435C16EA58`).
- CI signs with the repo secrets `TAURI_SIGNING_PRIVATE_KEY` +
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (must match the 1Password pair).
- **`bundle.createUpdaterArtifacts: true` is REQUIRED** in `tauri.conf.json`.
  Tauri v2 only emits the updater bundles + `.sig` signatures (and lets
  `tauri-action` build `latest.json`) when this is set. Without it a release
  ships installers but **no `.sig` and no `latest.json`** — a silently broken
  updater — even with valid signing secrets and a correct pubkey. This (not the
  empty secrets) is why v1.0.0 and v0.1.0 had no updater; fixed for v0.1.1+.
  Independent of Tauri version (the repo tracks the latest v2 line, 2.11.x).

### Set / rotate the signing secrets

```bash
# private key — STRIP whitespace: op.exe on WSL injects a stray byte mid-base64
op.exe item get "minisign key platevault" --fields <key-field-id> --reveal \
  | tr -d '[:space:]' | gh secret set TAURI_SIGNING_PRIVATE_KEY -R nightwatch-astro/alm
# password — do NOT strip
op.exe item get "minisign key platevault" --fields label=password --reveal \
  | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R nightwatch-astro/alm
```

### Verify a keypair without shipping a broken updater

Sign a throwaway file with the private key, verify against the pubkey:

```bash
printf 'check\n' > /tmp/m.txt
pnpm --dir apps/desktop tauri signer sign -f <clean-key-file> -p "$PW" /tmp/m.txt
base64 -d < ~/.tauri/platevault_updater.key.pub > /tmp/pub
base64 -d < /tmp/m.txt.sig > /tmp/m.minisig
rsign verify -p /tmp/pub -x /tmp/m.minisig /tmp/m.txt   # "Signature ... verified"
```

If they don't pair, CI ships `.sig` files the embedded pubkey can't verify — a
silently-broken updater. Always verify before the first signed release after a
key change.

## OS code signing — not yet in place

Today only the minisign updater signing above exists. There is **no Windows
Authenticode signing and no macOS notarization** — released bundles trigger
SmartScreen ("unrecognized publisher") on Windows and a Gatekeeper
"unidentified developer" refusal on macOS. This is expected until an OS-level
signing certificate is wired into the release workflow.

Disabled SignPath-style infrastructure for Windows signing is being added on a
separate branch, `ci/windows-oss-signing`; it is not wired into
`release-please.yml` yet. Do not assume Windows builds are Authenticode-signed
until that lands and this section is updated.

## Versioning — pre-1.0 (0.x) policy

The app is under active development and may break things, so it stays **sub-1.0**.
`release-please-config.json` has `bump-minor-pre-major: true`, which keeps
breaking changes inside 0.x:

| commit | bump (pre-1.0) |
|--------|----------------|
| `fix:` | patch — `0.1.0 → 0.1.1` |
| `feat:` | minor — `0.1.0 → 0.2.0` |
| `feat!:` / `BREAKING CHANGE:` | minor — `0.1.0 → 0.2.0` (**not** 1.0.0) |

Go to 1.0.0 only deliberately, via a `Release-As: 1.0.0` footer when the API is
stable.

## Recovery — resetting the version baseline

Done 2026-07-09 to drop a premature 1.0.0. To move the baseline (e.g. back to
0.x):

1. Delete the unwanted release + tag: `gh release delete vX.Y.Z --yes --cleanup-tag`.
2. Close any open release PR and delete its `release-please--branches--*` branch
   (release-please reuses an open branch and won't re-run the version-file
   updaters against corrected config).
3. Lower `.release-please-manifest.json` `"."` and the synced version files
   (`tauri.conf.json`, `package.json`, `Cargo.toml`) to a value **below** the
   target (e.g. `0.0.0`).
4. Add `"last-release-sha": "<full-sha-of-old-release-commit>"` to
   `release-please-config.json` to bound the next changelog to commits since
   then (avoids a full-history dump).
5. Commit with a `Release-As: <target>` footer to force the next version.
6. Push; release-please opens a fresh release PR at the target version.

Everything above was exercised in this repo's history — `git log` around
2026-07-09 shows the concrete commits.
