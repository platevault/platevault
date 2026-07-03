---
paths:
  - "**/*"
---

# Windows QA runtime — the `win-qa` branch

The app is exercised as a **native Windows Tauri build** running from a separate
Windows checkout (`C:\dev\astro-plan`) that mirrors this WSL repo. Full runbook:
`docs/development/windows-native-rust-dev.md`.

**The Windows checkout is a READ-ONLY runtime mirror.** Never edit files in it —
not by hand, not via `/mnt/c/dev/astro-plan`, not through a subagent. Editing it
diverges the mirror and causes conflicts. The only thing that ever changes it is
`git reset --hard origin/win-qa`, done by the sync script.

Windows always runs one persistent, live branch: **`win-qa`**. Every agent merges
its work into `win-qa` so the running app reflects it. The loop is fixed:

1. Do the work in WSL and commit it — in the primary checkout **or an isolated
   worktree**. A worktree/feature branch is invisible to Windows on its own.
2. **Merge it into `win-qa`** (`gh pr create --base win-qa … && gh pr merge
   --squash`, or a direct merge) and push. Also merge to `main` per trunk-based
   flow. This step is mandatory: if you only committed on a worktree/feature
   branch, Windows will not see it.
3. **Sync + (re)launch the mirror** from WSL:
   ```bash
   powershell.exe -NoProfile -File 'C:\dev\astro-plan\scripts\win-sync-run.ps1'
   ```
   It defaults to `win-qa`, hard-resets the mirror to `origin/win-qa`, fixes the
   stale-mtime rebuild trap, reinstalls deps if the lockfile moved, and starts or
   restarts the app. Flags: `-Mocks` (UI-only), `-SyncOnly`, `-Force`,
   `-Branch <name>` (one-off preview of another pushed branch).

Do NOT ask the user to run the Windows app against a raw worktree/feature branch,
and do NOT hand-edit the Windows checkout to preview a change faster — always
route through `win-qa` + `win-sync-run.ps1`.
