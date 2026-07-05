# Projects

A project collects the acquisition sessions you intend to process together —
"NGC 7000 in narrowband", say — and tracks everything around the processing
run PlateVault itself never performs: the sources, the generated
documentation (manifests), your notes, the launch into PixInsight or Siril,
and the output files your tool writes.

[screenshot: a project detail page with channels, sources, and outputs]

## Creating a project

**Create project** opens the **New project** flow:

- **Project name** — required, up to 120 characters (placeholder:
  "e.g. NGC 7000 Narrowband"). A name that already exists — in any letter
  case — is flagged inline right at the field: "A project with this name
  already exists." Creation is blocked until you change it.
- **Folder path** — where the project's working folder lives, relative to
  your project library root (placeholder: `projects/my-project`). A path
  another project already uses is refused: "Another project already uses
  this folder path."
- **Target (optional)** — search your catalog ("e.g. M31, NGC 224,
  Andromeda") to link the project to a target.
- A processing-tool profile — **PixInsight** ("WBPP, StarAlignment,
  integration") or **Siril** ("Free open-source stacking").
- **Notes (optional)**.

On success, PlateVault creates the project's on-disk folder structure
(`lights/`, `darks/`, `flats/`, and so on) automatically. This is the one
plan in the app that auto-applies — because every action in it is a folder
*creation*, never a move, copy, or delete of your files — and it still leaves
a plan row and an audit record behind. If a file already occupies a spot
where a folder should go, creation still succeeds, the toast says so, and
that folder plan stays available for review instead of being silently
skipped.

> **Not yet available:** a fix is pending for a bug where new project folders
> could be created under the app's own working directory instead of your
> registered project library. Until it lands, double-check where a new
> project's folders were created.

## Attaching and removing sources

In the project's **Edit** pane, **Add sources** opens a picker showing only
sessions that are confirmed *and* not yet linked ("All sessions are already
linked to this project." when there is nothing left to add). You cannot
attach unconfirmed inbox data — if it is not in [Sessions](./03-sessions.md),
it cannot be a project source.

Removing a source is immediate, except for the last one: removing the final
confirmed source would drop the project back to an incomplete state, so it is
refused with "You can't remove the last confirmed source." An archived
project refuses edits outright: "This project is archived and cannot be
edited."

The project detail's per-channel (per-filter) breakdown shows real numbers —
actual sub-frame counts and total integration time computed from the attached
sessions, formatted as hours and minutes. When you add sources after a
channel review, a banner points it out ("New sources were added since the
last channel review.") with a **Re-infer channels** action.

## Manifests and notes

The **Manifests** section is the project's append-only paper trail. Every
lifecycle-relevant change — **Project created**, **Source changed**,
**Lifecycle transition**, **Workflow run**, **Cleanup applied** — appends a
new manifest snapshot. Manifests are generated documentation and are never
overwritten, so you can always see what the project looked like at each point
in its history. **Reveal** opens the manifest file in your file manager.

**Notes** are freehand text, auto-saved a few seconds after you stop typing
("Saved"), with a live byte counter and a hard size cap ("Note exceeds the
{max}-byte limit."). Notes on an archived project are read-only.

[screenshot: the Manifests list with several snapshots and their reasons]

## Launching your processing tool

With the tool's executable configured (see
[Settings → Processing Tools](./08-settings.md#processing-tools)),
**Open in {tool}** launches it for this project — "Launched PixInsight" — and
changes nothing about the project's state. Three honest refusals to know
about:

- **Tool path not configured** / **Tool executable missing** — fix the path
  in Settings via the **Configure** link.
- If the project's working directory would resolve *outside* every
  registered library root, the launch is refused. This containment check
  prevents a misconfigured project from pointing a tool at an unrelated part
  of your disk.
- If the operating system itself fails to start the process, that is
  reported plainly ("Failed to launch {tool}: {error}") rather than silently
  swallowed.

Launching again while the tool may already be open asks first: "{tool} may
already be open for this project. Open another instance?"

## Observing outputs (artifacts)

While a project is open, PlateVault watches its output folder — only that
folder, never your whole library — and records new files as artifacts with a
kind (**Intermediates** / **Masters** / **Finals**) and a confidence level.
Low-confidence classifications are labeled as such ("{kind} (low
confidence)"), unrecognized files show as "Unattributed", and you can
override a classification manually (marked "(manual)"). Files written while
the project was closed are picked up the next time you open it.

PlateVault never modifies or deletes an artifact file itself — reclaiming
space from stale intermediates is what
[Cleanup](./05-cleanup-and-archive.md) is for.

## Related journeys

- [Journey 5 — Project lifecycle: create → attach sources → manifests/notes → tool launch → artifacts](../product/user-journeys.md#journey-5--project-lifecycle-create--attach-sources--manifestsnotes--tool-launch--artifacts)

Click-by-click scenario scripts:

- `e2e-agentic-test/008-project-create-onboard-edit/create-wizard-field-errors/scenario.md`
- `e2e-agentic-test/008-project-create-onboard-edit/edit-project-sources/scenario.md`
- `e2e-agentic-test/008-project-create-onboard-edit/per-channel-integration-time/scenario.md`
- `e2e-agentic-test/008-project-create-onboard-edit/project-mkdir-auto-apply/scenario.md`
- `e2e-agentic-test/008-project-create-onboard-edit/project-path-root-anchoring/scenario.md`
- `e2e-agentic-test/024-project-manifests-and-notes/manifests-notes-reveal-labels/scenario.md`
- `e2e-agentic-test/011-processing-tool-launch/tool-launch-containment/scenario.md`
- `e2e-agentic-test/012-processing-artifact-observation/artifact-attribution/scenario.md`
- `e2e-agentic-test/journeys/full-project-lifecycle/scenario.md`
