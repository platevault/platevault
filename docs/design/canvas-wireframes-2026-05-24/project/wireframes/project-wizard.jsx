// New-project wizard — end-to-end: target → sources (sessions + masters) → source views → review plan → create
// Single page; the wizard is a modal-like centered surface but framed in the app.

function _Step({ n, label, active, done }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
      background: active ? W.bg3 : 'transparent', border: `1px solid ${active ? W.rule : 'transparent'}`,
      borderBottom: active ? `2px solid ${W.ink}` : `1px solid transparent`, flex: 1 }}>
      <span style={{ width: 18, height: 18, borderRadius: 9, background: done ? W.ink : active ? W.ink2 : W.bg2, color: done || active ? W.bg : W.ink3, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, border: `1px solid ${W.rule}` }}>{done ? '✓' : n}</span>
      <span style={{ fontSize: 11.5, color: active ? W.ink : done ? W.ink2 : W.ink3, fontWeight: active ? 600 : 400 }}>{label}</span>
    </div>
  );
}

function WfProjectWizard() {
  return (
    <AppFrame title="New project · NGC 7000 · HOO" active="projects" navOverride="sidebar"
      breadcrumb={<>Projects <Arr/> + New project <Arr/> Step 3 of 6 · Calibration</>}>
      <Toolbar sub={<><span>Workflow profile: PixInsight/WBPP</span><span style={{ color: W.ink4 }}>·</span><span>From target context: NGC 7000</span><span style={{ marginLeft: 'auto', color: W.ink4 }}>Sources are selected here; the filesystem plan is shown at step 6 before anything is created.</span></>}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>New project — NGC 7000 · HOO</span>
        <div style={{ flex: 1 }} />
        <Btn small>Save draft</Btn>
        <Btn small>Cancel</Btn>
      </Toolbar>

      {/* Step rail */}
      <div style={{ borderBottom: `1px solid ${W.rule}`, background: W.bg, padding: '6px 12px', display: 'flex', gap: 0 }}>
        <_Step n="1" label="Name & profile" done />
        <_Step n="2" label="Sources (lights)" done />
        <_Step n="3" label="Calibration" active />
        <_Step n="4" label="Source views" />
        <_Step n="5" label="Naming & layout" />
        <_Step n="6" label="Review plan & create" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', height: 'calc(100% - 100px)' }}>
        <div style={{ padding: 18, overflow: 'auto', borderRight: `1px solid ${W.rule}` }} className="wf-scroll">
          <div style={{ fontSize: 18, fontWeight: 600 }}>Step 3 · Calibration</div>
          <div style={{ fontSize: 12, color: W.ink3, marginTop: 4, maxWidth: 640 }}>
            Map calibration to each light source. Flats are per-filter (Ha flats can only calibrate Ha lights). Darks &amp; bias are usually shared across all lights of the same exposure / camera / gain.
          </div>

          {/* Flats per light source (by filter) */}
          <div style={{ marginTop: 16 }}>
            <Section title="Flats — per light source" sub="one master flat per filter; light sources are auto-grouped by filter" noPad>
              <table>
                <thead>
                  <tr>
                    <th>Filter</th>
                    <th>Lights covered</th>
                    <th>Master flat</th>
                    <th style={{ width: 60 }}>Score</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><Pill variant="ghost" size="xs">Ha</Pill></td>
                    <td style={{ fontSize: 11.5 }}>NGC 7000 · Ha · 11-30 (54×) · NGC 7000 · Ha · 12-15 (30×)</td>
                    <td>
                      <select defaultValue="ha" style={{ width: '100%', padding: '4px 6px', border: `1px solid ${W.rule}`, fontSize: 11.5, background: W.bg }}>
                        <option value="ha">MasterFlat_Ha_2024-11 (12d old)</option>
                        <option>MasterFlat_Ha_2024-12 (newer)</option>
                        <option>Skip — no flat for Ha</option>
                      </select>
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>0.88</td>
                    <td style={{ fontSize: 11, color: W.ink3 }}>filter-matched · same camera</td>
                  </tr>
                  <tr>
                    <td><Pill variant="ghost" size="xs">OIII</Pill></td>
                    <td style={{ fontSize: 11.5 }}>NGC 7000 · OIII · 11-30 (38×)</td>
                    <td>
                      <select defaultValue="oiii" style={{ width: '100%', padding: '4px 6px', border: `1px solid ${W.rule}`, fontSize: 11.5, background: W.bg }}>
                        <option value="oiii">MasterFlat_OIII_2024-11 (12d old)</option>
                        <option>MasterFlat_OIII_2024-12</option>
                        <option>Skip — no flat for OIII</option>
                      </select>
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>0.88</td>
                    <td style={{ fontSize: 11, color: W.ink3 }}>filter-matched · same camera</td>
                  </tr>
                </tbody>
              </table>
              <Btn small style={{ marginTop: 8 }}>+ Add another flat (for a future filter)</Btn>
            </Section>
          </div>

          {/* Shared calibration: darks, bias, dark flats */}
          <div style={{ marginTop: 16 }}>
            <Section title="Shared calibration — applies to all lights matching the fingerprint" noPad>
              <table>
                <thead><tr><th style={{ width: 70 }}>Role</th><th>Pick</th><th style={{ width: 60 }}>Score</th><th>Notes</th></tr></thead>
                <tbody>
                  <tr>
                    <td><Pill variant="ghost" size="xs">dark</Pill></td>
                    <td>
                      <select defaultValue="m1" style={{ width: '100%', padding: '4px 6px', border: `1px solid ${W.rule}`, fontSize: 11.5, background: W.bg }}>
                        <option value="m1">MasterDark_300s_-10C_g100 · ASI2600MM · 23d (recommended)</option>
                        <option>Use calibration session instead…</option>
                        <option>Skip darks</option>
                      </select>
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>0.92</td>
                    <td style={{ fontSize: 11, color: W.ink3 }}>exact exposure + temp + gain</td>
                  </tr>
                  <tr>
                    <td><Pill variant="ghost" size="xs">bias</Pill></td>
                    <td>
                      <select defaultValue="m10" style={{ width: '100%', padding: '4px 6px', border: `1px solid ${W.rule}`, fontSize: 11.5, background: W.bg }}>
                        <option value="m10">MasterBias_g100 · ASI2600MM (180d old — aging)</option>
                        <option>Skip bias (rely on darks)</option>
                      </select>
                    </td>
                    <td className="mono" style={{ fontSize: 11, color: W.warn }}>0.71</td>
                    <td style={{ fontSize: 11, color: W.warn }}>age &gt; 90d</td>
                  </tr>
                  <tr>
                    <td><Pill variant="ghost" size="xs">dark flat</Pill></td>
                    <td>
                      <select defaultValue="skip" style={{ width: '100%', padding: '4px 6px', border: `1px solid ${W.rule}`, fontSize: 11.5, background: W.bg }}>
                        <option value="skip">Skip (no dark flats in library)</option>
                      </select>
                    </td>
                    <td className="mono" style={{ fontSize: 11, color: W.ink4 }}>—</td>
                    <td style={{ fontSize: 11, color: W.ink3 }}>WBPP can compute from bias + darks</td>
                  </tr>
                </tbody>
              </table>
              <div style={{ padding: '8px 0', fontSize: 11, color: W.ink3, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Btn small>+ Add calibration session…</Btn>
                <Btn small>+ Import master…</Btn>
                <span style={{ marginLeft: 'auto', color: W.warn }}>⚠ aging bias master — soft mismatch in plan</span>
              </div>
            </Section>
          </div>

          <div style={{ marginTop: 14 }}>
            <Box title="Why these were recommended">
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, color: W.ink2 }}>
                <li><b>Flats</b>: matched per filter; same camera; flats &lt; 30d old preferred</li>
                <li><b>Dark</b>: exact match on EXPTIME (300s) · temp Δ 0.1°C · gain 100</li>
                <li><b>Bias</b>: only g100 bias for this camera exists; soft mismatch on age</li>
              </ul>
            </Box>
          </div>
        </div>

        {/* Right rail: summary + nav */}
        <div style={{ padding: 14, background: W.bg2, overflow: 'auto' }} className="wf-scroll">
          <div style={{ fontSize: 11, color: W.ink3, textTransform: 'uppercase', letterSpacing: '.04em' }}>Project summary</div>
          <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600 }}>NGC 7000 · HOO</div>
          <div style={{ fontSize: 11.5, color: W.ink3 }}>PixInsight/WBPP · NGC 7000 (primary)</div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, color: W.ink3, textTransform: 'uppercase' }}>What's selected so far</div>
            <div style={{ marginTop: 4, fontSize: 11.5 }}>
              <div style={{ padding: '3px 0', borderBottom: `1px dotted ${W.rule2}`, display: 'flex' }}><span style={{ flex: 1 }}>Lights</span><span className="mono">3 sess · 122 fr</span></div>
              <div style={{ padding: '3px 0', borderBottom: `1px dotted ${W.rule2}`, display: 'flex' }}><span style={{ flex: 1 }}>Darks</span><span className="mono">1 master</span></div>
              <div style={{ padding: '3px 0', borderBottom: `1px dotted ${W.rule2}`, display: 'flex' }}><span style={{ flex: 1 }}>Flats</span><span className="mono">2 masters</span></div>
              <div style={{ padding: '3px 0', display: 'flex' }}><span style={{ flex: 1 }}>Bias</span><span className="mono">1 master</span></div>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, color: W.ink3, textTransform: 'uppercase' }}>Coming up</div>
            <div style={{ marginTop: 4, fontSize: 11.5 }}>
              <div style={{ padding: '3px 0', borderBottom: `1px dotted ${W.rule2}` }}>4. Source views — pick strategy</div>
              <div style={{ padding: '3px 0', borderBottom: `1px dotted ${W.rule2}` }}>5. Naming & on-disk layout</div>
              <div style={{ padding: '3px 0' }}>6. Review plan → create on disk</div>
            </div>
          </div>

          <div style={{ marginTop: 14, padding: 8, background: W.bg, border: `1px solid ${W.rule}`, fontSize: 11.5 }}>
            <div style={{ color: W.ink3 }}>Estimated on-disk footprint</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }} className="mono">~12 KB</div>
            <div style={{ fontSize: 10.5, color: W.ink3 }}>plan #18 will create directories + manifest only · no light frames are copied</div>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 6 }}>
            <Btn small>← Back to sources</Btn>
            <Btn primary small style={{ flex: 1 }}>Next: source views →</Btn>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}
