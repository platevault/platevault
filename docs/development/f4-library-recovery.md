# F4 library recovery after a stop

This note traces recovery behavior in the rebuilt library backend. The Home and Project command handlers register in the library shell. (`apps/desktop/src-tauri/src/library_shell.rs:145-148,237-239`)

## Apply journals

### Durable operation and journal

Before Apply touches the folder tree, the catalog validates the request revision and basis. The transaction reserves the Project's sole active operation and creates a manifest generation with a `building` manifest. (`crates/persistence/library/src/project_view.rs:1047-1095`; `crates/persistence/library/src/project_operations.rs:69-119`)

The journal stores operation and Project ids, manifest generation, phase, outcome, settled phase, folder identities, and error. (`crates/platevault-model/src/project_view.rs:429-443`)
Its phases include source verification, build verification, swap, manifest commit, foreign-file transfer, retirement, and `Settled`. (`crates/platevault-model/src/project_view.rs:353-400`)
The core records each phase before its filesystem effect. (`crates/platevault-core/src/apply.rs:806-820,1017-1033,1123-1172`)

The expected tree stores identities for the Project root and `View/`, `View (building)/`, and `View (previous)/`. Recovery treats names alone as insufficient proof of ownership. (`crates/platevault-model/src/project_view.rs:416-427`; `crates/platevault-core/src/apply.rs:740-756`)

`Catalog::unsettled_applies` selects journal rows whose phase is not `settled`. (`crates/persistence/library/src/project_view.rs:316-327`)
`Catalog::latest_apply_journal` returns the highest-generation journal, whether settled or not. It returns `None` if the Project has no Apply history. (`crates/persistence/library/src/project_view.rs:339-361`)

### A normal Failed or Canceled Apply

Apply can settle as `Failed` or `Canceled` only before `NewInstalled`. It can settle as `Applied` only from `ManifestCommitted` or a later phase. (`crates/platevault-model/src/project_view.rs:403-414,445-450`)
Both a failure and cancellation leave the old View active. For cancellation, `Run::end` reports an unchanged View. (`crates/platevault-core/src/apply.rs:847-868`)

When the user cancels, `Run::end` clears the staging tree before it records the outcome. It removes links, partial files (a `.pv-…partial` copy, and the `.<partial>.tmp-<pid>` file `xisf-header` writes beside one while it edits it), files that match recorded digests, and the patched copies the build plans, proven against their originals. It leaves unreadable or unproven files on disk. (`crates/platevault-core/src/apply.rs:1027-1043`; `crates/platevault-core/src/apply/files.rs:283-333`; `crates/platevault-core/src/custody/transfer.rs:190-202`; `crates/platevault-core/src/patched_copy.rs:537-565`)

Persistence records entries built so far, marks the manifest `discarded`, and settles both the journal and Project operation. The journal retains the outcome and error. (`crates/persistence/library/src/project_view.rs:179-207,1162-1172`; `crates/persistence/library/src/project_operations.rs:122-139`)

`Run::end` clears `View (building)/` for a canceled Apply. A failed Apply leaves that folder on disk. (`crates/platevault-core/src/apply.rs:847-863`)
The next explicit Apply creates a new operation and generation. It first clears leftover staging files, but refuses if it cannot prove ownership of every entry. (`crates/persistence/library/src/project_view.rs:1047-1095`; `crates/platevault-core/src/apply.rs:1072-1089`; `crates/platevault-core/src/apply/files.rs:307-333`)

### A process stop during Apply

`Library::open` runs Apply reconciliation before it returns. (`crates/platevault-core/src/library.rs:130-166`)
Reconciliation reads each unsettled Apply and attempts recovery. If recovery cannot finish, it leaves the journal unsettled for the next start. (`crates/platevault-core/src/apply.rs:327-334`)
Recovery compares the journal phase and the current folder identities. (`crates/platevault-core/src/apply.rs:293-323,740-783`)

When the journal phase precedes `BuildVerified`, recovery determines that it did not install the new View. It settles the Apply as `Failed`. (`crates/platevault-core/src/apply.rs:314-323,740-783`)
Starting at `BuildVerified`, recovery installs `View (building)/` only if it matches the recorded identity. (`crates/platevault-core/src/apply.rs:740-783`)
If folder identities cannot establish a safe result, Apply returns an identity conflict and keeps the journal unsettled. (`crates/platevault-core/src/apply.rs:314-323`)
After recovery proves it installed the new View, Apply commits the manifest and resumes foreign-file transfer. It then retires the old View and settles as `Applied`. (`crates/platevault-core/src/apply.rs:314-323,1123-1172`)

