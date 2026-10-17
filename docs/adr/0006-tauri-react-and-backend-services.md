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

The user chose this direction (decision S1, 2026-10-12) after considering the Round 9 reports and spikes in apps/prototype/design/ on the ui-harness-v5 branch: R9-FLUTTER-MIGRATION.md, R9-NATIVE-UI-KITS.md, R9-BACKEND-SERVICES.md, R9-SPIKE-TAURI.md, R9-SPIKE-FLUTTER.md and R9-SPIKE-SLINT.md. The Flutter migration report recommends staying on Tauri for now, and its verdict is conditional (R9-FLUTTER-MIGRATION.md §8, lines 437-456). By that verdict, a later move to Flutter with flutter_rust_bridge would make sense only if all of these hold: a ground-up UI rebuild is planned anyway, a matched keyboard and screen-reader script passes on Flutter and is no worse than on Tauri, browser-engine divergence keeps causing failures that Tauri 3 CEF cannot address, the owner accepts owning packaging, signing and the updater, and Windows cold start is acceptable. It would not make sense if any of these hold: the goal is an OS-native look per OS, the React prototype is meant to become production code, WCAG AA is a release gate and the spike reproduces the open VoiceOver and Narrator defects, or the only gain sought is fewer Tauri plugins. The services crate keeps such a switch possible.

## Alternatives

The research considered OS-native UI libraries behind a per-OS abstraction, Flutter with flutter_rust_bridge, Slint, and Tauri + React. The user chose Tauri + React.

## Consequences

The UI composition rebuild remains in React. The services crate keeps a later switch possible.
