# Processing-run views: do they need copies?

Scope: the folder a processing run gives to Siril, WBPP or DeepSkyStacker. Ingest is out of scope, because getting raws into the catalogue may cross volumes and copy. The prior research is [INPUT-MODES-RESEARCH.md](INPUT-MODES-RESEARCH.md); this note narrows it.

Status: decided 2026-10-12 as P-PREP3 (HARNESS-V5-FEEDBACK-R1.md § Round 7). The user chose Symlinks by default with a Windows Developer Mode check, Copies as the alternative, and no verification of originals; locking is still open. The recommendations below that differ (hard-link fallback, verification) were not adopted.

Evidence labels: **[src]** is a pinned source, **[probe]** is a local test on macOS 26.7.1 APFS (2026-10-12), and **[code]** is current PlateVault code. Source pins: Siril `2a72477`, siril-doc `9ae8ec8`, PJSR `76e4f38`, DSS `7989bcd`.

## Answer

A view does not need copies. A view made of symlinks is safe for every supported tool and format except Siril SER. Siril without Developer Mode on Windows copies on its own. The disk sprawl during a run comes from the tools' float32 intermediates, about 4 to 12× the raw set, not from the view.

## What the tools do to their inputs

| Tool | Opens an input for writing | Writes beside inputs | Saves "in place" |
|---|---|---|---|
| Siril, FITS | No: `READONLY` ([image_format_fits.c L1413]) | Yes, into its working folder (`.seq`, `pp_`, `r_`, `cache/`) | Unlinks first, then creates ([image_format_fits.c L2091-L2109]), so the link is replaced and the original is untouched |
| Siril, SER | **Yes**: always `r+b`, and it can rewrite the header ([ser.c L762], L362-L372) | Same | n/a |
| Siril, FITSEQ | Yes, only for `sequpdate_key` ([fits_keywords.c L1382-L1419]) | Same | n/a |
| WBPP | No; weights go to a copy in `measured/` ([BPP-SubframeAnalyzer.js L237-L248]) | No; everything goes to `outputDirectory` ([BPP-Processing.js L2008]). The cache is global, in PixInsight's config folder ([BPP-Helper.js L146-L149]) | n/a |
| PixInsight ImageFileManager | Moves the input ([ImageFileManager-engine.jsh L589-L592]) | n/a | On a symlink, moves the link **[INFERENCE: rename semantics]** |
| DeepSkyStacker | No: FITS `READONLY`, TIFF `"r"` ([FITSUtil.cpp L224], [TIFFUtil.cpp L200-L202]) | **Yes**: `.info.txt`, `.cal.*`, masters and `Autosave` next to the lights ([RegisterEngine.cpp L987], [StackingTasks.cpp L243], [StackingEngine.cpp L2555-L2560]) | "Erase from disk" deletes the frame it was given |

Consequences:
- **A real view folder is required.** A bare file list would make DeepSkyStacker write its sidecar files next to the catalogue originals.
- **A symlink view keeps every tool's writes in the view.** On a symlink, save-by-replace and "Erase from disk" act on the link.
- **SER is the one format that writes through.** It needs a writable copy.

## Protecting originals (belt and braces)

| Protection | Write through a link | Rename or delete of the original |
|---|---|---|
| POSIX `0444` | Blocked, EACCES **[probe]** | **Allowed**; this depends only on the folder's permissions **[probe]** |
| macOS `chflags uchg` | Blocked, EPERM **[probe]** | Blocked **[probe]** |
| Read-only folder (`0555`) | n/a | Blocked **[probe]** |
| Windows read-only attribute | Blocked | Delete blocked ([file attribute constants]); rename unverified |

A locked original also blocks PlateVault's own moves, trash and reorganisation, and Finder shows it as Locked. Locking therefore costs friction outside runs.

## What the current backend does **[code]**

- The default intra-drive view kind is **hard link** (`crates/domain/core/src/settings.rs:316`); the cross-drive default is symlink (`:317`).
  - A hard link is the one link kind where a write through the view changes the original **[probe in INPUT-MODES-RESEARCH §6]**.
