/**
 * The Project pages in the app window over a mocked library host: what the
 * user sees and what each write sends, for the reviewed Apply basis, every
 * way an Apply ends, View (previous) review, a missing pin, a Project left
 * Closing, a locked Project's Duplicate and Close without a destination.
 */
import { type AnyRoute, createMemoryHistory, createRoute } from "@tanstack/react-router"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import type { ApplyPreview_Serialize, ApplyReport_Serialize, NativePathWire, ProjectInputs_Serialize, ProjectSummary, WrapUpStatus } from "@/api/ipc"
import { createQueryClient } from "@/api/query"
import { AppRoot } from "@/app/root"
import { m } from "@/lib/i18n"
import { createShellRouter } from "@/routes"
import { resetApplyRuns, startApply } from "./apply-run"
import { resetCloseRuns } from "./close-run"
import { ProjectPage } from "./project-page"
import { ProjectsPage } from "./projects-page"

const P = "11111111-1111-1111-1111-111111111111"
const S1 = "22222222-2222-2222-2222-222222222222"
const G1 = "33333333-3333-3333-3333-333333333333"
const path = (display: string): NativePathWire => ({ encoding: "unix-bytes", payload: [...new TextEncoder().encode(display)], display })
const TEST_MS = 30_000

const summary = (lifecycle: ProjectSummary["lifecycle"] = "open"): ProjectSummary => ({ id: P, name: "Cygnus HOO", lifecycle, revision: 4, subjects: ["NGC 7000"], rigCount: 1, goalCount: 0 })

const INPUTS: ProjectInputs_Serialize = {
  desired: {
    projectId: P,
    revision: 4,
    lifecycle: "open",
    settings: { mode: "symlinks", keywords: null, profileId: null, parent: path("/p") },
    groups: [{ id: G1, rigId: "rig", name: "Rig · Framing 1", panel: false, origin: "framing", optics: { cameraId: null, focalLengthMm: null, reducer: null }, framing: null, position: 0 }],
    sessions: [{ sessionId: S1, groupId: G1, placement: "framing", targetId: "t", groupingRevision: 1, calibrationGeneration: 1, addedAt: "2026-10-01T00:00:00Z" }],
    captures: [],
  },
  keywords: { group: "GROUP", panel: "PANEL" },
  folders: [],
  pending: [],
  suggestions: [],
  panels: [],
  panelOffers: [],
}

function preview(over: Partial<ApplyPreview_Serialize> = {}): ApplyPreview_Serialize {
  return { projectId: P, desiredRevision: 4, appliedGeneration: null, basisDigest: "digest-a", projectFolder: path("/p/Cygnus HOO"), mode: "symlinks", entries: [], footprint: { frames: 0, bytes: 0, cloned: 0 }, foreign: [], changedCopies: [], leftovers: [], blockers: [], ...over }
}

function report(over: Partial<ApplyReport_Serialize> = {}): ApplyReport_Serialize {
  return { projectId: P, operationId: "op", generation: 1, outcome: "applied", failures: [], foreign: [], leftovers: [], keptMissing: [], correctedValues: 0, patchedCopies: 0, footprint: { frames: 0, bytes: 0, cloned: 0 }, stop: null, ...over }
}

function status(over: Partial<WrapUpStatus> = {}): WrapUpStatus {
  return { projectId: P, lifecycle: "open", desiredRevision: 4, blocker: null, records: [], current: "clean_up", ...over }
}

const evidence = { path: path("/p/Cygnus HOO/View (previous)/notes.txt"), root: null, kind: { kind: "file" as const }, fingerprint: { identity: { volume: { filesystem: "apfs", stableId: null, fileIdsStable: true, case: "sensitive" as const, normalization: "sensitive" as const }, fileId: null }, sizeBytes: 1, modifiedNs: "0", contentSha256: null }, sha256: "ab" }

type Answer = (args: Record<string, unknown>) => unknown

/** The library host: `answers` by command, then quiet defaults; every call is recorded with its arguments. */
function host(answers: Record<string, Answer> = {}) {
  const calls: { command: string; args: Record<string, unknown> }[] = []
  mockIPC((command, args) => {
    const fields = (args ?? {}) as Record<string, unknown>
    if (command === "plugin:event|listen") return fields.handler
    if (command === "plugin:event|unlisten") return null
    calls.push({ command, args: fields })
    const answer = answers[command]
    if (answer) return answer(fields)
    switch (command) {
      case "library_issues":
        return { issues: [], dismissed: [], counts: { danger: 0, warning: 0, info: 0 }, pages: [] }
      case "library_list_locations":
      case "library_list_operations":
      case "prepare_profiles":
      case "project_previous_items":
        return []
      case "project_list":
        return [summary()]
      case "project_inputs":
        return INPUTS
      case "project_progress":
        return { projectId: P, revision: 4, goals: [], warnings: [] }
      case "project_apply_preview":
        return preview()
      case "project_wrap_up_status":
        return status()
      default:
        return null
    }
  })
  return { calls, sent: (command: string) => calls.filter((c) => c.command === command) }
}

