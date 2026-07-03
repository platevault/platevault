# Windows-Native Rust/Tauri Development (canonical repo in WSL)

**Standard procedure** for live development and troubleshooting of the Astro
Library Manager desktop app as a **native Windows Tauri application**, when your
canonical working copy lives inside WSL.

## 🔒 Golden rule: the Windows checkout is a READ-ONLY runtime mirror

**Never edit files in the Windows checkout** (`C:\dev\astro-plan`, or its
`/mnt/c/dev/astro-plan` view from WSL) — not by hand, not with an editor, not via
an agent. It exists only to *build and run* the app. The **only** thing that ever
changes it is `git reset --hard origin/<branch>`.

All edits happen in the **canonical WSL checkout**. The loop is always:

> **edit in WSL → commit → `git push` → sync + relaunch the mirror.**

Why: the mirror and the WSL repo are two independent checkouts. If anyone edits
the mirror directly, its tree diverges and the next sync either silently loses
those edits or collides with them. Keeping the mirror strictly read-only makes a
conflict **impossible**. Use [`scripts/win-sync-run.ps1`](#sync--relaunch-in-one-step-agents-use-this)
for every sync — it enforces this by discarding (and loudly reporting) any local
change it finds on the mirror.

## Why this setup exists

Running the app from the WSL checkout fails or is painful for two independent
reasons:

1. **UNC path problem.** Windows `node`/`pnpm`/`cargo` cannot use a
   `\\wsl$\…` / `\\wsl.localhost\…` path as a working directory (`cmd.exe`
   refuses UNC CWDs; many tools break). So you cannot drive the build from
   Windows against the WSL filesystem.
2. **WSL↔Windows networking problem.** A Vite dev server bound inside WSL is
   often unreachable from a Windows browser under NAT networking (`localhost`
   forwarding is flaky/absent), so the browser-preview path is unreliable.

The fix that eliminates **both**: keep a **second checkout on a native Windows
NTFS drive** (e.g. `C:\dev\astro-plan`) and build/run there. node, cargo, Vite,
and the WebView2 window are all Windows-native — nothing crosses the WSL
boundary. The WSL copy stays as the canonical repo; the Windows copy is a
**read-only runtime mirror** (see the golden rule above). You never edit the
mirror; you sync it to a pushed branch and it runs that code.

```
WSL  /home/<you>/dev/astro-plan      <- canonical git checkout (ALL edits happen here)
Win  C:\dev\astro-plan               <- read-only runtime mirror: build + run only
      = /mnt/c/dev/astro-plan from inside WSL (never edit through this path)
```

## One-time prerequisites (Windows side)

Verify the Windows toolchain. From PowerShell:

```powershell
node --version            # any current LTS
cargo --version           # rustup default host must be x86_64-pc-windows-msvc
rustup show               # confirm stable-x86_64-pc-windows-msvc
git --version
# MSVC linker (required by the msvc Rust toolchain):
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" `
  -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property displayName
```

Required:

- **Rust (MSVC toolchain)** — `stable-x86_64-pc-windows-msvc`.
- **Visual Studio / Build Tools 2022** with the **“Desktop development with
  C++”** workload (provides `link.exe`; Rust finds it via the registry, no
  `vcvars` needed).
- **Node.js** (LTS) and **pnpm** — enable pnpm via Corepack:
  ```powershell
  corepack enable
  corepack prepare pnpm@10.33.0 --activate
  ```
- **WebView2 Runtime** — preinstalled on Windows 11; otherwise install the
  Evergreen runtime.
- **git** — and allow it to read the WSL repo if you clone from there:
  ```powershell
  git config --global --add safe.directory '*'
  ```

## One-time setup (create the Windows checkout)

Clone from GitHub, or directly from the WSL repo to capture local-only branches
and uncommitted history base:

```powershell
mkdir C:\dev -Force
# Option A: from GitHub (has everything merged into main)
git clone https://github.com/nightwatch-astro/alm.git C:\dev\astro-plan
# Option B: from the WSL working copy (captures local branches too)
git clone \\wsl.localhost\Ubuntu\home\<you>\dev\astro-plan C:\dev\astro-plan
```

Then, from inside WSL, copy over any **uncommitted** app changes you want to see
(the clone only has committed state):

```bash
SRC=/home/<you>/dev/astro-plan ; DST=/mnt/c/dev/astro-plan
cp "$SRC/apps/desktop/src/features/.../Changed.tsx" "$DST/apps/desktop/src/features/.../Changed.tsx"
```

Install dependencies and pre-build esbuild (pnpm blocks its build script by
default; Vite needs it):

```powershell
cd C:\dev\astro-plan
pnpm install
pnpm rebuild esbuild
```

## Sync + relaunch in one step (agents: use this)

**The Windows app always runs the persistent `win-qa` branch.** `win-qa` is the
live QA integration branch that *every* agent merges into. It is never rebased
away or renamed; Windows tracks it and nothing else.

To get any change in front of the Windows app, the loop is always the same:

1. **Do the work in WSL and commit it** on your branch. You may be in the primary
   checkout or in an **isolated git worktree** — either is fine.
2. **Land it on `win-qa`.** Push your branch and merge it into `win-qa`
   (`gh pr create --base win-qa … && gh pr merge --squash`, or a direct merge +
   push). If you worked in a **worktree**, its branch is *not* something Windows
   can run — you **must** merge it into `win-qa` in the shared repo first. A
   branch that only exists in your worktree will never appear on the mirror.
3. **Sync + (re)launch the mirror** — from WSL, drive the Windows script:

   ```bash
   powershell.exe -NoProfile -File 'C:\dev\astro-plan\scripts\win-sync-run.ps1'
   ```

   It hard-resets the mirror to `origin/win-qa`, fixes the stale-mtime rebuild
   trap, reinstalls deps if the lockfile moved, and starts the app (or restarts
   it if anything changed). Add `-Mocks` for a UI-only preview, `-SyncOnly` to
   update without touching the running app, or `-Force` to restart a wedged
   window. `-Branch <name>` runs a different pushed branch for a one-off check.

> **Never edit the mirror to preview a change faster.** Editing
> `C:\dev\astro-plan` (or `/mnt/c/dev/astro-plan`) diverges it from `win-qa` and
> the next sync will discard your edits. The mirror is read-only; `win-qa` is the
> only channel.

**Bootstrapping (one-time, if the script isn't on the mirror yet):** the script
lives in the repo, so it self-updates on every sync. For the very first run,
sync the mirror by hand once, then use the script thereafter:

```powershell
cd C:\dev\astro-plan
git fetch origin; git checkout -B win-qa origin/win-qa; git reset --hard origin/win-qa
pwsh -File scripts\win-sync-run.ps1
```

The sections below document the underlying `win-native-dev.ps1` launcher and the
manual steps `win-sync-run.ps1` automates.

## Daily run

Use the launch script (real backend + WSL-edit-safe HMR by default):

```powershell
cd C:\dev\astro-plan
pwsh -File scripts\win-native-dev.ps1            # real Rust backend
pwsh -File scripts\win-native-dev.ps1 -Mocks     # UI only, in-memory fixtures
```

Or run it by hand (the env vars are the important part):

```powershell
cd C:\dev\astro-plan\apps\desktop
$env:VITE_USE_MOCKS    = 'false'   # real backend; 'true' = fixtures
$env:CHOKIDAR_USEPOLLING = 'true'  # so WSL-side edits trigger HMR
pnpm tauri dev
```

First launch compiles the whole Rust workspace (~1–2 min on a warm machine);
subsequent launches are incremental (~20 s). The native window opens
automatically; Vite serves the frontend on `http://127.0.0.1:5173`.

### Mock vs. real backend — important gotcha

`apps/desktop/vite.config.ts` resolves the flag from **`process.env`**, not the
`.env` file:

```ts
define: {
  "import.meta.env.VITE_USE_MOCKS":
    JSON.stringify(process.env.VITE_USE_MOCKS ?? "true"),
}
```

Consequences:

- **You must export `VITE_USE_MOCKS` as an environment variable.** Editing
  `apps/desktop/.env` alone does **not** wire the backend — the `define`
  overrides it, defaulting to `"true"` (mocks) when the env var is unset. This is
  the usual cause of “the native app is showing mock data.”
- `VITE_USE_MOCKS=false` ⇒ `isTauri()` is true, the frontend calls real Tauri
  `invoke` commands, and data comes from the SQLite store at
  `%APPDATA%\dev.astro-plan.astro-library-manager\alm.db`.
- `VITE_USE_MOCKS=true` ⇒ data comes from `apps/desktop/src/data/fixtures/*`.

## How updates reach the running app

The mirror is read-only, so updates never come from editing it — they come from
syncing `win-qa` (see [Sync + relaunch](#sync--relaunch-in-one-step-agents-use-this)).
Once `win-sync-run.ps1` has fast-forwarded the mirror and touched the changed
files, the running `tauri dev` picks them up:

- **Frontend changes** hot-reload via Vite. Polling
  (`CHOKIDAR_USEPOLLING=true`, set by the launcher) guarantees Vite notices files
  rewritten by `git reset` — a change produces `[vite] (client) page reload …`.
  Editing entry files (`main.tsx`) triggers a full page reload.
- **Rust changes** under `crates/…` or `src-tauri/…` make `tauri dev` rebuild and
  relaunch the app. This only happens if the changed files have a *newer* mtime
  than the last build, which is exactly why `win-sync-run.ps1` touches every file
  it pulled — `git reset` alone restores old mtimes and cargo would skip the
  rebuild, leaving a **stale binary** (the classic "my fix isn't showing" bug).

Because a `reset --hard` can look like a large simultaneous change, the default
`win-sync-run.ps1` behaviour is to **fully restart** the app on any change rather
than trust in-place HMR — the running binary must always reflect the latest
`win-qa` commit.

### Driving it from WSL (agent workflow)

An agent in WSL runs the whole loop without a human at the Windows terminal — but
**only through git + the sync script**, never by editing the mirror:

- Make and commit edits in the **WSL** checkout (primary or worktree).
- Merge them into **`win-qa`** and push.
- Sync + relaunch, then read the log:
  ```bash
  powershell.exe -NoProfile -File 'C:\dev\astro-plan\scripts\win-sync-run.ps1'
  #   watch progress:
  #   powershell.exe -NoProfile -Command "Get-Content -Wait 'C:\dev\astro-plan\tauri-dev.log'"
  ```
  Read `/mnt/c/dev/astro-plan/tauri-dev.log` from WSL for build progress.

## Stop / cleanup

```powershell
Get-Process desktop_shell,cargo,rustc -ErrorAction SilentlyContinue | Stop-Process -Force
# free the Vite port if a stray dev server is holding it:
(Get-NetTCPConnection -LocalPort 5173 -State Listen -EA SilentlyContinue).OwningProcess |
  Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -EA SilentlyContinue }
```

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Native app shows **mock data** | `VITE_USE_MOCKS` env var not set to `false`. The `.env` file alone is ignored (see gotcha above). Relaunch with the env var. |
| `fatal: detected dubious ownership` when cloning from WSL | `git config --global --add safe.directory '*'` on Windows. |
| `Port 5173 is already in use` | A stray Vite is holding the port — kill it (see Stop/cleanup). `strictPort` is on, so Vite won’t auto-pick another. |
| `Ignored build scripts: esbuild` after `pnpm install` | Run `pnpm rebuild esbuild` (or `pnpm approve-builds`). |
| `UNC paths are not supported. Defaulting to Windows directory` | Harmless — `powershell.exe` was started with a WSL CWD. Always `Set-Location C:\dev\astro-plan` (or use the script) before building. |
| `link.exe`/`cl` “not found” at the Rust link step | Install VS Build Tools 2022 “Desktop development with C++”. |
| WSL-side edits don’t hot-reload | Ensure `CHOKIDAR_USEPOLLING=true` (default in the launch script). |
| Keeping the two checkouts in sync | Use `scripts\win-sync-run.ps1` — it does the canonical `git fetch; git reset --hard origin/win-qa` for you (and never preserves mirror-local edits, because there should be none). The mirror is read-only: WSL is canonical, everything lands on `win-qa`, Windows only ever *resets* to it. **Do NOT** pull the Windows checkout from the WSL repo over a `\\wsl.localhost\…` UNC path: `node`/`pnpm` fail over UNC and git is flaky there. Keep all git + node + cargo on the native `C:\` filesystem. |
| Windows mirror shows unexpected local edits | Someone edited the read-only mirror (a rule violation). `win-sync-run.ps1` discards them on the next sync and reports what it dropped. Make the change in WSL, merge to `win-qa`, and re-sync instead. |
| `tauri dev` fails with `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL … Exit status 4294967295` | The `beforeDevCommand` (Vite) couldn't bind `:5173`. A Vite dev server left running **inside WSL** on `:5173` is forwarded to Windows `localhost:5173`, and Vite uses `strictPort`. Kill the WSL `:5173` server (`lsof -ti :5173 \| xargs kill`) before launching on Windows, or change the port. |
