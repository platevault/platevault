# Code signing policy

This is the code signing policy for PlateVault. It is written to meet the
[SignPath Foundation conditions for open-source projects](https://signpath.org/terms.html).
Clause c is met through first-run setup; see [SignPath conditions](#signpath-conditions).

## Status

**Windows releases are not code-signed yet.** Windows shows an unknown
publisher, and SmartScreen warns when you first run the installer. The project
plans to apply to SignPath Foundation for a free code signing certificate.
Until SignPath Foundation accepts the project and a signed release ships, the
Windows signing described below is a plan, not a fact about any published
build.

Once SignPath Foundation accepts the project, Windows releases will carry this
attribution:

> Free code signing provided by [SignPath.io](https://about.signpath.io),
> certificate by [SignPath Foundation](https://signpath.org)

The certificate is issued to SignPath Foundation, so Windows will then show
**SignPath Foundation** as the publisher in SmartScreen and UAC dialogs. That
is expected, and does not mean the file came from somewhere else.

## What will be signed

With the SignPath Foundation certificate, these Windows files will be signed:

- the application, `desktop_shell.exe`, and the rebuilt Library shell,
  `platevault-library.exe`, which both installers put on disk;
- the NSIS installer, `PlateVault_<version>_x64-setup.exe`;
- the MSI installer, `PlateVault_<version>_x64_en-US.msi`.

The release workflow signs the two programs first and then builds the
installers around the signed copies, so the programs you install are the
copies SignPath signed. One installed file stays unsigned: the
`uninstall.exe` that the NSIS installer writes into the install folder while
it installs. The MSI has no such file; Windows uninstalls it.

Only files built from this repository's source are signed. Third-party
binaries bundled with PlateVault are never signed with this certificate.

Other platforms are outside SignPath:

- macOS builds are signed with a self-signed PlateVault certificate, with no
  Apple Developer ID and no notarization. [macOS signing](./macos-signing.md)
  covers first launch and the certificate.
- Linux packages (AppImage, `.deb`, `.rpm`) are not code-signed.

On every platform, independent of code signing:

- each update bundle carries a minisign signature, which the built-in updater
  checks against the public key embedded in the app;
- each published bundle has a GitHub build provenance attestation. The
  [README](../../README.md#verifying-a-download) shows how to check one.

## How signing will work

- Signing runs only in the release workflow in this repository, on
  GitHub-hosted runners, for releases built from `main`. Nothing is signed on
  a developer machine or from another branch.
- SignPath checks that each file it signs came from a GitHub Actions build of
  this repository at the released commit.
- Every signing request needs manual approval from an approver (see the roles
  below). No release is signed automatically.
- Signed files must carry the product name `PlateVault` and the release
  version, which SignPath enforces through metadata restrictions.

## Team roles

PlateVault has one maintainer, who holds all three roles. Before anyone else
gets a role, the maintainer adds them to this list.

- **Authors**, who may change the source code without a separate review:
  [srobroek](https://github.com/srobroek).
- **Reviewers**, who review every change proposed by someone who is not an
  author: [srobroek](https://github.com/srobroek).
- **Approvers**, who decide whether a release may be signed and approve each
  signing request: [srobroek](https://github.com/srobroek).

Every team member must use multi-factor authentication on GitHub and on
SignPath.

## Privacy

PlateVault sends nothing to the maintainer. The app makes a few network
requests, each tied to a feature. [Privacy and network access](../manual/11-privacy.md)
lists them, links the privacy policies of the services involved, and says
how to turn off or avoid each one.

## SignPath conditions

Clause c is met: first-run **Configuration** offers **Check for updates
automatically** and **Online SIMBAD resolution** switches to disable those
network requests. The update switch shares its preference with **Settings →
Advanced → Software Update → Check for updates automatically**. With it off,
the first startup check sends no update request. The SIMBAD switch appears
next to it in **Configuration**. [Privacy and network access](../manual/11-privacy.md)
documents both services and how to turn off their requests.

These conditions are met:

- **Privacy policy shown during installation.** The NSIS setup.exe and the
  MSI show a privacy notice
  ([`apps/desktop/src-tauri/installer/privacy-notice.txt`](../../apps/desktop/src-tauri/installer/privacy-notice.txt))
  before any file is installed. It summarises
  [Privacy and network access](../manual/11-privacy.md) and links to it.
- **Installation options to disable network requests.** The **Configuration**
  step offers **Check for updates automatically** and **Online SIMBAD
  resolution** switches. With automatic update checks off, no update request
  is made at startup; with Online SIMBAD resolution off, target requests are
  disabled. The map sends no OpenStreetMap request until the user clicks
  **Show map**.

Together, the privacy policy, installation notice and first-run options meet
SignPath conditions a, b and c.

## Uninstalling

[Uninstalling PlateVault](../manual/12-uninstalling.md) covers every package
type, including where PlateVault keeps its data and how to remove it.

## Report a problem

If you think a file signed under this policy breaks it, open an issue at
<https://github.com/platevault/platevault/issues>, or write to SignPath at
<support@signpath.io>.