### What the Home backend derives from journals

Home reads each Project's latest Apply journal. (`crates/platevault-core/src/home.rs:177-206`)

When the latest journal outcome is `Failed` or `Canceled`, rule 2 adds an `ApplyNotFinished` wait. (`crates/platevault-core/src/home.rs:304-336`)

That wait opens at the View step. An unsettled journal with no outcome does not create this wait. (`crates/platevault-model/src/home.rs:44-66`)

## Wrap up recovery

At startup, the shell spawns `recover_wrap_up` with a host `SystemTrash`. The asynchronous task may continue while the event loop runs. (`apps/desktop/src-tauri/src/library_shell.rs:315-331`)
On success, the shell logs how many archives it settled. On error, it logs a stop and retries at the next start. (`apps/desktop/src-tauri/src/library_shell.rs:324-328`)
Recovery releases the Project operation for each interrupted Clean up, but leaves the step unfinished. (`crates/platevault-core/src/wrap_up.rs:102-108`; `crates/persistence/library/src/project_wrap_up.rs:565-587`)
Recovery resumes active Wrap up Trash journals through the host Trash. After settlement, it records the Trash step as finished. (`crates/platevault-core/src/wrap_up.rs:109-117`; `crates/persistence/library/src/project_wrap_up.rs:556-562`)

The catalog selects archives with any move lacking an outcome or with an active Project operation. (`crates/persistence/library/src/project_wrap_up.rs:1206-1221`)
Recovery resumes each archive from its recorded phases. After every move settles, it settles the storage operation and archive. (`crates/platevault-core/src/wrap_up/archive.rs:437-473`)
The Project becomes `Archived` if an archive record moved, or `Closed` if none moved. (`crates/persistence/library/src/project_wrap_up.rs:1342-1374`)

The first catalog, Trash, or archive error stops recovery. (`crates/platevault-core/src/wrap_up.rs:102-117`)
The shell logs that stop and retries on the next start. A stopped archive keeps its Project `Closing` until recovery settles it. (`apps/desktop/src-tauri/src/library_shell.rs:315-319`; `crates/platevault-core/src/wrap_up/archive.rs:144-149`)

## OutputWatch start and stop

The rebuilt shell starts `OutputWatch` on the Tauri runtime. Its task first resumes unfinished Copy to Output operations. (`apps/desktop/src-tauri/src/library_shell.rs:332-335`; `crates/platevault-core/src/project_output/watch.rs:98-115,167-171`; `crates/platevault-core/src/project_output.rs:433-447`)
`OutputWatch` then sweeps and follows each open Project that has a processing location. (`crates/platevault-core/src/project_output/watch.rs:200-221`)

During recovery, the watcher lists a copy only after it verifies. An unverified copy settles without a listing. (`crates/platevault-core/src/project_output.rs:433-483`)

Each pass walks `Output/` and `Processing/`. (`crates/platevault-core/src/project_output/watch.rs:350-388`)
The watcher responds to folder changes and files that remain unsettled. It also sweeps Projects on a timer to find files added while PlateVault was closed. (`crates/platevault-core/src/project_output/watch.rs:4-24,71-80,223-233`)
A pass waits while Copy to Output runs. (`crates/platevault-core/src/project_output/watch.rs:350-388`)

At `RunEvent::Exit`, the shell first shuts down `OutputWatch`. It then stops `CaptureWatch` and drops Windows eject notices. (`apps/desktop/src-tauri/src/library_shell.rs:354-363`)
`OutputWatch::shutdown` closes its command channel, waits through its grace period, and aborts the task if needed. Dropping it also aborts the task. (`crates/platevault-core/src/project_output/watch.rs:71-80,139-158`)

## CaptureWatch and eject notices

The shell starts `CaptureWatch` after `OutputWatch`. It walks online Captures locations and starts a live folder watcher for each. (`apps/desktop/src-tauri/src/library_shell.rs:336-345`; `crates/platevault-core/src/new_captures.rs:9-15,198-217`)

CaptureWatch handles online Captures roots while the app runs. Its shutdown stops its watchers within a grace period. If filesystem work blocks longer, it cancels the task. (`crates/platevault-core/src/new_captures.rs:119-127,339-353`; `apps/desktop/src-tauri/src/library_shell.rs:354-363`)

