# F4 library recovery after a stop

This note traces recovery through the rebuilt library backend. Its source citations do not establish whether a desktop Project or Home screen uses these commands. (`apps/desktop/src-tauri/src/library_shell.rs:54-250`; `apps/desktop/src-tauri/src/commands/project_apply.rs:4-12`; `apps/desktop/src-tauri/src/commands/home.rs:4-8`)

## Apply journals

### Durable operation and journal

Before Apply touches the folder tree, the catalog validates the request revision and basis. The transaction reserves the Project's sole active operation and creates a manifest generation with a `building` manifest. (`crates/persistence/library/src/project_view.rs:1047-1095`; `crates/persistence/library/src/project_operations.rs:69-119`)

The journal stores operation and Project ids, manifest generation, phase, outcome, settled phase, folder identities, and error. (`crates/platevault-model/src/project_view.rs:429-443`)
Its phases include source verification, build verification, swapping, manifest commit, foreign-file transfer, retirement, and `Settled`. (`crates/platevault-model/src/project_view.rs:353-400`)
The core records each phase before its filesystem effect. (`crates/platevault-core/src/apply.rs:806-820,1017-1033,1123-1172`)

The expected tree stores identities for the Project root and `View/`, `View (building)/`, and `View (previous)/`. Recovery treats names alone as insufficient proof of ownership. (`crates/platevault-model/src/project_view.rs:416-427`; `crates/platevault-core/src/apply.rs:740-756`)

`Catalog::unsettled_applies` selects journal rows whose phase is not `settled`. (`crates/persistence/library/src/project_view.rs:312-327`)
`Catalog::latest_apply_journal` returns the highest-generation journal, whether settled or not. It returns `None` if the Project has no Apply history. (`crates/persistence/library/src/project_view.rs:339-361`)

### A normal Failed or Canceled Apply

Apply can settle as `Failed` or `Canceled` only before `NewInstalled`. It can settle as `Applied` only from `ManifestCommitted` or a later phase. (`crates/platevault-model/src/project_view.rs:403-414,445-450`)
Both a failure and cancellation leave the old View active. For cancellation, `Run::end` reports an unchanged View. (`crates/platevault-core/src/apply.rs:847-868`)

When the user cancels, `Run::end` clears the staging tree before it records the outcome. It removes links, partial files, and files that match recorded digests. It leaves unreadable or unproven files on disk. (`crates/platevault-core/src/apply.rs:852-863`; `crates/platevault-core/src/apply/files.rs:232-260`)

Persistence records entries built so far, marks the manifest `discarded`, and settles both the journal and Project operation. The journal retains the outcome and error. (`crates/persistence/library/src/project_view.rs:172-207,1155-1172`; `crates/persistence/library/src/project_operations.rs:122-139`)

`Run::end` clears `View (building)/` for a canceled Apply. A failed Apply leaves that folder on disk. (`crates/platevault-core/src/apply.rs:847-863`)
The next explicit Apply creates a new operation and generation. It first clears leftover staging files, but refuses if it cannot prove ownership of every entry. (`crates/persistence/library/src/project_view.rs:1047-1095`; `crates/platevault-core/src/apply.rs:884-901`; `crates/platevault-core/src/apply/files.rs:232-260`)

### A process stop during Apply

`Library::open` runs Apply reconciliation before it returns. (`crates/platevault-core/src/library.rs:127-161`)
Reconciliation reads each unsettled Apply and attempts recovery. If recovery cannot finish, reconciliation leaves the journal unsettled for the next start. (`crates/platevault-core/src/apply.rs:327-334`)

Recovery compares the journal phase and the current folder identities. (`crates/platevault-core/src/apply.rs:293-323,740-783`)

When the journal phase precedes `BuildVerified`, recovery determines that it did not install the new View. It settles the Apply as `Failed`. (`crates/platevault-core/src/apply.rs:314-323,740-783`)
Starting at `BuildVerified`, recovery installs `View (building)/` only if it matches the recorded identity. If the journal records that the old View moved aside but the new one did not install, recovery restores the old folder using its identity. (`crates/platevault-core/src/apply.rs:740-783`)
If folder identities cannot establish a safe result, Apply returns an identity conflict and keeps the journal unsettled. (`crates/platevault-core/src/apply.rs:314-323`)
After recovery proves it installed the new View, Apply commits the manifest and resumes foreign-file transfer. It then retires the old View and settles as `Applied`. (`crates/platevault-core/src/apply.rs:314-323,1123-1172`)

### What the Home backend derives from journals

Home reads each Project's latest Apply journal. (`crates/platevault-core/src/home.rs:177-205`)

