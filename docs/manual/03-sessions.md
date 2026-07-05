# Sessions

A session is a night's worth of acquisition for one target/filter/camera
combination. In PlateVault, sessions are a *derived view*: they are computed
from the inventory you have already confirmed and applied through the
[Inbox](./02-inbox.md), and they update automatically. There is nothing to
create, approve, or maintain here — which is exactly the point.

[screenshot: the Sessions page with the calendar timeline and the sessions table]

## Where sessions come from

- Before you confirm and apply anything, Sessions shows nothing for that
  data. Sessions are derived from confirmed inventory only — never from raw,
  unreviewed scans.
- The moment an inbox plan applies, the corresponding session(s) appear, with
  frame counts matching what was actually moved or catalogued.
- Rescanning the inbox never duplicates a session or drags one back into a
  "pending" state: the view is deterministic over your confirmed metadata.

You may notice what is *not* here: no Confirm, Reject, Ignore, or Re-open
buttons, and no review-state badges. An earlier design had a full session
review lifecycle; it was deliberately removed. The confirm gate you already
passed in the Inbox is the only gate — Sessions is a read view, and its
simplicity is intentional.

## Reading the list

The table shows one row per session: **Night**, **Target**, **Filter**,
**Camera**, **Frames**, **Integration**, and **Projects** (which projects use
this session as a source). Above it:

- **Search** ("Search target, filter, camera…") narrows the list as you type.
- The **Filter:** bar (**+ add**) pins structured filters — by **Target**,
  **Filter**, **Camera**, or **Month** — each removable individually.
- Grouping collects sessions by target, filter, camera, or month.
- A calendar timeline strip visualizes your imaging nights; each night shows
  its total frame count.

Every column sorts, and "No sessions match the current filters." tells you
when your filters are the reason the list looks empty.

## Session details

Selecting a row opens the detail pane: the session's **Night**, target,
filter, camera fingerprint details (gain, sensor temperature, binning,
exposure), **Total integration**, **Confirmed by** (which inbox confirmation
produced it), and **Linked projects**. **Reveal in OS** opens the session's
source folder in your system's file manager.

[screenshot: session detail pane with fingerprint details and linked projects]

> **Not yet available:** interaction parity with the Inbox list — the same
> dropdown filters, grouping-hint footer, and screen-reader sort
> announcements — is still being finished. The Sessions list is functionally
> complete, but some of these refinements arrive with a pending update.

## Related journeys

- [Journey 4 — Sessions review (derived groupings, live membership)](../product/user-journeys.md#journey-4--sessions-review-derived-groupings-live-membership)

Click-by-click scenario scripts:

- `e2e-agentic-test/041-inbox-plan-surface/sessions-derived-inventory/scenario.md`
- `e2e-agentic-test/043-sessions-parity/sessions-inbox-parity/scenario.md`
