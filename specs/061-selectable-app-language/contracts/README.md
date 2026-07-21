# Contracts: Selectable Application Language

**Feature**: 061-selectable-app-language | **Date**: 2026-07-20

## Summary

**No new contract. No changed contract shape.**

This feature adds no IPC command and alters no request or response type. It
reuses the existing settings commands with an additional key. This document
records that conclusion so the constitution's Principle V gate has something to
check against, rather than leaving the absence of contract files ambiguous.

## Commands used

| Command | Use | Change |
|---|---|---|
| `settings_update(scope, values)` | persist the chosen locale — `scope: "general"`, `values: { locale: "<tag>" }` | none — `values` is already a free-form JSON object |
| `settings_get(scope)` | read the stored locale at startup | none |

`settings_update` accepts `contracts_core::JsonAny` for `values`, so carrying a
new key requires no signature, schema, or binding change. The addition is
entirely in the backend's key allowlist (see data-model.md), which is
validation behaviour rather than contract surface.

## Why the allowlist is not a contract change but still matters

The contract shape is unchanged, so nothing regenerates and no consumer
breaks. But behaviour changes materially: before registration
`settings_update` accepts `locale` and discards it; after, it persists it.
Both return `Ok`.

That asymmetry is the reason T004 asserts a **round-trip through a reopened
store** rather than a successful call. A contract-level test — "does the
command accept this payload?" — passes in both states and would certify a
build that silently loses every user's language choice.

## Portability note (Principle V)

Because the semantics are "a scoped preference key with a validated value",
this carries to a future non-Tauri backend unchanged. Nothing about the
language preference is bound to the desktop adapter: the locale tag is a
portable value, the scope/key addressing already exists in the contract, and
the synchronous `localStorage` mirror is a frontend implementation detail of
Paraglide's `getLocale()` contract, not part of the UI-to-core boundary.