When the latest journal outcome is `Failed` or `Canceled`, rule 2 adds an `ApplyNotFinished` wait. (`crates/platevault-core/src/home.rs:303-332`)

That wait opens at the View step. An unsettled journal with no outcome does not create this wait. (`crates/platevault-model/src/home.rs:44-66`)

## Wrap up recovery

At startup, the shell spawns `recover_wrap_up` with a host `SystemTrash`. The asynchronous task may continue while the event loop runs. (`apps/desktop/src-tauri/src/library_shell.rs:306-322`)
On success, the shell logs how many archives it settled. On error, it logs a stop and retries at the next start. (`apps/desktop/src-tauri/src/library_shell.rs:315-319`)
Recovery releases the Project operation for each interrupted Clean up, but leaves the step unfinished. (`crates/platevault-core/src/wrap_up.rs:102-108`; `crates/persistence/library/src/project_wrap_up.rs:565-587`)
Recovery resumes active Wrap up Trash journals through the host Trash. After settlement, it records the Trash step as finished. (`crates/platevault-core/src/wrap_up.rs:109-117`; `crates/persistence/library/src/project_wrap_up.rs:556-562`)

The catalog selects archives with any move lacking an outcome or with an active Project operation. (`crates/persistence/library/src/project_wrap_up.rs:1206-1221`)
Recovery resumes each archive from its recorded phases. After every move settles, it settles the storage operation and archive. (`crates/platevault-core/src/wrap_up/archive.rs:437-473`)
The Project becomes `Archived` if an archive record moved, or `Closed` if none moved. (`crates/persistence/library/src/project_wrap_up.rs:1342-1374`)

The first catalog, Trash, or archive error stops recovery. (`crates/platevault-core/src/wrap_up.rs:102-117`)
The shell logs that stop and retries on the next start. A stopped archive keeps its Project `Closing` until recovery settles it. (`apps/desktop/src-tauri/src/library_shell.rs:315-319`; `crates/platevault-core/src/wrap_up/archive.rs:144-149`)

## OutputWatch start and stop

The rebuilt shell starts `OutputWatch` on the Tauri runtime. Its task first resumes unfinished Copy to Output operations. (`apps/desktop/src-tauri/src/library_shell.rs:323-332`; `crates/platevault-core/src/project_output/watch.rs:98-115,167-171`; `crates/platevault-core/src/project_output.rs:433-447`)
`OutputWatch` then sweeps and follows each open Project that has a processing location. (`crates/platevault-core/src/project_output/watch.rs:200-221`)

During recovery, the watcher lists a copy only after it verifies. An unverified copy settles without a listing. (`crates/platevault-core/src/project_output.rs:433-483`)

Each pass walks `Output/` and `Processing/`. (`crates/platevault-core/src/project_output/watch.rs:350-388`)
The watcher responds to folder changes and files that remain unsettled. It also sweeps Projects on a timer to find files added while PlateVault was closed. (`crates/platevault-core/src/project_output/watch.rs:4-24,71-80,223-233`)
A pass waits while Copy to Output runs. (`crates/platevault-core/src/project_output/watch.rs:350-388`)

When Tauri emits `RunEvent::Exit`, the shell calls `OutputWatch::shutdown`. (`apps/desktop/src-tauri/src/library_shell.rs:329-332`)
Shutdown closes the task's command channel and waits through its grace period. If the task has not finished, shutdown aborts it. Dropping the watcher also aborts its task. (`crates/platevault-core/src/project_output/watch.rs:71-80,139-158`)

## What the library exposes

The Apply command returns an `ApplyReport` when a build fails or is canceled. (`apps/desktop/src-tauri/src/commands/project_apply.rs:39-55`)

The shell returns command errors as `ErrorResponse` values with kind, identity, scope, retry action, and message. (`apps/desktop/src-tauri/src/commands/library.rs:32-51`; `crates/platevault-model/src/lib.rs:203-213,229-270`)

After reviewing the new frames, if rule 2 has waits, Home returns `NextAction::WaitsOnUser`. (`crates/platevault-core/src/home.rs:267-280`; `crates/platevault-model/src/home.rs:70-91`)
The waits include calibration-blocked suggestions, the latest failed or canceled Apply, and pending files in `View (previous)/`. (`crates/platevault-core/src/home.rs:303-332`)

The first wait selects Sessions or View. (`crates/platevault-model/src/home.rs:44-66`)

The rebuilt shell registers Home and Project Apply handlers. The command modules do not establish that any frontend consumes or renders these F4 surfaces. (`apps/desktop/src-tauri/src/library_shell.rs:54-250`; `apps/desktop/src-tauri/src/commands/home.rs:4-8`; `apps/desktop/src-tauri/src/commands/project_apply.rs:4-12`)
