# Cross-platform path safety matrix (2026-10-16)

> How the path code that `platevault-core` depends on behaves on macOS, Windows
> and Linux: `fs_pathsafe` (`crates/fs/pathsafe`) and `safe-filename`
> (`crates/safe-filename`), declared at `crates/platevault-core/Cargo.toml:15`
> and `:17`, plus the core code that applies them. Describes `main` at
> `408b204d`. Spec 001 T100 (bead `astro-plan-cyku`). Setup for a Windows
> machine lives in `windows-native-rust-dev.md`.

## How to read the tables

- **Code** and **Test** cite `file:line` at `408b204d`. Paths are relative to
  `crates/` unless they start with `docs/`.
- **Status** says where the cited test runs:
  - *all*: no platform gate, so it runs in every Stage A job (Windows, Linux,
    macOS; see `testing.md`).
  - *unix*: `#[cfg(unix)]`, so macOS and Linux only.
  - *Windows only*, *Linux only*, *macOS only*: gated to that platform.
  - *ignored*: `#[ignore]`, run by hand only.
  - **UNTESTED**: no test exercises the behaviour on that platform.
- Platform columns state what the code does there. Where the behaviour comes from
  the operating system rather than PlateVault, the cell says so.

## What platevault-core calls

| Dependency | Entry point | Core call sites |
|---|---|---|
| `safe-filename` | `sanitize_token_value` | `platevault-core/src/layout.rs:38-42`, used for Project, run and chosen folder names at `platevault-core/src/layout.rs:176-179` |
| `safe-filename` (through `patterns`) | `resolve_pattern_str` | naming templates at `platevault-core/src/naming.rs:156` and `:166`; `patterns/src/resolver.rs:23` imports the sanitiser |
| `fs_pathsafe` | `is_link_or_junction_metadata` | every no-follow check: `platevault-core/src/inventory.rs:101,160,296,339,478,575,669,676`, `platevault-core/src/inventory/identity.rs:305`, `platevault-core/src/import.rs:1525`, `platevault-core/src/custody.rs:96`, `platevault-core/src/prepare.rs:1469,1591,1833`, `platevault-core/src/results.rs:193,220`, `platevault-core/src/storage/cleanup.rs:1198` |
| `fs_pathsafe` | `create_symlink` | link probe `platevault-core/src/prepare.rs:1044`, Linked View entries `platevault-core/src/prepare.rs:2047` |

Core does not call the `fs_pathsafe` walkers, `contain` or `export_dest`. Other
crates do; section 6 covers them so the crate is described in full.

## 1. Generated folder and file names

Every rule here runs the same on all three platforms. The Windows rules apply
everywhere so a name made on one machine can be opened on another.

