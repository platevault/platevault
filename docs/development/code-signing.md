# Code signing (Windows Authenticode + macOS Developer ID) — research and infrastructure

PlateVault's Windows and macOS release artifacts are unsigned by their
platform's native code-signing mechanism. Both already carry a minisign
signature consumed by `tauri-plugin-updater`
(`TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]`), but that signature is invisible to
the OS itself — Windows SmartScreen/UAC and macOS Gatekeeper still flag the
app as untrusted because there is no Authenticode or Developer ID signature.
This doc covers both platforms: Windows has a free path (SignPath Foundation)
with disabled-but-ready CI infrastructure below; macOS has no free path (see
the dedicated section near the end) and is a fast-follow once a maintainer
holds a paid Apple Developer account.

## Windows: provider comparison

| Provider | Cost | Fit for this repo |
|---|---|---|
| **SignPath Foundation** | Free for qualifying OSS | **Chosen.** See eligibility below. |
| Azure Trusted Signing / Artifact Signing | $9.99/mo (5,000 sigs), no free/OSS tier; Public Trust certs restricted to individuals in US/Canada only as of 2026 | Rejected — not free, and the maintainer isn't in an eligible individual-signing country for Public Trust |
| Certum Open Source Code Signing | ~€14, no longer free (discontinued the free tier some years ago) | Rejected — not free |
| Sigstore (Fulcio/Rekor/cosign) | Free | Rejected — does not produce Windows-SmartScreen-trusted Authenticode signatures for `.exe`/`.msi` |
| OSSign | Free for qualifying OSS (newer entrant) | Not evaluated in depth; SignPath has a longer track record and an existing Tauri-adjacent GitHub Action — kept as a fallback note only |

