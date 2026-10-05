// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! In-app reminders (spec 072): the pure due and upcoming rules over computed
//! windows, and the scheduler that runs only while a subscription is enabled.
//! It claims each Target, site and window-start identity durably before it
//! submits a notification, so no identity is ever sent twice, and it never
//! starts a scan, inventory or image operation.