window.WfProjectWizard = WfProjectWizard;

// --- Step 4 detail: Source views in-wizard ---
function WfProjectWizardViews() {
  return (
    <AppFrame title="New project · NGC 7000 · HOO" active="projects" navOverride="sidebar"
      breadcrumb={<>Projects <Arr/> + New project <Arr/> Step 4 of 6 · Source views</>}>
      <Toolbar sub={<><span>Workflow profile: PixInsight/WBPP</span><span style={{ color: W.ink4 }}>·</span><span>122 light + 4 master frames in scope</span></>}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>New project — Source views</span>
        <div style={{ flex: 1 }} />
        <Btn small>Save draft</Btn>
        <Btn small>Cancel</Btn>
      </Toolbar>

      <div style={{ borderBottom: `1px solid ${W.rule}`, background: W.bg, padding: '6px 12px', display: 'flex' }}>
        <_Step n="1" label="Name & profile" done />
        <_Step n="2" label="Sources (lights)" done />
        <_Step n="3" label="Calibration" done />
        <_Step n="4" label="Source views" active />
        <_Step n="5" label="Naming & layout" />
        <_Step n="6" label="Review plan & create" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', height: 'calc(100% - 100px)' }}>
        <div style={{ padding: 18, overflow: 'auto', borderRight: `1px solid ${W.rule}` }} className="wf-scroll">
          <div style={{ fontSize: 18, fontWeight: 600 }}>Step 4 · Source views</div>
          <div style={{ fontSize: 12, color: W.ink3, marginTop: 4, maxWidth: 640 }}>
            A source view is a tool-friendly projection of your source map. PixInsight/WBPP will read source files through this view. The strategy is preset from <a>Settings → Source view strategy</a> — override here if you need.
          </div>

          <div style={{ marginTop: 14 }}>
            <Box title="Strategy (from settings)" right={<a style={{ fontSize: 11 }}>Override for this project</a>}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Pill variant="ok" size="xs">NTFS JUNCTION</Pill>
                <span style={{ fontSize: 12 }}>Default for Windows + PixInsight</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: W.ink3 }}>~12 KB on disk · no admin · cleanup-safe</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: W.ink3 }}>If a fallback is needed (e.g. across volumes), the plan will indicate per item.</div>
            </Box>
          </div>

          <div style={{ marginTop: 14 }}>
            <Section title="Views to generate" sub="for mosaic projects, one view per panel; otherwise a single wbpp_input" noPad>
              <table>
                <thead><tr><th>View name</th><th>Strategy</th><th>Scope</th><th>Items</th><th>Estimated size</th></tr></thead>
                <tbody>
                  <tr>
                    <td className="mono"><input defaultValue="wbpp_input" style={{ width: 160, fontFamily: 'inherit', padding: '3px 6px', border: `1px solid ${W.rule}`, background: W.bg }} /></td>
                    <td><Pill variant="ok" size="xs">junction</Pill></td>
                    <td style={{ fontSize: 11.5 }}>all sources (3 lights + 4 masters)</td>
                    <td className="mono" style={{ fontSize: 11 }}>126 items</td>
                    <td className="mono" style={{ fontSize: 11 }}>12 KB</td>
                  </tr>
                </tbody>
              </table>
              <Btn small style={{ marginTop: 8 }}>+ Add view (per panel / per filter)</Btn>
            </Section>
          </div>

          <div style={{ marginTop: 14 }}>
            <Box title="Conflict policy" right={<a style={{ fontSize: 11 }}>defaults from settings</a>}>
              <label style={{ display: 'block', fontSize: 11.5, padding: '2px 0' }}><input type="radio" name="cp" defaultChecked /> fail if exists (safest)</label>
              <label style={{ display: 'block', fontSize: 11.5, padding: '2px 0' }}><input type="radio" name="cp" /> rename with suffix</label>
              <label style={{ display: 'block', fontSize: 11.5, padding: '2px 0' }}><input type="radio" name="cp" /> skip existing</label>
              <label style={{ display: 'block', fontSize: 11.5, padding: '2px 0' }}><input type="radio" name="cp" /> require manual resolution</label>
            </Box>
          </div>
        </div>

        <div style={{ padding: 14, background: W.bg2, overflow: 'auto' }} className="wf-scroll">
          <div style={{ fontSize: 11, color: W.ink3, textTransform: 'uppercase' }}>Summary</div>
          <div style={{ marginTop: 6, fontSize: 11.5 }}>
            <div style={{ padding: '3px 0', borderBottom: `1px dotted ${W.rule2}`, display: 'flex' }}><span style={{ flex: 1 }}>Views</span><span className="mono">1</span></div>
            <div style={{ padding: '3px 0', borderBottom: `1px dotted ${W.rule2}`, display: 'flex' }}><span style={{ flex: 1 }}>Items</span><span className="mono">126</span></div>
            <div style={{ padding: '3px 0', borderBottom: `1px dotted ${W.rule2}`, display: 'flex' }}><span style={{ flex: 1 }}>Strategy</span><span>junction</span></div>
            <div style={{ padding: '3px 0', display: 'flex' }}><span style={{ flex: 1 }}>Est. footprint</span><span className="mono">12 KB</span></div>
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 6 }}>
            <Btn small>← Calibration</Btn>
            <Btn primary small style={{ flex: 1 }}>Next: naming →</Btn>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}
