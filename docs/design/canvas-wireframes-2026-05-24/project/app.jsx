// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// app.jsx — Compose the design canvas with all wireframes + Tweaks panel.
// IMPORTANT: DCArtboard must be a *direct* JSX child of DCSection — wrappers break the child filter.

const { TweaksPanel, useTweaks, TweakSection, TweakRadio, TweakToggle, TweakSelect } = window;

const DEFAULTS = /*EDITMODE-BEGIN*/{
  "annotations": true,
  "sketchy": false,
  "density": "comfortable",
  "nav": "sidebar"
}/*EDITMODE-END*/;

const W_DESKTOP = 1280;
const H_WIREFRAME = 800;
const H_NOTES = 280;
const H_TOTAL = H_WIREFRAME + H_NOTES;
const H_DENSITY = 700;

function CanvasApp() {
  const [tweaks, setTweak] = useTweaks(DEFAULTS);
  const ctx = useMemo(() => ({
    annotations: !!tweaks.annotations,
    sketchy: !!tweaks.sketchy,
    density: tweaks.density,
    nav: tweaks.nav,
  }), [tweaks.annotations, tweaks.sketchy, tweaks.density, tweaks.nav]);

  const N = window.NOTES;

  return (
    <TweakCtx.Provider value={ctx}>
      <DesignCanvas>
        <DCSection id="onboarding" title="① Onboarding & review" subtitle="First-run + session-centric review queue">
          <DCArtboard id="setup" label="A · First-run setup" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N.setup}><WfSetup /></WfWrap>
          </DCArtboard>
          <DCArtboard id="review" label="B · Review queue (session-centric, three-pane)" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N.review}><WfReviewQueue /></WfWrap>
          </DCArtboard>
        </DCSection>

        <DCSection id="sessions" title="② Acquisition sessions" subtitle="One list view with multiple group-by states + calendar. Multi-project re-use visible in the Projects column.">
          <DCArtboard id="sess-list" label="A · List (flat, sorted by date)" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N['sess-list']}><WfSessionsList /></WfWrap>
          </DCArtboard>
          <DCArtboard id="sess-by-target" label="B · Grouped by target" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N['sess-by-target']}><WfSessionsByTarget /></WfWrap>
          </DCArtboard>
          <DCArtboard id="sess-by-month" label="C · Grouped by month" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N['sess-by-month']}><WfSessionsByMonth /></WfWrap>
          </DCArtboard>
          <DCArtboard id="sess-by-train" label="D · Grouped by optical train" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N['sess-by-train']}><WfSessionsByTrain /></WfWrap>
          </DCArtboard>
          <DCArtboard id="sess-calendar" label="E · Calendar view" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N['sess-cal']}><WfSessionsCalendar /></WfWrap>
          </DCArtboard>
          <DCArtboard id="session-detail" label="F · Session detail" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N['session-detail']}><WfSessionDetail /></WfWrap>
          </DCArtboard>
        </DCSection>

        <DCSection id="cal-targets" title="③ Calibration & targets">
          <DCArtboard id="calibration" label="A · Calibration masters (three-pane, with project linkage)" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N.calibration}><WfCalibration /></WfWrap>
          </DCArtboard>
          <DCArtboard id="targets" label="B · Targets — list + detail" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N.targets}><WfTargets /></WfWrap>
          </DCArtboard>
        </DCSection>

        <DCSection id="projects" title="④ Projects" subtitle="List + project-detail variations (all sidebar nav, with view-toggle: command center / pipeline / combined)">
          <DCArtboard id="projects-list" label="A · Projects list" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N['projects-list']}><WfProjects /></WfWrap>
          </DCArtboard>
          <DCArtboard id="proj-center" label="B · Command center (kit-grid source map)" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N['proj-center']}><WfProjectDetailA /></WfWrap>
          </DCArtboard>
          <DCArtboard id="proj-pipeline" label="C · Pipeline" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N['proj-pipeline']}><WfProjectDetailB /></WfWrap>
          </DCArtboard>
          <DCArtboard id="proj-combined" label="D · Combined — source map + pipeline" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N['proj-combined']}><WfProjectDetailC /></WfWrap>
          </DCArtboard>
        </DCSection>

        <DCSection id="wizard" title="⑤ New project wizard" subtitle="End-to-end: name → lights → calibration → source views → naming → review plan & create">
          <DCArtboard id="wiz-3" label="Step 3 · Calibration" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N['wiz-3']}><WfProjectWizard /></WfWrap>
          </DCArtboard>
          <DCArtboard id="wiz-4" label="Step 4 · Source views" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N['wiz-4']}><WfProjectWizardViews /></WfWrap>
          </DCArtboard>
          <DCArtboard id="wiz-6" label="Step 6 · Review plan & create" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N['wiz-6']}><WfProjectWizardReview /></WfWrap>
          </DCArtboard>
        </DCSection>

        <DCSection id="plans" title="⑥ Filesystem plans" subtitle="Single plan-review page; toggle between table and diff in the header">
          <DCArtboard id="plan-table" label="A · Plan review — Table" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N['plan-table']}><WfPlanReviewTable /></WfWrap>
          </DCArtboard>
          <DCArtboard id="plan-diff" label="B · Plan review — Diff (before / after)" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N['plan-diff']}><WfPlanReviewDiff /></WfWrap>
          </DCArtboard>
        </DCSection>

        <DCSection id="lifecycle" title="⑦ Artifacts & audit">
          <DCArtboard id="artifacts" label="A · Processing artifacts & outputs" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N.artifacts}><WfArtifacts /></WfWrap>
          </DCArtboard>
          <DCArtboard id="audit" label="B · Audit log" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N.audit}><WfAudit /></WfWrap>
          </DCArtboard>
        </DCSection>

        <DCSection id="settings" title="⑧ Settings" subtitle="Data sources · naming · source view strategy · cleanup policy">
          <DCArtboard id="set-sources" label="A · Data sources" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N['set-sources']}><WfSettingsDataSources /></WfWrap>
          </DCArtboard>
          <DCArtboard id="set-naming" label="B · Naming & structure" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N['set-naming']}><WfSettingsNaming /></WfWrap>
          </DCArtboard>
          <DCArtboard id="set-views" label="C · Source view strategy" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N['set-views']}><WfSettingsViewStrategy /></WfWrap>
          </DCArtboard>
          <DCArtboard id="set-cleanup" label="D · Cleanup & archive policy" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N['set-cleanup']}><WfSettingsCleanup /></WfWrap>
          </DCArtboard>
          <DCArtboard id="set-recovery" label="E · Root recovery (drive remap)" width={W_DESKTOP} height={H_TOTAL}>
            <WfWrap notes={N['set-recovery']}><WfRootRecovery /></WfWrap>
          </DCArtboard>
        </DCSection>

        <DCSection id="density" title="⑨ Density study" subtitle="The same sessions table at three densities.">
          <DCArtboard id="density-study" label="Compact · Comfortable · Spacious" width={1480} height={H_DENSITY + H_NOTES}>
            <WfWrap notes={N['density-study']}><WfDensityStudy /></WfWrap>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>

      <TweaksPanel title="Wireframe tweaks">
        <TweakSection label="Display" />
        <TweakToggle label="Annotations" value={tweaks.annotations} onChange={v => setTweak('annotations', v)} />
        <TweakToggle label="Sketchy" value={tweaks.sketchy} onChange={v => setTweak('sketchy', v)} />
        <TweakSection label="Default nav pattern" />
        <TweakRadio label="Nav" value={tweaks.nav} onChange={v => setTweak('nav', v)} options={[
          { value: 'sidebar', label: 'Side' },
          { value: 'tabs', label: 'Tabs' },
          { value: 'three-pane', label: '3-pane' },
        ]} />
        <TweakSection label="Density" />
        <TweakRadio label="Density" value={tweaks.density} onChange={v => setTweak('density', v)} options={[
          { value: 'compact', label: 'Tight' },
          { value: 'comfortable', label: 'Comfy' },
          { value: 'spacious', label: 'Loose' },
        ]} />
      </TweaksPanel>
    </TweakCtx.Provider>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<CanvasApp />);
