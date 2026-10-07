// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Volume kinds and network addresses of location roots (LIB-FR-01, LIB-FR-19).
//!
//! A location may sit on a network share the operating system has already
//! mounted. `PlateVault` mounts nothing, so a root is always a folder of a
//! mounted volume and never an SMB, NFS or URL address.

use serde::{Deserialize, Serialize};

use crate::NativePath;

/// What kind of volume a location root is on, as the platform reports it.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VolumeKind {
    /// An internal disk.
    Local,
    /// An external or removable disk, such as a USB drive or a memory card.
    Removable,
    /// A network share the operating system mounted. While it is unmounted the
    /// location reads Offline, never Missing.
    Network,
}

/// Why a network address is refused as a location root.
pub const NETWORK_ADDRESS_REFUSED: &str = "a location root is a folder on a mounted volume; \
     PlateVault mounts no share, so mount it in the operating system and choose its folder \
     instead of an SMB or URL address";

impl NativePath {
    /// Whether this is a network address rather than a folder of a mounted
    /// volume: a URL (`smb://`, `afp://`, `nfs://`, `https://` and any other
    /// scheme), a `//server/share` address or a Windows UNC path
    /// (`\\server\share`, `\\?\UNC\server\share`).
    #[must_use]
    pub fn is_network_address(&self) -> bool {
        let text = self.display();
        let text = text.trim_start();
        let verbatim_unc =
            text.get(..8).is_some_and(|prefix| prefix.eq_ignore_ascii_case(r"\\?\UNC\"))
                || text.get(..8).is_some_and(|prefix| prefix.eq_ignore_ascii_case(r"\\.\UNC\"));
        verbatim_unc || unc_share(text) || url_scheme(text)
    }
}

/// `//server/...` or `\\server\...`; the `\\?\` and `\\.\` device prefixes
/// name local paths unless they are UNC.
fn unc_share(text: &str) -> bool {
    let mut chars = text.chars();
    let (Some(first), Some(second), Some(third)) = (chars.next(), chars.next(), chars.next())
    else {
        return false;
    };
    matches!(first, '/' | '\\')
        && matches!(second, '/' | '\\')
        && !matches!(third, '/' | '\\' | '?' | '.')
}

/// `scheme://` with an RFC 3986 scheme of at least two characters, so a
/// Windows drive letter is never a scheme.
fn url_scheme(text: &str) -> bool {
    let Some((scheme, _)) = text.split_once("://") else {
        return false;
    };
    let mut chars = scheme.chars();
    scheme.len() >= 2
        && chars.next().is_some_and(|first| first.is_ascii_alphabetic())
        && chars.all(|char| char.is_ascii_alphanumeric() || matches!(char, '+' | '-' | '.'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unix(text: &str) -> NativePath {
        NativePath::UnixBytes(text.as_bytes().to_vec())
    }

    fn windows(text: &str) -> NativePath {
        NativePath::WindowsUtf16(text.encode_utf16().collect())
    }

    #[test]
    fn smb_and_url_addresses_are_network_addresses() {
        for address in [
            "smb://nas.local/Astro",
            "SMB://nas/Astro/Captures",
            "afp://nas/Astro",
            "nfs://nas/export/astro",
            "cifs://nas/astro",
            "https://nas.local/dav/astro",
            "webdav://nas/astro",
            "file:///Volumes/Astro",
            "//nas/Astro",
            "//user@nas/Astro/Captures",
            "  //nas/Astro",
        ] {
            assert!(unix(address).is_network_address(), "{address}");
            assert!(windows(address).is_network_address(), "{address}");
        }
        for address in
            [r"\\nas\Astro", r"\\nas\Astro\Captures", r"\\?\UNC\nas\Astro", r"\\.\unc\nas\a"]
        {
            assert!(windows(address).is_network_address(), "{address}");
        }
    }

    #[test]
    fn folders_of_mounted_volumes_are_not_network_addresses() {
        for path in ["/Volumes/NAS/Astro", "/mnt/nas/astro", "/", "///Volumes/NAS", "/a://b"] {
            assert!(!unix(path).is_network_address(), "{path}");
        }
        for path in [r"Z:\Astro\Captures", r"C:\", "C://Astro", r"\\?\C:\Astro", r"\\.\C:\Astro"] {
            assert!(!windows(path).is_network_address(), "{path}");
        }
    }
}
