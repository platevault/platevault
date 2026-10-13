# R10: Best-of-breed updater per OS, and the free SignPath certificate (bead astro-plan-mbf26)

Research date: 2026-10-13. Every web source was accessed on that date.

This report extends `apps/prototype/design/R9-UPDATER-OPTIONS.md` (ui-harness-v5 @ f7d09e8f). Its §2 table, §8 conditions and §11 sources are the baseline and are not repeated here. R9's labels ([T1] [T2] [V1]–[V14] [S1]–[S4] [W1] [W2] [M1] [M2] [K1] [K2] [C1] [G1] [G2] [H1] [PV-c]) keep their meaning. New sources are listed in §10.

**Notation**
- `PV:` the main checkout.
- `PV-f:` branch `fix/release-macos-updater-windows-signing` at 517959b5.
- `R:` a crate source in `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/`.

**Confidence**
- **H**: read directly in a primary source or in code.
- **M**: the primary source was read but the conclusion needs one inference, or the source is secondary.
- **L**: an inference with thin evidence.
- **[INFERENCE]**: marks every claim not verified against a primary source.

---

## 0. Answer

**SignPath.** PlateVault meets every written SignPath Foundation condition [SP1]:
- an OSI license (AGPL-3.0-only);
- a public repository;
- tagged releases that already ship the NSIS and MSI installers;
- a README that describes what the app does.

It does not yet meet the condition that decides most applications: SignPath requires "a certain verifiable reputation" for executable programs [SP1]. PlateVault has 0 stars, five months of history and no external references. The docent project (Arsarneq/docent) was turned down in June 2026 for exactly this reason [X1], so an application today will probably be declined (**M**).

If SignPath accepts, the project gets a free **OV** Authenticode certificate issued in the name "SignPath Foundation" [SP2]. It signs Windows PE, MSI and MSIX files only. It does not sign anything for macOS, and it cannot make deb packages or detached GPG signatures [SP2] (**H**). SmartScreen still warns until reputation builds up. EV certificates lost their SmartScreen bypass in 2024, and OV certificates never had one [MS1][MS2] (**H**).

**The certificate changes less than R9 assumed:**
- Velopack never checks Authenticode on an update. It checks only the SHA1/SHA256 hash from its feed [VP1][VP2].
- SignPath's free open-source plan signs only whole GitHub artifacts, needs a manual approval for every request, and has no hash-based signing [SP2][SP3]. That does not fit `vpk`, which signs files itself during packaging [V9].
- So Authenticode is no longer a reason to move Windows to Velopack (**M**).
- It does matter for:
  - trust on first install;
  - Smart App Control [MS1];
  - any future Microsoft Store listing [MS3].
- All three need the installed `PlateVault.exe` itself to be signed. The in-flight wiring signs only the installers [PV-f]. Signing the exe means splitting the build: sign the exe, then bundle, then sign the installers, which is two approvals per release (**M**).

**Best of breed for PlateVault, given S3 and the services crate:**
- **Windows:** keep the per-user NSIS installer with the services-crate minisign updater, so the S3 flow is written once. Add Authenticode through SignPath once accepted, and publish to winget. Velopack has the most features, but adopt it only after it ships package signatures.
- **macOS:** the one purchase that changes the outcome is the Apple Developer Program (99 USD a year [AP1]), which gives Developer ID signing and notarization. Then use Sparkle 2 with a custom user driver, which produces the S3 UI exactly [SPK1]. Without Developer ID, keep the services-crate updater.
- **Linux:** for direct downloads, use the AppImage with the services-crate updater. For deb/rpm, use signed apt/dnf repositories instead of the in-app `pkexec` install. Flathub, through the Flatpak update portal [FH2][FH3], has the most features, but three things gate it: its generative-AI policy, its development-history rule and the sandbox fit [FH1]. Snap is rejected.

**Migration.** Every recommended path keeps the minisign key, so no install needs a key bridge. Existing 0.5.x and 0.6.x installs take one last update through `latest.json`, and that release carries the new client. For deb/rpm, that release also sets up its own package repository.

---

## 1. Per-OS recommendation

| OS | Pick for PlateVault | Feature leader and the gate to switch | Signature / trust | S3 fit | Services-crate fit | Main CI change | Cost | Sources | Conf. |
|---|---|---|---|---|---|---|---|---|---|
| **Windows** | NSIS per-user `setup.exe` with the services-crate minisign client (R9 §7.2), Authenticode via SignPath once accepted (split signing, §2.4), and a winget manifest | **Velopack** (deltas, persistent staging, apply-after-exit). **Gate:** a Velopack-native package signature. Authenticode is no longer a gate (§3.1) | minisign Ed25519 over the final bytes (517959b5), plus OV Authenticode for OS trust | **Exact.** The check reads only the manifest. Install now: download, verify, run the installer, exit. Install on quit: download and verify into the cache, run the installer at exit [INFERENCE: design] | Native. No tauri types (R9 §2a) | Split the build into `tauri build --no-bundle`, SignPath #1, `tauri bundle`, SignPath #2, minisign; raise the approval timeout; move the action to v2; add a winget step | 0 (SignPath). Fallbacks: Certum 58 USD/yr, an OV certificate at 150–300 USD/yr | [SP1]–[SP5] [MS1]–[MS4] [VP1] [TC1] [PV-f] | M |
| **macOS** | Developer ID plus notarization, then **Sparkle 2** with a custom `SPUUserDriver` bridged into the services crate; Homebrew tap cask (`auto_updates true`). **Without Developer ID:** keep the services-crate minisign `.app.tar.gz` swap | **Sparkle 2** (EdDSA, code-signing continuity, deltas, phased rollout). It is the pick once Developer ID exists | Sparkle EdDSA, the Apple Developer ID identity and notarization. Without Developer ID: minisign and ad-hoc signing | **Exact** through a custom driver. "Update found" → install, for both choices. "Ready to install" → install now, or dismiss, which installs at termination [SPK1] | Host-owned on the main thread. A window-owner adapter publishes into `Latest` [INFERENCE] | The existing `ENABLE_MACOS_SIGNING` path plus notarization; Sparkle framework embed, `generate_appcast`, an appcast asset and an EdDSA key secret | 99 USD/yr | [AP1]–[AP3] [SPK1] [SPK2] [S1]–[S4] [HB1]–[HB3] | M |
| **Linux** | AppImage with the services-crate minisign client; deb/rpm through **signed apt/dnf repositories** (the OS installs, the app only notifies); no Snap | **Flathub** with the Flatpak update portal (`ashpd`). **Gate:** Flathub's generative-AI policy, its development-history rule, the sandbox fit for a library manager, and an offline build from source | AppImage: minisign. apt/dnf: the repository's GPG signature [INFERENCE: standard apt/dnf behaviour]. Flathub: its signed repository [INFERENCE] | AppImage: **exact**. apt/dnf: **partial** (the app notifies; the package manager installs). Flatpak portal: exact inside the app, but software centres may auto-update outside it [INFERENCE] | AppImage: native. Portal: `ashpd` (no tauri types) [FH3] | A repository job (GPG key, `reprepro`/`aptly`, `createrepo_c`, Pages); deb/rpm `postInstallScript` [TU1]. Flathub: a human-maintained manifest repository | 0 | [FH1]–[FH5] [AI1] [SN1] [TU1] | M |

