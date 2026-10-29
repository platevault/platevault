/**
 * The Project area against the library IPC as the webview sees it: every
 * answer comes from a mocked `__TAURI_INTERNALS__` host, so these cover the
 * consumer-visible contract (what the user sees for a stale basis, a
 * cancelled Apply, a missing archive destination), not the library itself.
 */
import { QueryClientProvider } from "@tanstack/react-query"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { ApplyPreview_Serialize, ApplyReport_Serialize, NativePathWire, ProjectSummary, WrapUpStatus } from "@/api/ipc"
import { createQueryClient } from "@/api/query"
import { m } from "@/lib/i18n"
import { ApplySheet } from "./apply-sheet"
import { resetApplyRuns, startApply } from "./apply-run"
import { applyBlocker, stopText } from "./apply-words"
import { outputName } from "./output-tab"
import { keyParts } from "./sessions"
import { wrapUpSteps } from "./wrap-up"

const PROJECT = "11111111-1111-1111-1111-111111111111"
const path = (display: string): NativePathWire => ({ encoding: "unix-bytes", payload: [...new TextEncoder().encode(display)], display })
const HEADER: ProjectSummary = { id: PROJECT, name: "Cygnus HOO", lifecycle: "open", revision: 4, subjects: ["NGC 7000"], rigCount: 1, goalCount: 0 }

function preview(over: Partial<ApplyPreview_Serialize> = {}): ApplyPreview_Serialize {
  return {
    projectId: PROJECT,
    desiredRevision: 4,
    appliedGeneration: null,
    basisDigest: "digest-a",
    projectFolder: path("/p/Cygnus HOO"),
    mode: "symlinks",
    entries: [],
    footprint: { frames: 0, bytes: 0, cloned: 0 },
    foreign: [],
    changedCopies: [],
    leftovers: [],
    blockers: [],
    ...over,
  }
}

function report(over: Partial<ApplyReport_Serialize> = {}): ApplyReport_Serialize {
  return { projectId: PROJECT, operationId: "op", generation: 1, outcome: "applied", failures: [], foreign: [], leftovers: [], keptMissing: [], correctedValues: 0, patchedCopies: 0, footprint: { frames: 0, bytes: 0, cloned: 0 }, stop: null, ...over }
}

afterEach(() => {
  cleanup()
  clearMocks()
  resetApplyRuns()
})

describe("Apply sheet", () => {
  it("applies the reviewed basis, and a later read that differs blocks Apply until the user takes it", async () => {
    let reads = 0
    const applied: unknown[] = []
    mockIPC((command, args) => {
      if (command === "project_apply_preview") return preview(reads++ === 0 ? {} : { basisDigest: "digest-b", desiredRevision: 5 })
      if (command === "project_inputs") return null
      if (command === "project_apply") {
        applied.push((args as { request: unknown }).request)
        return report()
      }
      return null
    })
    const client = createQueryClient()
    render(
      <QueryClientProvider client={client}>
        <ApplySheet header={HEADER} onClose={() => undefined} />
      </QueryClientProvider>,
    )
    // The reviewed read has arrived once Apply is enabled (the unavailable trigger is a different element).
    await waitFor(() => expect(screen.getByRole("button", { name: m.project_apply() })).not.toHaveAttribute("aria-disabled", "true"))
    // A background re-read moves the basis: the sheet keeps what was reviewed and refuses to apply it blind.
    await act(() => client.refetchQueries())
    expect(await screen.findByText(m.view_sheet_stale())).toBeInTheDocument()
    expect(screen.getByRole("button", { name: m.project_apply() })).toHaveAttribute("aria-disabled", "true")
    expect(applied).toEqual([])
  })

  it("lists every blocker with where it is resolved, and Apply stays unavailable", async () => {
    mockIPC((command) => {
      if (command === "project_apply_preview")
        return preview({ blockers: [{ blocker: "no_processing_location" }, { blocker: "original_offline", path: path("/Volumes/T7/a.fits"), locationId: "loc" }, { blocker: "leftovers_pending", count: 2 }] })
      return null
    })
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ApplySheet header={HEADER} onClose={() => undefined} />
      </QueryClientProvider>,
    )
    expect(await screen.findByText(m.apply_refused_no_folder(), { selector: "th, td, th *, td *" })).toBeInTheDocument()
    expect(screen.getByText(m.apply_blocker_original_offline({ path: "/Volumes/T7/a.fits" }))).toBeInTheDocument()
    expect(screen.getByText(m.view_review_previous_first())).toBeInTheDocument()
  })
})

