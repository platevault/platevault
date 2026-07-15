> **MIGRATED:** current truth now lives at
> `docs/journeys/J17-software-update-install/journey.md`. This file and
> its deltas are frozen legacy history.

## Journey 17 — Software update & install

**Goal:** learn that a new PlateVault version exists, install it with a
verified download, and restart into it — without the update machinery ever
interrupting library work.

**Preconditions:** a build with the updater enabled (spec 051); an update
feed reachable (or deliberately unreachable, for the failure branch).

**Narrative flow:**

1. **Settings → Advanced** shows the running version and the update state
   (up to date / update available / check failed). Checking is passive — no
   library work is interrupted.
2. When an update is available, an **Install** action appears. Installing
   downloads the package and verifies its signature before anything is
   staged; a failed signature or download is reported plainly and changes
   nothing.
3. A staged update asks for an explicit restart; declining leaves the app
   fully usable on the current version until the user chooses otherwise.
4. After restart, the new version is running and the update state returns
   to "up to date".

**Touch & validate:**

- Up-to-date state: version visible; no Install control rendered.
- Update-available state: Install appears; install → signature-verified
  download → explicit restart prompt; declining the restart is honored.
- Failure branches: unreachable feed and failed signature each produce a
  specific, in-context message (generic "update failed" copy fails the
  run) and leave the running install untouched.
- No auto-install and no silent restart anywhere; the updater never
  triggers during an in-flight plan apply.

**Safety & trust notes:** update trust is signature-based (minisign); an
unverifiable package must never be staged — for a product whose brand is
"never touch files without review", the updater holds itself to the same
standard.

**Scenario files:** *(to be authored)*
`e2e-agentic-test/journeys/software-update/scenario.md`.
