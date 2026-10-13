# Uninstalling PlateVault

Uninstalling removes the app and leaves your image folders alone, because
PlateVault never stores your frames in its own folders. Its own data stays
behind by default, so a later reinstall picks up where you left off. That
data is the library database, the resolve cache, the logs and the window
position. Each section explains how to remove it too. Removing it deletes
your catalogue, plans and audit history for good.

Quit PlateVault before you uninstall it.

## Windows

### NSIS installer (`PlateVault_<version>_x64-setup.exe`)

The NSIS installer installs for your user account only, into
`%LOCALAPPDATA%\PlateVault`.

1. Open **Settings → Apps → Installed apps**, find **PlateVault**, and choose
   **Uninstall**. Or run `uninstall.exe` in `%LOCALAPPDATA%\PlateVault`.
2. To remove your data as well, tick **Delete the application data** in the
   uninstaller. It deletes both data folders listed under
   [Where your data lives](#where-your-data-lives).

### MSI installer (`PlateVault_<version>_x64_en-US.msi`)

The MSI installs for all users, into `C:\Program Files\PlateVault`, and needs
administrator rights to remove.

1. Open **Settings → Apps → Installed apps**, find **PlateVault**, and choose
   **Uninstall**. From a terminal, `msiexec /x PlateVault_<version>_x64_en-US.msi`
   does the same.
2. The MSI uninstaller leaves your data in place. Delete the two Windows
   folders under [Where your data lives](#where-your-data-lives) by hand, for
   each user who ran PlateVault.

## macOS

### Disk image (`.dmg`)

1. Drag **PlateVault** from your **Applications** folder to the Trash.
2. To remove your data, delete the macOS folders under
   [Where your data lives](#where-your-data-lives).

### Homebrew

- `brew uninstall --cask platevault` removes the app.
- `brew uninstall --zap --cask platevault` also removes its data, caches and
  preferences, except the log folder,
  `~/Library/Logs/dev.astro-plan.astro-library-manager`. Delete that one by
  hand.

## Linux

### AppImage

Delete the `.AppImage` file. If you added it to your applications menu with a
tool such as AppImageLauncher, remove it through that tool. Then delete the
Linux folders under [Where your data lives](#where-your-data-lives) if you
want your data gone.

### Debian and Ubuntu (`.deb`)

```bash
sudo apt remove plate-vault
```

### Fedora and other RPM-based systems (`.rpm`)

```bash
sudo dnf remove plate-vault
```

On openSUSE, use `sudo zypper remove plate-vault`.

Removing the `.deb` or `.rpm` package leaves your data in your home folder.
Delete the Linux folders under [Where your data lives](#where-your-data-lives)
to remove it.

## Where your data lives

PlateVault names its folders after its application identifier,
`dev.astro-plan.astro-library-manager`.

| System | Folder | What it holds |
|---|---|---|
| Windows | `%APPDATA%\dev.astro-plan.astro-library-manager` | Library database (`alm.db`), resolve cache (`simbad-cache.redb`), window position |
| Windows | `%LOCALAPPDATA%\dev.astro-plan.astro-library-manager` | Logs and the built-in web view's data |
| macOS | `~/Library/Application Support/dev.astro-plan.astro-library-manager` | Library database, resolve cache, window position |
| macOS | `~/Library/Logs/dev.astro-plan.astro-library-manager` | Logs |
| macOS | `~/Library/Caches/`, `~/Library/WebKit/` and `~/Library/HTTPStorages/`, each in a `dev.astro-plan.astro-library-manager` folder | Web view caches |
| macOS | `~/Library/Preferences/dev.astro-plan.astro-library-manager.plist` and `~/Library/Saved Application State/dev.astro-plan.astro-library-manager.savedState` | App preferences and saved window state |
| Linux | `~/.local/share/dev.astro-plan.astro-library-manager` (or under `$XDG_DATA_HOME`) | Library database, resolve cache, logs |
| Linux | `~/.config/dev.astro-plan.astro-library-manager` | Window position |
| Linux | `~/.cache/dev.astro-plan.astro-library-manager` | Web view cache |

Some of these folders appear only after you have used the matching feature.

If you started PlateVault with the `PV_DATA_DIR` environment variable, the
database, resolve cache, logs and window position are in that folder instead.

## Related

- [Privacy and network access](./11-privacy.md)
- [Code signing policy](../release/code-signing-policy.md)
