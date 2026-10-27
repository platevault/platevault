# winget

PlateVault for Windows is published to the
[Windows Package Manager](https://learn.microsoft.com/en-us/windows/package-manager/)
community repository, [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs),
as **PlateVault.PlateVault**. Once the package is listed, install it with:

```powershell
winget install --id PlateVault.PlateVault
```

winget installs the same files as the GitHub release: the NSIS per-user
installer (`PlateVault_<version>_x64-setup.exe`) and the MSI
(`PlateVault_<version>_x64_en-US.msi`). PlateVault's built-in updater keeps
working after a winget install. `winget upgrade` also picks up new versions
once each one is merged into winget-pkgs.

## How releases reach winget

The `winget` job in `.github/workflows/release-please.yml` runs after every
published release, once the updater manifest is out. It downloads a pinned
[Komac](https://github.com/russellbanks/Komac) release binary, checks it
against the SHA256 that the Komac release publishes, and runs
`komac update --submit`. For the release tag, the job:

1. picks the release assets that match `_x64(-setup\.exe|_en-US\.msi)$`;
2. syncs the bot account's winget-pkgs fork with upstream;
3. writes the new version's manifests, with each installer's SHA256;
4. opens a pull request to microsoft/winget-pkgs from the fork, and writes
   its URL to the job summary.

The job runs after `updater-manifest`, so the installers are final: when
Windows signing is on, the Windows leg of `build` has already uploaded the
SignPath-signed copies. winget then validates the pull request, and a
moderator merges it.

The job is off until the repository variable `ENABLE_WINGET_PUBLISH` is
`true`. `komac update` only adds versions to a package that already exists
in winget-pkgs, so the first version goes in by hand, as below. The job runs
with `continue-on-error`, so a winget failure shows on the job but does not
fail the release run. The Homebrew cask bump, which waits for a successful
release run, still happens.

### Token isolation

The token belongs to a dedicated bot account that owns the winget-pkgs fork
and has **no write access to any platevault repository**. A leaked token can
act only as the bot: it can push to the bot's own repositories, such as the
fork, and open pull requests, but cannot change PlateVault's code or
releases. Only the step that runs Komac sees the token. The job checks out
no code, and Komac is a fixed release checked by SHA256. To move to a newer
Komac, change `KOMAC_VERSION` and
`KOMAC_SHA256` together, with the SHA256 taken from that release's
`SHA256SUMS`.

## Owner steps

Only the owner can do these. Do them once, in this order. Steps 4 and 6
publish PlateVault to winget, so take them only once you have decided to
publish there. Nothing here runs by itself.

1. **Create the bot account and its fork.**
   1. Sign out of GitHub, or use a private browser window. Open
      <https://github.com/signup> and create a new account for the bot, for
      example `platevault-winget-bot`, with its own email address. Turn on
      two-factor authentication: **Settings** › **Password and
      authentication** › **Enable two-factor authentication**.
   2. Do not add the bot to the `platevault` organization, and do not invite
      it as a collaborator on any platevault repository.
   3. Signed in as the bot, open <https://github.com/microsoft/winget-pkgs>
      and click **Fork** › **Create fork**, with the bot as the owner.
   4. As the owner, record the bot's name:

      ```sh
      gh variable set WINGET_FORK_USER --repo platevault/platevault --body platevault-winget-bot
      ```

2. **Create the bot's token.** Signed in as the bot, open **Settings** ›
   **Developer settings** › **Personal access tokens** › **Tokens (classic)**.
   Name it `platevault winget`, pick an expiry date, and select only the
   scopes `public_repo` and `workflow`. Click **Generate token** and copy it.
   Komac needs a classic token, because a fine-grained token cannot open the
   winget-pkgs pull request
   ([Komac #310](https://github.com/russellbanks/Komac/issues/310)).
   `workflow` lets the fork sync when upstream changes its workflow files
   ([Komac #1726](https://github.com/russellbanks/Komac/issues/1726)).

3. **Store the token.** As the owner of platevault/platevault, run this command and enter the bot's token at the prompt:

   ```sh
   gh secret set WINGET_TOKEN --repo platevault/platevault
   ```

4. **Submit the first version.** Komac updates existing packages only, so submit the first manifest by hand.

   Install [Komac 2.16.0](https://github.com/russellbanks/Komac/releases/tag/v2.16.0) and check the download against that release's `SHA256SUMS`, as the job does. Set `KOMAC_FORK_OWNER` to the bot account. Then preview manifests for the latest release using the bot token.

   ```sh
   read -rs -p 'Bot token: ' GITHUB_TOKEN && export GITHUB_TOKEN && echo
   export KOMAC_FORK_OWNER=platevault-winget-bot
   VERSION=0.6.1 # Replace with the latest published release version.
   TAG="v${VERSION}"
   komac new PlateVault.PlateVault --version "${VERSION}" \
     --urls "https://github.com/platevault/platevault/releases/download/${TAG}/PlateVault_${VERSION}_x64-setup.exe" \
            "https://github.com/platevault/platevault/releases/download/${TAG}/PlateVault_${VERSION}_x64_en-US.msi" \
     --package-locale en-US \
     --publisher PlateVault \
     --publisher-url https://github.com/platevault \
     --publisher-support-url https://github.com/platevault/platevault/issues \
     --package-name PlateVault \
     --package-url https://github.com/platevault/platevault \
     --moniker platevault \
     --license AGPL-3.0-only \
     --license-url https://github.com/platevault/platevault/blob/main/LICENSE \
     --short-description "Local-first organizer for large astrophotography libraries" \
     --release-notes-url "https://github.com/platevault/platevault/releases/tag/${TAG}" \
     --dry-run
   ```

   Review the generated manifests. Compare their URLs and SHA256 values with the release assets:

   ```sh
   gh release view "${TAG}" --repo platevault/platevault --json assets --jq '.assets[] | .name + " " + .digest'
   ```

   Then run the same `komac new` command with `--submit` instead of `--dry-run`.

5. **Wait for the merge.** winget-pkgs validates the pull request and a moderator reviews it. After the merge, check the package on Windows:

   ```powershell
   winget show --id PlateVault.PlateVault
   ```

6. **Enable automated submissions.** After the first manifest merges, set the variable:

   ```sh
   gh variable set ENABLE_WINGET_PUBLISH --repo platevault/platevault --body true
   ```

   Each subsequent published release then opens a pull request and writes its URL to the job summary.

## When the job fails

- *WINGET_FORK_USER is empty* or *the WINGET_TOKEN secret is empty*: complete the bot fork setup and set repository secrets and variables in steps 1 and 3.
- *computed checksum did NOT match* in **Install Komac**: the downloaded
  Komac is not the pinned release. Do not change `KOMAC_SHA256` to make it
  pass; check the Komac release first.
- *expected the x64 setup.exe and .msi*: the release does not have exactly
  one installer of each kind matching the pattern above. Check the release's
  assets and the `build` job.
- Komac reports that PlateVault.PlateVault does not exist: the package isn't in winget-pkgs yet. Unset `ENABLE_WINGET_PUBLISH` (`gh variable delete ENABLE_WINGET_PUBLISH --repo platevault/platevault`), submit the first manifest by hand (owner step 4), wait for its merge, then set the variable again.
- Komac reports a permission or fork-sync error: the token has expired,
  lacks a scope, or does not belong to `WINGET_FORK_USER`. Make a new token
  (owner step 2) and store it (owner step 3). Or, signed in as the bot, click
  **Sync fork** on the fork, then re-run the job.
