// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calendar export (spec 072): RFC 5545 rendering of a confirmed window
//! snapshot with UTC instants, and the atomic write of the one user-chosen
//! `.ics` file. The application keeps no copy and never rewrites the file.