function renderAt(url: string) {
  const history = createMemoryHistory({ initialEntries: [url] })
  const pages = (appWindow: AnyRoute): AnyRoute[] => [
    createRoute({ getParentRoute: () => appWindow, path: "/projects", component: ProjectsPage }),
    createRoute({ getParentRoute: () => appWindow, path: "/projects/$projectId", component: ProjectPage }),
  ]
  const client = createQueryClient()
  render(<AppRoot router={createShellRouter(history, pages)} client={client} />)
  return { history, client }
}

const enabled = (name: string) => waitFor(() => expect(screen.getByRole("button", { name })).not.toHaveAttribute("aria-disabled", "true"))

const original = { resizeObserver: globalThis.ResizeObserver, scrollIntoView: Element.prototype.scrollIntoView }

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Element.prototype.scrollIntoView = () => {}
})

afterAll(() => {
  globalThis.ResizeObserver = original.resizeObserver
  Element.prototype.scrollIntoView = original.scrollIntoView
})

afterEach(() => {
  cleanup()
  clearMocks()
  resetApplyRuns()
  resetCloseRuns()
})

describe("Apply", { timeout: TEST_MS }, () => {
  it("sends exactly the reviewed revision, digest and ticked foreign files, then reports Applied", async () => {
    const user = userEvent.setup()
    const keep = path("notes/keep.txt")
    const { sent } = host({
      project_apply_preview: () => preview({ foreign: [{ path: keep, evidence }, { path: path("notes/leave.txt"), evidence }] }),
      project_apply: () => report(),
    })
    renderAt(`/projects/${P}?stage=view&apply=open`)
    const dialog = await screen.findByRole("dialog")
    await user.click(await within(dialog).findByRole("checkbox", { name: /keep\.txt/ }))
    await enabled(m.project_apply())
    await user.click(screen.getByRole("button", { name: m.project_apply() }))
    await waitFor(() => expect(sent("project_apply")).toHaveLength(1))
    expect(sent("project_apply")[0]!.args.request).toEqual({ projectId: P, desiredRevision: 4, basisDigest: "digest-a", ticked: [keep] })
    expect(await screen.findByText(m.view_apply_applied())).toBeInTheDocument()
  })

  it("lists a missing pin among the blockers and keeps Apply unavailable", async () => {
    host({ project_apply_preview: () => preview({ blockers: [{ blocker: "pin_drift", sessionId: S1, kind: "dark", path: null, health: "missing" }] }) })
    renderAt(`/projects/${P}?stage=view&apply=open`)
    expect(await screen.findByText(m.project_pin_missing({ kind: m.calibration_kind_dark() }))).toBeInTheDocument()
    expect(screen.getByRole("button", { name: m.project_apply() })).toHaveAttribute("aria-disabled", "true")
  })

  const ended: [string, () => unknown, string, string | null][] = [
    ["cancelled", () => report({ outcome: "canceled", stop: { code: "canceled" } }), m.view_apply_canceled(), m.apply_stop_canceled()],
    ["failed", () => report({ outcome: "failed", stop: { code: "originals_unverified", count: 2 } }), m.op_apply_failed(), m.apply_stop_originals_unverified({ count: 2 })],
    ["interrupted", () => report({ outcome: null, stop: { code: "interrupted" } }), m.view_apply_unsettled(), m.apply_stop_interrupted()],
  ]
  for (const [name, answer, title, line] of ended)
    it(`shows a ${name} Apply as ${name}, never as applied`, async () => {
      host({ project_apply: answer })
      const { client } = renderAt(`/projects/${P}?stage=view`)
      await screen.findByText(m.project_view_settings())
      act(() => startApply(client, { projectId: P, desiredRevision: 4, basisDigest: "digest-a", ticked: [] }))
      expect(await screen.findByText(title)).toBeInTheDocument()
      if (line) expect(screen.getByText(line)).toBeInTheDocument()
      expect(screen.queryByText(m.view_apply_applied())).toBeNull()
    })

  it("shows a refused Apply as a refusal and re-reads the Project", async () => {
    const { sent } = host({
      project_apply: () => {
        throw { code: "conflict", retry: "review", successors: [] }
      },
    })
    const { client } = renderAt(`/projects/${P}?stage=view`)
    await screen.findByText(m.project_view_settings())
    const before = sent("project_inputs").length
    act(() => startApply(client, { projectId: P, desiredRevision: 4, basisDigest: "stale", ticked: [] }))
    expect(await screen.findByText(m.action_failure_conflict())).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: new RegExp(m.view_apply_review_again()) })).toHaveLength(1)
    expect(screen.queryByText(m.view_apply_applied())).toBeNull()
    await waitFor(() => expect(sent("project_inputs").length).toBeGreaterThan(before))
  })
})