While it runs, CaptureWatch reads a location's recorded paths again after a scan ends there and after each change of them outside a scan, so its count follows without a scan. The Trash step records frames Trashed through `Library::record_trashed`. An archive announces its destination once a record moves to the verified copy, and its source once the original is retired or kept. Until then the catalog reports the original's path with the size and time the move started from, so the original waiting there is held. An original the archive kept then counts as a new capture, since the library no longer holds a file at that path. (`crates/platevault-core/src/new_captures.rs:34-44,89-96`; `crates/platevault-core/src/library.rs:204-238`; `crates/platevault-core/src/wrap_up/trash.rs:181-183`; `crates/platevault-core/src/wrap_up/archive.rs:470-479,541-544`; `crates/persistence/library/src/lib.rs:281-288,1189-1225`; `crates/persistence/library/src/project_wrap_up.sql:107-111`)

On Windows, the shell starts optional `EjectNotices` after it manages CaptureWatch. The notices forward drive-removal events to CaptureWatch so it can release root handles. Startup continues if the notices cannot start. (`apps/desktop/src-tauri/src/library_shell.rs:346-353`; `apps/desktop/src-tauri/src/eject.rs:68-110`)

The shell stops CaptureWatch before dropping EjectNotices. Pending removal requests can then return without delaying app exit. (`apps/desktop/src-tauri/src/library_shell.rs:354-363`; `apps/desktop/src-tauri/src/eject.rs:68-74`)

## What the library exposes

The Apply command returns an `ApplyReport` when a build fails or is canceled. (`apps/desktop/src-tauri/src/commands/project_apply.rs:39-55`)
An Applied report counts the corrected values written to patched copies, one per held session and corrected field, and the isolated patched copies the installed View holds, one per held frame with a recorded correction, in a Copies or a Symlinks View. Each patched copy's manifest entry records the digest it was proven to hold when written, which retiring the old View and Clean up compare against. The report claims nothing about what an application reads from them, which D-W123 leaves open. (`crates/platevault-model/src/project_apply.rs:270-280`; `crates/platevault-model/src/project_view.rs:254-271`)

The Apply sheet and an Applied report carry the View's `footprint`: the entries that are files of their own, their bytes, and how many are copy-on-write clones. The sheet counts a Copies entry as a clone where a hidden probe clone of its original into the processing location succeeds, once per volume the originals are on; the report counts what the build placed, so a footprint reads "(cloned)" only on one clone-capable volume. No blocker, failure, foreign-file reason or report error carries an OS error's text: Apply logs it, and a failure's reason keeps its code with a fixed diagnostic. (`crates/platevault-core/src/apply.rs` `preview`, `Clones`, `Delivered`; `crates/platevault-core/src/apply/files.rs` `reported`)

`library_check_symlinks` returns a chosen folder's `SymlinkCapability`, for setup, Settings and the Apply sheet: `available`, `developer_mode_off` when Windows refuses the symlink with `ERROR_PRIVILEGE_NOT_HELD`, or `unsupported` for any other refusal. A Symlinks Apply meets the matching blocker, `symlinks_unavailable` or `links_unsupported` naming the processing location, and is refused with the error code of the same name. macOS mounts exFAT with emulated symlinks, so there the probe reads `available`. (`apps/desktop/src-tauri/src/commands/project_apply.rs` `library_check_symlinks`; `crates/platevault-core/src/apply/files.rs` `probe_symlinks`)

The shell returns command errors as `ErrorResponse` values: a stable `code`, the identity and native scope the failure concerns, the retry action, a conflict's current revision, successors and window, and, as `correction`, the field and refusal of a corrected value no patched copy can carry, whether refused when it is recorded or at Apply. No English text crosses IPC; the catalogues word each code as `err_library_<code>`. (`apps/desktop/src-tauri/src/commands/library.rs:38-65`; `crates/platevault-model/src/lib.rs:193-242,298-331,396-437`)

After reviewing new frames, when rule 2 has waits Home returns `NextAction::WaitsOnUser`. (`crates/platevault-core/src/home.rs:268-281`; `crates/platevault-model/src/home.rs:70-91`)
The waits include calibration-blocked suggestions, the latest failed or canceled Apply, and pending files in `View (previous)/`. (`crates/platevault-core/src/home.rs:304-336`)

The first wait selects the Sessions or View step. (`crates/platevault-model/src/home.rs:59-66`)

The rebuilt shell registers Apply and Home handlers. This note documents their backend command results and the `NextAction` data model. (`apps/desktop/src-tauri/src/library_shell.rs:146-147,238`; `apps/desktop/src-tauri/src/commands/home.rs:4-8`; `apps/desktop/src-tauri/src/commands/project_apply.rs:4-12`; `crates/platevault-model/src/home.rs:70-91`)
