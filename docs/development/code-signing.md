# Windows code signing (Authenticode) — research and disabled infrastructure

PlateVault's Windows release artifacts (NSIS `.exe`, `.msi`) are unsigned. They
already carry a minisign signature consumed by `tauri-plugin-updater`
(`TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]`), but that signature is invisible to
Windows itself — SmartScreen and the installer UAC prompt still show "Unknown
Publisher" because there is no Authenticode signature. This doc records the
free/OSS option research and the (currently disabled) CI wiring to close that
gap.

## Provider comparison

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
   publishes the unsigned release — this step is unconditional and inert
   (an upload-artifact call) so it doesn't change today's release output.
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