- Removing or regenerating a view **refuses hard-link views** ("not supported in v1", `crates/app/projects/src/prepared_views.rs:203`, `:324`). With today's defaults, a same-drive view cannot be cleaned up.
- View removal *archives* each view entry (`prepared_views.rs:240-269`). For a symlink this keeps a useless link. Views are also regenerable from the record (`regenerate_prepared_view`), so they can be deleted outright.
- Copy happens only with explicit opt-in (`source_view.rs:130`), and junction appears in the fallback chain even though it cannot target files.

## Where the space actually goes (mono, N frames of size S)

| Item | Size |
|---|---|
| Symlink view | 0 (a symlink takes no data blocks, `st_blocks = 0` **[probe]**) |
| Copy view | N·S |
| Siril `convert` of camera RAW (CR2/NEF/ARW) to FITS | about N·S, whatever the view mode ([convert.rst]) |
| Calibrated `pp_` / WBPP `_c` (float32) | 2·N·S |
| Registered `r_` / WBPP `_r` | 2·N·S |
| Debayered colour | ×3 on top, so about 12·N·S in total |
| Result, masters, logs | small |

Example: 300 × 32 MB mono subs ≈ 9.6 GB of raws.
- A copy view adds 9.6 GB.
- The intermediates add about 38 GB.
- The result is about 0.1 GB.

## Options

| | Option | Disk during the run | Left after Complete | Friction | Where it applies |
|---|---|---|---|---|---|
| A | **Symlink view** | 0 | nothing (the links are deleted) | Source drive must stay connected; Windows needs Developer Mode | macOS, Linux, Windows with Developer Mode |
| B | **Temporary copy view**, deleted on Complete | N·S (0 when it clones on the same APFS, Btrfs or ReFS volume) | nothing | Time and space to copy; slow from a NAS | SER; Windows without Developer Mode across volumes; "copy locally for speed" |
| C | **Hard-link view** + read-only originals | 0 | nothing, once removal supports hard links | Same NTFS or ext4 volume only; 1023 links per file on NTFS; locking friction | Windows without Developer Mode, same volume |
| D | **File list, no view** (WBPP only) | 0 | nothing | Unsafe for DSS; loses the grouping WBPP reads from paths | Not worth a mode of its own; a symlink view costs the same and works with every tool |
| E | Junction per catalogue folder | n/a | n/a | Folders only, but views select individual frames | Not viable |

Cross-cutting choices:

1. **Lifecycle.**
   - Create the view at Prepare and **delete it at Complete or Archive**, rather than archiving it.
   - Regenerate it from the run record if the run is reopened.
   - Temporary copies follow the same rule.
2. **Detecting changes instead of locking.** After the run, compare each original's size, mtime and inode with the record, and re-hash only the ones that differ. This takes seconds, needs no lock and causes no friction.
3. **Intermediates cleanup.**
   - On Complete, offer "Remove intermediate files (calibrated, registered) · frees 38 GB", ticked by default.
   - Keep the result, masters, logs and the tool's project or script.
   - Most of the space is reclaimed here.

## Recommended model (least friction, least sprawl)

- **The view is links.**
  - Use symlinks wherever they can be created.
  - On Windows without Developer Mode, use hard links when the source is on the same volume, else temporary copies.
    - Siril copies the frames into its own working folder whatever the view holds ([FITS_symlink.c L66-L81]). Siril's working folder is inside the run folder, so the intermediates cleanup removes those copies.
    - For Siril there, a hard-link view only avoids a second copy. For WBPP and DSS it avoids copying at all.
    - How Siril reads a hard-linked input on Windows has not been tested **[INFERENCE: an ordinary file, read `READONLY`]**.
  - There is no mode picker. Prepare reports either "Linked · 0 B" or "18 frames copied · 3.4 GB, removed when the run completes".
