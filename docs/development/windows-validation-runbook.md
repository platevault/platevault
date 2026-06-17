# Windows-Native Validation Runbook (2026-06-17)

> Step-by-step manual validation of the desktop app on a **native Windows** Tauri
> build (the only place the real Rust backend + WebView2 GUI run together).
> Setup/build/HMR/troubleshooting live in `windows-native-rust-dev.md` — this doc
> is the **what-to-check** companion. Gap details referenced here are in
> `autonomous-run-2026-06-validation-findings.md`.

## 0. Build verification (before any clicking)

From `C:\dev\astro-plan` (PowerShell):

```powershell
cargo build --workspace                       # default features → MUST succeed
cargo build -p desktop_shell --features dev-tools   # dev surface present
# Release/default build MUST NOT contain the dev surface (Constitution / spec 021):
cargo build -p desktop_shell --release        # dev.* commands compile-time ABSENT
```

- ✅ Expected: all three succeed. The default/release binary has **no**
  `dev.contracts.list` / `dev.calls.list` / `dev.export` commands and no
  `CallBuffer` (verified in source; confirm the binary doesn't expose them).
- The `/dev/contracts` **frontend route still exists** in every JS bundle and
  renders a disabled stub when devMode is off — known deferral (T031/T036), not a
  bug. Only the Rust side is compile-time gated.

## 1. Launch (two modes)

```powershell
pwsh -File scripts\win-native-dev.ps1            # REAL backend (validate this)
pwsh -File scripts\win-native-dev.ps1 -Mocks     # UI-only fixtures (cross-check)
```

Real backend writes SQLite to
`%APPDATA%\dev.astro-plan.astro-library-manager\alm.db`. **Tip:** to re-test
first-run, close the app and delete that file (or rename it).

## 2. First-run + the two known runtime crashes

| # | Action | Expected (correct) | Known issue to confirm/expect |
|---|---|---|---|
| 2.1 | Fresh launch (no `alm.db`) | Redirects to `/setup`, 4-step wizard (Source Folders → Tools → Catalogs → Confirm) | OK in WSL smoke |
| 2.2 | Complete setup, then **relaunch the app** (lands on `/`) | Should show the **Sessions** ledger | **R-1 BLOCKER**: today `/` crashes to "Something went wrong! — Invariant failed: Could not find an active match from /shell/sessions". Index route renders `SessionsPage` but its `useSearch({from:'/shell/sessions'})` isn't the active match. Fix: make the index route `redirect` to `/sessions`. |
| 2.3 | Click **Calibration** in the sidebar | Calibration ledger with master list | **R-2 BLOCKER (verify against real data)**: in mocks this crashes — `MastersList.tsx:126` `Cannot read properties of undefined (reading 'gain')`. Confirm whether real-backend master rows avoid it; if masters list is empty (007 stub) it may not crash. Add null-safety regardless. |

Both crashes are caught by spec-028's error boundary (no white-screen). If R-1/R-2
are fixed first, the rest of this runbook is reachable by normal navigation.

## 3. Per-screen smoke (real backend)

For each: does it render without console errors, and does the data come from the
**real DB** (not fixtures)? Open DevTools console (the dev-tools build) or watch
the bottom **Activity** log panel.

| Screen | Smoke action | Expected | Known-deferred / inert (don't file as new bugs) |
|---|---|---|---|
| **Setup wizard** | Add a real folder via native picker; finish | Folders persist; real OS folder dialog opens | Picker is real on Windows (mock only in browser) |
| **Inbox** | Point at a folder of mixed FITS; Rescan | Folders classified by IMAGETYP; confirm builds a reviewable plan | **No destructive-destination toggle (Archive/OS-trash) in the UI — always defaults to archive** (005 T1-6). `plan_listener` not started → confirmed items won't auto-resolve to "resolved" after apply (built, not spawned). |
| **Sessions** | Filter by frame type / review state; open a session | Server-side filtered list; detail pane | "mixed" filter only matches literally-tagged rows (006); no "Show ignored" Cmd+K entry (006 FR-010); real sessions may be **empty/ungrouped** because inbox confirm doesn't set `root_id` (006). |
| **Calibration** | Open a light session; view match candidates | Ranked candidates with matched/mismatched dims | **Suggest returns nothing on real data**: `calibration_fingerprint`/`acquisition_fingerprint` are never populated from ingestion (007 known); masters list/get are fixture stubs (007). Flat rotation/night tolerances not user-configurable. |
| **Targets** | Open a target; edit notes; Cmd+K search an alias | Notes save + audit | **Cmd+K alias search returns the same 4 fixtures regardless of query** (`search.global` is a stub, 023 T1-7). "Targets" wrongly in primary nav (FR-005). Target detail sessions/projects always empty (FR-003). Alias/rename/note audit is `tracing::info!` only, not real audit rows. |
| **Projects** | Create a project (name + tool + path) | Project created; a `project_create` plan generated (reviewable) | create→plan seam is real. No transaction → a mid-create failure can orphan a project row (008). AddSourcePicker/onboard wizard deferred. |
| **Project detail** | Trigger a lifecycle transition; observe blocked banner | State machine enforces allowed transitions | **Blocked banner always shows generic "user" reason** (typed reasons never wired, 009 T1-3). Auto-ready/auto-block write **no audit row**. Lifecycle stored in **two tables** that can diverge (009). "Open in tool" launches PixInsight/WBPP and walks away (correct). |
| **Manifests / Notes** (project detail) | Edit a project note; view manifests | Note persists to DB + audit | **On-disk `notes/project-notes.md` is never written** (Tauri passes `project_root:None`, 024). Manifests **never auto-generate** on workflow completion (subscriber built but not spawned, 024). `source_map` not shown in the accordion. |
| **Archive** | Send-to-trash / permanently-delete an item | Permanent delete requires typing `DELETE`; block-permanent-delete setting honored | `send_to_trash` is a **metadata-only stub** — no real OS trash yet (025 trash crate deferred). |
| **Settings** | Change values across panes (auto-save, no Save button) | Persist to DB; bottom log shows `settings.changed` | **Aging-threshold control silently does NOT persist** (wrong scope, 018/007 T1-5). Cleanup per-type action table is fixtures. Debounce/snapshot timer not wired (018). |
| **Catalogs** (settings + wizard) | Try to download a catalog | License/attribution shown | **Real download is inert** (external `astro-plan-catalogs` repo unpublished). If/when wired: **minisign signature is NOT verified** — checksum only (014 T1-4). |
| **Activity log** (bottom panel) | Open panel; filter levels; export | Recent entries pull from audit; export writes JSON | **Live push-stream not started** (pull works); export path hardcoded `/tmp` with no file picker (019); `contractVersion` runtime "1" vs schema "2.0.0". |
| **Dev contracts** (`/dev/contracts`, dev-tools build, devMode on) | Open via Cmd+K | Contract list + schema viewer | **Call list is empty** — the recording proxy isn't wrapped at boot (021 T021); export action fails (relative path bug). |

## 4. Cross-cutting things to verify at runtime

- **"Built but never started" subscribers** — confirm these do NOT fire (expected,
  until a startup-wiring pass): inbox plan_listener resolve (005), artifact watcher
  (012), manifest auto-gen on run_completed (024), log live-push (019), guided
  auto-advance (010). One `run_app` wiring pass fixes all five.
- **Guided coach (010)** — overlay should appear post-setup anchored to real
  elements (inbox confirm, "+ New project", "open in tool"). Confirm steps actually
  **advance** on the domain events — wiring was unconfirmed (010 T1-8). `react-joyride`
  is declared but unused (hand-rolled overlay shipped).
- **Audit/safety (Constitution §II)** — for any plan you apply (if an apply UI path
  exists): confirm every item writes an audit row, destination collisions are
  refused (no silent overwrite), and a failed apply leaves a recoverable state.
  ⚠ **Do not apply a real plan against real files yet** — the 025 executor passes
  **raw relative paths with no library-root join / escape check** (T1-2), so paths
  can mis-resolve. Treat real `plan.apply` as not-ready until T1-2 is fixed.

## 5. Results capture

For each screen, record: renders? (Y/N), console errors (paste), data source
(real DB vs fixtures), and any behavior diverging from "Expected" that is **not**
in the known-deferred column. New divergences → add to the validation findings
doc. Re-confirm R-1 and R-2 explicitly (fix candidates above).