---

## 2. SignPath Foundation

### 2.1 Eligibility for PlateVault

| Condition [SP1] | PlateVault today | Evidence | Conf. |
|---|---|---|---|
| OSI license, no commercial dual-licensing | **Met.** AGPL-3.0-only | `gh repo view`: `licenseInfo.key = agpl-3.0`. PV:Cargo.toml:57. SPDX headers read `AGPL-3.0-only` (the search matched 1,779 files; copyright Sjors Robroek) | H |
| Public repository | **Met** | `gh repo view`: `visibility: PUBLIC`, created 2026-05-14 | H |
| No proprietary component | Appears met. The only bundled resource is the OFL-licensed Inter font | PV:apps/desktop/src-tauri/tauri.conf.json:46-49 [INFERENCE: no dependency-tree audit] | M |
| Released in the form to be signed | **Met.** v0.1.0–v0.6.0 (2026-07-09 to 2026-07-21) ship NSIS and MSI | `gh release list` | H |
| Documented on the download page | **Met.** The README describes the features | PV:README.md:1-35 | H |
| Actively maintained | **Met** | Commit history | H |
| "Verifiable reputation" for executable programs | **Probably not met.** 0 stars, about 5 months old, no external references found | [SP1] "Common misunderstandings". [X1]: a June 2026 rejection that cites stars, forks, contributors, independent references and articles. [SP7]: a sample of 40 accepted projects ranged from 9 to 33.6 k stars, and most are older than PlateVault | M |
| Team roles: Authors, Reviewers, Approvers | One maintainer can hold all three roles. Astera does, though its acceptance was not verified (it is not in [SP7]) | [SP1], [X2] | M |
| MFA on GitHub and on SignPath for all team members | Only the user can enable it | [SP1] | H (rule) |
| "Code signing policy" on the home page and on download/release pages, with the exact sentence, the roles and a privacy statement | **Missing** | A repository search for "Code signing policy" found nothing | H |
| Data sent to systems the user did not specify → a privacy policy, shown at install, with an option to disable | The startup update check calls github.com (PV:docs/journeys/J17-software-update-install/journey.md:61-67). There is no opt-out setting | [SP1]. Whether an update check falls under this clause is [INFERENCE]; Astera only lists it [X2] | L |
| Uninstallation provided | **Met** (NSIS/MSI uninstallers) | Tauri bundles | H |
| Every job leading to signing runs on GitHub-hosted runners | **Met** | PV-f:.github/workflows/release-please.yml:45,82-83,319 | H |
| Manual approval of every signing request | A per-release obligation on the user | [SP1], [SP2] `manual_approval: required` | H |
| Metadata restrictions: product name = project name, product version identical in each build | Tauri writes ProductName "PlateVault" and the version into the exe and the installer [INFERENCE] | [SP1], [SP4] | M |
| Sign only your own binaries | Upstream binaries may be bundled unsigned, but must not be signed with this certificate | [SP1] | H |

**Verdict.** The written conditions are met or fixable in a day. The reputation test probably fails today (**M**). PV-f:docs/development/code-signing.md:40 says "Verdict: eligible. No blockers identified." That leaves out the reputation criterion (finding F6, §7).

### 2.2 What it signs

The free open-source plan is called the "Open Source Code Signing" edition [SP2] (**H**):
- **Authenticode:** yes. This covers:
  - `.exe` and `.dll` (PE files);
  - `.msi`, a composite format: SignPath can also sign the files inside it ("deep signing");
  - `.cab`;
  - `.appx` and `.msix` (composite). The `<Identity Publisher>` in `AppxManifest.xml` must match the certificate subject [SP4];
  - PowerShell, ClickOnce, OPC, NuGet, JAR, APK and JSF.
- **Linux:**
  - `rpm: true`, but RPM signing needs a GPG-key certificate, and the plan provides "1 standard (OV)" certificate [SP2][SP4]. [INFERENCE] So it cannot be used in practice with the Foundation certificate.
  - `deb: false`, `gpg: false` (no detached GPG) and `raw: false`.
  - The AppImage format is not listed [SP4].
- **macOS:** no. Only Apple issues Developer ID certificates, and only to a program member [AP1]; PV-f:docs/development/code-signing.md (macOS section) says the same.
- **`hash_based_signing: none`.** There is no remote-key signtool mode [SP2].
- **NSIS `setup.exe`:** it can be signed as a PE file, but PE is not a composite format [SP4]. So signing the installer leaves the `PlateVault.exe` inside it unsigned (**H**).

