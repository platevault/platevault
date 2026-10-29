/**
 * The Library area (Home, Sessions, intake, Import) against the library IPC
 * as the webview sees it: every answer comes from a mocked
 * `__TAURI_INTERNALS__` host, so these cover the consumer-visible contract
 * (stale revisions, refusals, restart progress, the bytes a path carries,
 * removable devices), not the library itself.
 */
import { QueryClientProvider } from "@tanstack/react-query"
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import type { ImportOperation_Serialize, LibrarySession_Serialize, NativePathWire, RemovableDevice, SessionAdmission_Serialize } from "@/api/ipc"
import { createQueryClient } from "@/api/query"
import type { SessionReviewProps } from "@/app/shell-contract"
import { setLocale } from "@/app/preferences"
import { formatList } from "@/lib/format"
import { LOCALES, m } from "@/lib/i18n"
import { HomePage } from "./home-page"
import { ImportPage } from "./import-page"
import { locationIngestion } from "./ingestions"
import { SessionPage } from "./session-page"
import { SessionsPage } from "./sessions-page"
import { deviceKind, deviceNote } from "./words"

const encode = (display: string): NativePathWire => ({ encoding: "unix-bytes", payload: [...new TextEncoder().encode(display)], display })
/** A mount point whose name is not UTF-8: the display text cannot rebuild these bytes. */
const RAW_ROOT: NativePathWire = { encoding: "unix-bytes", payload: [0x2f, 0x56, 0x6f, 0x6c, 0x2f, 0xff, 0xfe, 0x31], display: "/Vol/\ufffd\ufffd1" }

const CARD: RemovableDevice = { root: encode("/Volumes/Card-1"), name: "Card-1", layout: { layout: "asiair", matched: ["autorun_folder", "plan_folder"] } }
const NINA: RemovableDevice = { root: encode("/Volumes/NINA"), name: "NINA", layout: { layout: "nina", matched: ["light_folder", "flat_folder"] } }
const STICK: RemovableDevice = { root: RAW_ROOT, name: "STICK", layout: null }

function importOp(over: Partial<ImportOperation_Serialize> = {}): ImportOperation_Serialize {
  return {
    id: "imp-1",
    sourceId: null,
    sourcePath: encode("/Volumes/Card-1"),
    sourceAvailability: "available",
    mode: null,
    state: "previewed",
    revision: 3,
    items: [],
    destinations: [{ role: "captures", locationId: "loc-1", name: "Captures", path: encode("/Astro/Captures"), chosen: true, items: 2, bytes: 2048, freeBytes: 1 << 30, writability: { state: "writable" } }],
    summary: { ready: 2, imported: 0, duplicates: 0, unclassified: 0, settling: 0, blocked: 0, excluded: 0, pending: 0, failed: 0, failedVerification: 0, sourcesTrashed: 0, sourcesKept: 0, uncertain: 0 },
    sessions: [],
    splitLimits: { maxCentreOffsetArcmin: null, maxRotationDeg: null },
    splitOverridden: false,
    createdAt: "2026-10-29T10:00:00Z",
    updatedAt: "2026-10-29T10:00:00Z",
    settledAt: null,
    ...over,
  }
}

const SESSION_ID = "11111111-1111-1111-1111-111111111111"
const FINGERPRINT = { identity: { volume: { kind: "unix", device: 1 } as never, fileId: "7" }, sizeBytes: 100, modifiedNs: "1", contentSha256: null }

function librarySession(): LibrarySession_Serialize {
  const session = { id: SESSION_ID, key: "capture-v1|type=light|night=2026-09-12@date-loc-noon|filter=Ha|exposure_s=300", groupingRevision: 4, decisionRevision: 7, assetIds: ["a1"], provisional: [], dateBasis: "date-loc-noon" }
  const candidate = { id: "t-ngc7000", designation: "NGC 7000", aliases: [], commonName: "North America Nebula", objectType: "HII", coordinates: null, provenance: { source: "user" as const }, providerId: null }
  return {
    detail: {
      summary: { session, locationIds: ["loc-1"], assetCount: 1, captureCount: 1, availability: "available", lastObservedAt: null, provisional: false, successors: [] },
      assets: [],
      members: [],
      associations: [],
      lineage: [],
    },
    targetAssessments: [{ candidate, state: "suggested", evidence: [{ kind: "alias", normalized: "ngc7000", agrees: true }], provenance: { source: "user" } }],
  } as unknown as LibrarySession_Serialize
}

function admission(over: Partial<SessionAdmission_Serialize["intake"]> = {}): SessionAdmission_Serialize {
  const unresolved = { state: "unresolved" } as const
  return {
    intake: { sessionId: SESSION_ID, groupingRevision: 4, superseded: false, targetConfirmed: false, rigId: null, reviewFinished: false, unreviewedFrames: 3, changedFrames: 0, ...over },
    calibration: { sessionId: SESSION_ID, generation: 0, matchingPending: false, dark: unresolved, flat: unresolved, bias: unresolved },
    health: { bias: "intact", dark: "intact", flat: "intact" },
    blockers: [{ blocker: "not_ready", readiness: over.targetConfirmed ? "needs_review" : "needs_target" }],
  } as SessionAdmission_Serialize
}

