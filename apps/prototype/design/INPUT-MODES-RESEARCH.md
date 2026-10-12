# Prepare inputs: links, clones and copies — research

Scope: how PlateVault should present the reviewed set of frames and masters in `<output>/<Project>/<Run>/` to WBPP and Siril on macOS, Windows and Linux, across local, removable and network volumes. This is read-only research; no repository files were changed.

Evidence labels: **[src]** is a primary source, linked inline. **[probe]** is a local experiment on macOS 26.7.1 (build 25G241), run on 2026-10-12 against `hdiutil` disk images (APFS, HFS+, exFAT, FAT32), calling `clonefile(2)` directly through ctypes. **[INFERENCE]** marks a claim I did not verify against a source or a run.

---

## 1. Summary

1. **Only a clone or a copy meets the trust requirement.** The requirement is that PixInsight and Siril cannot write through to an original.
   - A hard link shares the inode. A write through it changes the original, and a permission change applies to both names. **[probe]** On APFS and HFS+, a `chmod 444` on the link made the original read-only, and a byte written through the link appeared in the original. **[src]** On NTFS, attributes and the security descriptor belong to the file, not to the link ([CreateHardLinkW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createhardlinkw), [Hard links and junctions](https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions)).
   - A symlink sends writes to its target.
   - A clone is isolated: "writes to the source file do not appear in the destination, or vice versa" ([Block Cloning](https://learn.microsoft.com/en-us/windows/win32/fileio/block-cloning); [FICLONE](https://man.archlinux.org/man/FICLONE.2const.en)).
   - A plain copy is isolated as well. So both "Linked" and "Direct source" can only *detect* write-through afterwards, by re-hashing the originals. They cannot prevent it.

2. **Clones work only within one volume.** That rules out clones for most astrophotography layouts: SD card to disk, USB drive to internal disk, NAS to local disk.
   - `clonefile` returns `EXDEV` when "src and dst are not on the same filesystem" ([clonefile(2)](https://keith.github.io/xcode-man-pages/clonefile.2.html)). **[probe]** It also returned `EXDEV` between two separate APFS volumes.
   - `FICLONE` requires "the same mounted filesystem" ([FICLONE](https://man.archlinux.org/man/FICLONE.2const.en)).
   - ReFS block cloning requires "the same ReFS volume" ([Block Cloning](https://learn.microsoft.com/en-us/windows/win32/fileio/block-cloning)).
   - Hard links have the same restriction. Only symlinks, Direct source and copies cross volumes.

3. **`std::fs::copy`, which PlateVault already calls for its Copy mode, is already "clone when possible, else copy" on many systems.**
   - macOS: Rust's std tries `fclonefileat` first and falls back to `fcopyfile` on `ENOTSUP`, `EEXIST` or `EXDEV` ([std unix.rs L2339-L2386](https://github.com/rust-lang/rust/blob/b5427502dab50cb27d9327d2893ddf2337dd4388/library/std/src/sys/fs/unix.rs#L2339-L2386)).
   - Linux: std uses `copy_file_range` ([kernel_copy/linux.rs](https://github.com/rust-lang/rust/blob/b5427502dab50cb27d9327d2893ddf2337dd4388/library/std/src/sys/io/kernel_copy/linux.rs#L1-L24)). Within one filesystem the kernel tries `remap_file_range` (a reflink) before splicing ([fs/read_write.c L1595-L1607](https://github.com/torvalds/linux/blob/24a19b953e2a3d0ea5a8c4951a0ab8f32720c907/fs/read_write.c#L1595-L1607)). NFS and CIFS turn the same call into a server-side copy ([nfs4file.c L191-L200](https://github.com/torvalds/linux/blob/24a19b953e2a3d0ea5a8c4951a0ab8f32720c907/fs/nfs/nfs4file.c#L191-L200), [cifsfs.c L1671-L1685](https://github.com/torvalds/linux/blob/24a19b953e2a3d0ea5a8c4951a0ab8f32720c907/fs/smb/client/cifsfs.c#L1671-L1685)).
   - Windows: std uses `CopyFileExW` ([std windows.rs L1675-L1696](https://github.com/rust-lang/rust/blob/b5427502dab50cb27d9327d2893ddf2337dd4388/library/std/src/sys/fs/windows.rs#L1675-L1696)). Microsoft says that since KB5034848 (Windows 11 Moment 5), "block cloning occurs natively in supported Windows copy operations" on ReFS ([Block Cloning](https://learn.microsoft.com/en-us/windows/win32/fileio/block-cloning)).
   - The real gap is not mechanism but **reporting**: PlateVault cannot tell the user how much space was actually used.

4. **OMP (oh-my-pi) never uses hard links or symlinks for task isolation, because writes must not reach the parent.**
   - It tries filesystem-native clones first, then mount or projection backends, then recursive copy ([pi-iso lib.rs L137-L150](https://github.com/can1357/oh-my-pi/blob/5d0aaffaf1f987503ce129a642fb6e30339615af/crates/pi-iso/src/lib.rs#L137-L150)).
   - It probes per host. It then attempts each backend for the actual source and destination pair and steps down when one is unavailable ([lib.rs L400-L443](https://github.com/can1357/oh-my-pi/blob/5d0aaffaf1f987503ce129a642fb6e30339615af/crates/pi-iso/src/lib.rs#L400-L443), [worktree.ts L563-L602](https://github.com/can1357/oh-my-pi/blob/5d0aaffaf1f987503ce129a642fb6e30339615af/packages/coding-agent/src/task/worktree.ts#L563-L602)).
   - pnpm (clone, then hard link, then copy, with the order varying by OS), cargo (hard link, then copy; clone on macOS), and psf-guard (reflink, then copy) all follow the same shape. psf-guard is the closest prior art: an astro library manager that exports to WBPP.

5. **Direct source (a file list) works for WBPP but not for Siril.**
   - WBPP's automation mode accepts `file=` and `dir=` plus `outputDirectory=` ([psf-guard wbpp.rs L1-L14](https://github.com/theatrus/psf-guard/blob/0d8fb0675555c4cec2f6b9babed27876dbe55e7c/src/commands/export/wbpp.rs#L1-L14)).
   - WBPP reads grouping keywords out of each frame's *path* (smart naming), and the originals' paths carry none. psf-guard therefore has to patch `WBPPUtils.smartNaming.getCustomKeyValueFromPath` ([wbpp.rs L875-L885](https://github.com/theatrus/psf-guard/blob/0d8fb0675555c4cec2f6b9babed27876dbe55e7c/src/commands/export/wbpp.rs#L875-L885)).
   - Siril's `convert` and `link` work only on "all images of the current working directory" ([Siril commands](https://siril.readthedocs.io/en/latest/Commands.html)), so Siril always needs a materialised folder.

6. **Junctions do not help.** A junction links directories only, cannot target files, and is not permitted to point at a mapped network volume ([Hard links and junctions](https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions)). The current fallback chain lists `Junction` for file items ([source_view.rs L156-L163](crates/domain/core/src/source_view.rs)). That entry can never produce a correct result and should go.

7. **Building our own CoW layer (FUSE, WinFsp or ProjFS) is not worth it now.** It needs three driver stacks. On macOS that means a kernel extension (Recovery Mode, "Reduced Security") or FSKit, whose I/O is slower and whose mounts must live under `/Volumes`. Two of the stacks carry licence restrictions on bundling. ProjFS writes the full file to disk on first read anyway. See §7.

**Recommendation in one line:** offer three modes, with **Automatic** as the default.
- **Independent copy**: clone, then server-side copy, then copy. This is the default whenever space allows.
- **Link to originals**: a symlink, or a hard link on the same NTFS volume when symlinks are unavailable. Opt-in, with a warning and re-verification after the run.
- **Give PixInsight the file list**: WBPP only.

Drop hard links as a mode of their own, and drop junctions for files. See §9.

---

## 2. How OMP and others choose

### OMP (`pi-iso`, commit `5d0aaff`)

- **Auto order per OS** ([lib.rs L137-L150](https://github.com/can1357/oh-my-pi/blob/5d0aaffaf1f987503ce129a642fb6e30339615af/crates/pi-iso/src/lib.rs#L137-L150)):
  - macOS: APFS clonefile → ZFS → rcopy
  - Linux: Btrfs → ZFS → reflink (FICLONE) → overlayfs → rcopy
  - Windows: block clone → ProjFS → rcopy
- **Two-stage resolution.** `resolve()` is "only a host-level probe. Some backends still reject a specific `lower`/`merged` pair at start time (cross-device reflinks, non-subvolume btrfs paths, non-ZFS mountpoints)" ([lib.rs L400-L443](https://github.com/can1357/oh-my-pi/blob/5d0aaffaf1f987503ce129a642fb6e30339615af/crates/pi-iso/src/lib.rs#L400-L443)). The caller then walks the candidates and calls `isoStart` on each until one succeeds. It records `fellBack` and `fallbackReason` ([worktree.ts L563-L602](https://github.com/can1357/oh-my-pi/blob/5d0aaffaf1f987503ce129a642fb6e30339615af/packages/coding-agent/src/task/worktree.ts#L563-L602)).
- **Per-file clone primitive** ([cow.rs](https://github.com/can1357/oh-my-pi/blob/5d0aaffaf1f987503ce129a642fb6e30339615af/crates/pi-iso/src/cow.rs)):
  - The header documents FICLONE (btrfs, XFS, bcachefs, OCFS2), `clonefile` (APFS) and `FSCTL_DUPLICATE_EXTENTS_TO_FILE` (ReFS, Dev Drive). On "different filesystems, NTFS, ext4, …" the call fails with an error that `is_unsupported` recognises, and "callers then copy the data instead" (L1-L24).
  - It checks the device up front ("source and destination are on different devices", L113-L158).
  - "Unsupported" errors are:
    - Linux: `EXDEV | EOPNOTSUPP | ENOTTY | EINVAL | ENOSYS` (L278-L279).
    - macOS: `ENOTSUP | EOPNOTSUPP | EXDEV` (L304-L305).
    - Windows: `ERROR_INVALID_FUNCTION | ERROR_NOT_SUPPORTED | ERROR_NOT_SAME_DEVICE | ERROR_INVALID_PARAMETER | ERROR_ACCESS_DENIED` (L450-L458).
  - The Windows path clones in regions under 4 GiB, matches the integrity-stream setting and sets the destination sparse (L346 onward). This follows the [ReFS rules](https://learn.microsoft.com/en-us/windows/win32/fileio/block-cloning).
- **ProjFS is refused under x64-on-ARM64 emulation**, because "the callbacks crash on first invocation" ([projfs.rs L28-L41](https://github.com/can1357/oh-my-pi/blob/5d0aaffaf1f987503ce129a642fb6e30339615af/crates/pi-iso/src/projfs.rs#L28-L41)).
- **Lessons for PlateVault:**
  1. Probe by attempting the operation on the real pair.
  2. Classify errors into "step down" and "fail".
  3. Record the mechanism actually used and why the preferred one failed.
  4. Keep plain copy as the universal floor.

### Other prior art

- **pnpm `packageImportMethod`.** In `auto` mode the order is hardlink → clone → copy on Linux and clone → hardlink → copy on macOS and Windows. pnpm warns: "Under a hardlink, the file in `node_modules` *is* the file in the store, so editing it changes every project". It also notes that on network shares cloning fails and hard linking "succeeds" while paying a round trip per file ([pnpm settings](https://pnpm.io/settings/node-modules)).
- **psf-guard** (astro library manager with WBPP export). It offers three placements, worded as follows ([CALIBRATION_LIBRARY.md L572-L597](https://github.com/theatrus/psf-guard/blob/a05f0c5d64a642b6a2bd8876f4642a04d8aa2d0c/docs/CALIBRATION_LIBRARY.md#L572-L597)):
  - "Copy … a clone or hard link where the filesystem allows, a copy elsewhere"
  - "Link to the originals" (symlinks; "Whatever reads it must see the originals at the same paths")
  - "Reference in place" (WBPP script)

  Its reflink placement calls `reflink_copy::reflink`, then falls back to `std::fs::copy`, and is described as "the right default for a tree another program will consume" ([export/mod.rs L451-L454, L571-L582](https://github.com/theatrus/psf-guard/blob/0d8fb0675555c4cec2f6b9babed27876dbe55e7c/src/commands/export/mod.rs#L451-L582)).
- **cargo `link_or_copy`.** It hard links, then copies. On macOS it copies instead, because `fs::copy` uses `fclonefileat` "which should be as fast as hardlinking", and because of an APFS/Gatekeeper race with hard links ([paths.rs L607-L680](https://github.com/rust-lang/cargo/blob/58e1dfdd157a7b58956f3112a886b16fcb36cdec/crates/cargo-util/src/paths.rs#L607-L680)).
- **Docker.** `overlay2` is the default. `btrfs` and `zfs` "rely on the backing filesystem". `vfs`, the plain-copy floor, is "for situations where no copy-on-write filesystem can be used" ([Docker storage drivers](https://docs.docker.com/engine/storage/drivers/select-storage-driver/)).
- **rsync `--link-dest`.** It hard links unchanged files from a prior directory, and only when they are "identical in all preserved attributes" ([rsync.1](https://download.samba.org/pub/rsync/rsync.1)). Copies preserve hard links only with `-H` (same page). Backup tools that skip `-H` duplicate hard-linked files.
- **Git.** A local clone hard links `.git/objects` "when possible", and `--no-hardlinks` exists "if you are trying to make a back-up" ([git-clone](https://git-scm.com/docs/git-clone)). Worktrees share the object store but check out real files. Hard links are safe in Git only because objects are immutable and written once. PixInsight and Siril give no such guarantee about FITS inputs **[INFERENCE]**.

---

## 3. Capability matrix

Legend:
- **SV** = works on the same volume or filesystem only.
- **XV** = can cross volumes.
- **—** = not supported.
- **P** = depends on server or version, so probe at runtime.

| OS / filesystem | Clone (CoW) | Hard link | Symlink | Junction | Server-side copy/clone |
|---|---|---|---|---|---|
| macOS · APFS | **SV** `clonefile`; `EXDEV` across APFS volumes **[probe]** ([clonefile(2)](https://keith.github.io/xcode-man-pages/clonefile.2.html)) | **SV** **[probe]** | **XV** **[probe]** | n/a | n/a |
| macOS · HFS+ | — (`ENOTSUP` **[probe]**) | **SV** **[probe]** | **XV** **[probe]** | n/a | n/a |
| macOS · exFAT / FAT32 | — (`ENOTSUP` **[probe]**) | — (`ENOTSUP` **[probe]**) | Emulated: macOS stores an `XSym` text file ([msdosfs ExtensionCommon.h L43-L52](https://github.com/apple-oss-distributions/msdosfs/blob/c9f076c4e7c10b4bc3b0177d114aedf1bb8b9109/msdos_appex/ExtensionCommon.h#L43-L52); works **[probe]**). Windows and Linux see a plain file **[INFERENCE]** | n/a | n/a |
| Windows · NTFS | — (block clone is ReFS-only) ([Block Cloning](https://learn.microsoft.com/en-us/windows/win32/fileio/block-cloning)) | **SV**, files only, ≤1023 links per file ([CreateHardLinkW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createhardlinkw)) | **XV**; needs Developer Mode or `SeCreateSymbolicLinkPrivilege` (default: Administrators) ([CreateSymbolicLinkW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createsymboliclinkw), [policy](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-10/security/threat-protection/security-policy-settings/create-symbolic-links)) | Directories only; local volumes only, no network ([Hard links and junctions](https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions)) | n/a |
| Windows · ReFS / Dev Drive | **SV**: cluster-aligned, <4 GB per call, same integrity-stream and sparse setting ([Block Cloning](https://learn.microsoft.com/en-us/windows/win32/fileio/block-cloning)); Dev Drive from Win 11 24H2 / Server 2025 ([Dev Drive](https://learn.microsoft.com/en-us/windows/dev-drive/)); not on removable media ([ReFS overview](https://learn.microsoft.com/en-us/windows-server/storage/refs/refs-overview)) | **P**: ReFS overview lists hard links ✅, older CreateHardLink table says ReFS "No" | **XV** (as NTFS) | Directories only, local | n/a |
| Windows · exFAT / FAT32 | — | — (CreateHardLink is "only supported on the NTFS file system") | — (no reparse points) **[INFERENCE]**; check `FILE_SUPPORTS_REPARSE_POINTS` ([GetVolumeInformationW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getvolumeinformationw)) | — | n/a |
| Linux · ext4 | — ("ext4 … never supported cloning", [pnpm](https://pnpm.io/settings/node-modules)) | **SV** | **XV** | n/a | n/a |
| Linux · Btrfs | **SV** FICLONE ([FICLONE](https://man.archlinux.org/man/FICLONE.2const.en)) | **SV** | **XV** | n/a | n/a |
| Linux · XFS | **SV** if `reflink=1`, which is the mkfs default with `crc=1` ([mkfs.xfs](https://man.archlinux.org/man/mkfs.xfs.8.en)) | **SV** | **XV** | n/a | n/a |
| ZFS (OpenZFS ≥2.2) | **SV**, same pool; "most versions of Linux will not allow clones across datasets"; silently falls back to a copy ([OpenZFS block cloning](https://openzfs.github.io/openzfs-docs/Basic%20Concepts/Data%20Storage/Block%20Cloning.html)) | **SV** | **XV** | n/a | n/a |
| Linux · exFAT / FAT | — | — | — **[INFERENCE]**; Siril documents "Function not implemented" on filesystems without symlinks ([Siril conversion](https://siril.readthedocs.io/en/latest/preprocessing/conversion.html)) | n/a | n/a |
| SMB · Windows client → Windows server | Only when the share is ReFS **P** | **SV** on the share; SMB 3.0 yes, but not on continuously-available shares ([CreateHardLinkW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createhardlinkw)) | Created as an NTFS reparse point. A *remote* link (R2L/R2R) is disabled by default; a local link to a UNC path (L2R) is enabled ([fsutil behavior](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/fsutil-behavior); defaults shown in [VAST KB](https://kb.vastdata.com/docs/enabling-nfs-symlink-traversal-for-smb-clients), secondary source) | Not to network targets | Copychunk via Explorer and Robocopy ([Samba wiki](https://wiki.samba.org/index.php/Server-Side_Copy)) |
| SMB · Windows client → Samba / Synology | **P**: `FSCTL_DUPLICATE_EXTENTS_TO_FILE` only on Btrfs with `vfs_btrfs` (Samba ≥4.7) ([Samba wiki](https://wiki.samba.org/index.php/Server-Side_Copy)); Synology lists "File Fast Clone on Btrfs" ([DSM spec](https://www.synology.com/en-us/dsm/7.2/software_spec/dsm)) | **P** **[INFERENCE]** | **P**: "Samba does not yet support reparse symlinks" ([Samba UNIX Extensions](https://wiki.samba.org/index.php/UNIX_Extensions)) | — | Copychunk on by default since Samba 4.1; Synology "server-side copy on Windows" |
| SMB · macOS client | — **[INFERENCE]** | **P** **[INFERENCE]** | Stored as Minshall+French `XSym` files when the server lacks reparse symlinks ([Samba UNIX Extensions](https://wiki.samba.org/index.php/UNIX_Extensions)) | n/a | Against Samba only with `vfs_fruit` and `fruit:copyfile = yes` ([Samba wiki](https://wiki.samba.org/index.php/Server-Side_Copy), [vfs_fruit](https://www.samba.org/samba/docs/current/man-html/vfs_fruit.8.html)) |
| SMB · Linux cifs client | **P**: `cp --reflink` → duplicate-extents (kernel ≥4.2, SMB3) ([Samba wiki](https://wiki.samba.org/index.php/Server-Side_Copy)) | **P** | `mfsymlinks`, or SMB3 POSIX extensions (on by default from Samba 4.23, [release notes](https://www.samba.org/samba/samba/history/samba-4.23.0.html)) | n/a | `copy_file_range` → copychunk ([cifsfs.c](https://github.com/torvalds/linux/blob/24a19b953e2a3d0ea5a8c4951a0ab8f32720c907/fs/smb/client/cifsfs.c#L1671-L1685)) |
| NFSv3 / v4.0 / v4.1 | — | **SV** within one export **[INFERENCE]** | **XV**, but the target string is "returned to the client for interpretation" ([RFC 7530 §16.25](https://www.rfc-editor.org/rfc/rfc7530.txt)) | n/a | — |
| NFSv4.2 (Linux client) | **P**: CLONE (RFC 7862) via FICLONE ([nfs4file.c L249-L291](https://github.com/torvalds/linux/blob/24a19b953e2a3d0ea5a8c4951a0ab8f32720c907/fs/nfs/nfs4file.c#L249-L291)) | **SV** | as above | n/a | COPY via `copy_file_range` ([RFC 7862](https://www.rfc-editor.org/rfc/rfc7862.txt)) |

NFS client and server limits that remove v4.2 features:
- The macOS NFS client supports v4.0 and v4.1 at most ([mount_nfs](https://keith.github.io/xcode-man-pages/mount_nfs.8.html)).
- Synology serves NFS v2, v3, v4 and v4.1 ([DSM spec](https://www.synology.com/en-us/dsm/7.2/software_spec/dsm)).
- So COPY and CLONE are unavailable for macOS clients and for Synology servers.

Detecting capability per volume:
- **Windows:** `GetVolumeInformationW` returns `FILE_SUPPORTS_BLOCK_REFCOUNTING` ("Indicates that FSCTL_DUPLICATE_EXTENTS_TO_FILE is a supported operation"), `FILE_SUPPORTS_HARD_LINKS` and `FILE_SUPPORTS_REPARSE_POINTS`. However, "SMB does not support volume management functions" ([GetVolumeInformationW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getvolumeinformationw)). Removable media: `GetDriveTypeW` reports USB flash drives as `DRIVE_FIXED` and points to `SPDRP_REMOVAL_POLICY` for USB detection ([GetDriveTypeW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getdrivetypew)).
- **Everywhere, the reliable test is the OMP one:** try the operation on the actual pair and classify the error.

---

## 4. Network filesystems in practice

- **Sources on a NAS, run folder local.**
  - Clones and hard links are impossible across volumes.
  - A symlink on a local Windows disk pointing at a UNC path is a local-to-remote link, which is enabled by default.
  - Point links at UNC paths, not mapped drive letters. With UAC, an elevated process does not see the standard session's mapped drives ([Mapped drives not available](https://learn.microsoft.com/en-us/troubleshoot/windows-client/networking/mapped-drives-not-available-from-elevated-command)).
  - A local copy acts as a cache. It also removes the dependency on the mount staying up during a long WBPP run **[INFERENCE]**.
- **Run folder on a NAS, sources local.**
  - A symlink created there pointing at a local path becomes a *remote* link when the share is read back. Windows clients evaluate remote links as R2L or R2R, both disabled by default.
  - Other machines cannot resolve a path that only means something on the creating machine (RFC 7530 interpretation rule).
  - Hard links are impossible (different volume).
  - Only a copy works.
- **Sources and run folder on the same NAS share.**
  - Copies can stay server-side. Windows uses copychunk; Linux cifs uses `copy_file_range` to copychunk; Linux NFS 4.2 uses COPY; macOS works only with `fruit:copyfile`.
  - On Btrfs-backed Samba or Synology shares, the server can even clone ([Samba wiki](https://wiki.samba.org/index.php/Server-Side_Copy), [Synology DSM spec](https://www.synology.com/en-us/dsm/7.2/software_spec/dsm): "copying data instantly via the SMB protocol when the source and destination … are located in the same Btrfs volume").
  - `std::fs::copy` already reaches these paths on Linux. On Windows it uses `CopyFileExW`; that this triggers copychunk is **[INFERENCE]**, since the Samba wiki only names Explorer and Robocopy.
  - Symlinks on the share are a poor fit. Windows does not follow remote links by default. macOS writes `XSym` pseudo-links that Windows clients see as small files. Samba is still moving to reparse-point symlinks ([Jeremy Allison, 2024](https://lists.samba.org/archive/samba/2024-June/249157.html)).
- **pnpm's measured warning applies:** on NFS and SMB, link operations "succeed" but cost a round trip each, so a copy can be faster ([pnpm](https://pnpm.io/settings/node-modules)).

---

## 5. PixInsight and Siril behaviour

Sources: PJSR at commit `76e4f38`, plus Siril docs.

- **WBPP writes only under its output directory.** The output tree includes `calibrated/`, `registered/`, `master/`, `logs/`, `weights/`, `measured/`, `fastIntegration/` and `cosmetized/` (for example [BPP-Processing.js L2008](https://gitlab.com/pixinsight/PJSR/-/blob/76e4f38c461320f07a0010bcc973fe26133f303a/src/scripts/BatchPreprocessing/BPP-Processing.js#L2008), [L960](https://gitlab.com/pixinsight/PJSR/-/blob/76e4f38c461320f07a0010bcc973fe26133f303a/src/scripts/BatchPreprocessing/BPP-Processing.js#L960)).
  - The only step that writes FITS keywords into a frame chooses its target deliberately. For a frame that has not been processed, it writes a copy to `measured/` ("avoid to overwrite unprocessed files (potentially original data)"). It writes in place only for processed or virtual-group frames ([BPP-SubframeAnalyzer.js L237-L249](https://gitlab.com/pixinsight/PJSR/-/blob/76e4f38c461320f07a0010bcc973fe26133f303a/src/scripts/BatchPreprocessing/BPP-SubframeAnalyzer.js#L237-L249)).
  - So WBPP itself does not write inputs. User actions in PixInsight can: opening a frame and saving it, or the "FileManager".
- **ImageFileManager ("Copy and move files based on FITS keys") can move the input file itself** with `File.move(inputFile, targetFile)` ([ImageFileManager-engine.jsh L589-L604](https://gitlab.com/pixinsight/PJSR/-/blob/76e4f38c461320f07a0010bcc973fe26133f303a/src/scripts/ImageFileManager/ImageFileManager-engine.jsh#L589-L604)).
  - Under Direct source this moves *originals*.
  - Under a symlink or hard link it moves only the link **[INFERENCE: rename semantics]**.
- **WBPP accepts file lists.** Automation mode takes `file=`, `dir=` (recursive) and `outputDirectory=` ([psf-guard wbpp.rs](https://github.com/theatrus/psf-guard/blob/0d8fb0675555c4cec2f6b9babed27876dbe55e7c/src/commands/export/wbpp.rs#L1-L30)).
  - `dir=` would sweep WBPP's own output on a second run (same file).
  - A comma in a path cannot be expressed on WBPP's command line ([psf-guard WBPP.md](https://github.com/theatrus/psf-guard/blob/main/docs/WBPP.md)).
  - Smart-naming keywords come from the path. Direct source therefore loses folder-encoded sessions unless they are injected (see §1.5).
- **Symlinks and junctions in PixInsight:** I found no primary statement. Ordinary file opens follow symlinks transparently, so WBPP reading a symlinked FITS should work **[INFERENCE]**. How `ImageWindow.saveAs` behaves on an existing link (writes through, or replaces it) is **unknown**.
- **Siril needs a folder.**
  - `convert` and `link` act on the current working directory. "For FITS images, Siril will try to make a symbolic link; if not possible, files will be copied". `-out=` sets the output directory ([Siril commands](https://siril.readthedocs.io/en/latest/Commands.html)).
  - On Windows its symlinks "require the activation of the developer mode" ([Siril conversion](https://siril.readthedocs.io/en/latest/preprocessing/conversion.html)).
  - Siril then writes new `pp_`-prefixed files and never rewrites its inputs ([calibrate](https://siril.readthedocs.io/en/latest/Commands.html)).
  - Consequence: on Windows without Developer Mode, Siril copies the whole set again into its process folder, whatever PlateVault prepared.

**Conclusion.** Direct source removes the need to materialise anything only for WBPP. Siril always needs a folder. Direct source also leaves originals exposed to user-driven move and save actions in PixInsight.

---

## 6. Write-through risk and mitigations

| Mechanism | What a tool's write does | Permission or attribute change | Mitigation that keeps originals untouched |
|---|---|---|---|
| Hard link | Modifies the original (shared inode). **[probe]** byte written through the link appeared in the original | Shared: `chmod` on the link changes the original **[probe]**; NTFS "attributes … propagate to all the hard links" ([MS](https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions)) | None. Making the entry read-only also makes the original read-only (that is a change to the original). A tool that saves via temp-then-rename silently breaks the link instead **[INFERENCE]** |
| Symlink | Follows to the target | `chmod` on Linux follows the link **[INFERENCE]** | None preventive. Detect by re-hashing originals after the run |
| Junction | n/a for files | — | — |
| Clone | Copy-on-write; the original is unaffected ([Block Cloning](https://learn.microsoft.com/en-us/windows/win32/fileio/block-cloning), [FICLONE](https://man.archlinux.org/man/FICLONE.2const.en)) | Independent inode | Set the prepared file read-only after hash verification |
| Copy | Independent | Independent | Same as clone |
| Direct source | The tool touches the original directly | — | None; detect only |

Hash verification:
- For clones and copies, hash the prepared file. Reads are local, and this proves the bytes the tool will see.
- For links, the hash reads the original through the link. Re-verify after the run and before cleanup to detect write-through.

---

## 7. Building our own CoW / virtual filesystem

| Platform | Stack | Burden |
|---|---|---|
| macOS | macFUSE kernel backend | On Apple Silicon the user must boot to Recovery, choose "Reduced Security", allow the kext, and restart ([macFUSE Getting Started](https://github.com/macfuse/macfuse/wiki/Getting-Started)). Kexts do not load when booting from external volumes or in VMs (same page) |
| macOS | macFUSE FSKit backend (macOS ≥15.4) | No kext, but mount points must be under `/Volumes`, "Files are always opened in read/write mode", and "I/O performance … is not on par" with the kext ([FUSE Backends](https://github.com/macfuse/macfuse/wiki/FUSE-Backends)). macFUSE licence: "Redistributions in binary form, bundled with commercial software, are not allowed without specific prior written permission" ([LICENSE](https://github.com/macfuse/macfuse/blob/master/LICENSE.txt)) |
| macOS | FUSE-T (NFSv4 local server, no kext) | "For commercial use or/and bundling with commercial software … has to obtain a commercial license" ([License.txt](https://github.com/macos-fuse-t/fuse-t/blob/main/License.txt)) |
| Windows | WinFsp | Kernel driver plus DLL through an installer; GPLv3 with a FLOSS exception ([WinFsp README](https://github.com/winfsp/winfsp)). Rust: `winfsp` 0.13.1, GPL-3.0 |
| Windows | ProjFS | An optional component an admin must enable (`Enable-WindowsOptionalFeature -FeatureName Client-ProjFS`, may need a reboot) ([Enabling ProjFS](https://learn.microsoft.com/en-us/windows/win32/projfs/enabling-windows-projected-file-system)). A read caches the content to disk ("hydrated placeholder"), so a 60 MB FITS costs 60 MB on first read ([ProjFS cache state](https://learn.microsoft.com/en-us/windows/win32/projfs/cache-state)). Crashes under x64-on-ARM64 per OMP. Rust: `windows-projfs` 0.1.8 (GPL-2.0, 478 recent downloads); `projfs` 0.1.2 (last release 2020) |
| Linux | FUSE (`fuser` 0.18.0, MIT) or overlayfs | FUSE is generally available. fuser's macOS support is "untested" and needs the macFUSE kext on Apple Silicon ([fuser README](https://github.com/cberner/fuser)). Overlayfs needs mount privileges or a user namespace, and processes outside the namespace would not see it **[INFERENCE]** |

**Verdict: too complex for what it buys. Defer.**
- **The real gain:** a read-only, zero-space, cross-volume view, where a write returns `EROFS`.
- **The costs:**
  - Three driver stacks, each with its own installer, permission and licence story. The macFUSE and FUSE-T bundling clauses need a decision on whether AGPL PlateVault counts as "commercial".
  - A mount that must stay alive for the whole PixInsight or Siril run, plus stale-mount recovery after a crash **[INFERENCE]**.
  - Every FITS byte passes through userspace.
  - On Windows ProjFS, the space saving disappears once frames have been read.
- OMP needs these backends because it isolates *writable* trees. PlateVault only needs read-only inputs, and clone or copy already gives that.
- Revisit only for a Linux-only FUSE view, and only if users with huge NAS libraries ask for it.

---

## 8. Rust crates

| Crate | Status (crates.io, 2026-10-12) | What it does |
|---|---|---|
| `reflink-copy` | 0.1.30, updated 2026-06-18, ~4.8M recent downloads, MIT/Apache, `cargo-bins` org | `reflink()`: FICLONE (Linux), `clonefile` (macOS), `FSCTL_DUPLICATE_EXTENTS_TO_FILE` (Windows). The Windows path is self-described as "currently untested and probably buggy" ([lib.rs L51-L59](https://github.com/cargo-bins/reflink-copy/blob/7886edec483700bbf9fa41e3ea6c820dff9dd2e1/src/lib.rs#L51-L59)). `reflink_or_copy()` returns `Ok(None)` when it cloned and `Ok(Some(bytes))` when it copied. It falls back to `fs::copy` on any error except `NotFound`, `PermissionDenied` or `AlreadyExists` ([L91-L148](https://github.com/cargo-bins/reflink-copy/blob/7886edec483700bbf9fa41e3ea6c820dff9dd2e1/src/lib.rs#L91-L148)). `check_reflink_support` works only on Windows. On other platforms it returns `Unknown` (L153-L159) |
| `reflink` | 0.1.3, last release 2019-04-02 | Unmaintained predecessor. Do not use |
| `fs_extra` | 1.3.0, last release 2023-02-03 | Recursive copy and move with progress. No clone or link awareness |
| `junction` | 2.1.0, updated 2026-09-24 | Create, delete and read NTFS junctions ("Only works on NTFS") ([lib.rs](https://github.com/tesuji/junction/blob/master/src/lib.rs)). The std equivalent `junction_point` is nightly-only, and "If either path is not a local file path then this will fail" ([std docs](https://doc.rust-lang.org/std/os/windows/fs/fn.junction_point.html)) |
| `symlink` | 0.1.0, last release 2017-01-27 | Thin wrapper over std. Not needed |
| `std::os::windows::fs::symlink_file` | stable | Always passes `SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE` and retries without it on older Windows ([windows.rs L1428-L1450](https://github.com/rust-lang/rust/blob/b5427502dab50cb27d9327d2893ddf2337dd4388/library/std/src/sys/fs/windows.rs#L1428-L1450)). PlateVault's `fs_pathsafe::create_symlink` therefore already works with Developer Mode, with no elevation |
| `std::fs::copy` | stable | Opportunistic clone or offload, as in §1.3 |
| `trash` | 5.2.9, updated 2026-09-13 (PlateVault pins 5.2) | Windows: `IFileOperation` with `FOF_NO_UI \| FOF_ALLOWUNDO \| FOF_WANTNUKEWARNING` ([windows.rs L97](https://github.com/ArturKovacs/trash/blob/b8d9ebc8dbbd6bfc2c07ba5469c5121e202ae419/src/windows.rs#L97)). `FOF_WANTNUKEWARNING` "partially overrides FOF_NOCONFIRMATION" ([SetOperationFlags](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileoperation-setoperationflags)). macOS: Finder via osascript by default, `NSFileManager` optionally ([macos/mod.rs L13-L47](https://github.com/ArturKovacs/trash/blob/b8d9ebc8dbbd6bfc2c07ba5469c5121e202ae419/src/macos/mod.rs#L13-L47)) |
| `fuser` / `winfsp` / `windows-projfs` | see §7 | Virtual-filesystem bindings |

---

## 9. Corner cases

- **SD card removed after Prepare.**
  - Symlinks dangle and Direct source paths vanish. Clones and hard links were never possible, since the card is a different volume.
  - Only a copy survives. Treat removable sources as copy-only.
  - Detecting removable media: on Windows, `SPDRP_REMOVAL_POLICY`, because `DRIVE_FIXED` also covers flash ([GetDriveTypeW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getdrivetypew)); on macOS, DiskArbitration's removable and ejectable keys **[INFERENCE]**.
- **Mixed volumes in one run.** Choose the mechanism per item, then show one summary ("212 cloned, 18 copied, 3.4 GB"). Preflight the bytes that will really be copied against free space before writing anything.
- **Windows without Developer Mode.**
  - Symlink creation fails, and Siril falls back to copying.
  - Hard links still work on the same NTFS volume and need no privilege.
  - Junctions need no privilege ([reconcile.rs comment](crates/fs/executor/src/reconcile.rs)) but cannot target files.
  - On a Dev Drive (ReFS, 24H2+), `CopyFileExW` clones.
- **Hard-link ceilings and drift.**
  - NTFS allows 1023 links per file ([CreateHardLinkW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createhardlinkw)). Years of runs that each link the same flats would hit this ceiling **[INFERENCE]**.
  - Explorer shows stale attributes on sibling links ([MS](https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions)).
- **Antivirus and indexers.**
  - Every copy is a new file for the scanner to process **[INFERENCE]**.
  - On a trusted Dev Drive, Defender runs in "performance mode" (asynchronous scanning), and antivirus filters stay attached by default ([Dev Drive](https://learn.microsoft.com/en-us/windows/dev-drive/)).
  - How Spotlight and Windows Search treat links: not researched **[INFERENCE: links add no new content to index]**.
- **Time Machine and backups.**
  - Copies and clones are separate files to a backup tool. Expect the run folder to be backed up at full size **[INFERENCE for clones]**.
  - Mark run folders with a sticky exclusion: `tmutil addexclusion` "follows a file or directory … when the item is copied, the copy retains the exclusion" ([tmutil](https://keith.github.io/xcode-man-pages/tmutil.8.html)). Programmatically this is `CSBackupSetItemExcluded`.
  - rsync without `-H` duplicates hard links ([rsync.1](https://download.samba.org/pub/rsync/rsync.1)).
- **OS Trash per mechanism.**
  - Trashing a symlink moves the link. Trashing a hard link removes one name, and the original keeps its data **[INFERENCE: standard unlink semantics]**.
  - Trashing a clone or copy frees space only when the Trash is emptied (Apple: "storage space doesn't become available until you empty the Trash", [Free up storage](https://support.apple.com/en-us/102624)).
  - On network shares and some removable media, the OS may have no Trash. Whether `trash` then fails or deletes permanently is **unverified**.
  - Synology shares can have their own Recycle Bin for SMB deletes ([DSM spec](https://www.synology.com/en-us/dsm/7.2/software_spec/dsm)).
  - PlateVault should probe for a Trash on the target volume and ask before a permanent delete.
- **Disk-space accounting.**
  - A clone costs nearly nothing until written. ZFS exposes `bcloneused` and `bclonesaved` ([OpenZFS](https://openzfs.github.io/openzfs-docs/Basic%20Concepts/Data%20Storage/Block%20Cloning.html)).
  - Report space from the per-item outcome (cloned vs copied) or from the volume's free-space delta, not from summed file sizes **[INFERENCE: du and Finder count full logical sizes]**.
  - A later write to a clone allocates new clusters; ReFS duplicates per 4 KB or 64 KB cluster ([Block Cloning](https://learn.microsoft.com/en-us/windows/win32/fileio/block-cloning)).
- **Current probe gaps** ([capability.rs L24-L48](crates/fs/inventory/src/capability.rs)):
  - The symlink probe links two files inside the destination. It cannot see symlink-evaluation policy for remote targets.
  - Junction is hard-coded unavailable, but the domain fallback chain still lists it.

---

## 10. Recommendation

### Modes (three, chosen automatically, with an override)

| Mode (user-facing) | Mechanism chain | Wording |
|---|---|---|
| **Automatic** (default) | Picks per item from the table below | "PlateVault picks the safest option that fits. Your originals are never changed." |
| **Independent copy** | Clone (`clonefile` / FICLONE / ReFS block clone) → server-side copy or clone (via the OS copy call) → plain copy | "Tools work on their own copy, so your originals can't be changed. Uses no extra space when the drive supports cloning (APFS, Btrfs, XFS, ReFS / Dev Drive); otherwise the files are copied." After Prepare: "212 frames cloned (no extra space) · 18 copied (3.4 GB)." |
| **Link to originals** (opt-in) | Symlink → hard link only when the source is on the same local NTFS or ext4 volume and symlinks are unavailable | "Uses no extra space. The run folder points at your originals, so the drive must stay connected, and a tool that edits a frame edits the original. PlateVault re-checks every original after the run." On Windows without Developer Mode, when only cross-volume links would work: "Needs Windows Developer Mode." |
| **Give PixInsight the file list** (WBPP only) | Nothing placed; PlateVault writes a `run-wbpp.js` carrying the exact paths and the grouping keywords | "Nothing is placed in the run folder. PixInsight reads each frame where it is. Not available for Siril, which needs a folder of frames." |

Remove `Hardlink` as a mode of its own, and remove `Junction` from file materialisation.

### Automatic chain per situation (ranked)

| Situation | 1st | 2nd (when space is short, after asking) | Never |
|---|---|---|---|
| Same CoW-capable volume (APFS, Btrfs, XFS reflink, ReFS/Dev Drive, ZFS same pool/dataset) | Independent copy (clones) | — | — |
| Same local non-CoW volume (NTFS, ext4, HFS+) | Independent copy | Link to originals | Junction |
| Different fixed local volumes | Independent copy | Link to originals (symlink) | Hard link (impossible) |
| Source on removable media (SD card, USB stick) | Independent copy | WBPP file list, with a "keep the card inserted" warning | Link to originals as a default |
| Source on NAS, run folder local | Independent copy (local cache) | Link to originals (UNC targets on Windows) or WBPP file list | Hard link, clone |
| Source and run folder on the same NAS share | Independent copy (server-side copy or clone where supported) | WBPP file list | Symlinks created on the share |
| Run folder on NAS, source local | Independent copy | — | Link to originals (Windows R2L is off by default; other machines can't resolve local paths) |
| Mixed volumes | Decide per item; one summary | Per-item fallback as above | — |

### Implementation notes for the current code

1. **Add a `Clone` outcome**, or record "cloned vs copied" on `Copy` items. Without it PlateVault cannot report space or explain the choice.
   - On macOS and Linux use `reflink_copy::reflink` explicitly. On an "unsupported" error (OMP's list in §2), fall back to `std::fs::copy`, which still offloads on SMB and NFS.
   - On Windows, prefer `std::fs::copy`, since `CopyFileExW` block-clones natively from KB5034848, over reflink-copy's untested path. Detect cloning through `FILE_SUPPORTS_BLOCK_REFCOUNTING` plus a free-space delta **[INFERENCE: no direct per-file API]**.
2. **Probe by attempting the operation on the real pair, as OMP does.** Classify errors as step-down or fail. Record the requested mechanism, the one used and the reason (`capability_drift` already models this).
3. **Make prepared clones and copies read-only after hash verification.** For links, re-hash originals after the run and before cleanup.
4. **Before cleanup**, check that the volume has a Trash. If it has none, ask before a permanent delete.
5. **Optionally exclude run folders from Time Machine.** This is a user setting, because it is a write to the run folder, not to the originals.

---

## 11. Open risks / not verified

- PixInsight's behaviour on symlinked inputs, and whether `saveAs` writes through or replaces an existing link: no primary source found.
- Hard-link creation over SMB from macOS clients, and from Windows clients to Samba or Synology: not tested. Probe at runtime.
- Whether `CopyFileExW` (std) triggers copychunk on Samba: the Samba wiki names only Explorer and Robocopy.
- Default SymlinkEvaluation values come from a secondary source (VAST KB). The Microsoft pages list the classes but not the defaults.
- ReFS hard-link support varies by version (two Microsoft pages disagree).
- Behaviour of `trash` 5.2 on volumes without a Trash or Recycle Bin.
- Time Machine and Spotlight handling of clones and links.
- The `reflink-copy` Windows implementation is self-described as untested.
- Whether AGPL PlateVault counts as "commercial" under the macFUSE and FUSE-T licences. This matters only if §7 is revisited.