window.WfProjectWizardViews = WfProjectWizardViews;

// --- Step 6: Review plan & create ---
function WfProjectWizardReview() {
  return (
    <AppFrame title="New project · NGC 7000 · HOO" active="projects" navOverride="sidebar"
      breadcrumb={<>Projects <Arr/> + New project <Arr/> Step 6 of 6 · Review plan</>}>
      <Toolbar sub={<><span>Plan: <span className="mono">plan-#new</span> · 132 items · est. footprint 12 KB</span><span style={{ color: W.ink4 }}>·</span><span>dry-run: ✓ all preconditions satisfied</span></>}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>New project — Review plan</span>
        <div style={{ flex: 1 }} />
        <Btn small>← Back</Btn>
        <Btn primary>Approve & create project</Btn>
      </Toolbar>

      <div style={{ borderBottom: `1px solid ${W.rule}`, background: W.bg, padding: '6px 12px', display: 'flex' }}>
        <_Step n="1" label="Name & profile" done />
        <_Step n="2" label="Sources (lights)" done />
        <_Step n="3" label="Calibration" done />
        <_Step n="4" label="Source views" done />
        <_Step n="5" label="Naming & layout" done />
        <_Step n="6" label="Review plan & create" active />
      </div>

      <div style={{ padding: 14, position: 'relative' }}>
        <div style={{ padding: 12, background: '#e9f1ec', border: `1px solid #c5d6cb`, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: W.ok, fontSize: 14 }}>✓</span>
            <div style={{ flex: 1, fontSize: 12 }}>
              <b>No destructive items.</b> This plan only creates directories, junctions, and the project manifest. No source frames are moved, copied, or modified.
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
          <Box title="Plan items (132)">
            <table>
              <thead><tr><th style={{ width: 80 }}>Action</th><th>Destination</th><th>Source</th></tr></thead>
              <tbody>
                <tr><td><Pill variant="info" size="xs">mkdir</Pill></td><td className="mono" style={{ fontSize: 11 }}>NGC7000_HOO/</td><td><span style={{ color: W.ink4 }}>—</span></td></tr>
                <tr><td><Pill variant="info" size="xs">mkdir</Pill></td><td className="mono" style={{ fontSize: 11 }}>NGC7000_HOO/.alm/</td><td><span style={{ color: W.ink4 }}>—</span></td></tr>
                <tr><td><Pill variant="info" size="xs">mkdir</Pill></td><td className="mono" style={{ fontSize: 11 }}>NGC7000_HOO/sources/views/wbpp_input/</td><td><span style={{ color: W.ink4 }}>—</span></td></tr>
                <tr><td><Pill variant="info" size="xs">write</Pill></td><td className="mono" style={{ fontSize: 11 }}>NGC7000_HOO/.alm/project.json</td><td className="mono" style={{ fontSize: 11, color: W.ink3 }}>generated</td></tr>
                <tr><td><Pill variant="info" size="xs">junction</Pill></td><td className="mono" style={{ fontSize: 11 }}>…/wbpp_input/lights/Ha_300s_0001.fit</td><td className="mono" style={{ fontSize: 11, color: W.ink3 }}>D:\…\Raw\…\Ha_300s_0001.fit</td></tr>
                <tr><td><Pill variant="info" size="xs">junction</Pill></td><td className="mono" style={{ fontSize: 11 }}>…/wbpp_input/lights/Ha_300s_0002.fit</td><td className="mono" style={{ fontSize: 11, color: W.ink3 }}>D:\…\Raw\…\Ha_300s_0002.fit</td></tr>
                <tr><td colSpan={3} style={{ fontSize: 11, color: W.ink3, padding: 6 }}>… 120 more junctions (118 lights + 4 masters)</td></tr>
                <tr><td><Pill variant="info" size="xs">write</Pill></td><td className="mono" style={{ fontSize: 11 }}>NGC7000_HOO/sources/manifests/manifest.json</td><td className="mono" style={{ fontSize: 11, color: W.ink3 }}>generated</td></tr>
              </tbody>
            </table>
          </Box>

          <div>
            <Box title="What will exist on disk">
              <pre className="mono" style={{ fontSize: 10.5, margin: 0, lineHeight: 1.5, color: W.ink2 }}>{`NGC7000_HOO/
├── .alm/
│   ├── project.json
│   └── manifests/
├── sources/
│   ├── manifests/
│   │   └── manifest.json
│   └── views/
│       └── wbpp_input/
│           ├── lights/  (122 junctions)
│           ├── darks/   (1)
│           ├── flats/   (2)
│           └── bias/    (1)
├── processing/
│   └── pixinsight/
├── outputs/
└── notes/`}</pre>
            </Box>

            <div style={{ marginTop: 14 }}>
              <Box title="After creating">
                <ol style={{ margin: 0, paddingLeft: 18, fontSize: 11.5 }}>
                  <li>Project lifecycle: <span className="mono">setup</span> → <span className="mono">prepared</span></li>
                  <li>Open <span className="mono">NGC7000_HOO/sources/views/wbpp_input</span> in PixInsight/WBPP</li>
                  <li>Process there. The app will observe artifacts on refresh.</li>
                  <li>Record final outputs back here when done.</li>
                </ol>
              </Box>
            </div>
          </div>
        </div>

        <Note side="left" x={16} y={40} width={190}>Single end-to-end wizard. Strategy comes from settings; per-project overrides via the "Override" link.</Note>
      </div>
    </AppFrame>
  );
}
window.WfProjectWizardReview = WfProjectWizardReview;