/** A stand-in review body: the router injects the real one (features/review) at integration. */
function StandInReview({ sessionId, onFinished }: SessionReviewProps) {
  return (
    <button type="button" onClick={onFinished}>
      stand-in review of {sessionId}
    </button>
  )
}

const loose = (search: Record<string, unknown>) => search as Record<string, string>

function renderAt(path: string) {
  const root = createRootRoute()
  const tree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: "/", component: HomePage, validateSearch: loose }),
    createRoute({ getParentRoute: () => root, path: "/import", component: ImportPage, validateSearch: loose }),
    createRoute({ getParentRoute: () => root, path: "/sessions", component: SessionsPage, validateSearch: loose }),
    createRoute({ getParentRoute: () => root, path: "/sessions/$sessionId", component: () => <SessionPage review={StandInReview} />, validateSearch: loose }),
  ])
  const router = createRouter({ routeTree: tree, history: createMemoryHistory({ initialEntries: [path] }) })
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, user: userEvent.setup() }
}

const conflict = { code: "conflict", identity: null, scope: null, retry: "review", currentRevision: 4, successors: [], window: null, correction: null }

const original = globalThis.ResizeObserver
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})
afterAll(() => {
  globalThis.ResizeObserver = original
})
afterEach(() => {
  cleanup()
  clearMocks()
  act(() => setLocale("en-GB"))
})

describe("Removable devices (STO-IMP-FR-10)", () => {
  it.each(LOCALES)("names each recognised layout with every marker found, and a generic device as USB device, in %s", (locale) => {
    act(() => setLocale(locale))
    expect(deviceKind(m, CARD)).toBe(m.import_layout_asiair())
    expect(deviceNote(m, CARD)).toBe(m.import_device_found({ markers: formatList([m.import_marker_autorun(), m.import_marker_plan()]) }))
    expect(deviceKind(m, NINA)).toBe(m.import_layout_nina())
    expect(deviceKind(m, STICK)).toBe(m.import_usb_device())
    expect(deviceNote(m, STICK)).toBeNull()
    expect(m.import_usb_device()).toBe(locale === "en-GB" ? "USB device" : "Dispositivo USB")
  })

  it("lists connected devices without a folder pick and drops one when the import_devices event reports it removed", async () => {
    let devices: RemovableDevice[] = [CARD, STICK]
    const listeners = new Map<number, string>()
    mockIPC((command, args) => {
      const fields = (args ?? {}) as { handler?: number; event?: string }
      if (command === "plugin:event|listen") {
        listeners.set(fields.handler!, fields.event!)
        return fields.handler
      }
      if (command === "import_devices_list") return devices
      if (command === "import_sources_list") return []
      return null
    })
    const emit = (event: string, payload: unknown) => {
      const internals = (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void } }).__TAURI_INTERNALS__
      for (const [id, name] of listeners) if (name === event) internals.runCallback(id, { event, id, payload })
    }
    renderAt("/import")
    expect(await screen.findByText("Card-1")).toBeInTheDocument()
    expect(screen.getByText(m.import_layout_asiair())).toBeInTheDocument()
    expect(screen.getByText(deviceNote(m, CARD)!)).toBeInTheDocument()
    expect(screen.getByText(m.import_usb_device())).toBeInTheDocument()
    await waitFor(() => expect([...listeners.values()]).toContain("import_devices"))
    devices = [STICK]
    act(() => emit("import_devices", devices))
    await waitFor(() => expect(screen.queryByText("Card-1")).toBeNull())
    expect(screen.getByText("STICK")).toBeInTheDocument()
  })

  it("previews a device at its root's exact bytes, never a path rebuilt from its display text", async () => {
    const previewed: unknown[] = []
    mockIPC((command, args) => {
      if (command === "import_devices_list") return [STICK]
      if (command === "import_sources_list") return []
      if (command === "import_preview") {
        previewed.push((args as { source: unknown }).source)
        return importOp({ sourcePath: RAW_ROOT })
      }
      if (command === "import_status") return importOp({ sourcePath: RAW_ROOT })
      return null
    })
    const { user } = renderAt("/import")
    const row = (await screen.findByText("STICK")).closest("tr")!
    await user.click(within(row).getByRole("button", { name: m.import_use_source() }))
    await user.click(screen.getByRole("button", { name: m.import_preview() }))
    await waitFor(() => expect(previewed).toHaveLength(1))
    expect(previewed[0]).toEqual({ kind: "folder", path: RAW_ROOT })
    expect((previewed[0] as { path: NativePathWire }).path.payload).toEqual([0x2f, 0x56, 0x6f, 0x6c, 0x2f, 0xff, 0xfe, 0x31])
  })
})