- **Copies are temporary and exceptional:** SER, Windows without Developer Mode across volumes, or an opt-in "Copy frames locally for speed" for NAS sources.
- **Delete the view on Complete.** Offer intermediates cleanup in the same dialog, so one action returns the disk to roughly the size of the result.
- **Verify, don't lock**, by default. Make "Lock originals during runs" an optional setting (uchg or the read-only attribute, removed at Complete).
- **Backend changes this implies:**
  - The intra-drive default changes from hard link to symlink.
  - View removal deletes links instead of archiving them, and supports hard links.
  - Junction leaves the file fallback chain.
  - Copy is allowed as the automatic last fallback, recorded per item as temporary.

This supersedes P-PREP2's "Automatic = Independent copy first". It also makes the per-item cloned-vs-copied accounting (astro-plan-mks5g) mostly moot, because only fallback copies need counting.

[image_format_fits.c L1413]: https://gitlab.com/free-astro/siril/-/blob/2a724774dc4b2f9218d4d9055e81289b77ca9be3/src/io/image_format_fits.c#L1413
[image_format_fits.c L2091-L2109]: https://gitlab.com/free-astro/siril/-/blob/2a724774dc4b2f9218d4d9055e81289b77ca9be3/src/io/image_format_fits.c#L2091-L2109
[ser.c L762]: https://gitlab.com/free-astro/siril/-/blob/2a724774dc4b2f9218d4d9055e81289b77ca9be3/src/io/ser.c#L762
[fits_keywords.c L1382-L1419]: https://gitlab.com/free-astro/siril/-/blob/2a724774dc4b2f9218d4d9055e81289b77ca9be3/src/io/fits_keywords.c#L1382-L1419
[convert.rst]: https://gitlab.com/free-astro/siril-doc/-/blob/9ae8ec8441c2fed06aa712e1479585624aa229d1/doc/commands/convert.rst
[BPP-SubframeAnalyzer.js L237-L248]: https://gitlab.com/pixinsight/PJSR/-/blob/76e4f38c461320f07a0010bcc973fe26133f303a/src/scripts/BatchPreprocessing/BPP-SubframeAnalyzer.js#L237-L248
[BPP-Processing.js L2008]: https://gitlab.com/pixinsight/PJSR/-/blob/76e4f38c461320f07a0010bcc973fe26133f303a/src/scripts/BatchPreprocessing/BPP-Processing.js#L2008
[BPP-Helper.js L146-L149]: https://gitlab.com/pixinsight/PJSR/-/blob/76e4f38c461320f07a0010bcc973fe26133f303a/src/scripts/BatchPreprocessing/BPP-Helper.js#L146-L149
[ImageFileManager-engine.jsh L589-L592]: https://gitlab.com/pixinsight/PJSR/-/blob/76e4f38c461320f07a0010bcc973fe26133f303a/src/scripts/ImageFileManager/ImageFileManager-engine.jsh#L589-L592
[FITS_symlink.c L66-L81]: https://gitlab.com/free-astro/siril/-/blob/2a724774dc4b2f9218d4d9055e81289b77ca9be3/src/io/FITS_symlink.c#L66-L81
[FITSUtil.cpp L224]: https://github.com/deepskystacker/DSS/blob/7989bcdd9db84a7cc0821e18bf84852c4ecb343d/DeepSkyStackerKernel/FITSUtil.cpp#L224
[TIFFUtil.cpp L200-L202]: https://github.com/deepskystacker/DSS/blob/7989bcdd9db84a7cc0821e18bf84852c4ecb343d/DeepSkyStackerKernel/TIFFUtil.cpp#L200-L202
[RegisterEngine.cpp L987]: https://github.com/deepskystacker/DSS/blob/7989bcdd9db84a7cc0821e18bf84852c4ecb343d/DeepSkyStackerKernel/RegisterEngine.cpp#L987
[StackingTasks.cpp L243]: https://github.com/deepskystacker/DSS/blob/7989bcdd9db84a7cc0821e18bf84852c4ecb343d/DeepSkyStackerKernel/StackingTasks.cpp#L243
[StackingEngine.cpp L2555-L2560]: https://github.com/deepskystacker/DSS/blob/7989bcdd9db84a7cc0821e18bf84852c4ecb343d/DeepSkyStackerKernel/StackingEngine.cpp#L2555-L2560
[file attribute constants]: https://learn.microsoft.com/en-us/windows/win32/fileio/file-attribute-constants
