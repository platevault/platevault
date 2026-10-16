# Code signing (Windows Authenticode + macOS Developer ID) — research and infrastructure

PlateVault's Windows and macOS release artifacts are unsigned by their
platform's native code-signing mechanism. Both already carry a minisign
signature consumed by the in-app updater (`crates/desktop/services/src/update`)
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
| Certum Open Source Code Signing | 29 USD for an activation code on your own cryptoCertum card and reader ([Certum, read 2026-10-16](https://certum.store/open-source-code-signing-code.html)), or 58 USD in the SimplySign cloud, up to 5,000 signatures a month ([Certum, read 2026-10-16](https://certum.store/open-source-code-signing-on-simplysign.html)) | Rejected — not free. The paid fallback if SignPath Foundation declines |
| Sigstore (Fulcio/Rekor/cosign) | Free | Rejected — does not produce Windows-SmartScreen-trusted Authenticode signatures for `.exe`/`.msi` |
| OSSign | Free for qualifying OSS (newer entrant) | Not evaluated in depth; SignPath has a longer track record and an existing Tauri-adjacent GitHub Action — kept as a fallback note only |

Sources: [SignPath Foundation](https://signpath.org/), [SignPath Foundation terms](https://signpath.org/terms.html), [Azure Artifact Signing pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/), [Trusted Signing individual developer access (Microsoft Community Hub)](https://techcommunity.microsoft.com/blog/microsoft-security-blog/trusted-signing-is-now-open-for-individual-developers-to-sign-up-in-public-previ/4273554), [Certum Open Source Code Signing](https://certum.store/open-source-code-signing-code.html) and [in the cloud](https://certum.store/open-source-code-signing-on-simplysign.html), [comparecheapssl.com 2026 comparison](https://comparecheapssl.com/free-code-signing-certificate-and-how-to-get-it/).

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
7. Reputable, for an executable program: "we require a certain verifiable
   reputation" (terms, *Common misunderstandings*).

**Verdict: not yet.** PlateVault meets conditions 1–6, but probably not
condition 7 today. On 2026-10-16 the repository had no stars and one fork,
five months after it was created, and the research of 2026-10-13 found no
outside references to it. In June 2026 SignPath declined a comparable project
for this reason and invited it to apply again later. The rejection, as that
project reported it, names what SignPath looks at: stars, forks and
contributors, independent discussions, articles, and sustained activity
([Arsarneq/docent#72](https://github.com/Arsarneq/docent/issues/72)).

On 2026-10-13 the owner chose to prepare now and apply later (decision D1,
recorded in `astro-plan-eub2i`): the code signing policy, the privacy
statement and the signing pipeline below are prepared now, and the owner
applies once the project has outside references. The project-page conditions
SignPath also sets, such as the code signing policy, team roles, MFA and
privacy, are tracked under
[Code signing policy → Open conditions](../release/code-signing-policy.md#open-conditions).

The certificate is issued to SignPath Foundation itself (Sectigo-issued OV
cert), so the Authenticode publisher name shown to users will read "SignPath
Foundation," not "PlateVault" or the maintainer's name — this is a
program-wide constraint, not something specific to this repo.

## How SignPath integrates with GitHub Actions / Tauri

Tauri v2 can sign during the build: the bundler runs
`bundle.windows.signCommand` from `tauri.conf.json` on each file it signs and
waits for it (see the [Tauri Windows signing docs](https://v2.tauri.app/distribute/sign/windows/)).
SignPath Foundation's plan cannot serve such a command. Every signing request
must carry a GitHub artifact that the workflow uploaded, and an approver must
approve it, and the plan offers no hash-based signing a local command could
call ([SignPath's GitHub connector](https://docs.signpath.io/trusted-build-systems/github)).
Signing the finished installers after the build is the pattern SignPath
documents and adopters use (e.g. [DB Browser for SQLite's writeup](https://sqlitebrowser.org/blog/signing-windows-executables-our-journey-with-signpath/),
[AMD gaia's SignPath wiring](https://github.com/amd/gaia/issues/732)). It
leaves the app inside them unsigned, though: signing an NSIS `setup.exe` does
not sign the files packed in it. Smart App Control and a Microsoft Store
listing check the installed executables too. So the workflow splits the
Windows build around two signing requests, the executables and then the
installers, as [Astera](https://github.com/parsingk/Astera/blob/main/docs/code-signing.md)
does.

Flow, once enabled (`.github/workflows/release-please.yml`, the Windows leg of
the `build` job):

1. `tauri build --no-bundle` compiles the app and packs no installer.
2. The leg prepares the first request: `nsis/desktop_shell.exe` and
   `msi/desktop_shell.exe`, each stamped for its installer, and the package's
   other executables at the root, today `platevault-library.exe`. The
   installers ship every bin target of the `desktop_shell` package. The
   bundler would stamp the app itself while it packs each installer: the
   first `__TAURI_BUNDLE_TYPE_VAR_UNK` in the binary becomes
   `__TAURI_BUNDLE_TYPE_VAR_NSS` or `__TAURI_BUNDLE_TYPE_VAR_MSI`. The app
   reads that stamp to choose its update package
   (`apps/desktop/src-tauri/src/updater.rs`), and the bundler's write would
   break a signature made before it. So the leg stamps both copies the same
   way first. It refuses a binary that holds the marker other than exactly
   once.
3. It uploads them as the `windows-app-for-signing` artifact and submits
   request 1 with the app artifact configuration through
   [`signpath/github-action-submit-signing-request`](https://github.com/signpath/github-action-submit-signing-request).
4. It checks that every file came back validly signed and puts the signed
   copies in the cargo target directory. It then runs `tauri bundle` twice,
   `--bundles nsis` around the NSIS copy and `--bundles msi` around the MSI
   copy. `--no-binary-patching` keeps the bundler from stamping the app again,
   and `--no-sign` keeps it from writing updater signatures that request 2
   would make stale.
5. It uploads `setup.exe` and the `.msi` as `windows-installers-for-signing`
   and submits request 2 with the installer artifact configuration.
6. It checks that both installers are validly signed, unpacks them (7-Zip for
   the NSIS installer, `msiexec /a` for the MSI), and fails unless each one
   carries the signed executables byte for byte.
7. It signs each installer with minisign (`tauri signer sign --app-version`,
   the bundler's key), attests the signed installers, and uploads them and
   their `.sig` files to the GitHub Release.
8. The `updater-manifest` job publishes `latest.json` (see below).

Each request waits up to an hour for its approval
(`wait-for-completion-timeout-in-seconds: 3600`; the action's default, 600 s,
gave the approver ten minutes), so a release needs two approvals, each within
an hour. Both submit steps pin the action's v2.3.0 by commit SHA.

Every one of these steps is gated on `vars.ENABLE_WINDOWS_SIGNING == 'true'`.
That repo Actions variable is **unset today**, so they are all skipped, and
the Windows leg builds, attests and uploads through `tauri-action` like the
other legs.

## Interaction with the minisign updater signature

The two signatures do different jobs, but on Windows they cover the **same
file**, so the order matters:

- **minisign** (`TAURI_SIGNING_PRIVATE_KEY`) signs the updater payload that
  the in-app updater verifies against the embedded public key in
  `tauri.conf.json`, gating in-app auto-update installs. Already active.
- **Authenticode** (SignPath) signs the `.exe`/`.msi` binary itself so Windows
  SmartScreen and the OS installer UI show a trusted publisher instead of
  "Unknown Publisher." This is what this doc adds, disabled.

The NSIS `setup.exe` and the `.msi` *are* the Windows updater payloads (Tauri
v2 `createUpdaterArtifacts: true` signs the installers directly). Authenticode
embeds its signature in the file, so a minisign signature made before it no
longer matches what clients download, and the updater would reject every
Windows update. So the minisign signature must be made **after** Authenticode.
The Windows leg does that in step 7 above, after both signing requests, and
`updater-manifest` checks it.

## Updater manifest (`latest.json`)

Installed copies poll
`https://github.com/platevault/platevault/releases/latest/download/latest.json`.
The `updater-manifest` job writes that file once per release, after every
`build` leg has succeeded, the Windows signing steps included when they are
on. It runs `scripts/assemble-updater-manifest.mjs`, which publishes nothing
unless:

- every updater bundle in its `UPDATER_BUNDLES` table (macOS `.app.tar.gz`,
  Linux AppImage/deb/rpm, Windows NSIS/MSI) is on the release with its `.sig`;
- every `.sig` on the release belongs to a row in that table, so a new matrix
  leg cannot be silently left out;
- every signature verifies against the bytes on the release, using the public
  key in `apps/desktop/src-tauri/tauri.conf.json`;
- every signature's trusted comment records the version it was made for (the
  `version:` field that `tauri build` and `tauri signer sign --app-version`
  write from Tauri CLI 2.12 on), and that version is the manifest's
  `version`, ignoring a leading `v`.

Together these are the checks the in-app updater runs before it installs an
update (`crates/desktop/services/src/update/signature.rs`). `latest.json` is
not signed, so the signed version is the only thing that ties the version it
announces to the payload. The in-app updater therefore refuses a signature
without one: an older release's signature could otherwise be announced as a
newer release and installed as a rollback. The releases up to v0.6.1 were
built with Tauri CLI 2.11 and carry no field, but the in-app updater is only
ever offered releases newer than itself. tauri-plugin-updater 2.13 in 0.6.x
installs runs the same checks with `requireSignedVersion` off, so it also
accepts a signature without the field. The in-app updater accepts prehashed
`ED` signatures only, which `tauri build` writes, so the gate rejects the
legacy `Ed` form.

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

1. Once the project has outside references (see the verdict above), apply at
   <https://signpath.org/apply> with the repo URL
   (`https://github.com/platevault/platevault`) and confirm AGPL-3.0-only
   licensing.
2. Once approved, create in the SignPath dashboard: an organization, a
   project, a release-signing policy, and two artifact configurations. Note
   the slugs. GitHub artifacts are ZIP files, so both configurations start at
   `<zip-file>`, and `*` in a path does not match `/`
   ([syntax](https://docs.signpath.io/artifact-configuration/syntax)).
   - The app configuration, for request 1. The two stamped copies of the app
     sit in `nsis/` and `msi/`, and the other executables at the root:

     ```xml
     <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
       <zip-file>
         <pe-file path="nsis/desktop_shell.exe"><authenticode-sign/></pe-file>
         <pe-file path="msi/desktop_shell.exe"><authenticode-sign/></pe-file>
         <pe-file path="*.exe" min-matches="0" max-matches="unbounded"><authenticode-sign/></pe-file>
       </zip-file>
     </artifact-configuration>
     ```

   - The installer configuration, for request 2:

     ```xml
     <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
       <zip-file>
         <pe-file path="PlateVault_*_x64-setup.exe"><authenticode-sign/></pe-file>
         <msi-file path="PlateVault_*_x64_en-US.msi"><authenticode-sign/></msi-file>
       </zip-file>
     </artifact-configuration>
     ```

   SignPath Foundation adds its own metadata restrictions to these, such as
   the product name and version.
3. Set repo secrets/variables (names only — no values invented here):
   - Secret `SIGNPATH_API_TOKEN`
   - Actions variable `SIGNPATH_ORGANIZATION_ID`
   - Actions variable `SIGNPATH_PROJECT_SLUG`
   - Actions variable `SIGNPATH_SIGNING_POLICY_SLUG`
   - Actions variable `SIGNPATH_APP_ARTIFACT_CONFIGURATION_SLUG`
   - Actions variable `SIGNPATH_INSTALLER_ARTIFACT_CONFIGURATION_SLUG`
4. Check the action version. The submit steps pin
   `signpath/github-action-submit-signing-request` v2.3.0, the newest release
   in [SignPath's changelog](https://docs.signpath.io/changelog) on
   2026-10-16. SignPath's GitHub connector page already shows `@v3`, which
   changes the default connector URL, but v3 had no release or changelog entry
   yet. If v3 has been released by then, move both steps to it, pinned by
   commit SHA.
5. Flip it on: set the Actions variable `ENABLE_WINDOWS_SIGNING` to `true`.
6. Verify on the next tagged release:
   - Approve both signing requests in SignPath, each within the hour.
   - The Windows leg's **Check the signed installers** step passes. It needs
     signatures Windows trusts, so a test-signing certificate fails it.
   - `updater-manifest` publishes `latest.json`. It only does so when the
     minisign signatures verify against the signed installers.
   - On a Windows machine, `Get-AuthenticodeSignature` reports `Valid`, signed
     by SignPath Foundation, for the release's `setup.exe` and `.msi`. After
     you install each one, it reports the same for the installed
     `desktop_shell.exe` and `platevault-library.exe`: under
     `%LOCALAPPDATA%\PlateVault` for the NSIS installer and
     `C:\Program Files\PlateVault` for the MSI.

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