describe("Import", () => {
  it("refuses a start on a stale preview, re-reads the import and keeps the chosen mode", async () => {
    let reads = 0
    const started: unknown[] = []
    mockIPC((command, args) => {
      if (command === "import_status") {
        reads += 1
        return importOp({ revision: reads === 1 ? 3 : 4 })
      }
      if (command === "import_start") {
        started.push(args)
        throw conflict
      }
      return null
    })
    const { user } = renderAt("/import?import=imp-1&step=review")
    await user.click(await screen.findByRole("button", { name: m.import_move() }))
    await user.click(screen.getByRole("button", { name: new RegExp(`^${m.import_import_frames({ count: 2, frames: "2" })}`) }))
    const dialog = await screen.findByRole("alertdialog")
    await user.click(within(dialog).getByRole("button", { name: m.import_move() }))
    expect(await screen.findByText(m.action_failure_conflict())).toBeInTheDocument()
    expect(started).toEqual([{ id: "imp-1", expectedRevision: 3, mode: "move" }])
    await waitFor(() => expect(reads).toBeGreaterThan(1))
    expect(screen.getByRole("button", { name: m.import_move() })).toHaveAttribute("aria-pressed", "true")
  })

  it("after a restart reads where the running import stands, then settles from its durable status", async () => {
    let reads = 0
    mockIPC((command) => {
      if (command !== "import_status") return null
      reads += 1
      const running = importOp({ state: "running", mode: "copy", summary: { ...importOp().summary, ready: 0, imported: 1, pending: 3 } })
      return reads === 1 ? running : importOp({ state: "settled", mode: "copy", summary: { ...importOp().summary, ready: 0, imported: 4 } })
    })
    renderAt("/import?import=imp-1&step=run")
    expect(await screen.findByText(m.home_percent({ percent: 25 }))).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("button", { name: m.import_show_in_sessions() })).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.queryByText(m.home_percent({ percent: 25 }))).toBeNull()
  })
})

describe("Session intake", () => {
  it("confirms the chosen Target at the session's revisions; a stale one is refused and the choice stays", async () => {
    const associated: unknown[] = []
    mockIPC((command, args) => {
      if (command === "library_session") return librarySession()
      if (command === "pix_session_intake") return admission()
      if (command === "library_associate_target") {
        associated.push(args)
        throw conflict
      }
      return null
    })
    const { user } = renderAt(`/sessions/${SESSION_ID}?step=target`)
    await user.click(await screen.findByRole("button", { name: m.session_confirm_target() }))
    expect(await screen.findByText(m.action_failure_conflict())).toBeInTheDocument()
    expect(associated).toEqual([{ expected: [{ sessionId: SESSION_ID, groupingRevision: 4, decisionRevision: 7 }], targetId: "t-ngc7000" }])
    expect(screen.getAllByText("NGC 7000").length).toBeGreaterThan(0)
  })

  it("hosts the injected review body on Review and opens the session once it reports Finish", async () => {
    mockIPC((command) => {
      if (command === "library_session") return librarySession()
      if (command === "pix_session_intake") return admission({ targetConfirmed: true, rigId: "rig-1" })
      if (command === "rig_filters_get") return null
      return null
    })
    const { user, router } = renderAt(`/sessions/${SESSION_ID}?step=review`)
    await user.click(await screen.findByRole("button", { name: `stand-in review of ${SESSION_ID}` }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("12 Sep · Ha")
  })
})

describe("Home", () => {
  it("keeps an offline Captures location as offline, never as everything imported", () => {
    const location = { id: "loc-1", name: "NAS captures", path: encode("/Volumes/NAS"), role: "captures", identity: FINGERPRINT.identity, decisionRevision: 1, availability: "offline", lastObservedAt: null, lifecycle: "active", volumeKind: "network" } as const
    expect(locationIngestion(location, undefined, 0)).toEqual({ kind: "location", location, state: { kind: "offline" } })
    expect(locationIngestion({ ...location, availability: "available" }, undefined, 0)).toMatchObject({ state: { kind: "never-scanned" } })
  })

  it.each(LOCALES)("shows each section that waits on the Home criteria as unavailable, in %s", async (locale) => {
    act(() => setLocale(locale))
    mockIPC((command) => {
      if (command === "library_list_locations") return []
      if (command === "library_new_captures") return { locations: [] }
      if (command === "library_list_operations") return []
      if (command === "library_issues") return { issues: [], dismissed: [], counts: { danger: 0, warning: 0, info: 0 }, pages: [] }
      return null
    })
    renderAt("/")
    expect(await screen.findByText(m.home_unavailable({ what: m.home_pending_work() }))).toBeInTheDocument()
    expect(screen.getByText(m.home_unavailable({ what: m.home_open_work() }))).toBeInTheDocument()
    expect(screen.getByText(m.home_unavailable({ what: m.home_calendar() }))).toBeInTheDocument()
    expect(await screen.findByText(m.home_add_captures_location())).toBeInTheDocument()
  })
})