### 2.3 Certificate type and SmartScreen

- **One OV certificate per approved project, issued to "SignPath Foundation".** Each project applies separately [SP2] (**H**). Users see "SignPath Foundation" as the publisher [SP1][X2] (**H**). The issuing CA (code-signing.md:41 says Sectigo) was not verified (**L**).
- **Reputation is not instant.** Microsoft: OV and EV certificates both show "unrecognized" until reputation builds. The EV bypass was removed in 2024. Reputation carries over to new versions only with a consistent signing identity, while unsigned files start from zero with every version [MS1][MS2] (**H**). Velopack's docs still claim EV and Azure certificates get instant reputation [V9]; Microsoft's current documentation contradicts that (**H**).
- **The reputation starts from zero.** Because each project has its own certificate, PlateVault's would not inherit reputation from other Foundation projects such as Vim or Flameshot [INFERENCE from [SP2]] (**L–M**).
- **Smart App Control** on Windows 11 blocks unsigned files with no reputation. It checks every executable, not only downloads [MS1] (**H**). That is why the installed exe must be signed.
- **Updates.** Files the in-app updater downloads carry no Mark-of-the-Web, so SmartScreen does not prompt on an update; Authenticode matters at first install [INFERENCE; SignPath's knowledge base ties SmartScreen to Mark-of-the-Web] (**M**).

### 2.4 Pipeline constraints, and what they mean for Tauri

- **Only whole GitHub artifacts.** The artifact must be uploaded with `actions/upload-artifact` v4+ and submitted by its artifact id. SignPath's GitHub connector checks that a GitHub workflow built it and that every job before it ran on GitHub-hosted runners [SP3] (**H**).
- **Origin verification checks:** the repository URL, the branch the signing policy allows, the commit, the build job and reproducibility [SP5] (**H**).
- **No in-build signing.** With manual approval required and no hash-based signing, there is no synchronous per-file signing from `bundle.windows.signCommand` or `vpk --signTemplate` [SP2][SP3]. This settles the open item in R9 §10 (**M**).
- **Approval window.** The default `wait-for-completion-timeout-in-seconds` is 600 [SP3]. PV-f's job does not set it (PV-f:release-please.yml:383-393), so the user would have 10 minutes to approve (**H**).
- **Old action version.** PV-f pins `signpath/github-action-submit-signing-request@v1`; v2 is current (2.3.0). v2's one breaking change removed the `signpath-api-url` output [SP8] (**H**).
- **Tauri needs two requests per release**, the pattern Astera documents [X2]:
  1. `tauri build --no-bundle`;
  2. upload `PlateVault.exe` and submit request #1;
  3. `tauri bundle --bundles nsis,msi` [TC1];
  4. submit request #2 for `setup.exe` and `.msi`;
  5. `tauri signer sign` over the final bytes;
  6. run the existing manifest gate.

  An MSI-only flow could deep-sign the inner exe in one request [SP4], but the NSIS installer is the per-user payload R9 keeps (**M**). The NSIS uninstaller is written at install time and stays unsigned [INFERENCE] (**L**).

### 2.5 Application steps, timeline, and what the user must do personally

**Preparation** (an agent can draft; the user approves):
1. Add a "Code signing policy" page and link it from the README and from every release body. The page needs:
   - the exact sentence "Free code signing provided by SignPath.io, certificate by SignPath Foundation";
   - the roles (the user as Author, Reviewer and Approver);
   - a privacy statement that lists the update check to github.com;
   - uninstall instructions [SP1]. Astera's page [X2] is a working single-maintainer template.
2. Optional: add an "Automatically check for updates" setting, to meet the privacy clause's "option to disable" without doubt (decision D8) [INFERENCE].
3. Correct code-signing.md:138. It names `nightwatch-astro/alm`; the repository is `platevault/platevault` (F1).
4. Build up the evidence SignPath looks at: stars, external posts (astro forums, Reddit), real-user issues [X1].

**Only the user can do these:**
5. Turn on MFA on GitHub, and later on the SignPath account [SP1].
6. Submit the form at https://signpath.org/apply. It is an embedded HubSpot form whose fields could not be read [SP6].
7. Once approved:
   - install the SignPath GitHub App;
   - link the GitHub trusted build system;
   - create the project, two artifact configurations (the app exe; the installers, with metadata restrictions) and a signing policy limited to `main`/tags;
   - mint the submitter API token;
   - set the secret and variables listed in code-signing.md:142-149.
8. For every release, approve both signing requests in the SignPath web UI within the job's wait window.

**Timeline.** One data point: docent opened its issue on 2026-05-28 and posted the rejection on 2026-06-04, about a week [X1] (**L**). SignPath allows no appeal or arbitration but invited docent to reapply [SP1][X1] (**M**).

### 2.6 How SignPath changes things

- **Windows first install:** "Unknown publisher" becomes "SignPath Foundation". SmartScreen still warns until the certificate builds reputation (**H**).
- **Velopack:** not unblocked (§3.1).
- **macOS and Linux:** nothing changes. SignPath covers neither (**H**).
- **Release cadence:** each release needs about two manual approvals with MFA. Releases can no longer run unattended (**H**, [SP1][SP2]).
- **Microsoft Store EXE/MSI listing:** becomes possible, because every PE file must be signed by a CA in the Microsoft Trusted Root Program [MS3]. This works only with the split build (**M**).

---

## 3. What Authenticode changes in the R9 comparison

### 3.1 Velopack

- **Velopack's update check uses only hashes.** On `develop` @ 9fc0b1fe, `verify_package_checksum` compares SHA256, and falls back to SHA1 when the feed has no SHA256 [VP1] (**H**). A code search for `WinVerifyTrust` matches only `vpk` packaging and the tests, not the client or `Update.exe` [VP2] (**M**: code-search coverage).
- **#975 is still open** (re-read: retitled to macOS, one comment on 2026-09-28) [V7] (**H**).
- **Authenticode does not restore an update signature.** A stolen GitHub token can still replace both the feed and the package (**M**).
- **SignPath conflicts with `vpk`.**
  - `vpk` must do the signing itself [V9], which SignPath's in-build model does not allow (§2.4).
  - Velopack's `Update.exe` is an upstream binary. The "sign your own binaries only" rule and the product-name restriction keep the project certificate off it [SP1].
  - So a SignPath setup would leave `Update.exe` unsigned and would need at least two approvals per release [INFERENCE] (**M**).
- **Change to R9 §8:** remove "Authenticode is live" as a way to qualify. Switch Windows to Velopack only when Velopack ships a native package signature.

### 3.2 SmartScreen

- Signing affects first-run warnings and reputation accrual.
- It does not change update integrity (§2.3).
- Smart App Control and enterprise allow-listing need the app exe signed, not only the installer [MS1] (**H**).

### 3.3 MSIX, App Installer and the Store

- A SignPath-signed MSIX would install by sideloading, because the certificate chains to a public CA, provided the manifest's Publisher matches the certificate subject [SP4] (**M**).
- What still blocks it:
  - Tauri cannot build MSIX (tauri#4818, open, updated 2026-09-06) (**H**);
  - the `ms-appinstaller:` protocol has been off by default since December 2023 [M2] (**H**);
  - App Installer's `ShowPrompt` and `UpdateBlocksActivation` need the 2021 schema [M1] (**H**).
- **Store MSIX:** the Store signs MSIX packages for free, the developer account is free, and Store apps never get SmartScreen warnings [MS1][MS2] (**H**). But Store updates are managed by the OS, which conflicts with S3 [INFERENCE] (**L–M**).
- **Verdict unchanged:** not now.

### 3.4 Signing order (bead rw8uc)

- **The order in 517959b5 is right:** Authenticode first, then minisign over the final bytes (PV-f:release-please.yml:395-413), then a verified manifest gate before publishing (**H**).
- **Gaps that remain:**
  - **F2:** the inner exe is unsigned, because the pipeline signs only the installers after the build.
  - **F3:** the approval window is 600 s.
  - The action is v1.
  - The Store needs every PE file signed [MS3].

### 3.5 R9 §8, revised

| R9 condition | Revised |
|---|---|
| Switch Windows to Velopack IF Authenticode is live OR Velopack ships native package signatures | Only when Velopack ships native package signatures, and preferably with a certificate route that lets `vpk` sign in-process (Azure Artifact Signing or an OV certificate with a cloud HSM, not the SignPath Foundation plan) |
| Revisit MSIX IF Tauri ships MSIX and a trusted Windows certificate exists | Unchanged. SignPath could supply the certificate, but the S3 conflict with Store-managed updates remains |
| D3: enabling `ENABLE_WINDOWS_SIGNING` | Also blocked on F2 (split signing) and F3 (timeout), and on the SignPath application decision (D1) |

---

## 4. Best of breed per OS

### 4.1 Windows

| | NSIS + services-crate client | Velopack 1.2.161 | WinSparkle 0.9.4 | MSIX + App Installer | Microsoft Store | winget |
|---|---|---|---|---|---|---|
| Signature and trust | minisign over the final bytes; Authenticode optional (**H**) | sha256 from the feed only [VP1] (**H**) | EdDSA or Authenticode, not both [W1] (**H**) | Authenticode required [M2] (**H**) | Store signs MSIX; EXE/MSI must be signed by the developer [MS2][MS3] (**H**) | Installer sha256 in the manifest, AV and Defender scans, URL from the publisher's release location; no Authenticode required [MS4] (**H**) |
| Deltas | No (11 MB payload) | Yes [V2] | No [W2] | Block map [K1] | Yes [INFERENCE] | No |
| Staged install | Verified file held in the cache [INFERENCE] | Persistent; applies after exit [V4] | Runs the full installer [W2] | Managed by the OS | Managed by the OS | `winget upgrade`, run by the user |
| S3 fit | **Exact** [INFERENCE: design] | **Exact**: check, download, then `apply_updates_and_restart` or `wait_exit_then_apply_updates` [V4] (**H**) | Its own dialogs; no "Install on quit" [INFERENCE from W1/W2] (**L**) | OS prompt (`ShowPrompt`) or app-driven APIs [M1][INFERENCE] | Conflicts with S3: the Store auto-updates [INFERENCE] | Compatible: user-initiated |
| Rust and services-crate fit | Native (R9 §2a) | Native crate with a blocking API [V4] | C DLL with its own UI thread [W1] | WinRT through `windows-rs` [INFERENCE] | n/a | n/a (CI only) |
| CI change | Split signing (§2.4) | .NET 8 and `vpk`; replaces NSIS/MSI [V1][V13] | DLL, appcast | No Tauri MSIX support (#4818) | Partner Center submission per release | One PR per release, automatable with `winget-releaser` (317★) or Komac (476★), which needs a token [INFERENCE] |
| Maintenance | cargo-packager-updater's last release was 2025-07-21 (R9 risk) | Active (R9 [G1]) | Active (R9 [G1]) | OS component | Microsoft | Microsoft |
| **Role** | **Pick** | Feature leader; gated (§3.5) | Rejected | Rejected for now | Optional listing once signed (D9) | **Add** (D10) |

### 4.2 macOS

| | Sparkle 2 + custom user driver | Services-crate minisign swap | Developer ID + notarization | Homebrew cask (own tap) |
|---|---|---|---|---|
| Trust | EdDSA required; with Developer ID it also checks code-signing continuity and supports key rotation [S1] (**H**) | minisign Ed25519 (**H**); the swap does not check the bundle's code identity [INFERENCE from T2] | Notarized Developer ID passes Gatekeeper | Same as the app |
| Deltas, rollout | Deltas [S3]; phased rollout skips manual checks [S2] (**H**) | None (13.7 MB) | n/a | n/a |
| S3 fit | **Exact** with a custom `SPUUserDriver`. When an update is found, reply `install` for both buttons. When it is ready, reply `install` for "Install now", or `dismiss`, after which "the update may still be installed automatically after the application terminates" [SPK1] (**M**: "may") | **Exact** [INFERENCE: design] | n/a | `auto_updates true` leaves updating to the app [H1] |
| Rust fit | `sparkle-updater` 0.1.0 (2026-09-19, 825 downloads) wraps the standard driver, gentle reminders and the relaunch hook, not a custom driver; its Objective-C bindings are private [SPK2] (**H**). A custom driver means in-house `objc2` code [INFERENCE] (**M**). It is `!Send`, runs on the main thread, and needs an `.app` [SPK2] (**H**) | Native | n/a | n/a |
| CI change | Embed `Sparkle.framework`, Info.plist keys, `generate_appcast`, EdDSA key secret (R9 §7.3) | Second manifest (R9 §7.2) | Secrets already wired (`ENABLE_MACOS_SIGNING`); notarization credentials | `homebrew-bump.yml` exists |
| Without paying | Works, but then mainly adds deltas | Works | Not possible | Official homebrew/cask requires a Gatekeeper pass; failing casks were disabled on 2026-09-01 [HB1][HB3] (**H**). `--no-quarantine` is deprecated [HB1] (**H**). Since Homebrew 6.0.0 a third-party tap needs explicit trust, or an install by its full name [HB2] (**H**) |

**What happens without Developer ID:**
- **No Control-click bypass.** Since macOS Sequoia, Control-click no longer bypasses Gatekeeper. The user must go to System Settings → Privacy & Security [AP2] (**H**). The cask caveat [H1] and code-signing.md:186-187 still say "right-click → Open" (F4).
- **Ad-hoc signatures break identity tracking.** The designated requirement of ad-hoc-signed code "is tied to that specific version of the code", so "macOS can't reliably track the identity of the code" [AP3] (**H**). [INFERENCE] Each update may therefore ask again for file and folder permissions, such as access to removable volumes (**M**).

### 4.3 Linux

| | Flathub + Flatpak portal | AppImage + services-crate client | AppImageUpdate (zsync) | Velopack on Linux | Signed apt/dnf repositories | Snap |
|---|---|---|---|---|---|---|
| Trust | Flathub builds from source and signs its repository [FH1][INFERENCE on the signing mechanism] | minisign (**H**) | GPG signature embedded in the AppImage [AI1] (**M**) | sha256 [VP1] | GPG-signed repository metadata [INFERENCE: standard apt/dnf] | Store-signed [INFERENCE] |
| Deltas | Yes [INFERENCE] | No (88 MB) | zsync | Yes [V2] | No | Yes [INFERENCE] |
| S3 fit | `UpdateAvailable` → notify → `Update(parent_window)`; "restarting the application will cause this commit to be used" [FH2] (**H**). Software centres may still auto-update outside the app [INFERENCE] (**L–M**) | **Exact** | External tool | **Exact** [V4] | Partial: the app only notifies; apt/dnf or the software centre installs | Conflicts: snapd checks four times a day and installs automatically; a snap can hold its own refresh for at most 90 days [SN1] (**M**: from search snippets of primary pages) |
| Rust fit | `ashpd` 0.13.13 (2026-07-17, 17.4 M downloads) has the update monitor [FH3] (**H**) | Native | None [INFERENCE] | Native crate | n/a | n/a |
| Gate or cost | Generative-AI policy: undisclosed AI-generated material can be rejected; manifests must contain no AI-generated content; AI agents may not open or automate submission PRs. Also a "meaningful history" rule, an offline build from source, and sandbox limits for file-manager-like apps [FH1] (**H**). `flatpak-node-generator` supports pnpm [FH4] (**H**). Tauri's Flatpak guide packages the prebuilt `.deb` [FH5], which the build-from-source rule disallows for open-source apps [INFERENCE] | None | Stagnant: only alpha releases, last push 2025-10-18 [AI1] (**H**) | No deb/rpm (#370 [V8]) | A GPG key to keep safe; repository hosting such as Pages [INFERENCE] | Strict confinement and file access [INFERENCE] |
| **Role** | Feature leader; gated (D6) | **Pick** (direct downloads) | Rejected | Rejected | **Pick** for deb/rpm users (D6) | Rejected |

### 4.4 Services-crate shape [INFERENCE: design proposal]

**The crate owns:**
- an `UpdateStatus` published through `Latest`;
- an update-backend port with four operations: check, download, install now, install on quit.

**Adapters inside the crate** (no tauri types):
- the minisign client for NSIS, `.app` and AppImage;
- the Flatpak portal, through `ashpd`;
- a notify-only backend for deb/rpm installed from a repository.

**Adapter in the window owner:**
- Sparkle, which must run on the AppKit main thread [SPK2]. It implements the same port and forwards the user-driver callbacks into the watch sender. This keeps the crate free of tauri types (PR #1791 rule).

---

## 5. Migration: how 0.5.x and 0.6.x installs reach the new mechanism

**Common facts:**
- Old clients run tauri-plugin-updater 2.10.1. They read `latest.json` and look up `{os}-{arch}-{bundle}`, then fall back to `{os}-{arch}` (PV-f:scripts/assemble-updater-manifest.mjs:49-63) (**H**).
- Old clients keep the D1 behaviour and install at launch. The bridge release itself installs that way, once (**H**).

### Windows (NSIS stays; Authenticode optional)
1. **Release N** carries the services-crate client and keeps emitting `windows-x86_64[-nsis|-msi]` entries, minisigned with the same key. 0.5.x and 0.6.x clients install N (**H**).
2. **If Authenticode is on in N:** 517959b5 re-minisigns after signing and verifies before it publishes. Old clients accept the result. The publisher shown changes from none to "SignPath Foundation". The in-place NSIS update is unaffected [INFERENCE] (**M**).
3. **From N:** the S3 flow applies. Keep emitting `latest.json` for several releases for clients that skip N. R9 §7.2 covers the second manifest.
4. **MSI installs** stay per-machine: S3's install step runs `msiexec` with UAC [INFERENCE].
5. **A later Velopack move** follows the R9 §7.4 bridge.

### macOS
1. **0.5.0 Macs** need any release that includes `darwin-*` entries. 517959b5 restores them, and the manifest gate refuses to publish without them (**H**).
2. **Developer ID (D3).**
   - Release N is notarized and still sits in `latest.json` as `.app.tar.gz`, so ad-hoc clients swap the bundle as before [INFERENCE from T2: no identity check] (**M**).
   - File and folder permissions are re-asked once [AP3][INFERENCE]; they are already per-version under ad-hoc signing.
   - Keep the bundle identifier `dev.astro-plan.astro-library-manager`.
3. **Sparkle (D4):**
   - N+1, still served through `latest.json`, embeds Sparkle with `SUFeedURL` and `SUPublicEDKey` (a new EdDSA key, not the minisign key; R9 §7.3).
   - From N+2, Sparkle reads the appcast.
   - Keep `darwin-*` entries in `latest.json` pointing at the newest build for stragglers (R9 §7.3 step 4).
4. **Cask:**
   - update the caveat (F4);
   - document `brew install --cask platevault/tap/platevault` for tap trust [HB2];
   - once notarized, an official homebrew/cask submission becomes possible [INFERENCE].

### Linux
1. **AppImage:** keep the `linux-x86_64-appimage` entries; the new client uses the same key (**H**).
2. **deb/rpm (D6 = repository):**
   - Release N still arrives through the old `pkexec dpkg -i` / `rpm -U` path.
   - N's package `postInstallScript` installs the repository source and key: an apt `sources.list.d` entry with `signed-by`, or a `yum.repos.d` file with an imported key. Tauri supports deb and rpm post-install scripts [TU1] (**H** for the hook; **M** for the pattern).
   - From N, the app shows "update available, install it with your package manager" and stops installing in-app.
   - Keep the deb/rpm entries in `latest.json` for a few releases.
   - If the user drops deb/rpm instead, N shows a one-time notice to switch to AppImage.
3. **Flathub (if D6 approves it):**
   - There is no automatic move from AppImage or deb to Flatpak.
   - The Flatpak data root differs (`~/.var/app/<id>`), so moving to it needs a library import or migration step [INFERENCE].
   - The Flatpak ID must be on a domain or code-hosting namespace the user controls [FH1] (D7).

---

## 6. Costs, accounts and decisions

### Paid items

| Item | Price | Needed for | Source | Conf. |
|---|---|---|---|---|
| Apple Developer Program | 99 USD per membership year. An individual enrolment shows the user's legal name; an organisation needs a D-U-N-S number | Developer ID, notarization, Sparkle key rotation, an official cask | [AP1] | H |
| Certum Open Source Code Signing (fallback if SignPath declines) | 29 USD (code for the user's own card; card and reader extra), or 58 USD in the cloud (SimplySign; mobile-app access codes; 5,000 signatures a month). The certificate reads "Open Source Developer" plus the user's name | Windows Authenticode | [CE1]. CI automation with mobile access codes is awkward [INFERENCE] | H / M |
| OV certificate from a CA | 150–300 USD a year; key on an HSM or token | Windows Authenticode | [MS2] | H |
| Azure Artifact Signing | about 9.99 USD a month. Individuals: USA and Canada only. Organisations: USA, Canada, EU, UK | Windows Authenticode with in-process `vpk` signing | [MS2]. Organisations reportedly need 3+ years of history [MS5] | H / M |
| Velopack Flow | Paid | Staged rollout only | R9 [V6] | H; not recommended |
| A domain for Flathub verification, if the user owns none | [INFERENCE] small yearly fee | A Flathub app ID | [FH1] | L |

code-signing.md:20 prices Certum at "~€14, no longer free". That is outdated (F5).

### Free accounts and applications
- SignPath Foundation application and SignPath account (MFA): [SP1].
- Microsoft Store developer account, free [MS2] (only for D9).
- winget-pkgs pull requests: a GitHub account plus a token for automation [MS4][INFERENCE].
- Flathub submission: a human-authored PR and manifest [FH1].
- A GPG signing key for the apt/dnf repositories, kept as a CI secret [INFERENCE].
- The existing Homebrew tap.

### Decisions for the user

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | SignPath application timing | (a) apply now and expect a likely rejection; (b) build reputation first, then apply; (c) skip and buy Certum | (b), with the §2.5 preparation done now. Reapplying is allowed [X1] |
| D2 | Publisher name shown on Windows | "SignPath Foundation" (free) or the user's legal name (Certum or OV, paid) | The user's preference; there is no technical difference for SmartScreen [MS1] |
| D3 | Apple Developer Program | Pay 99 USD a year (individual or organisation), or stay ad-hoc | Pay, if macOS is a real audience. It is the only item that removes the Gatekeeper and per-update permission friction |
| D4 | macOS updater | Sparkle 2 with a custom driver (needs D3 to pay off), or the uniform services-crate minisign client | Services crate now; Sparkle after D3 |
| D5 | Windows updater | NSIS with the services crate (pick), or Velopack now | NSIS; Velopack only after it ships package signatures |
| D6 | Linux channels | AppImage in-app; deb/rpm through a repository, or drop deb/rpm; Flathub yes or no (AI disclosure, human-authored manifest, sandbox); Snap no | AppImage and a repository now; decide Flathub separately |
| D7 | App identifier for stores | Keep `dev.astro-plan.astro-library-manager` (does the user control `astro-plan.dev`?) or a code-hosting ID for Flathub only | Keep it on macOS and Windows; decide only if Flathub goes ahead |
| D8 | Update-check privacy | Add an "automatically check for updates" setting; write the privacy statement | Add both. They are cheap and they meet SignPath's clause [SP1] |
| D9 | Microsoft Store listing (EXE/MSI) | Yes or no | Later, once signing (and F2) works |
| D10 | winget | Yes or no | Yes. Free, and it fits S3 |
| D11 | Manual approvals | Accept about two SignPath approvals per release | Required if SignPath is used [SP2] |

---

## 7. Findings and dependency edges for the dispatcher

**Findings.** Each is `discovered-from` this bead.
- **F1.** code-signing.md:137-138 tells the user to apply with `https://github.com/nightwatch-astro/alm`. The repository is `platevault/platevault`.
- **F2.** Post-build signing in PV-f (release-please.yml:291-413) signs only `setup.exe` and `.msi`, so the installed `PlateVault.exe` stays unsigned. Smart App Control [MS1] and a Store listing [MS3] need it signed. Fix: the split build in §2.4.
- **F3.** PV-f's SignPath step relies on the default 600 s approval window [SP3] and pins action v1 [SP8].
- **F4.** The macOS bypass in code-signing.md:186-187 and the Homebrew cask caveat [H1] ("right-click → Open") no longer works on macOS Sequoia and later [AP2]. Homebrew `--no-quarantine` is deprecated, and Homebrew 6 adds tap trust [HB1][HB2].
- **F5.** The Certum row in code-signing.md:20 is outdated: 29 or 58 USD [CE1].
- **F6.** The "eligible, no blockers" verdict in code-signing.md:40 leaves out SignPath's reputation requirement [SP1][X1].
- **F7.** SignPath requires a code signing policy and privacy statement on the home page; none exists yet [SP1].

**Edges**

| Edge | Type |
|---|---|
| This finding → astro-plan-5wcib (services-crate updater: the per-OS backends and the S3 port) | `blocks` |
| F2, F3 → enabling `ENABLE_WINDOWS_SIGNING` | `blocks` |
| F1–F7 → this bead | `discovered-from` |
| User decisions D1 and D3 → Windows and macOS signing enablement | `blocks` |
| This finding ↔ astro-plan-rw8uc (in flight; F2 and F3 extend it) | `related` |

---

## 8. Confidence per claim

| Claim | Conf. |
|---|---|
| PlateVault meets SignPath's written conditions, apart from the policy page, MFA and the privacy text | H |
| SignPath would probably decline PlateVault today on reputation | M |
| The certificate is OV, in SignPath Foundation's name, one per project | H |
| SmartScreen still warns with OV or EV until reputation builds | H |
| Velopack does not verify Authenticode on updates | H (client source), M (search coverage) |
| SignPath's open-source plan cannot sign inside `tauri build` or `vpk pack` | M |
| The split two-request build is needed to sign the app exe under NSIS | M |
| NSIS with the services crate is the Windows pick | M |
| Sparkle with a custom driver meets S3 exactly | M |
| Developer ID is the single paid item with the largest effect | M |
| AppImage plus apt/dnf repositories is the Linux pick; Flathub is gated | M |
| No key bridge is needed for any recommended path | H |
| Store and software-centre updates conflict with S3 | L–M |

---

## 9. What was not checked

- The SignPath application form's fields (an embedded HubSpot form) and SignPath's actual review time.
- Whether Astera was accepted. It has a published policy but is not in the projects list.
- Whether each Foundation project gets its own key: inferred from "1 standard certificate" per edition.
- No runtime test of any flow: split signing, Sparkle with a custom driver, the Flatpak portal, or the deb postinst repository setup.
- Whether Tauri's NSIS output passes SignPath's metadata restrictions as built.
- Whether the Store auto-updates EXE/MSI listings.
- Whether winget installs trigger SmartScreen.
- The Snap refresh-control details: read only from search snippets of snapcraft.io pages.

---

## 10. Sources (all accessed 2026-10-13)

**SignPath**
- [SP1] SignPath Foundation conditions: https://signpath.org/terms.html (source: https://github.com/SignPath/fdn-website/blob/main/docs/terms.md, last edited 2025-02-14). Covers the conditions, the certificate issued to SignPath Foundation, the MFA and role rules, the policy-page text, the privacy rules, "every release needs manual approval", and "we require a certain verifiable reputation".
- [SP2] SignPath editions data, Open Source Code Signing: https://github.com/SignPath/docs-product/blob/main/docs/_data/editions.yml (lines 283-354). Records "1 standard (OV) code signing certificate issued to SignPath Foundation"; separate applications per project; `rpm: true`, `deb: false`, `gpg: false`, `raw: false`, `hash_based_signing: none`, `deep_signing: true`, `metadata_constraints: required`, `manual_approval: required`, `trusted_build_systems: required`, `origin_verification: required`.
- [SP3] https://docs.signpath.io/trusted-build-systems/github: `upload-artifact` v4+ and `github-artifact-id`; for open-source projects, all jobs on GitHub-hosted agents; `wait-for-completion-timeout-in-seconds` defaults to 600.
- [SP4] https://docs.signpath.io/artifact-configuration/reference: the format table (`pe-file` is not composite; `msi-file`, `msix-file` and `appx-file` are composite); the MSIX Publisher must match the certificate subject; RPM needs a GPG-key certificate; directive availability per edition.
- [SP5] https://github.com/SignPath/docs-product/blob/main/docs/origin-verification/index.md: the origin-verification checks.
- [SP6] https://signpath.org/apply.html: an embedded HubSpot form.
- [SP7] https://github.com/SignPath/fdn-website/blob/main/docs/_data/projects.yml: about 330 entries, including Tauri and AGPL-3.0-only projects. Stars were sampled for the last 40 repositories.
- [SP8] https://github.com/SignPath/github-action-submit-signing-request/releases (v2 published 2025-10-23) and the changelog in https://github.com/SignPath/docs-product/blob/main/docs/_data/changelog.yml (action 2.3.0; the 2.0.0 breaking change).

**Other projects**
- [X1] https://github.com/Arsarneq/docent/issues/72: a SignPath Foundation rejection on 2026-06-04 for insufficient public-traction signals, with an invitation to reapply.
- [X2] https://github.com/parsingk/Astera/blob/main/docs/code-signing.md: a single-maintainer code signing policy; two signing requests (binaries, then the NSIS installer).

**Microsoft**
- [MS1] https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation (updated 2026-08-17).
- [MS2] https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options (2026-08-29): prices, Azure regions, the 2024 EV change, the free Store account, SignPath "OV-level".
- [MS3] https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements: every PE file signed by a Trusted Root Program CA, versioned URLs, silent install.
- [MS4] https://learn.microsoft.com/en-us/windows/package-manager/package/repository: winget validation.
- [MS5] https://learn.microsoft.com/en-us/answers/questions/5977141/azure-artifact-signing-trusted-signing-is-a-us-llc (a Q&A answer: organisations need 3+ years of history).

**Velopack**
- [VP1] https://github.com/velopack/velopack/blob/9fc0b1fe83dc3fe3ed471729e9d4b89ca265938a/src/lib-rust/src/manager.rs#L541-L562
- [VP2] GitHub code search for `WinVerifyTrust` in velopack/velopack: matches only `src/vpk/Velopack.Packaging.Windows/CodeSign.cs` and tests.
- [V7] Re-read: #975 is open, labelled `os:mac`, with one comment (2026-09-28).
- [V9] Re-read: "signing needs to be performed by Velopack itself"; the EV and Azure instant-reputation claim.

**Sparkle**
- [SPK1] https://github.com/sparkle-project/Sparkle/blob/b41aa91142bb752324838a3c4e0cac2e5f942ff4/Sparkle/SPUUserDriver.h lines 94-106 and 222-230.
- [SPK2] https://docs.rs/sparkle-updater/latest/sparkle_updater/ (0.1.0). crates.io: 2026-09-19, 825 downloads.

**Apple**
- [AP1] https://developer.apple.com/programs/enroll/: 99 USD per membership year; individual or organisation (D-U-N-S); fee waivers for nonprofits, education and government.
- [AP2] https://developer.apple.com/news/?id=saqachfa (2024-08-06): macOS Sequoia removes the Control-click bypass.
- [AP3] https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements: the designated requirement of ad-hoc-signed code is tied to that specific version.

**Homebrew**
- [HB1] https://brew.sh/2025/11/12/homebrew-5.0.0/: casks without code signing deprecated, disabled September 2026; `--no-quarantine` deprecated.
- [HB2] https://brew.sh/2026/06/11/homebrew-6.0.0/ and https://docs.brew.sh/Tap-Trust: tap trust is required for non-official taps.
- [HB3] https://github.com/orgs/Homebrew/discussions/7050: casks disabled on 2026-09-01.

**Linux**
- [FH1] https://docs.flathub.org/docs/for-app-authors/requirements: the generative-AI policy, development history, build from source, no network during the build, the sandbox-fit categories, app-ID verification.
- [FH2] https://github.com/flatpak/flatpak/blob/main/data/org.freedesktop.portal.Flatpak.xml: `CreateUpdateMonitor`, `UpdateAvailable`, `Update`.
- [FH3] https://docs.rs/ashpd/latest/ashpd/flatpak/index.html (0.13.13). crates.io: 2026-07-17, 17.4 M downloads.
- [FH4] https://github.com/flatpak/flatpak-builder-tools/blob/master/node/README.md: npm, yarn and pnpm.
- [FH5] https://v2.tauri.app/distribute/flatpak/
- [AI1] https://github.com/AppImageCommunity/AppImageUpdate: 2.0.0-alpha releases only; last push 2025-10-18; 746 stars.
- [SN1] https://snapcraft.io/docs/how-to-guides/manage-snaps/manage-updates and https://forum.snapcraft.io/t/refresh-control/27213 (search snippets: four checks a day; a snap can hold its own refresh for up to 90 days).

**Certificates and tooling**
- [CE1] https://certum.store/open-source-code-signing-code.html (29 USD) and https://certum.store/open-source-code-signing-on-simplysign.html (58 USD).
- [TC1] https://v2.tauri.app/reference/cli/: `bundle` generates bundles for an app already built.
- [TU1] R:tauri-utils-2.10.1/src/config.rs:341-375 and 440-474: `DebConfig` and `RpmConfig` `post_install_script`.
- GitHub API, read 2026-10-13:
  - vedantmgoyal9/winget-releaser: 317 stars;
  - russellbanks/Komac: 476 stars;
  - ahonn/tauri-plugin-sparkle-updater: 29 stars, pushed 2026-10-13;
  - tauri-apps/tauri#4818 and #11863: open;
  - cargo-packager-updater: last release v0.2.3, 2025-07-21.

**Repository**
- `gh repo view platevault/platevault`: PUBLIC, `agpl-3.0`, created 2026-05-14, 0 stars. `gh release list`: v0.1.0–v0.6.0.
- PV-f:.github/workflows/release-please.yml:291-296, 315-413 and 456.
- PV-f:docs/development/code-signing.md:20, 40-43, 53, 99-101, 137-149 and 185-190.
- PV-f:scripts/assemble-updater-manifest.mjs:49-63.
- PV:docs/journeys/J17-software-update-install/journey.md:61-67.
- PV:apps/desktop/src-tauri/tauri.conf.json:44-64.
- [H1] platevault/homebrew-tap `Casks/platevault.rb` (the caveat recommends right-click → Open).
