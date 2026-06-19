# Windows UI validation — 2026-06

Validates the UI/behavior merged to `main` this cycle that has only been verified on
Linux gates: **spec 035** (SIMBAD target resolution), the **calibration source-folder
unification** (#251), and **spec 036** (Targets page rebuilt on the gen-3 model).
Green Linux gates ≠ working Windows app — run this on the real Windows build.

## Setup (avoid the stale-binary trap)

1. `git pull` on `main`.
2. **Fully recompile** — stop any running dev server, rebuild the Tauri app, relaunch.
   Do NOT validate against an old binary (stale-binary = phantom failures).
3. Use a **fresh database** (schema changed: `0031` gained `canonical_target.display_alias`,
   `target_alias.kind` now allows `'user'`; gen-2 tables `targets`/`target_aliases`/
   `target_catalog_refs`/`catalog_equivalences` are gone). Fresh DB exercises first-run
   seed + migrations.

## A. Spec 035 — SIMBAD target resolution

- [ ] Project creation → target search: type `M3`, `androm`, `ngc 70` → instant ranked
      suggestions (designation + common name + object type).
- [ ] Select a target → create project → **ProjectDetail shows a "Target" card**
      (primary designation + common name).
- [ ] Settings → **Target Resolution** pane: online toggle (default ON), SIMBAD endpoint,
      debounce/timeout edit + persist.
- [ ] Attribution section shows SIMBAD/CDS + OpenNGC credit.
- [ ] Long-tail resolve (object beyond the seed) resolves from SIMBAD and is cached.
- [ ] Manual "Correct…" override binds a query to the right target and sticks.
- [ ] Setup wizard "Target resolution" step (repurposed catalogs step) works.

## B. Calibration source-folder unification (#251)

- [ ] Setup wizard "add source folders": darks/flats/bias appear as a **single
      "Calibration frames"** category, not three separate ones.
- [ ] Frame-type detection still derives from FITS metadata (`IMAGETYP`), not folder kind.

## C. Spec 036 — Targets page (primary nav) — most new surface

- [ ] Open **Targets** (sidebar entry / Cmd+K) → list renders.
- [ ] Open a target → primary designation, object type, coordinates, alias list render.
- [ ] **Add** a user alias → appears and persists across reload.
- [ ] **Remove** the user alias → gone. A SIMBAD-derived designation has **no** remove
      affordance / refuses removal.
- [ ] Adding a duplicate alias → rejected with a clear message.
- [ ] **Set a display alias** → shown as the target's label (detail header, list, Cmd+K);
      canonical designation unchanged.
- [ ] **Clear** the display alias → label reverts to canonical.
- [ ] The **note box and primary-rename control are gone** (D1/D2).

## D. Regression

- [ ] Settings panes all load (the spec-013 `active_catalogs` setting was removed).
- [ ] Inbox / inventory list shows no error (legacy target-name join removed).
- [ ] **tauri-specta sanity**: the dotted commands `target.get` / `target.list` /
      `target.alias.add` / `target.alias.remove` / `target.display_alias.set` /
      `target.display_alias.clear` work against the real backend (not just tests) — i.e. no
      "command not found". This is the exact class of bug that passes Linux tests but
      breaks on a real build.
- [ ] Project creation target selection + ProjectDetail target card (spec 035) still work
      after the 036 rebuild.

## On failure

Report the failing item + console/log output. Note whether it's a stale-binary artifact
(re-pull + recompile first). Fixes land on `main` (or a fix branch) before starting the
next feature (spec-002 per-file ingest).
