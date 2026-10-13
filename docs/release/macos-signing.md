# macOS signing

PlateVault for macOS is signed with a self-signed certificate named
**PlateVault Self-Signed**. It is not an Apple Developer ID certificate, and
Apple does not notarize the app. So macOS asks you to approve PlateVault
once, by hand, when you first open it.

The certificate stays the same from one release to the next. macOS
identifies an app by a rule built into its signature, called the designated
requirement. With a stable certificate that rule names the certificate, so
every update counts as the same app, and the folder and drive access you
granted carries over. An ad-hoc signature, which releases up to v0.6.1 used,
ties that rule to one exact build, so macOS can treat every update as a new
app ([Apple TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)).

## First launch on macOS Sequoia and later

On macOS 15 Sequoia and later, Control-click (or right-click) › **Open** no
longer opens an app that Apple has not notarized
([Apple, 2024-08-06](https://developer.apple.com/news/?id=saqachfa)). Do this
instead:

1. Move PlateVault to **Applications** and open it. macOS says it cannot
   verify PlateVault. Click **Done**.
2. Open **System Settings** › **Privacy & Security**.
3. Scroll down to **Security**. Next to the message that PlateVault was
   blocked, click **Open Anyway**.
4. Enter your password or use Touch ID, then click **Open Anyway** again in
   the dialog.

macOS remembers this approval for that copy of PlateVault, so later launches
open as normal.

## Folder and drive access after the switch from ad-hoc signing

If you installed PlateVault v0.6.1 or earlier, the first self-signed release
has a new designated requirement. macOS treats it as a different app. It asks
again, once, for each kind of access you granted before:

- folders such as Desktop, Documents and Downloads;
- removable volumes, such as an external drive with your image archive;
- network volumes.

Click **Allow** for each, or turn the access on under **System Settings** ›
**Privacy & Security** › **Files and Folders**. After this one re-grant,
updates keep the access you gave.

## Check a download

To check that a copy of PlateVault carries this certificate, run:

```sh
codesign -dv --verbose=2 /Applications/PlateVault.app
```

The output shows `Authority=PlateVault Self-Signed`, not `Signature=adhoc`.
To compare the certificate itself:

```sh
cd "$(mktemp -d)"
codesign -d --extract-certificates /Applications/PlateVault.app
openssl x509 -inform DER -in codesign0 -noout -fingerprint -sha256
```

Compare the output with this fingerprint:

```text
E9:6A:01:D4:3D:87:F8:BA:86:94:53:71:09:15:28:B6:BB:A4:E6:D1:38:93:D9:5A:70:9F:41:64:26:33:1B:D9
```

## Certificate rotation

The certificate is valid until 7 October 2051. A new certificate, before
then or after a key leak, changes the designated requirement again. It
needs:

1. A release whose built-in updater accepts both the old and the new
   certificate, shipped while releases are still signed with the old one.
   The updater is planned to check the designated requirement before it
   installs an update. Once it does, a client that knows only the old
   certificate refuses an update signed with the new one.
2. A new identity. Rename the old 1Password item first; keep it until no
   supported release needs it. Then run
   `scripts/macos-signing-identity-create.sh --op-vault Private` (see
   [For maintainers](#for-maintainers)).
3. A release signed with the new certificate, with the new fingerprint in
   this page. Users re-grant folder and drive access once, as in the
   [switch from ad-hoc signing](#folder-and-drive-access-after-the-switch-from-ad-hoc-signing).

If the private key leaks, rotate at once. Updates stay protected meanwhile:
the updater also checks each download's minisign signature against a separate
key embedded in the app.

## For maintainers

- `scripts/macos-signing-identity-create.sh` creates the identity: an RSA
  4096 key and a certificate valid for 9125 days, with keyUsage
  digitalSignature and extendedKeyUsage codeSigning. With `--op-vault`, it
  saves the `.p12` and its password in 1Password. It then sets the
  repository secrets `MACOS_SELF_SIGNED_P12` (base64 of the `.p12`) and
  `MACOS_SELF_SIGNED_P12_PASSWORD`, and the variable
  `MACOS_SIGNING_IDENTITY` (`PlateVault Self-Signed`). It prints no secret,
  and it shreds its temporary files. The current identity is in the owner's
  1Password vault **Private**, item **PlateVault macOS signing identity**.
- In `.github/workflows/release-please.yml`, the macOS build leg runs
  `scripts/macos-import-signing-identity.sh` when Developer ID signing
  (`ENABLE_MACOS_SIGNING`) is off. The script imports the identity into a
  temporary keychain, trusts it for code signing on that runner, and exports
  `APPLE_SIGNING_IDENTITY`, so the Tauri bundler signs the `.app` with it. No
  notarization credentials are set, so the bundler skips notarization. With
  the secrets absent, the script does nothing and the build stays ad-hoc
  signed.
- After the build, `scripts/macos-check-app-signature.sh` logs
  `codesign -dv` and the designated requirement. It fails the leg if the
  identity was imported but the `.app` is ad-hoc signed or signed by another
  authority.
