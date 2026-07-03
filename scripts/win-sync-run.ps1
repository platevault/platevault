<#
.SYNOPSIS
  Sync the read-only Windows runtime mirror to a pushed branch and start/restart
  the native Tauri app -- one command, safe for agents to drive from WSL.

.DESCRIPTION
  The Windows checkout (e.g. C:\dev\astro-plan) is a READ-ONLY RUNTIME MIRROR.
  Nobody -- human or agent -- edits files here. All edits happen in the canonical
  WSL checkout, get committed and pushed, and this script fast-forwards the
  mirror to `origin/<branch>` with `git reset --hard`, then (re)launches the app.

  This is the ONLY supported way to move the mirror. It never merges, never
  preserves local edits, and never leaves the mirror on a diverged tree -- so the
  two checkouts can never conflict.

  What it does, in order:
    1. Guards: must run on Windows, mirror must be a local NTFS path (not UNC).
    2. Warns + DISCARDS any local modifications (a dirty mirror = rule violation).
    3. `git fetch` + `git checkout -B <branch> origin/<branch>` + `reset --hard`.
    4. Touches every file that changed between old and new HEAD, so cargo/Vite
       actually notice (git reset restores OLD mtimes -> cargo would skip the
       rebuild and run a STALE binary; this is the #1 "my fix isn't showing" trap).
    5. If pnpm-lock.yaml / package.json changed: `pnpm install` + rebuild esbuild
       (a stale optimized-deps graph otherwise blanks the Vite screen).
    6. Starts the app if it is down; restarts it if anything changed (or -Force).
       Frontend-only + already-running still restarts by default -- the standing
       rule is "the running binary must always reflect the latest pushed commit."

.PARAMETER Branch
  Remote branch to sync the mirror to. Default: 'win-qa' -- the persistent live
  QA branch that every agent merges into and the Windows app always runs off.
  Override only for a one-off preview of some other pushed branch.

.PARAMETER Mocks
  Launch the frontend against in-memory fixtures (VITE_USE_MOCKS=true) instead of
  the real Rust backend. Default is the real backend.

.PARAMETER SyncOnly
  Do the git sync + mtime touch + dep install, but do NOT start or stop the app.
  Prints whether a (re)launch is recommended.

.PARAMETER Force
  Restart the app even when nothing changed (e.g. to recover a wedged window).

.EXAMPLE
  # From WSL, after your change has been merged into win-qa:
  powershell.exe -NoProfile -File C:\dev\astro-plan\scripts\win-sync-run.ps1

.EXAMPLE
  pwsh -File scripts\win-sync-run.ps1 -Mocks            # win-qa, UI-only preview
  pwsh -File scripts\win-sync-run.ps1 -Branch main      # one-off: run some other branch
#>
[CmdletBinding()]
param(
  [string]$Branch = 'win-qa',
  [switch]$Mocks,
  [switch]$SyncOnly,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Run($file, [string[]]$args) {
  & $file @args
  if ($LASTEXITCODE -ne 0) { throw "$file $($args -join ' ') -> exit $LASTEXITCODE" }
}

# -- Guards ------------------------------------------------------------------
# Windows PowerShell 5.1 leaves $IsWindows undefined; pwsh 7 sets it.
if ($PSVersionTable.PSVersion.Major -ge 6 -and -not $IsWindows) {
  throw "Run this on Windows (powershell.exe / pwsh.exe), not inside WSL. The mirror only builds natively."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$desktop  = Join-Path $repoRoot 'apps\desktop'
$launch   = Join-Path $PSScriptRoot 'win-native-dev.ps1'
$log      = Join-Path $repoRoot 'tauri-dev.log'

if ($repoRoot -like '\\*') {
  throw "Mirror is on a UNC path ($repoRoot). It must be a native NTFS checkout (e.g. C:\dev\astro-plan)."
}
if (-not (Test-Path $desktop)) { throw "apps\desktop not found under $repoRoot" }
if (-not (Test-Path $launch))  { throw "win-native-dev.ps1 not found next to this script" }

Set-Location $repoRoot

Say "== Windows runtime mirror: sync + (re)launch ==" 'Cyan'
Say "Repo:    $repoRoot"
Say "Branch:  $Branch"
Say "Backend: $(if ($Mocks) { 'MOCKS (fixtures)' } else { 'REAL (Rust backend)' })"

# -- 1. Enforce read-only mirror: discard any local edits --------------------
$dirty = & git status --porcelain
if ($dirty) {
  Say "!! The Windows mirror has LOCAL MODIFICATIONS -- this violates the read-only-mirror rule." 'Red'
  Say "   Nobody should ever edit files in this checkout. Discarding the following:" 'Red'
  $dirty | ForEach-Object { Say "     $_" 'DarkYellow' }
}

$before = (& git rev-parse HEAD).Trim()

# -- 2. Hard-sync to origin/<branch> (never merge, never preserve) -----------
Say "Fetching origin..." 'Gray'
Run git @('fetch','origin','--prune','--quiet')
& git reset --hard --quiet HEAD 2>$null            # clear working tree so checkout can't be blocked
Run git @('checkout','-B',$Branch,"origin/$Branch")
Run git @('reset','--hard','--quiet',"origin/$Branch")

$after   = (& git rev-parse HEAD).Trim()
$changed = @(& git diff --name-only $before $after | Where-Object { $_ })

Say "HEAD: $($before.Substring(0,9)) -> $($after.Substring(0,9))  ($($changed.Count) file(s) changed)" 'Green'

# -- 3. Fix the stale-mtime trap: touch every changed file -------------------
$now = Get-Date
foreach ($f in $changed) {
  $p = Join-Path $repoRoot ($f -replace '/', '\')
  if (Test-Path -LiteralPath $p) { (Get-Item -LiteralPath $p).LastWriteTime = $now }
}

# -- 4. Reinstall deps if the lockfile / manifests moved ---------------------
$depsChanged = @($changed | Where-Object { $_ -match '(^|/)(pnpm-lock\.yaml|package\.json|pnpm-workspace\.yaml)$' })
if ($depsChanged.Count -gt 0) {
  Say "Dependency manifest changed -> pnpm install (avoids a blank Vite screen)..." 'Yellow'
  Push-Location $repoRoot
  try {
    $env:CI = 'true'   # skip the no-TTY approve-builds purge prompt
    Run pnpm @('install','--frozen-lockfile')
    & pnpm rebuild esbuild 2>$null
  } finally { Pop-Location }
}

# -- 5. Classify the change + current run state ------------------------------
$rustChanged = @($changed | Where-Object {
  $_ -match '\.rs$' -or $_ -match '(^|/)crates/' -or $_ -match 'src-tauri/' -or $_ -match '(^|/)Cargo\.(toml|lock)$'
})
$appProc  = Get-Process desktop_shell -ErrorAction SilentlyContinue
$running  = [bool]$appProc

$frontendCount = $changed.Count - $rustChanged.Count
$kinds = @()
if ($rustChanged.Count -gt 0) { $kinds += 'backend (Rust)' }
if ($frontendCount -gt 0)     { $kinds += 'frontend' }
$changeLabel = if ($kinds.Count) { $kinds -join ' + ' } else { 'none' }
$appLabel = if ($running) { 'RUNNING (pid ' + ($appProc.Id -join ',') + ')' } else { 'not running' }

Say "Changed: $changeLabel" 'Gray'
Say "App:     $appLabel" 'Gray'

if ($SyncOnly) {
  $rec = if (-not $running) { 'app is DOWN -- launch it' }
         elseif ($changed.Count -gt 0) { 'changes pulled -- RESTART recommended' }
         else { 'already up to date -- no relaunch needed' }
  Say "SyncOnly: done. Recommendation: $rec" 'Cyan'
  return
}

# -- 6. Decide + act: start if down, restart on any change (or -Force) -------
$needStart   = -not $running
$needRestart = $running -and ($Force -or $changed.Count -gt 0)

if (-not $needStart -and -not $needRestart) {
  Say "Up to date and running -- nothing to do. (Use -Force to restart anyway.)" 'Green'
  return
}

if ($needRestart) { Say "Restarting to reflect the new commit..." 'Yellow' }
else              { Say "Starting the app..." 'Yellow' }

# Kill any existing app/build/vite so the relaunch is clean and :5173 is free.
Get-Process desktop_shell,cargo,rustc -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$viteOwners = (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue).OwningProcess
if ($viteOwners) { $viteOwners | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }
Start-Sleep -Seconds 1

# Launch detached via the canonical launcher (owns the env-var wiring), combined
# log to $log. cmd /c ... > log 2>&1 gives one redirected file; hidden window.
$mocksArg = if ($Mocks) { ' -Mocks' } else { '' }
$cmd = "pwsh -NoProfile -File `"$launch`"$mocksArg > `"$log`" 2>&1"
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmd -WorkingDirectory $repoRoot -WindowStyle Hidden | Out-Null
Say "Launched (log: $log)" 'Gray'

# -- 7. Wait for readiness (first Rust build can take 1-2 min) ----------------
$deadline = (Get-Date).AddSeconds(210)
$ready = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 3
  $vite = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
  $app  = Get-Process desktop_shell -ErrorAction SilentlyContinue
  if ($vite -and $app) { $ready = $true; break }
}

if ($ready) {
  Say "READY: app window is up and Vite is serving on http://127.0.0.1:5173" 'Green'
} else {
  Say "TIMED OUT waiting for the app. Last 40 log lines:" 'Red'
  if (Test-Path $log) { Get-Content -Path $log -Tail 40 | ForEach-Object { Say "  $_" 'DarkGray' } }
  Say "Watch live with: Get-Content -Wait '$log'" 'Yellow'
  exit 1
}
