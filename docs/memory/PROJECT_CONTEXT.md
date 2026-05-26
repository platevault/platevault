# Project Context

Last reviewed: 2026-05-26

## Product / Service

Astro Library Manager (ALM) is a local-first desktop application for
astrophotography library organization. It helps users register source
directories, map acquisition sessions to targets and projects, prepare
inputs for PixInsight/WBPP, track project lifecycles, and safely plan
filesystem changes — without modifying raw image files.

The primary user is an astrophotographer with a large, messy library
spread across multiple drives, using PixInsight for processing. The app
organizes and documents; it never processes images.

## Key Constraints

- **Local-first file custody**: the app never copies, moves, or modifies
  image files without explicit user approval via a reviewable plan.
- **PixInsight boundary**: no calibration, debayer, registration,
  stacking, or editing. The app prepares inputs and documents outputs.
- **Cross-platform paths**: must handle Windows, macOS, Linux, external
  drives, symlinks, junctions, case sensitivity, long paths.
- **Research-led modeling**: domain concepts (folder structures, naming
  conventions, calibration reuse rules) are research questions documented
  in SpecKit before implementation.
- **Portable contracts**: UI-to-core boundary described by JSON Schema
  contracts; Tauri is the first adapter but semantics remain portable.

## Important Domains

- Acquisition sessions (light, dark, flat, bias frames grouped by capture)
- Calibration matching (master darks/flats/biases matched to sessions)
- Target catalog (NGC, IC, Messier objects with aliases)
- Project envelopes (processing project structure and lifecycle)
- Filesystem plans (reviewable move/copy/archive/delete operations)
- Library roots and source categories (raw, calibration, project, inbox)

## Current Priorities

- Spec 003 (First-Run Source Setup) — in PR, wiring wizard to real storage
- Next: spec 004 (Native Filesystem Controls) or revisiting spec 010 (Guided First Project)
- Deferred: spec 028 (Frontend Quality Hardening)

## Keep Here

- Constitution at `.specify/memory/constitution.md` governs all product decisions
- SQLite is the canonical local store for all durable state
- `VITE_USE_MOCKS=true` enables mock mode for frontend dev without Tauri
- WSLg cannot render WebKitGTK/Tauri windows; test visually on native Windows