describe("View (previous)", { timeout: TEST_MS }, () => {
  it("keeps, moves and trashes a leftover, each as the library's review", async () => {
    const user = userEvent.setup()
    const item = { path: path("View (previous)/notes.txt"), reason: "unticked_file" as const, evidence, review: "pending" as const }
    const { sent } = host({ project_previous_items: () => [item] })
    renderAt(`/projects/${P}?stage=view`)
    const menu = async () => user.click(await screen.findByRole("button", { name: m.actions_for({ name: "View (previous)/notes.txt" }) }))
    await menu()
    await user.click(await screen.findByRole("menuitem", { name: m.status_keep() }))
    await menu()
    await user.click(await screen.findByRole("menuitem", { name: m.project_previous_move() }))
    await menu()
    await user.click(await screen.findByRole("menuitem", { name: new RegExp(m.common_move_to_trash()) }))
    const confirm = await screen.findByRole("alertdialog")
    await user.click(within(confirm).getByRole("button", { name: m.common_move_to_trash() }))
    await waitFor(() => expect(sent("project_review_previous_item").map((c) => c.args.resolution)).toEqual(["kept", "moved", "trashed"]))
  })
})

describe("Wrap up", { timeout: TEST_MS }, () => {
  const recorded = (step: "clean_up" | "trash" | "archive") => ({ step, outcome: "finished" as const, operationId: null, recordedAt: "2026-10-29T10:00:00Z" })

  it("keeps Close project unavailable without an archive destination, and offers Close without archiving", async () => {
    host({ project_wrap_up_status: () => status({ records: [recorded("clean_up"), recorded("trash")], current: "archive" }) })
    renderAt(`/projects/${P}?stage=wrap-up&step=archive`)
    expect((await screen.findAllByText(m.wrapup_no_archive_location())).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.getByRole("button", { name: new RegExp(`^${m.stepflow_close_project()}`) })).toHaveAttribute("aria-disabled", "true"))
    expect(screen.getByRole("button", { name: new RegExp(m.wrapup_close_without_archive()) })).toBeInTheDocument()
  })

  it("reads a Project left Closing as Closing, with Stop", async () => {
    const user = userEvent.setup()
    const { sent } = host({
      project_list: () => [summary("closing")],
      project_wrap_up_status: () => status({ lifecycle: "closing", blocker: { blocker: "not_open", lifecycle: "closing" }, records: [recorded("clean_up"), recorded("trash"), recorded("archive")], current: null }),
    })
    renderAt(`/projects/${P}?stage=wrap-up`)
    expect(await screen.findByText(m.wrapup_closing_state())).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: m.wrapup_stop_archive() }))
    await waitFor(() => expect(sent("project_close_stop")).toHaveLength(1))
  })
})

describe("A locked Project", { timeout: TEST_MS }, () => {
  it("offers no Apply, says it closed, and duplicates on the current pins", async () => {
    const user = userEvent.setup()
    const { sent } = host({
      project_list: () => [summary("closed"), { ...summary(), id: "copy", name: "Cygnus HOO (copy)" }],
      project_closed_snapshot: () => ({ projectId: P, takenAt: "2026-10-20T10:00:00Z", appliedGeneration: 1, basis: { mode: "symlinks", keywords: { group: "G", panel: "P" }, groups: [] }, goals: [] }),
      project_duplicate: () => ({ id: "copy", name: "Cygnus HOO (copy)" }),
    })
    renderAt(`/projects/${P}?duplicate=open`)
    const dialog = await screen.findByRole("dialog", { name: m.common_duplicate_title({ name: "Cygnus HOO" }) })
    expect(screen.queryByRole("button", { name: m.project_apply() })).toBeNull()
    await enabled(m.project_duplicate())
    await user.click(within(dialog).getByRole("button", { name: m.project_duplicate() }))
    await waitFor(() => expect(sent("project_duplicate")).toHaveLength(1))
    expect(sent("project_duplicate")[0]!.args.request).toEqual({ projectId: P, name: m.project_duplicate_name({ name: "Cygnus HOO" }), sessions: [S1], goals: true, notes: true, settings: true })
  })
})
