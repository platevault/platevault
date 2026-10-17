---
title: Stay on Tauri and React, with backend-owned services
status: accepted
date: 2026-10-12
bead: astro-plan-2ckn9
---

# Stay on Tauri and React, with backend-owned services

## Status

Accepted on 2026-10-12 by user decision S1.

## Context

The decision synthesised reports on OS-native UI kits, Flutter migration, and backend-owned desktop services, along with Tauri, Flutter, and Slint spike results. Acceptance called for measured spike data, a conditional recommendation, and the user's decision recorded as an ADR.

## Decision

Stay on Tauri + React. Rebuild the UI composition in React. Keep a services crate so a later framework switch remains possible.

## Rationale

The research recommends staying on Tauri because no native toolkit meets the stated accessibility bar with shipped, tested code, migrating would discard a large tested frontend, and Tauri is already a thin, replaceable adapter. Source: docs/research/2026-08-17-gui-toolkit-evaluation.md:433-454.

## Alternatives

The research considered OS-native UI libraries behind a per-OS abstraction, Flutter with flutter_rust_bridge, Slint, and Tauri + React. The user chose Tauri + React.

## Consequences

The UI composition rebuild remains in React. The services crate keeps a later switch possible.