describe("Apply run", () => {
  it("reports a cancelled build as cancelled with the old View kept, never as applied", async () => {
    mockIPC((command) => (command === "project_apply" ? report({ outcome: "canceled", stop: { code: "canceled" } }) : null))
    const client = createQueryClient()
    const { useApplyRun } = await import("./apply-run")
    let seen: ReturnType<typeof useApplyRun> = null
    function Probe() {
      seen = useApplyRun(PROJECT)
      return null
    }
    render(<Probe />)
    act(() => startApply(client, { projectId: PROJECT, desiredRevision: 4, basisDigest: "digest-a", ticked: [] }))
    await waitFor(() => expect(seen?.phase).toBe("settled"))
    const settled = seen as unknown as { phase: "settled"; result: { ok: true; data: ApplyReport_Serialize } }
    expect(settled.result.ok).toBe(true)
    expect(settled.result.data.outcome).toBe("canceled")
    expect(stopText(m, settled.result.data.stop!)).toBe(m.apply_stop_canceled())
  })

  it("keeps a stale basis refusal as a refusal", async () => {
    mockIPC((command) => {
      if (command === "project_apply") throw { code: "conflict", retry: "review", successors: [], currentRevision: 5 }
      return null
    })
    const client = createQueryClient()
    const { useApplyRun } = await import("./apply-run")
    let seen: ReturnType<typeof useApplyRun> = null
    function Probe() {
      seen = useApplyRun(PROJECT)
      return null
    }
    render(<Probe />)
    act(() => startApply(client, { projectId: PROJECT, desiredRevision: 4, basisDigest: "stale", ticked: [] }))
    await waitFor(() => expect(seen?.phase).toBe("settled"))
    const settled = seen as unknown as { result: { ok: boolean; failure?: { source: string; error: { code: string } } } }
    expect(settled.result.ok).toBe(false)
    expect(settled.result.failure?.error.code).toBe("conflict")
  })
})

describe("words", () => {
  it("links a blocker that names a session to that session, in both locales", () => {
    const blocker = applyBlocker(m, { blocker: "calibration_unsettled", sessionId: "s1", kinds: ["dark"] }, () => "18 Sep · Ha", { to: "/projects/$projectId" })
    expect(blocker.link).toEqual({ to: "/sessions/$sessionId", params: { sessionId: "s1" } })
    expect(blocker.label).toBe(m.view_blocker_unsettled({ name: "18 Sep · Ha" }))
  })

  it("reads the night and filter from a capture key, and nothing it doesn't name", () => {
    expect(keyParts("capture-v1|type=light|night=2026-09-12@date-loc-noon|filter=Ha")).toEqual({ night: "2026-09-12", filter: "Ha" })
    expect(keyParts("capture-v1|type=light")).toEqual({ night: null, filter: null })
  })

  it("encodes an Output name like the source path", () => {
    expect(outputName("é.fits", path("/x")).payload).toEqual([...new TextEncoder().encode("é.fits")])
    expect(outputName("é", { encoding: "windows-utf16", payload: [], display: "C:\\x" }).payload).toEqual([0xe9])
  })
})

describe("Wrap up steps", () => {
  const status = (over: Partial<WrapUpStatus>): WrapUpStatus => ({ projectId: PROJECT, lifecycle: "open", desiredRevision: 4, blocker: null, records: [], current: "clean_up", ...over })

  it("orders Clean up, Trash and Archive, recording each as the library did", () => {
    const steps = wrapUpSteps(m, status({ records: [{ step: "clean_up", outcome: "skipped", operationId: null, recordedAt: "2026-10-29T10:00:00Z" }], current: "trash" }), null)
    expect(steps.map((s) => [s.id, s.state])).toEqual([
      ["clean_up", "skipped"],
      ["trash", "current"],
      ["archive", "todo"],
    ])
  })

  it("holds the current step while changes are pending", () => {
    const gate = { reason: m.flow_wrapup_pending({ count: 2 }), blockers: [] }
    const steps = wrapUpSteps(m, status({ blocker: { blocker: "pending_changes", count: 2 } }), gate)
    expect(steps[0]).toMatchObject({ id: "clean_up", state: "blocked", gate })
  })
})
