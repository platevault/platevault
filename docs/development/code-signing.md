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
   publishes the unsigned release. This step is itself gated on
   `vars.ENABLE_WINDOWS_SIGNING == 'true'`, so with the variable unset it is
   skipped and today's release output is unchanged.
2. `sign-windows` job downloads that artifact, re-uploads it under a fresh
   artifact ID (SignPath's action needs a `github-artifact-id` from an
   `upload-artifact` step in the *same* job), then submits it via
   [`signpath/github-action-submit-signing-request`](https://github.com/signpath/github-action-submit-signing-request).
3. The signed artifact is downloaded back and re-uploaded to the same GitHub
   Release with `gh release upload --clobber`, replacing the unsigned copies
   `tauri-action` already published.

This job is entirely gated on `vars.ENABLE_WINDOWS_SIGNING == 'true'`. That
repo Actions variable is **unset today**, so `sign-windows` — and the
artifact-collection step it depends on — never runs, and the `build` job's
behavior is unchanged.

## Interaction with the minisign updater signature

Both signatures coexist and serve different purposes — enabling one does not
touch the other:

- **minisign** (`TAURI_SIGNING_PRIVATE_KEY`) signs the updater payload that
  `tauri-plugin-updater` verifies against the embedded public key in
  `tauri.conf.json`, gating in-app auto-update installs. Already active.
- **Authenticode** (SignPath) signs the `.exe`/`.msi` binary itself so Windows
  SmartScreen and the OS installer UI show a trusted publisher instead of
  "Unknown Publisher." This is what this doc adds, disabled.

## Application checklist (user action required)

1. Apply at <https://signpath.org/apply> with the repo URL
   (`https://github.com/nightwatch-astro/alm`) and confirm AGPL-3.0-only
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
   `build`, and the release's `.exe`/`.msi` assets should carry a valid
   Authenticode signature (`signtool verify /pa`) from SignPath Foundation.

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
  developer" on first open. The documented bypass: right-click (or
  Control-click) the app in Finder → Open → confirm in the dialog that
  appears, which whitelists that specific app going forward; equivalently,
  clear the quarantine attribute directly with
  `xattr -d com.apple.quarantine /Applications/PlateVault.app`. Subsequent
  launches are unaffected.

### Recommended path: Apple Developer account as a fast-follow

Once a maintainer enrolls in the $99/yr Apple Developer Program, wiring up
signing follows the same disabled-by-default pattern as Windows above rather
than a new mechanism:

- **Tauri config point**: `bundle.macOS.signingIdentity` in
  `apps/desktop/src-tauri/tauri.conf.json` (or the `APPLE_SIGNING_IDENTITY`
  env var, which overrides it — used here to avoid a config change gated
  only by env var presence).
- **CI env vars**, added to the macOS leg of the `build` job's
  `tauri-apps/tauri-action` step in `.github/workflows/release-please.yml`,
  each gated behind `vars.ENABLE_MACOS_SIGNING == 'true'` (empty string when
  the var is unset — `tauri-action` treats an empty value as not set, so this
  is provably inert today, the same guarantee as the Windows job):
  - Secret `APPLE_CERTIFICATE` (base64 `.p12`)
  - Secret `APPLE_CERTIFICATE_PASSWORD`
  - Actions variable `APPLE_SIGNING_IDENTITY`
  - Secret `APPLE_ID` + Secret `APPLE_PASSWORD` (app-specific password) for
    notarization, or the `APPLE_API_KEY`/`APPLE_API_ISSUER` App Store Connect
    API key alternative
  - Actions variable `APPLE_TEAM_ID`

  Source: [Tauri v2 macOS code signing](https://v2.tauri.app/distribute/sign/macos/),
  [Tauri v2 environment variables reference](https://v2.tauri.app/reference/environment-variables/).

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
