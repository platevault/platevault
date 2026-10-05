// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Observing windows (spec 072): pure astronomical window computation for a
//! saved Target from a saved site, composed from skymath 0.7.2 twilight,
//! altitude-crossing, Moon-crossing and lunar-separation primitives, with night
//! boundaries and local times from the bundled IANA time-zone database.
//! Suitability is astronomical only; nothing here performs I/O.
