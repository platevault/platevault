<!-- Generated from a beads decision bead. Edit the bead, not this file:
     bd show astro-plan-eub2i -->
---
number: 4
title: "Decision: distribution strategy per OS (NSIS + SignPath later, macOS self-signed, Linux unchanged, winget, Store later, update-check setting)"
status: accepted
date: 2026-10-13
bead: astro-plan-eub2i
---

# Decision: distribution strategy per OS (NSIS + SignPath later, macOS self-signed, Linux unchanged, winget, Store later, update-check setting)

## Context and Problem Statement

Owner answers of 2026-10-13 to the decisions D1-D11 in `apps/prototype/design/R10-UPDATER-BEST-OF-BREED.md` (branch ui-harness-v5, bead astro-plan-mbf26) §6, recorded on astro-plan-mbf26. The research compared per-OS updaters (§1, §4), the free SignPath Foundation certificate (§2), Velopack, MSIX and the Store (§3), and migration from 0.5.x/0.6.x installs (§5).

## Considered Options

- Apply to SignPath now (D1a): likely rejected on reputation as of 2026-10-13 [X1]; reapplying is allowed, so waiting costs nothing.
- Buy a Certum or OV certificate (D1c): 29-58 USD or 150-300 USD a year, with the owner's legal name as publisher; rejected on cost while the free route is open.
- Apple Developer Program with notarization (D3): removes Gatekeeper friction but costs 99 USD a year; deferred.
- Sparkle 2 on macOS (D4): mature, but a second update mechanism and only worth it with Developer ID signing.
- Velopack on Windows (D5): rejected until it ships package signature verification (§3.1).
- Flathub, Snap or a deb/rpm repository on Linux (D6): not chosen; left for a later decision.

## Decision Outcome

PlateVault ships one shared Rust updater on every OS and sets distribution per platform as follows:
- Windows: NSIS per-user installers, signed through SignPath Foundation once it accepts the project.
- macOS: a stable self-signed identity, with a designated-requirement check before each update.
- Linux: the existing AppImage, deb and rpm channels, unchanged.
- Stores: winget now, and the Microsoft Store after Windows signing works.
- Privacy: a "Check for updates automatically" setting and a published privacy statement.
- Update offer: a system notification with Install now and Install on quit buttons, with the in-app notice as fallback.

### Rationale

Criteria, set in the research before the options were scored: one update mechanism and one signature check across OSes (S3), no recurring cost, no friction on every update, and a migration path for existing installs.
- Windows (D1, D2, D5, D11): NSIS keeps the per-user install that existing installs already use; Velopack does not verify package signatures (§3.1). SignPath is free for OSI-licensed projects, but its reputation requirement was probably not met on 2026-10-13 (§2.1), so the owner prepares now and applies once the project has outside references. Publisher shown: "SignPath Foundation". Each release then needs two manual approvals (§2.4, §2.6).
- macOS (D3, D4): owner, 2026-10-13: "the self updater process plus self signed is probably easier and less complex". A stable self-signed identity gives a designated requirement that survives updates, which ad-hoc signing does not (§4.2 [AP3]), without the 99 USD/year Apple Developer Program. The shared minisign client replaces Sparkle, so one updater serves every OS.
- Linux (D6): no option chosen; current AppImage, deb and rpm channels stay.
- winget (D10): free and fits S3. Microsoft Store (D9): needs every PE file signed by a trusted CA [MS3], so it waits for Windows signing.
- Update offer (owner, 2026-10-13): the install choice goes inside the system notification, not only in an in-app notice. Tauri's desktop notifications have no cross-platform action buttons, so each OS gets its own Rust adapter in the shared updater; nothing downloads before a click.
- Privacy (D8): the startup update check contacts GitHub; SignPath's terms ask for a privacy statement and an option to disable such traffic [SP1].

### Consequences

- Costs: every Windows release needs two SignPath approvals with MFA within the job's wait window, so releases stop being unattended (D11). SmartScreen still warns until the certificate builds reputation (§2.3).
- macOS users still see a Gatekeeper prompt on first launch (System Settings, Privacy and Security, Open Anyway), and existing installs re-grant folder and drive access once when signing switches from ad-hoc to the self-signed identity. A future certificate change breaks the designated-requirement check and needs a planned rotation.
- The .p12 and its password become repository secrets that only the owner may approve.
- The Store listing waits for split signing (F2) and SignPath.
- Notification actions mean three per-OS adapters (UserNotifications, Windows toasts under the installer's AppUserModelID, freedesktop actions) to build and test, plus an in-app fallback. PR #1795 ships with the in-app notice only until then.

### Confirmation

Work beads linked to this record with relates-to: SignPath preparation (policy page and privacy statement), the automatic-check setting, winget publishing, the SignPath application (owner), Windows signing enablement, the Store listing, macOS self-signed signing, findings F1-F6, and astro-plan-5wcib (services-crate updater with the macOS designated-requirement check), and the update-offer notification bead. The decision holds when those beads close against their acceptance criteria.
