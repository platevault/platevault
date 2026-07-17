# Windows verification mechanics (PlateVault / astro-plan)

The launch, reset, recompile-trap, MCP-bridge, native-picker, and blank-screen
mechanics are **canonical in `docs/development/windows-native-rust-dev.md`
§"Validation driving (MCP bridge, reset, recompile trap)"**. That doc is the
single source of truth — do not re-derive the steps here. This file only covers
how `verify-on-windows` consumes them.

## Using the canonical blocks in a generated scenario

The Windows computer-use ("cowork") agent has **no access to this repo** — it
sees only the scenario file and the running app. So you must **copy the relevant
canonical blocks verbatim into the emitted scenario**, never link to them:

- **Preconditions → Deploy:** the "Recompile (mtime) trap" block (branch deploy +
  touch changed `.rs` when Rust changed).
- **Preconditions → Reset:** the "Reset to a clean first-run" block (delete
  `wizard-test.db*`) when the flow needs a fresh first-run.
- **Preconditions → Launch:** the throwaway-DB launch block. App process is
  `desktop_shell.exe`, Vite on `http://127.0.0.1:5173`, real backend. (Any
  `run-dev*.bat` you see is an optional local wrapper; the tracked launcher is
  `scripts\win-native-dev.ps1`.)
- **Troubleshooting:** the "Blank screen (empty `#root`)" block.
- **If the scenario drives the MCP bridge** (vs. pure vision computer-use): the
  "Connect the MCP bridge" + "Native pickers" + "Driving quirks" blocks —
  connect with `driver_session host=localhost port=9223` (mirrored networking;
  the old NAT gateway-IP lookup is obsolete).

Copy only the blocks the change needs. Every value the cowork agent needs (paths,
command names, testids) must live inside the scenario.

## Separate checkouts (state the branch, not "the repo")

- WSL repo `/home/sjors/dev/astro-plan` is where you edit/commit/push.
- The app serves from the **Windows checkout** `C:\dev\astro-plan`; a change
  reaches it only after commit → push → `git reset --hard origin/<branch>` on
  Windows. The cowork agent works only on the Windows side — give it the branch
  name, not repo context.

## Pushing workflow files

Pushing `.github/workflows/*` over HTTPS fails ("OAuth App without workflow
scope") — push via SSH (`git push git@github.com:...`).