Sources: [SignPath Foundation](https://signpath.org/), [SignPath Foundation terms](https://signpath.org/terms.html), [Azure Artifact Signing pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/), [Trusted Signing individual developer access (Microsoft Community Hub)](https://techcommunity.microsoft.com/blog/microsoft-security-blog/trusted-signing-is-now-open-for-individual-developers-to-sign-up-in-public-previ/4273554), [Certum Open Source Code Signing](https://certum.store/open-source-code-signing-code.html), [comparecheapssl.com 2026 comparison](https://comparecheapssl.com/free-code-signing-certificate-and-how-to-get-it/).

## SignPath Foundation eligibility for this repo

Per the [official terms](https://signpath.org/terms.html), a project must be:

1. Free of malware/PUPs.
2. Licensed under an OSI-approved OSS license, no proprietary dual-licensing.
   **AGPL-3.0-only, this repo's license, is OSI-approved — qualifies.**
3. Free of proprietary/non-OSS components (system libraries excepted).
4. Actively maintained.
5. Already released in the form to be signed — release-please already tags
   and publishes GitHub Releases with Windows bundles, so this condition is
   met once the first tagged release exists.
6. Documented (functionality described on the release/download page).

**Verdict: eligible.** No blockers identified. The certificate is issued to
SignPath Foundation itself (Sectigo-issued OV cert), so the Authenticode
publisher name shown to users will read "SignPath Foundation," not
"PlateVault" or the maintainer's name — this is a program-wide constraint, not
something specific to this repo.

## How SignPath integrates with GitHub Actions / Tauri

Tauri v2's own signing mechanism (`bundle.windows.signCommand` in
`tauri.conf.json`, see the [Tauri Windows signing docs](https://v2.tauri.app/distribute/sign/windows/))
expects a local `signtool`-style command run during the Windows build, and
explicitly requires a custom command when cross-compiling from Linux/macOS.
That path is a plausible future option, but the pattern this doc wires up
instead is **post-build signing of the already-built `tauri-action` output**,
because:

- It doesn't require changing `tauri.conf.json` or touching the Windows build
  step at all (constitution/task constraint: don't modify build-affecting
  config in this PR).
- It matches the pattern SignPath documents and the pattern real adopters use
  (e.g. [DB Browser for SQLite's writeup](https://sqlitebrowser.org/blog/signing-windows-executables-our-journey-with-signpath/),
  [AMD gaia's SignPath wiring](https://github.com/amd/gaia/issues/732)).

Flow, once enabled (`.github/workflows/release-please.yml`):

1. `build` job (Windows leg only) uploads the unsigned `.exe`/`.msi` as a
   workflow artifact (`windows-unsigned-bundles`) after `tauri-action`
   uploads them to the release. The paths come from `tauri-action`'s
   `artifactPaths` output, because the bundles land in the workspace's cargo
   target directory (`target/release/bundle/`), not under
   `apps/desktop/src-tauri/`. This step is itself gated on
   `vars.ENABLE_WINDOWS_SIGNING == 'true'`, so with the variable unset it is
   skipped and today's release output is unchanged.
2. `sign-windows` job downloads that artifact and flattens it, so the `.exe`
   and `.msi` sit at the artifact root, which is the layout the SignPath
   artifact configuration must expect. It re-uploads the result under a fresh
   artifact ID (SignPath's action needs a `github-artifact-id` from an
   `upload-artifact` step in the *same* job), then submits it via
   [`signpath/github-action-submit-signing-request`](https://github.com/signpath/github-action-submit-signing-request).
3. The job signs each Authenticode-signed file again with minisign
   (`tauri signer sign`, same key), because Authenticode changed its bytes.
   It then uploads each bundle and its new `.sig` to the same GitHub Release
   with `gh release upload --clobber`, replacing the unsigned copies and their
   now-stale signatures.
4. `updater-manifest` job publishes `latest.json` (see below).

This job is entirely gated on `vars.ENABLE_WINDOWS_SIGNING == 'true'`. That
repo Actions variable is **unset today**, so `sign-windows` — and the
artifact-collection step it depends on — never runs, and the `build` job's
behavior is unchanged.

## Interaction with the minisign updater signature

The two signatures do different jobs, but on Windows they cover the **same
file**, so the order matters:

- **minisign** (`TAURI_SIGNING_PRIVATE_KEY`) signs the updater payload that
  `tauri-plugin-updater` verifies against the embedded public key in
  `tauri.conf.json`, gating in-app auto-update installs. Already active.
- **Authenticode** (SignPath) signs the `.exe`/`.msi` binary itself so Windows
  SmartScreen and the OS installer UI show a trusted publisher instead of
  "Unknown Publisher." This is what this doc adds, disabled.

The NSIS `setup.exe` and the `.msi` *are* the Windows updater payloads (Tauri
v2 `createUpdaterArtifacts: true` signs the installers directly). Authenticode
embeds its signature in the file, so a minisign signature made before it no
longer matches what clients download, and the updater would reject every
Windows update. So the minisign signature must be made **after** Authenticode.
`sign-windows` does that in step 3 above, and `updater-manifest` checks it.

## Updater manifest (`latest.json`)

Installed copies poll
`https://github.com/platevault/platevault/releases/latest/download/latest.json`.
The `updater-manifest` job writes that file once per release, after every
`build` leg and, when enabled, `sign-windows` have succeeded. It runs
`scripts/assemble-updater-manifest.mjs`, which publishes nothing unless:

- every updater bundle in its `UPDATER_BUNDLES` table (macOS `.app.tar.gz`,
  Linux AppImage/deb/rpm, Windows NSIS/MSI) is on the release with its `.sig`;
- every `.sig` on the release belongs to a row in that table, so a new matrix
  leg cannot be silently left out;
- every signature verifies against the bytes on the release, using the public
  key in `apps/desktop/src-tauri/tauri.conf.json`;
- every signature whose trusted comment records a version (Tauri CLI 2.12 and
  later write a `version:` field) was made for the manifest's `version`,
  ignoring a leading `v`. A signature without the field is accepted.

Together these are the checks tauri-plugin-updater 2.13 runs before it
installs an update with `requireSignedVersion` off, PlateVault's setting. A
signed version that differs from the manifest is rejected whatever that
setting says; it only decides whether a signature without one is rejected.

If any check fails, the run is red and the new release has no `latest.json`,
so clients' update checks fail until the failed jobs are re-run. Before this
gate, each `build` leg merged its own platform into `latest.json`. v0.6.0's
failed macOS leg then shipped a manifest with no `darwin-*` entry, and 0.5.0
Macs got `TargetsNotFound`. The cask bump (`homebrew-bump.yml`) only runs
after a fully successful release run, so it waits too.

Add a row to `UPDATER_BUNDLES` whenever the `build` matrix gains a platform.

The manifest's `version` always comes from `--tauri-conf`, the released
commit's config. The trusted key comes from the same file, except during a
minisign key rotation: the release that embeds a new key must still be signed
with the old one, because that is the key installed clients trust. For that
one release, pass the previous release's config as `--pubkey-conf`, e.g.
`git show v0.6.0:apps/desktop/src-tauri/tauri.conf.json > previous.json`.

## Application checklist (user action required)

1. Apply at <https://signpath.org/apply> with the repo URL
   (`https://github.com/platevault/platevault`) and confirm AGPL-3.0-only
   licensing.
2. Once approved, create in the SignPath dashboard: an organization, a
   project, a signing policy (test/release-signing), and an artifact
   configuration for the NSIS `.exe`/MSI outputs. Note the slugs.
3. Set repo secrets/variables (names only — no values invented here):
   - Secret `SIGNPATH_API_TOKEN`
   - Actions variable `SIGNPATH_ORGANIZATION_ID`
   - Actions variable `SIGNPATH_PROJECT_SLUG`
   - Actions variable `SIGNPATH_SIGNING_POLICY_SLUG`
   - Actions variable `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG`
4. Flip it on: set the Actions variable `ENABLE_WINDOWS_SIGNING` to `true`.
5. Verify on the next tagged release: the `sign-windows` job should run after
   `build`, the release's `.exe`/`.msi` assets should carry a valid
   Authenticode signature (`signtool verify /pa`) from SignPath Foundation,
   and `updater-manifest` should publish `latest.json`. It only does so when
   the re-made minisign signatures verify against those signed files.

## macOS signing (state and path)

Unlike Windows, **no free OSS code-signing path exists for macOS.** Apple does
not delegate Developer ID certificate issuance the way public CAs do for
Authenticode, so a SignPath-Foundation-style nonprofit intermediary is not
possible — there is no equivalent program to apply to.

- **Apple Developer Program ($99/yr) is the only route** to a Developer ID
  Application certificate and notarization. A free Apple ID can build and
  locally run an app, but cannot notarize, and Gatekeeper treats an
  unnotarized app as untrusted on any machine other than the one that built
  it.
- **Fee waivers exist but don't apply here**: Apple waives the $99 fee for
  nonprofit organizations, accredited educational institutions, and
  government entities — not for informal open-source projects run by an
  individual. This repo does not qualify. Source:
  [Apple Developer Program Fee Waivers](https://developer.apple.com/help/account/membership/fee-waivers/).

### Current state

- Tauri applies **ad-hoc signing** to the arm64 (Apple Silicon) build
  automatically — this is mandatory for the binary to execute at all on
  Apple Silicon, but it is not a Developer ID signature and does nothing for
  Gatekeeper/notarization trust.
- The **minisign updater chain already verifies updates** independent of
  Authenticode/Developer-ID status (same mechanism described above for
  Windows) — in-app auto-update integrity is not affected by the absence of
  macOS code signing.
- **Gatekeeper friction is first-install only.** A user who downloads the
  unsigned/unnotarized `.dmg`/`.app` sees "app is damaged" or "unidentified
  developer" on first open. Since macOS 15 Sequoia, Control-click (or
  right-click) › Open no longer bypasses this. Instead: try to open the app
  once, dismiss the warning, then open System Settings › Privacy & Security,
  click **Open Anyway** next to the message about PlateVault, and confirm.
  That approves that specific app going forward. Equivalently, clear the
  quarantine attribute directly with
  `xattr -d com.apple.quarantine /Applications/PlateVault.app`, which is also
  the remedy for "app is damaged". Subsequent launches are unaffected.

### Recommended path: Apple Developer account as a fast-follow

Once a maintainer enrolls in the $99/yr Apple Developer Program, wiring up
signing follows the same disabled-by-default pattern as Windows above rather
than a new mechanism:

- **Tauri config point**: `bundle.macOS.signingIdentity` in
  `apps/desktop/src-tauri/tauri.conf.json` (or the `APPLE_SIGNING_IDENTITY`
  env var, which overrides it — used here to avoid a config change gated
  only by env var presence).
- **CI env vars**, passed to the macOS leg of the `build` job only in the
  step env of its `Build, sign, and upload Tauri bundles (macOS code signing)`
  tauri-action step in `.github/workflows/release-please.yml`, so no later or
  post-job step sees them. That step runs only when
  `vars.ENABLE_MACOS_SIGNING == 'true'`, after a `Check macOS signing
  credentials` step that fails the leg if any value is empty; otherwise its
  twin without the `APPLE_*` env runs. The Tauri bundler treats an `APPLE_*`
  variable that is **set** as a request to sign, even when it is empty. The
  earlier wiring passed `APPLE_CERTIFICATE: ''` while signing was off, which
  made v0.6.0's macOS leg fail with "failed to import keychain certificate".
  With the variable unset, none of these are set, and the bundler ad-hoc
  signs as before:
  - Secret `APPLE_CERTIFICATE` (base64 `.p12`)
  - Secret `APPLE_CERTIFICATE_PASSWORD`
  - Actions variable `APPLE_SIGNING_IDENTITY`
  - Secret `APPLE_ID` + Secret `APPLE_PASSWORD` (app-specific password) for
    notarization. The App Store Connect API key alternative
    (`APPLE_API_KEY`/`APPLE_API_ISSUER`) would need that step extended.
  - Actions variable `APPLE_TEAM_ID`

  Source: [Tauri v2 macOS code signing](https://v2.tauri.app/distribute/sign/macos/),
  [Tauri v2 environment variables reference](https://v2.tauri.app/reference/environment-variables/).

### Self-signed identity (without Developer ID)

Until a Developer ID exists, release builds are signed with the stable
self-signed identity **PlateVault Self-Signed** instead of ad-hoc, once the
`MACOS_SELF_SIGNED_*` secrets are set. The ad-hoc notes under
[Current state](#current-state) apply to releases up to v0.6.1 and to builds
without those secrets. [macOS signing](../release/macos-signing.md) covers
the workflow steps, the first launch, the one-time re-grant of folder and
drive access, and rotation.

### Free distribution channel: Homebrew cask

Independent of Developer ID signing, a **Homebrew cask** is shipped as a free
distribution channel: [platevault/homebrew-tap](https://github.com/platevault/homebrew-tap)
(`brew tap platevault/tap && brew install --cask platevault`). It packages the
same unnotarized `.dmg` described above (Apple Silicon only, ad-hoc signed),
so the Gatekeeper caveat and `xattr -d com.apple.quarantine` workaround still
apply — the cask does not change the app's trust status, only the install
mechanics. Homebrew's `brew audit --cask`/`brew style` checks run in the tap
repo's CI and give a baseline packaging-quality signal independent of
notarization.

`.github/workflows/homebrew-bump.yml` in this repo bumps the cask's
`version`/`sha256` and opens a PR against the tap repo after each release
that publishes a macOS `.dmg`, using the same GitHub App identity as
`release-please.yml` (the app is installed org-wide, so no extra secret is
needed for the tap repo).
