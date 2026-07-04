# Targets planner columns — HONEST stub disclosure (specs 044/047 pending)

> Two-stage verification plan with an UNUSUAL success condition: this
> scenario asserts that the planner columns are VISIBLY stubs. **A stub
> presented as working astronomical data is a FAIL.** Real astronomy for
> these columns arrives with specs 044 (Track B) / 047 (Track A) and backend
> ephemeris (#57/#58); until then the app must not let a user mistake mock
> values for the sky.
>
> Stage 1: agent via Tauri MCP bridge, real backend. Stage 2: Claude Desktop
> human-honesty pass after Stage 1 PASS. Shared mechanics:
> `e2e-agentic-test/AGENT-RUNNER.md`.

## Feature facts (context)

- Spec 044 (status: PLACEHOLDER/deferred, §3: "frontend is mocked now; real
  astronomy later"; product decision 2026-07-04: astronomy-engine
  unification + Lorentzian filter model land under 044-TrackB/047-TrackA).
- The stubbed/mocked planner surfaces in `TargetsTable.tsx` /
  `planner-altitude.ts` (values derived deterministically from the
  DESIGNATION HASH — not from coordinates, date, or observer location):
  - **Max alt** + **Tonight sparkline** + **Visible** — stub altitude model.
  - **Opposition** — always renders `—` (sort is a no-op) until ephemeris.
  - **Lunar** distance — mock 0–180° hash value.
  - **Filters** — mock bracketing recommendation (NOT astronomy).
  - **Img time** — hours above threshold from the stub model.
  - **Sessions** — always `—` / 0 (no linkage yet, #57); sort is a no-op.
  - Favourites star + "My Targets" — localStorage-only stub (#54 pending).
- In `TargetDetailV2.tsx`: altitude graph uses a FIXED placeholder observer
  latitude (~52°) and the graph title includes that latitude; Coverage
  renders an explicit no-coverage stub; Transit shows no precise time.
- The honesty mechanism shipped today = hover `title` tooltips with
  "approximate" wording, `—` placeholders for unavailable values, and the
  graph-title latitude disclosure. This scenario checks those mechanisms
  exist and judges whether they are ENOUGH.

## Preconditions

1. Branch `redesign-ui-platevault`, fresh DB, setup completed, Targets page
   loaded with the seed catalog (AGENT-RUNNER.md). Bridge connected.

## Stage 1 — Agent validation via Tauri MCP

### Test 1 — Stub columns never fabricate unavailable values

1. Via `webview_execute_js`, sample 10 target rows and read the Opposition
   and Sessions cell text:
   ```js
   (() => [...document.querySelectorAll('.alm-targets-table__row')].slice(0,10)
     .map(r => { const c = r.querySelectorAll('td');
       return { desig: c[1]?.textContent.trim(),
                opposition: c[6]?.textContent.trim(),
                sessions: c[10]?.textContent.trim() }; })
   )();
   ```
Expected:
- EVERY sampled Opposition cell is `—` and EVERY Sessions cell is `—`.
FAIL if: ANY row shows a concrete opposition date or a nonzero session
count — with no backend for these, a concrete value is fabricated data
(this is the core honesty assertion).

### Test 2 — Mock values are deterministic, not sky-derived

1. Read Max alt + Lunar for 3 named rows; note the values.
2. Reload the page (Ctrl+R) and read the same 3 rows again.
Expected: identical values across reloads (deterministic hash — fine), AND
the values do not change with wall-clock time. Record the triple so future
runs can confirm.
FAIL if: values differ between immediate reloads (nondeterminism would make
the table look like a live computation).

### Test 3 — Disclosure affordances exist on stub cells

1. Read the `title` attributes on the Max alt header/cells, the Visible
   indicator, the Img time cells, and the Lunar cells:
   ```js
   (() => { const row = document.querySelector('.alm-targets-table__row');
     return [...row.querySelectorAll('td [title]')].map(el => el.getAttribute('title')); })();
   ```
Expected:
- Max alt tooltip copy includes approximate/estimate wording (the
  `targets_table_approx_max_alt` string).
- Each stub numeric carries a tooltip explaining what it claims to be.
FAIL if: stub cells carry NO qualifying tooltip/hint anywhere (bare numbers
presented exactly like real data).

### Test 4 — Detail pane discloses the placeholder model

1. Select any target; read the Tonight graph title text.
Expected: the title names the placeholder observer latitude (e.g. "… lat
52°"), the Transit marker has NO precise clock time, Coverage shows the
no-coverage stub copy, and the identity table shows `—` for values the
backend does not supply.
FAIL if: the graph presents itself as a computed ephemeris for the user's
location (there is no location setting wired), or Coverage invents hours.

### Test 5 — Stub sort columns are inert, not broken

1. Click the **Opposition** header, then **Sessions** header.
Expected: no crash; row order is PRESERVED (documented no-op sort). The
header may still show as active — record whether the active-arrow appearing
on a no-op column is observed (it is a known honesty smell for Stage 2 to
judge).
FAIL if: clicking throws or scrambles rows nondeterministically.

**Stage 1 verdict**: PASS = Tests 1–5 green. Note explicitly: Stage 1 can
only verify the MECHANISMS. Whether disclosure is SUFFICIENT is Stage 2's
call.

## Stage 2 — Final Claude Desktop pass (only after Stage 1 PASS)

This stage is a deliberate honesty audit at 1100×720, both a light and a
dark theme. The question for each column: **"Would an astrophotographer who
has NOT read the source believe this number is real?"**

1. Look at the table cold (no hovering). Max alt, sparkline, Visible,
   Lunar, Filters, Img time all render as confident, precise-looking values.
   Judge: without hovering, is there ANY visible cue these are placeholder
   models? If the only disclosure is hover-tooltips, record verdict
   **FAIL-SOFT (finding)**: hidden-by-default disclosure for fabricated-
   looking precision — recommend a visible "preview/estimate" affordance
   (e.g. muted styling, a badge on the column group, or an info banner)
   until 044/047 land.
2. Hover each stub column header/cell; confirm tooltip copy actually says
   approximate/mock-equivalent wording in user language (not developer
   jargon like "stub" or "#58").
3. Opposition and Sessions render `—`: judge whether `—` reads as "not
   available yet" (good) vs "no data for this object" (misleading). Record.
4. Sort a stub column (Opposition): if the header shows an active sort arrow
   while doing nothing, record as a finding (control implies capability).
5. Detail pane: is the "lat 52°" title honest enough for a user in, say,
   Texas? Judge and record.
6. Sign-off: an explicit statement per column — HONEST / DISCLOSED-ON-HOVER
   / PRESENTED-AS-REAL — with screenshots. Any column judged
   PRESENTED-AS-REAL with zero disclosure = scenario FAIL.

## Verdict rubric

- **PASS**: fabrication-free (`—` for Opposition/Sessions everywhere),
  deterministic mocks, disclosure mechanisms present, and Stage 2 judges no
  column as PRESENTED-AS-REAL-with-zero-disclosure.
- **FAIL**: any fabricated concrete value where no backend exists, or a
  stub column indistinguishable from real data with no disclosure at all.
- **FAIL-SOFT / FINDINGS**: hover-only disclosure, active sort arrows on
  no-op columns, `—` ambiguity — file as follow-ups against specs 044/047,
  do not block the convoy on them, but they MUST appear in the report.
