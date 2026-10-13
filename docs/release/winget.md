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
published release, once the updater manifest is out. It uses
[WinGet Releaser](https://github.com/vedantmgoyal9/winget-releaser), which
runs [Komac](https://github.com/russellbanks/Komac) `update`. For the
release tag, the job:

1. picks the release assets that match `_x64(-setup\.exe|_en-US\.msi)$`;
2. syncs the winget-pkgs fork with upstream;
3. writes the new version's manifests, with each installer's SHA256;
4. opens a pull request to microsoft/winget-pkgs from the fork.

The job runs after `updater-manifest`, so the installers are final: when
Windows signing is on, `sign-windows` has already replaced them with signed
copies. winget then validates the pull request, and a moderator merges it.

The job is off until the repository variable `ENABLE_WINGET_PUBLISH` is
`true`. WinGet Releaser only adds versions to a package that already exists
in winget-pkgs, so the first version goes in by hand, as below.

## Owner steps

Only the owner can do these. Do them once, in this order.

1. **Fork winget-pkgs.** Open <https://github.com/microsoft/winget-pkgs> and
   click **Fork**. Fork into the `platevault` organization, which is the
   job's default, or into a personal account. For a personal account, run:

   ```sh
   gh variable set WINGET_FORK_USER --repo platevault/platevault --body <account>
   ```

2. **Create the token.** Signed in as an account that can push to the fork,
   open GitHub › **Settings** › **Developer settings** › **Personal access
   tokens** › **Tokens (classic)** › **Generate new token (classic)**. Select
   the scopes `public_repo` and `workflow`. Both tools need a classic token:
   a fine-grained token cannot open the winget-pkgs pull request
   ([Komac #310](https://github.com/russellbanks/Komac/issues/310)).
   `workflow` lets the fork sync when upstream changes its workflow files.
   Note the expiry date: the job fails once the token expires.
3. **Store the token.** Run this, and paste the token at the prompt:

   ```sh
   gh secret set WINGET_TOKEN --repo platevault/platevault
   ```

4. **Submit the first version.** Install Komac (`brew install komac`, or
   `winget install --id RussellBanks.Komac`). Preview the manifests with
   `--dry-run`, then run the same command with `--submit` instead:

   ```sh
   export GITHUB_TOKEN="$(gh auth token)" # or the token from step 2
   komac new PlateVault.PlateVault --version 0.6.1 \
     --urls https://github.com/platevault/platevault/releases/download/v0.6.1/PlateVault_0.6.1_x64-setup.exe \
            https://github.com/platevault/platevault/releases/download/v0.6.1/PlateVault_0.6.1_x64_en-US.msi \
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
     --release-notes-url https://github.com/platevault/platevault/releases/tag/v0.6.1 \
     --dry-run
   ```

   Komac then asks for the fields it cannot read from the installers: install
   modes, extra installer return codes, upgrade behavior, commands,
   protocols, file extensions, author, copyright and description. Press
   Enter at each one to keep the default (**Install** for upgrade behavior,
   empty for the rest). It detects the NSIS installer as `nullsoft`, scope
   `user`, and the MSI as `wix`, scope `machine`. With `--submit` it pushes
   the manifests to the fork and prints the pull request URL.
5. **Wait for the merge.** winget-pkgs runs automated validation, then a
   moderator reviews the pull request. Answer any review comments on the pull
   request. After the merge, check on a Windows machine:

   ```powershell
   winget show --id PlateVault.PlateVault
   ```

6. **Turn the job on.**

   ```sh
   gh variable set ENABLE_WINGET_PUBLISH --repo platevault/platevault --body true
   ```

   From the next release on, the `winget` job opens the pull request for each
   new version. Its log ends with the pull request URL.

## When the job fails

- *Package 'PlateVault.PlateVault' does not exist*: the first submission
  has not merged yet. Finish owner step 5, then re-run the job.
- *does not have the correct permissions* or *failed to sync upstream
  changes*: the token has expired, lacks a scope, or belongs to an account
  that cannot push to the fork. Make a new token (owner step 2) and store it
  (owner step 3). Or sync the fork on GitHub (**Sync fork**), then re-run the
  job.
- *No release assets found*: the release has no installer whose name
  matches the pattern above. Check the release's assets and the `build`
  job.