| # | Behaviour | macOS | Windows | Linux | Code | Test | Status |
|---|---|---|---|---|---|---|---|
| N1 | Unicode normalisation | Output is NFC. APFS compares names normalisation-insensitively, so an NFC name matches its NFD twin (OS behaviour). | Output is NFC. NTFS stores the code points given. | Output is NFC. ext4 stores the bytes given. | `safe-filename/src/lib.rs:94-97` | `safe-filename/src/lib.rs:253`, `:441-445` | all |
| N2 | C0/C1 controls, soft hyphen, zero-width, bidi overrides, variation selectors and BOM are removed | same | same | same | `safe-filename/src/lib.rs:65-87` | `safe-filename/src/lib.rs:245-249`, `:377-381`, `:433-436` | all |
| N3 | Forbidden characters `/ \ : ? * " < > \|` become `_` | same | same (these are the Windows reserved characters) | same | `safe-filename/src/lib.rs:104-106`, `:116-118` | `safe-filename/src/lib.rs:270-273`, `:450-460` | all |
| N4 | A value never adds a path level: `/` and `\` inside a value become `_`; pattern literals are split on `/` before each piece is sanitised | same | same | same | `safe-filename/src/lib.rs:111-118`; `patterns/src/resolver.rs:233-239` | `safe-filename/src/lib.rs:279-281`, `:287-292`, `:473-484` | all |
| N5 | Leading and trailing dots and whitespace are trimmed; a value with nothing left is an error, never an empty segment | same | same (Windows refuses a trailing dot or space) | same | `safe-filename/src/lib.rs:119-121`, `:219-224` | `safe-filename/src/lib.rs:274-275`, `:397-408` | all |
| N6 | `.` and `..` are refused, before trimming could hide them; the assembled pattern path is checked again | same | same | same | `safe-filename/src/lib.rs:133-138`, `:215-217`; `patterns/src/resolver.rs:259-262` | `safe-filename/src/lib.rs:298-299`, `:384-387`; `platevault-core/tests/naming.rs:124-164` | all |
| N7 | Device names `CON PRN AUX NUL COM1-9 LPT1-9` are refused, any case, on the text before the first dot (`CON.fits`, `nul.xisf`), including names assembled from a literal and a token | same | same | same | `safe-filename/src/lib.rs:145-166`; `patterns/src/resolver.rs:266` | `safe-filename/src/lib.rs:315-329`, `:390-393`, `:411-415`; `patterns/src/resolver.rs:870-873`; `platevault-core/tests/naming.rs:131-132`, `:153-156`, `:160-162` | all |
| N7a | On `main`, device names with superscript digits (`COM¹`, `COM²`, `COM³`, `LPT¹`, `LPT²`, `LPT³`) are **accepted**: they are not in the list, and `to_uppercase` leaves `¹²³` unchanged. Fixed by draft PR #1813: at `53d16f63` they are refused in any case, with an extension and with trailing dots or spaces | accepted; harmless | accepted; Windows reserves these names in every folder, so creating the folder fails ([Microsoft: Naming Files](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file)) | accepted; harmless | `main`: `safe-filename/src/lib.rs:145-148`, `:160-162`. #1813 at `53d16f63`: `safe-filename/src/lib.rs:148-152` | `main`: none. #1813 at `53d16f63`: `safe-filename/src/lib.rs:323-325`, `:402-415`, `:417-426` | `main`: **UNTESTED** (gap; WIN-6). #1813: all |
| N8 | Mixed-script values are refused unless the scripts are only Latin and Greek (Bayer names such as `α Centauri`). A value that `unicode-security` resolves to one augmented script also passes: Han with Hiragana or Katakana (Japanese, `冬の雪`), Han with Hangul (Korean, `日出은`) and Han with Bopomofo are accepted | same | same | same | `safe-filename/src/lib.rs:177-199`, with the single-script test at `:192`; `unicode-security` 0.1.2 `src/mixed_script.rs:21-50`, `:188-190` | Latin/Greek and Cyrillic: `safe-filename/src/lib.rs:343-366`, `:418-422`; the CJK combinations: none | all; CJK combinations **UNTESTED** |
| N9 | Naming-template paths: at most 200 UTF-8 bytes per segment and 200 characters for the whole relative path | same; the OS allows 255 bytes per name | same; the OS allows 255 UTF-16 units per name | same; the OS allows 255 bytes per name | `patterns/src/resolver.rs:42-57`, `:258-283` | `patterns/src/resolver.rs:575-591`; `platevault-core/tests/naming.rs:167-184` | all |
| N10 | Project, run and chosen folder names (`layout::segment`) pass the same sanitiser but have **no length cap**; the `" Results"` and `" (rev N)"` suffixes are added after sanitising | same | same | same | `platevault-core/src/layout.rs:38-58`, `:176-179` | no core test feeds `layout::segment` a refused name; the sanitiser itself is covered by N1-N8 | **UNTESTED** in platevault-core |
| N11 | Full path length: the 200-character cap covers the relative part only; the destination root adds to it. Core adds no `\\?\` prefix of its own | 1024-byte `PATH_MAX` | paths over 260 characters depend on Rust's standard library, which adds `\\?\` to long absolute paths itself [INFERENCE: not verified in this repository], and on the processing tool that opens the folder | 4096-byte `PATH_MAX` | none in core | none | **UNTESTED** (WIN-5) |

## 2. Links, junctions and reparse points

`is_link_or_junction_metadata` answers true for a symlink on every platform and,
on Windows, for any entry with `FILE_ATTRIBUTE_REPARSE_POINT`, which covers
junctions and reparse-point kinds `is_symlink()` does not classify.

| # | Behaviour | macOS | Windows | Linux | Code | Test | Status |
|---|---|---|---|---|---|---|---|
| L1 | Classify an entry from `symlink_metadata` | symlink | symlink, junction or other reparse point | symlink | `fs/pathsafe/src/lib.rs:62-75` | symlink: `fs/pathsafe/src/lib.rs:409-419`, `:423-444`; junction: `fs/pathsafe/src/lib.rs:475-504` | symlink all (`:423` unix); junction Windows only |
| L2 | `is_link_or_junction` fails closed: absent is "not a link", any other stat error is "link" | same | same | same | `fs/pathsafe/src/lib.rs:47-52` | `fs/pathsafe/tests/fail_closed.rs:16-35`, `:37-41`; `fs/pathsafe/tests/proptest_pathsafe.rs:42-47` | unix (whole file is `cfg(unix)`); proptest all |
| L3 | The inventory walker records a link or junction as an issue, "link or junction not followed", and keeps that path uncertain | symlink tested | junction handled by L1 | symlink tested | `platevault-core/src/inventory.rs:478-484` | `platevault-core/tests/inventory.rs:474-525` | unix; Windows junction **UNTESTED** (WIN-1) |
| L4 | A location root that is itself a link or junction is refused; linked ancestors such as macOS `/var` are allowed. On Windows the no-follow handle also refuses a reparse point | same | same, plus handle check | same | `platevault-core/src/inventory/identity.rs:275-279`, `:305-312`, `:838-851` | none | **UNTESTED** (WIN-2) |
| L5 | A retry scope that passes through a link is refused | same | same | same | `platevault-core/src/inventory.rs:292-307` | `platevault-core/tests/inventory.rs:718-724` | unix; Windows **UNTESTED** |
| L6 | A folder swapped for a link after it was listed never brings outside files in; every ancestor's stamp is re-checked before and after a header read | same | same | same | `platevault-core/src/inventory.rs:336-345`, `:411-434`, `:574-578` | `platevault-core/tests/inventory.rs:532-573` | unix; Windows **UNTESTED** |
| L7 | Creating a link: Unix `symlink`; Windows `symlink_file` only (no directory junctions); other targets return an error. Core probes the destination first and refuses Linked View with the reason when the probe fails | symlink | file symlink; needs the symlink privilege (Developer Mode or elevation, OS behaviour) | symlink | `fs/pathsafe/src/lib.rs:262-276`; `platevault-core/src/prepare.rs:1012-1047` | `fs/pathsafe/src/lib.rs:409-419`; `platevault-core/src/prepare.rs:3136-3161`, `:3166-3176` | all; Windows without privilege **UNTESTED** (WIN-3) |
| L8 | Hardlink mode: Unix checks same volume and read access; Windows always refuses with "cannot be checked on this platform" | checked | refused | checked | `platevault-core/src/prepare.rs:1603-1638` | none | **UNTESTED** (WIN-4) |
| L9 | Rebuilding a prepared link during archive works on macOS and Linux; Windows refuses and keeps the source | supported | refused | supported | `platevault-core/src/storage/archive.rs:1596-1611` | none for the Windows branch | Windows **UNTESTED** |
| L10 | Trashing a link moves the link, never its target | same | same | same | `platevault-core/src/custody.rs:95-97` | `platevault-core/tests/custody.rs:205-207` | unix; Windows **UNTESTED** |
| L11 | Stale link-probe entries are removed by exact prefix and age; a link is removed, never followed; folders are kept | same | same | same | `platevault-core/src/prepare.rs:1053-1069` | `platevault-core/src/prepare.rs:3181-3210` | unix |

## 3. Volumes, case and Unicode on disk

| # | Behaviour | macOS | Windows | Linux | Code | Test | Status |
|---|---|---|---|---|---|---|---|
| V1 | Each location records whether its volume compares names by case and by normalisation | APFS/HFS+: case from the volume personality, normalisation insensitive; FAT/exFAT: case insensitive, normalisation unknown; shares: both unknown | NTFS, ReFS, FAT, exFAT: case insensitive, normalisation sensitive; others unknown | ext2-4, XFS, Btrfs, F2FS: both sensitive; vfat/exFAT: case insensitive, normalisation unknown; shares: both unknown | `platevault-core/src/inventory/identity.rs:459-475`, `:508-509`, `:629-633`, `:688-689`, `:803-812` | share case only: `platevault-core/src/inventory/identity.rs:921`; `platevault-core/tests/inventory.rs:729-743` probes a real macOS volume but asserts no case values | **UNTESTED** for real volumes |
| V2 | Path equality uses the recorded values: either unknown means exact comparison; insensitive normalisation compares NFC; insensitive case compares lowercase | same | same | same | `platevault-model/src/lib.rs:314-337` | `platevault-core/tests/state_boundaries.rs:89-99` | all |
| V3 | A rescan matches a case or normalisation variant of a known asset only with the same size, mtime and a qualified file ID; path equivalence alone never adopts a record | same | same | same | `persistence/library/src/lib.rs:3746-3768` | `persistence/library/tests/catalog.rs:1151`, `:1227`, `:1258` | all |
| V4 | Names are kept as the OS gives them: Unix bytes or Windows UTF-16, never normalised or lossily converted | NFD name kept | NFD name kept; an unpaired surrogate survives the wire format | arbitrary bytes kept | `platevault-model/src/lib.rs:195-232` | `platevault-core/tests/inventory.rs:403-413`, `:465-466`; `platevault-core/tests/model.rs:79-94`; `platevault-core/tests/state_boundaries.rs:101-118` | all; the Linux byte name (`platevault-core/tests/inventory.rs:405-409`) and the Windows round trip (`platevault-core/tests/state_boundaries.rs:110-117`) run only on their OS |
| V5 | A stored path containing NUL is refused when rebuilt | same | same | same | `platevault-model/src/lib.rs:237-254` | none | **UNTESTED** |
| V6 | Image extensions match ASCII case-insensitively (`.FITS`, `.Xisf`) | same | same | same | `platevault-core/src/inventory.rs:775-779`; `platevault-core/src/import.rs:1693-1694` | none with an upper-case extension | **UNTESTED** |
| V7 | Results discovery skips dot-files, `Thumbs.db` and `desktop.ini`, any case | same | same | same | `platevault-core/src/results.rs:181-186` | none | **UNTESTED** |
| V8 | A scan never crosses into another volume mounted inside the root; that folder is a boundary scope | tested with a disk image | a volume mounted on a folder meets the same device check | a filesystem mounted inside meets the same device check; a bind mount of the same filesystem keeps its device and is walked | `platevault-core/src/inventory.rs:300-301`, `:485-501` | `platevault-core/tests/inventory.rs:786-807` | macOS only, ignored (MAC-1); Windows and Linux **UNTESTED** (LNX-3) |
| V9 | A location root needs a remount-stable folder ID, so FAT and exFAT roots are refused; on Windows only NTFS qualifies, so ReFS is refused too | FAT, exFAT refused | only NTFS accepted | vfat, exFAT and unknown filesystems refused | `platevault-core/src/inventory/identity.rs:203-205`, `:322-331`, `:815` | `platevault-core/tests/inventory.rs:811-848` | macOS only, ignored (MAC-1); Windows and Linux **UNTESTED** (WIN-7, LNX-4) |

## 4. Roots, prefixes, separators and shares

| # | Behaviour | macOS | Windows | Linux | Code | Test | Status |
|---|---|---|---|---|---|---|---|
| P1 | A location root must be absolute and contain no `..` | `/` prefix | drive letter with `\`, or UNC; `C:foo` and `\foo` are relative (`Path::is_absolute`) | `/` prefix | `platevault-core/src/inventory/identity.rs:287-294` | `platevault-core/tests/inventory.rs:642-643` | all |
| P2 | Network addresses are refused before any filesystem call: any URL scheme of two or more characters, `//server/share`, `\\server\share`, `\\?\UNC\`, `\\.\UNC\`; `C:\`, `\\?\C:\` and `\\.\C:\` stay local | same | same | same | `platevault-model/src/volume.rs:38-71`; `platevault-core/src/inventory/identity.rs:284-286` | `platevault-model/src/volume.rs:86-118`; `platevault-core/src/inventory/identity.rs:1077-1083` | all |
| P3 | A share the OS mounted is identified by server and share, without the user; SMB and AFP names are lowercased, NFS paths keep their case | `smbfs`, `afpfs`, `nfs`, `webdav` | a mapped drive (`DriveType` 4) is Network; a `\\?\UNC\` root ends the volume query unqualified | `nfs`, `nfs4`, `cifs`, `smb3`; `serverino` decides stable file IDs | `platevault-core/src/inventory/identity.rs:492-511`, `:676-690`, `:706-727`, `:734`, `:753-760` | `platevault-core/src/inventory/identity.rs:917-936`, `:966-993`, `:996-1001` | all (parsers only); real Windows query **UNTESTED** (WIN-8) |
| P4 | An unmounted share reads Offline, never Missing; another share at the same path is a conflict | same | same | same | `platevault-core/src/inventory.rs:668-680` | `platevault-core/src/inventory/identity.rs:1042-1074` | all |
| P5 | A stored relative path refuses a prefix, a root and `..` | same | same | same | `platevault-model/src/lib.rs:262-270` | `platevault-core/tests/model.rs:68-77` | all |
| P6 | Stored paths keep the native separator (`\` on Windows); display text is a lossy rendering, never the identity | `/` | `\` | `/` | `platevault-model/src/lib.rs:221-232`, `:272-277` | `platevault-core/tests/inventory.rs:99-103` (helper builds native separators) | all |
| P7 | The inventory walker turns an unreadable or interrupted directory into an issue and an incomplete scope, never into absence; an unreadable scan scope ends the scan with an error | mode-000 folder tested | ACL denial handled by the same branch | mode-000 folder tested | `platevault-core/src/inventory.rs:409-459`, `:470-477` | `platevault-core/tests/inventory.rs:474-525`; `platevault-core/tests/state_boundaries.rs:73-86` | unix (denial assertions skip when run as root); Windows **UNTESTED** (WIN-10) |
| P8 | Results discovery lists unreadable folders and entries, skips links, and reports an unreadable root as unavailable | same | same | same | `platevault-core/src/results.rs:191-234` | none | **UNTESTED** |
| P9 | OS Trash refuses volumes where moving deletes at once | writable local APFS, HFS+, FAT and exFAT only; network volumes refused | fixed drives only, within the Recycle Bin size and policy; removable and network drives refused; UNC paths read as network | own freedesktop Trash: same-device Trash folder, created owner-only, `.trashinfo` paths escaped | `platevault-core/src/custody/trash.rs:155-176`, `:219-231`, `:345-468`, `:492-541`, `:551-552` | `platevault-core/src/custody/trash.rs:706`, `:724`, `:751-754`, `:758-760` | all for the classifiers; `:758-760` Linux only; real Recycle Bin and second-volume Trash **UNTESTED** (WIN-9, LNX-2) |

## 5. Pending change

Row D2 below describes `main` at `408b204d`. The open branch
`fix/fs-inventory-data-safety` changes `real_files_under_reporting` so per-entry
stat and iteration errors are reported as unknown instead of being dropped, and
carries that through `fs_inventory` reconcile. Update D2 when it lands. It does
not touch `real_dirs_under` or `platevault-core`.

## 6. fs_pathsafe parts platevault-core does not call

| # | Behaviour | macOS | Windows | Linux | Code | Test | Status |
|---|---|---|---|---|---|---|---|
| D1 | The walkers skip links unless following is on; `real_dirs_under(root, true)` returns `[root]`; with following on, directories are deduplicated by canonical path so a cycle ends | same | same | same | `fs/pathsafe/src/lib.rs:160-188`, `:213-250` | `fs/pathsafe/src/lib.rs:423-444`, `:448-465`; `fs/pathsafe/tests/fail_closed.rs:48-67`; `fs/pathsafe/tests/proptest_pathsafe.rs:89-111`, `:198-210` | unix for links; proptests all |
| D2 | Unreadable directories: `real_dirs_under` skips them silently; `real_files_under_reporting` lists a directory whose `read_dir` failed but drops per-entry errors (`entries.flatten()`). See section 5. Draft PR #1810 (`fix/fs-inventory-data-safety`) changes this reporting and removes `real_files_under`; update this row when #1810 lands | same | same | same | `fs/pathsafe/src/lib.rs:172-174`, `:232-236` | `fs/pathsafe/src/lib.rs:371-391` | unix; per-entry errors **UNTESTED** |
| D3 | `probe_root` tells a missing, non-directory, gated-link or unreadable root apart from an empty one | same | same | same | `fs/pathsafe/src/lib.rs:121-144` | `fs/pathsafe/src/lib.rs:333-342`, `:346-361` | all; gated link unix |
| D4 | Containment is lexical: the root and the joined path are normalised with `path-clean`, then compared by prefix; nothing follows links or touches the disk. Roots must be absolute, so on Windows they need a drive or UNC prefix | same | same | same | `fs/pathsafe/src/contain.rs:97-155`; `fs/pathsafe/src/test_support.rs:13-21` | `fs/pathsafe/src/contain.rs:211-310` | all |
| D5 | Export destination. The path must be absolute. The final name must not be `.`, `..` or a device name, on every platform. The parent is canonicalised. An existing entry, link or case variant is refused at validation and again just before the rename. The write goes to a `create_new` temporary file. **Known gap:** the second check and the `std::fs::rename` are two steps, so an entry another process creates between them is replaced, because `rename` replaces an existing file. The "never overwrites" guarantee holds only against entries that exist at the second check | case variant refused on case-insensitive APFS; the race replaces | case variant tested; missing UNC share tested; the race replaces (`std::fs::rename` replaces on Windows too) [INFERENCE: from the Rust standard library documentation, not tested here] | case variants stay apart; the race replaces | `fs/pathsafe/src/export_dest.rs:68-98`, `:141-178`; second check and rename at `:155-162` | `fs/pathsafe/src/export_dest.rs:199-202`, `:217-227`, `:264-270`, `:273-281`, `:337-353`, `:358-369`, `:373-384`, `:391-407`, `:411-417`, `:421-425`, `:429-432`. `:337-353` covers an entry that appears before the second check, not one between check and rename | all, with these gates: `:358-407` unix, `:411-425` Windows only, `:429-432` off Windows. macOS case variant **UNTESTED** (MAC-2); check-to-rename race **UNTESTED** (gap) |
| D6 | `wire_path` replaces every `\` with `/` on every platform, and falls back to lossy UTF-8. On Windows that converts separators. On macOS and Linux `\` is a valid name character, so a file named `a\b.fits` and the nested `a/b.fits` give the same wire text `a/b.fits` | converts; `\` in a name collides with a nested path | converts separators | converts; `\` in a name collides with a nested path | `fs/pathsafe/src/lib.rs:292-297`, `:305-308` | none | **UNTESTED** on every platform; the Unix collision is a gap |

## 7. Manual verification checklist

Run on a real machine; record the result, date and build next to each item.
Item ids: WIN Windows, LNX Linux, MAC macOS. The row id in brackets is the
matrix row the item proves.

### Windows (NTFS system drive unless stated)

- [ ] **WIN-1 (L3)** In a capture location, run `mklink /J linked C:\Elsewhere`
  with a FITS file in `C:\Elsewhere`. Scan. Expect an issue at `linked` reading
  "link or junction not followed" and no file from `C:\Elsewhere` in the results.
- [ ] **WIN-2 (L4)** Register a junction itself as a location root. Expect
  `invalid_input`, "location root is a link or junction".
- [ ] **WIN-3 (L7)** With Developer Mode off and a standard account, review a
  preparation. Expect Linked View (symlink) refused with the OS reason and Copy
  offered. Turn Developer Mode on and repeat: expect Linked View offered and each
  prepared entry a file symlink (`dir /AL`).
- [ ] **WIN-4 (L8)** Choose hardlink mode. Expect "hardlink eligibility … cannot
  be checked on this platform; choose another mode".
- [ ] **WIN-5 (N11)** Choose an output parent deep enough that a prepared file
  path exceeds 260 characters, with long paths disabled in the registry. Prepare
  with Copy. Record whether PlateVault writes the files, and whether the
  processing tool opens them.
- [ ] **WIN-6 (N7a)** Name a run `COM¹` and review its preparation. Record
  whether PlateVault accepts the name and what Windows does when the folder is
  created.
- [ ] **WIN-7 (V9)** Register a root on an NTFS USB disk, an exFAT USB disk and
  a ReFS volume if one exists. Expect NTFS accepted; exFAT and ReFS refused with
  "no remount-stable folder ID".
- [ ] **WIN-8 (P2, P3)** Register a folder on a mapped drive (`Z:\Astro`):
  expect volume kind Network. Register `\\server\share\Astro`: expect the
  network-address refusal before any file access.
- [ ] **WIN-9 (P9)** Move a reviewed entry to the Recycle Bin from a fixed
  drive, a USB stick and a mapped drive. Expect the fixed drive to work and the
  other two refused because Windows would delete at once. A USB disk that
  reports itself as fixed counts as fixed.
- [ ] **WIN-10 (P7)** Deny the current user read on a subfolder (`icacls sub
  /deny %USERNAME%:(RX)`). Scan. Expect an `access_denied` issue at that folder,
  an incomplete scope, and siblings reconciled.

### Linux (ext4 home unless stated)

- [ ] **LNX-1 (V4)** `cargo test -p platevault_core --test inventory
  progressive_scan_reports_real_headers_and_per_file_errors_without_writing`
  runs the byte-name branch. Then create a FITS file named with a `0xFF` byte in
  a location and scan in the app: expect it indexed and shown with a replacement
  character.
- [ ] **LNX-2 (P9)** Trash an entry on a second ext4 volume (expect
  `.Trash-$UID` at its top folder, mode 700) and on a vfat USB stick.
- [ ] **LNX-3 (V8)** Mount a USB disk on a folder inside a location root. Scan.
  Expect that folder as a boundary scope with `identity_conflict`.
- [ ] **LNX-4 (V9)** Register a root on a vfat and on an exFAT stick. Expect
  both refused.
- [ ] **LNX-5 (P3)** Register a folder on a CIFS mount with `serverino`, then
  remount with `noserverino`. Expect the second refused as a root without stable
  folder IDs.

### macOS

- [ ] **MAC-1 (V8, V9)** Run the ignored disk-image tests; they attach and
  detach images with `hdiutil`:
  `cargo test -p platevault_core --test inventory -- --ignored nested_foreign_volume_is_a_boundary_scope roots_without_stable_folder_ids_are_refused_before_any_batch`.
- [ ] **MAC-2 (D5)** On the default case-insensitive APFS volume, export the
  log to `export.JSON` in a folder holding `Export.json`. Expect "export
  destination already exists" and `Export.json` unchanged.

## 8. Verification record

On 2026-10-16, on macOS arm64 at `408b204d`, this command passed with no
failures. Only the two `hdiutil` tests in MAC-1 were ignored. The `unix` and
`all` rows ran; the Windows-only and Linux-only rows did not.

```bash
cargo test -p fs_pathsafe -p safe-filename -p patterns -p platevault_model \
  -p persistence_library -p platevault_core --no-fail-fast
```

`cargo nextest` was not installed on that machine, so `cargo test` ran the same
unit and integration tests.
