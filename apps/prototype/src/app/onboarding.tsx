/**
 * Onboarding after setup (Round 6, spec 056): the orientation walk and the
 * Getting started checklist.
 *
 * - The walk (`OrientationWalk`): five steps anchored to the source list,
 *   the toolbar's Issues, Home's Next, the status bar and Targets, on the
 *   modal `CoachWalk`. Setup's end makes it due once
 *   (`settings.onboarding.walk`); Done or Skip marks it done, and Settings ›
 *   Help restarts it. A step whose anchor is not on screen (a narrow window
 *   has no source list) is passed over.
 * - The checklist (`GettingStartedRing`): a ChecklistRing in the sidebar
 *   footer, above Activity and Settings (C OB7). Set up locations, first
 *   import, confirm Targets, first Project, first run and, on Windows, turn
 *   on Developer Mode (symlinks need it, P-PREP3), each ticked from the
 *   library's state or the last check. It goes once every step is done or
 *   the user dismisses it.
 */
import { useNavigate, useRouterState } from "@tanstack/react-router"
import { type ChecklistItem, ChecklistRing } from "@/components/app/checklist"
import { type CoachStep, CoachWalk } from "@/components/app/walk"
import { setOnboarding } from "@/features/t1/lib/writes"
import { nowIso, type PrototypeState, useStore } from "@/store/core"
import { openWindowsDeveloperSettings } from "@/store/actions/settings"
import { useMessages } from "./preferences"
import { openSheet } from "./ui-state"

// ---------------------------------------------------------------------------
// Orientation walk
// ---------------------------------------------------------------------------

/** Restart the walk (Settings › Help); it shows on the next app screen. */
export function restartWalk() {
  setOnboarding({ walk: "due" })
}

function useWalkSteps(): CoachStep[] {
  const m = useMessages()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const toHome = () => {
    if (pathname !== "/") void navigate({ to: "/" })
  }
  return [
    { id: "sources", title: m.onboarding_walk_sources_title(), body: m.onboarding_walk_sources(), anchors: ["[data-frame-nav]"] },
    { id: "issues", title: m.issues_title(), body: m.onboarding_walk_issues(), anchors: ["[data-issues]"] },
    { id: "next", title: m.onboarding_walk_next_title(), body: m.onboarding_walk_next(), anchors: ["[data-next]", "#home-projects"], onEnter: toHome },
    { id: "status", title: m.onboarding_walk_status_title(), body: m.onboarding_walk_status(), anchors: ["[data-status-bar]"] },
    { id: "targets", title: m.nav_targets(), body: m.onboarding_walk_targets(), anchors: ['[data-frame-nav] a[href$="/targets"]'] },
  ]
}

function Walk() {
  const steps = useWalkSteps()
  return <CoachWalk steps={steps} onEnd={() => setOnboarding({ walk: "done" })} />
}

/** Mounted in the app frame: the walk while it is due. */
export function OrientationWalk() {
  const due = useStore((s) => s.settings.onboarding.walk === "due")
  return due ? <Walk /> : null
}

// ---------------------------------------------------------------------------
// Getting started checklist (sidebar footer)
// ---------------------------------------------------------------------------

type CheckId = "locations" | "import" | "targets" | "project" | "run" | "developer-mode"

/** Each step, ticked from what the library holds now. */
function checklist(s: PrototypeState): Array<{ id: CheckId; done: boolean }> {
  const { catalog, operations, settings } = s
  return [
    { id: "locations", done: Object.values(catalog.locations).some((l) => !l.retiredAt) },
    { id: "import", done: Object.values(operations).some((op) => op.kind === "import" && (op.status === "succeeded" || op.status === "partial")) },
    { id: "targets", done: Object.values(catalog.sessions).some((x) => x.imageType === "light" && !x.supersededBy && x.target.status === "confirmed") },
    { id: "project", done: Object.keys(catalog.projects).length > 0 },
    { id: "run", done: Object.keys(catalog.runs).length > 0 },
    ...(settings.developerModeCheck === "not-windows" ? [] : [{ id: "developer-mode" as const, done: settings.developerModeCheck === "on" }]),
  ]
}

/** Whether the checklist still shows: some step is pending and the user has not dismissed it. */
export function useGettingStartedDue(): boolean {
  const checks = useStore(checklist)
  const dismissed = useStore((s) => Boolean(s.settings.onboarding.checklistDismissedAt))
  return !dismissed && checks.some((check) => !check.done)
}

/** The checklist ring, until every step is done or it is dismissed. */
export function GettingStartedRing({ collapsed }: { collapsed: boolean }) {
  const m = useMessages()
  const navigate = useNavigate()
  const checks = useStore(checklist)
  const due = useGettingStartedDue()
  const firstProjectId = useStore((s) => Object.values(s.catalog.projects).find((p) => p.state === "open")?.id ?? null)
  if (!due) return null

  const item: Record<CheckId, Omit<ChecklistItem, "id" | "done">> = {
    locations: { label: m.setup_set_up_locations(), action: { id: "open-locations", label: m.verb_open(), run: () => void navigate({ to: "/settings/locations" }) } },
    import: { label: m.onboarding_check_import(), action: { id: "import", label: m.import_open(), run: () => void navigate({ to: "/import" as never }) } },
    targets: { label: m.onboarding_check_targets(), action: { id: "review-targets", label: m.verb_review(), run: () => void navigate({ to: "/sessions", search: { filter: "needs-target" } as never }) } },
    project: { label: m.onboarding_check_project(), action: { id: "new-project", label: m.newproject_open_ellipsis(), run: () => openSheet({ kind: "new-project" }) } },
    run: {
      label: m.onboarding_check_run(),
      action: {
        id: "start-run",
        label: m.startrun_open_ellipsis(),
        run: () => (firstProjectId ? openSheet({ kind: "start-run", projectId: firstProjectId }) : undefined),
        unavailable: firstProjectId ? undefined : { action: m.startrun_open_ellipsis(), reason: m.onboarding_check_project(), blockers: [] },
      },
    },
    "developer-mode": { label: m.onboarding_check_developer_mode(), action: { id: "developer-mode", label: m.settings_open_windows_settings(), run: () => openWindowsDeveloperSettings() } },
  }

  return (
    <ChecklistRing
      title={m.onboarding_getting_started()}
      collapsed={collapsed}
      sections={[{ id: "steps", title: m.onboarding_checklist_steps(), items: checks.map((check) => ({ id: check.id, done: check.done, ...item[check.id] })) }]}
      onDismiss={() => setOnboarding({ checklistDismissedAt: nowIso() })}
    />
  )
}
