/**
 * The composed shell over the real providers and router (astro-plan-iczs2):
 * boot reads the library's startup state, navigation reaches only registered
 * routes, the keyboard model (spec 063 FR-042), the palette and the More
 * menu sharing one descriptor, counters opening the affected rows (D-W92,
 * D-W144), failures staying visible with Retry, the status live region and
 * the native Quit confirmation.
 */
import { type AnyRoute, createMemoryHistory, createRoute } from "@tanstack/react-router"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import type { Issue, IssueView, LocationState, NativeQuitRequest, ScanOperation, ScanProgressEvent } from "@/api/ipc"
import { NATIVE_QUIT_CONFIRM_EVENT, SCAN_PROGRESS_EVENT } from "@/api/ipc"
import { createQueryClient } from "@/api/query"
import { m } from "@/lib/i18n"
import { createAppRouter, createShellRouter } from "@/routes"
import { setSingleKeyShortcuts } from "./preferences"
import { AppRoot } from "./root"
import { closePanel } from "./ui-state"

// DataTable (the keyboard help) measures its room and keeps rows in view; jsdom has neither.
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

const PROJECT = "7a1e8f52-9c1d-4c5e-8a43-2f0d1c9b6e11"

function issue(fields: Partial<Issue> & Pick<Issue, "id" | "kind" | "severity" | "page" | "owner">): Issue {
  return { fingerprint: fields.id, count: 1, bytes: null, name: null, dismissable: true, ...fields }
}

const ISSUES: IssueView = {
  issues: [
    issue({ id: "needs-target", kind: "needs-target", severity: "warning", count: 3, page: { kind: "sessions" }, owner: { kind: "library" } }),
    issue({ id: "previous", kind: "previous-review", severity: "warning", count: 2, name: "Cygnus HOO", page: { kind: "project", id: PROJECT }, owner: { kind: "project", id: PROJECT } }),
    issue({ id: "offline", kind: "location-offline", severity: "danger", name: "Astro-T7", page: { kind: "locations" }, owner: { kind: "location", id: "loc-2" } }),
  ],
  dismissed: [],
  counts: { danger: 1, warning: 2, info: 0 },
  pages: [
    { severity: "warning", page: { kind: "sessions" }, count: 3 },
    { severity: "warning", page: { kind: "project", id: PROJECT }, count: 2 },
    { severity: "danger", page: { kind: "locations" }, count: 1 },
  ],
}

function location(id: string, availability: "available" | "offline"): LocationState {
  return {
    location: {
      id,
      name: id,
      path: { display: `/Volumes/${id}`, encoded: id } as never,
      role: "captures",
      identity: {} as never,
      decisionRevision: 1,
      availability,
      lastObservedAt: null,
      lifecycle: "active",
      volumeKind: "local" as never,
    },
    failure: null,
  }
}

interface TauriInternals {
  __TAURI_INTERNALS__: { runCallback: (id: number, message: unknown) => void }
}

/** The window's own status bar; the design-system page shows specimens of it too. */
function windowStatusBar(): HTMLElement {
  const bar = screen.getAllByRole("contentinfo", { name: m.status_bar() }).find((footer) => !footer.closest("main"))
  if (!bar) throw new Error("no window status bar")
  return bar
}

/** The library host as the webview sees it: its commands, the event plugin, and `emit` to attached listeners. */
function libraryHost(answers: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  const listeners = new Map<number, string>()
  const calls: string[] = []
  mockIPC((command, args) => {
    const fields = (args ?? {}) as Record<string, unknown>
    if (command === "plugin:event|listen") {
      listeners.set(fields.handler as number, fields.event as string)
      return fields.handler
    }
    if (command === "plugin:event|unlisten") return null
    calls.push(command)
    const answer = answers[command]
    if (answer) return answer(fields)
    if (command === "library_issues") return ISSUES
    if (command === "library_list_locations") return [location("Astro-T7", "offline"), location("Captures", "available")]
    if (command === "library_list_operations") return []
    return null
  })
  const internals = (window as unknown as TauriInternals).__TAURI_INTERNALS__
  return {
    calls,
    emit(event: string, payload: unknown) {
      for (const [id, name] of [...listeners]) if (name === event) internals.runCallback(id, { event, id, payload })
    },
    /** How many listeners are attached to `event`. */
    listening(event: string): number {
      return [...listeners.values()].filter((name) => name === event).length
    },
  }
}

/** How long counts must hold still to count as settled. */
const QUIET_MS = 300

/** Wait until `read` returns the same counts across one quiet window, so no read is still on its way. */
async function quiet(read: () => unknown): Promise<void> {
  for (;;) {
    const before = JSON.stringify(read())
    await act(() => new Promise((resolve) => setTimeout(resolve, QUIET_MS)))
    if (JSON.stringify(read()) === before) return
  }
}

/** A test page titled by its path, with a text field, a page search, and a plain button to open the palette from. */
function testPage(path: string) {
  return () => (
    <>
      <h1>{`page ${path}`}</h1>
      <input aria-label="Notes" />
      <input aria-label="Filter" data-page-search="" />
      <button type="button">Opener</button>
    </>
  )
}

/** The shell's own router over test pages at `paths`, plus one that fails to render. */
function renderShell(paths: string[], at: string) {
  const history = createMemoryHistory({ initialEntries: [at] })
  const pages = (appWindow: AnyRoute): AnyRoute[] => [
    ...paths.map((path) => createRoute({ getParentRoute: () => appWindow, path, component: testPage(path) })),
    createRoute({
      getParentRoute: () => appWindow,
      path: "/broken",
      component: () => {
        throw new Error("render failed")
      },
    }),
  ]
  render(<AppRoot router={createShellRouter(history, pages)} client={createQueryClient()} />)
  return { history }
}

function announcer(): HTMLElement {
  const region = windowStatusBar().querySelector<HTMLElement>("[data-status-announcer]")
  if (!region) throw new Error("no status live region")
  return region
}

function scan(id: string, locationId: string, state: ScanOperation["state"]): ScanOperation {
  const progress = { discovered: 1, metadataRead: 0, unsupported: 0, unreadable: 0, completeDirectories: 0 }
  return { id, locationId, state, progress, issues: [], completeScopes: [], incompleteScopes: [], startedAt: "2026-10-29T08:00:00Z", finishedAt: null }
}

function scanEvent(operationId: string, locationId: string, state: ScanProgressEvent["state"]): ScanProgressEvent {
  const progress = { discovered: 1, metadataRead: 0, unsupported: 0, unreadable: 0, completeDirectories: 0 }
  return { operationId, revision: 2, locationId, state, progress, completeScopes: [], incompleteScopes: [] }
}

/** Each test drives the whole window; a loaded machine renders it slowly. */
const SHELL_TEST_MS = 20_000

const PERSISTENCE_FAILURE = { code: "persistence_failure", retry: "retry", successors: [] }

async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Control>}k{/Control}")
  return screen.findByRole("dialog", { name: m.palette_title() })
}

async function closePalette(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Escape}")
  await waitFor(() => expect(screen.queryByRole("dialog", { name: m.palette_title() })).toBeNull())
}

afterEach(() => {
  // Unmount while the IPC mock still answers the listeners' detach.
  cleanup()
  clearMocks()
  closePanel()
  setSingleKeyShortcuts(true)
})

describe("boot", { timeout: SHELL_TEST_MS }, () => {
  it("loads the app router, reads the startup state and fills the window", async () => {
    const host = libraryHost()
    const history = createMemoryHistory({ initialEntries: ["/design-system"] })
    render(<AppRoot router={createAppRouter(history)} client={createQueryClient()} />)

    expect(await screen.findByRole("heading", { level: 1, name: m.nav_design_system() })).toBeInTheDocument()
    const status = windowStatusBar()
    expect(await within(status).findByText(`${m.common_locations()}: ${m.status_bar_locations_online({ online: 1, total: 2 })}`)).toBeInTheDocument()
    expect(within(status).getByRole("img", { name: m.status_bar_errors({ count: 1 }) })).toBeInTheDocument()
    // Sessions is registered, so the warnings counter links to it.
    expect(within(status).getByRole("button", { name: m.status_bar_warnings({ count: 2 }) })).toBeInTheDocument()
    await waitFor(() => expect(host.calls).toEqual(expect.arrayContaining(["library_issues", "library_list_locations", "library_native_menu_set_labels"])))
    // What the window shows at start is not news.
    expect(announcer()).toHaveTextContent("")
    // Running work opens Activity, which is not built: the bar does not read it.
    expect(host.calls).not.toContain("library_list_operations")
  })

  it("reads each status query once per refresh", async () => {
    const host = libraryHost()
    renderShell(["/", "/sessions", "/projects"], "/")
    await screen.findByRole("heading", { level: 1, name: "page /" })
    await waitFor(() => expect(within(windowStatusBar()).getByRole("button", { name: m.status_bar_warnings({ count: 2 }) })).toBeInTheDocument())
    const reads = () => ({ issues: host.calls.filter((call) => call === "library_issues").length, locations: host.calls.filter((call) => call === "library_list_locations").length })
    // Every refresher's listener is attached and its first read is done: the counts stop changing.
    await waitFor(() => expect(host.listening(SCAN_PROGRESS_EVENT)).toBeGreaterThan(0))
    await quiet(reads)
    const before = reads()
    act(() => host.emit(SCAN_PROGRESS_EVENT, scanEvent("scan-1", "Captures", "completed")))
    await waitFor(() => expect(reads().issues).toBeGreaterThan(before.issues))
    await quiet(reads)
    expect(reads()).toEqual({ issues: before.issues + 1, locations: before.locations + 1 })
  })

  it("shows an unregistered page inside the one window, which stays mounted when the user moves on", async () => {
    const user = userEvent.setup()
    libraryHost()
    // The palette path: Home is not among these pages, so not-found offers the palette (with Home it offers Home).
    const router = createShellRouter(createMemoryHistory({ initialEntries: ["/"] }), (appWindow) => [createRoute({ getParentRoute: () => appWindow, path: "/design-system", component: testPage("/design-system") })])
    render(<AppRoot router={router} client={createQueryClient()} />)
    expect(await screen.findByRole("heading", { level: 1, name: m.shell_not_found_title() })).toBeInTheDocument()
    const bar = windowStatusBar()
    const search = screen.getByRole("button", { name: m.shell_not_found_search_action() })
    await user.click(search)
    await screen.findByRole("dialog", { name: m.palette_title() })
    // Escape closes without navigating and gives focus back to its opener.
    await closePalette(user)
    await waitFor(() => expect(search).toHaveFocus())
    expect(screen.getByRole("heading", { level: 1, name: m.shell_not_found_title() })).toBeInTheDocument()

    await user.click(search)
    const again = await screen.findByRole("dialog", { name: m.palette_title() })
    await user.click(within(again).getByRole("option", { name: m.nav_design_system() }))
    expect(await screen.findByRole("heading", { level: 1, name: "page /design-system" })).toBeInTheDocument()
    expect(windowStatusBar()).toBe(bar)
  })

  it("offers Go home on not-found once Home is registered, and opens it", async () => {
    const user = userEvent.setup()
    libraryHost()
    render(<AppRoot router={createAppRouter(createMemoryHistory({ initialEntries: ["/no-such-page"] }))} client={createQueryClient()} />)
    expect(await screen.findByRole("heading", { level: 1, name: m.shell_not_found_title() })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: m.shell_not_found_search_action() })).toBeNull()
    await user.click(screen.getByRole("button", { name: m.shell_not_found_home() }))
    expect(await screen.findByRole("heading", { level: 1, name: m.nav_home() })).toBeInTheDocument()
  })

  it("keeps a failed library read visible with Retry, and announces it", async () => {
    const user = userEvent.setup()
    let fail = true
    libraryHost({
      library_issues: () => {
        if (fail) throw PERSISTENCE_FAILURE
        return ISSUES
      },
    })
    renderShell(["/"], "/")
    await screen.findByRole("heading", { level: 1, name: "page /" })
    const status = windowStatusBar()
    expect(await within(status).findByRole("group", { name: m.status_bar_issues_failed() })).toHaveTextContent(m.status_bar_issues_failed())
    await waitFor(() => expect(announcer()).toHaveTextContent(m.status_bar_issues_failed()))
    fail = false
    await user.click(within(status).getByRole("button", { name: `${m.verb_retry()}: ${m.status_bar_issues_failed()}` }))
    expect(await within(status).findByRole("img", { name: m.status_bar_errors({ count: 1 }) })).toBeInTheDocument()
    await waitFor(() => expect(announcer()).toHaveTextContent(`${m.status_bar_errors({ count: 1 })} and ${m.status_bar_warnings({ count: 2 })}`))
  })

  it("announces a scan that finished, once Activity is registered", async () => {
    let running = true
    const host = libraryHost({ library_list_operations: () => (running ? [scan("scan-1", "Captures", "running")] : [scan("scan-1", "Captures", "completed")]) })
    renderShell(["/", "/activity"], "/")
    await screen.findByRole("heading", { level: 1, name: "page /" })
    await waitFor(() => expect(host.calls).toContain("library_list_operations"))
    await waitFor(() => expect(within(windowStatusBar()).getByRole("img", { name: m.status_bar_errors({ count: 1 }) })).toBeInTheDocument())
    running = false
    act(() => host.emit(SCAN_PROGRESS_EVENT, scanEvent("scan-1", "Captures", "completed")))
    await waitFor(() => expect(announcer()).toHaveTextContent(m.status_bar_scan_finished({ name: "Captures" })))
  })

  it("shows a page that fails to render inside the window, with Retry", async () => {
    libraryHost()
    renderShell(["/"], "/broken")
    expect(await screen.findByRole("heading", { level: 1, name: m.shell_error_title() })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: m.verb_retry() })).toBeInTheDocument()
    expect(windowStatusBar()).toBeInTheDocument()
  })

  it("asks before a native Quit that would interrupt work, and keeps a failed answer visible", async () => {
    const user = userEvent.setup()
    const host = libraryHost({
      library_native_quit_answer: () => {
        throw PERSISTENCE_FAILURE
      },
    })
    renderShell(["/"], "/")
    await screen.findByRole("heading", { level: 1, name: "page /" })
    const request: NativeQuitRequest = { requestId: "quit-7", work: { imports: 1, indexes: 0, applies: [] } }
    await waitFor(() => {
      act(() => host.emit(NATIVE_QUIT_CONFIRM_EVENT, request))
      expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    })
    const dialog = screen.getByRole("alertdialog")
    await user.click(within(dialog).getByRole("button", { name: m.shell_quit_app() }))
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument()
    expect(host.calls).toContain("library_native_quit_answer")
  })
})

describe("navigation", { timeout: SHELL_TEST_MS }, () => {
  it("lists only registered pages in the source list, the palette and Help", async () => {
    const user = userEvent.setup()
    libraryHost()
    renderShell(["/", "/sessions"], "/")
    await screen.findByRole("heading", { level: 1, name: "page /" })
    const nav = screen.getByRole("navigation", { name: m.shell_nav_main() })
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([m.nav_home(), expect.stringContaining(m.nav_sessions())])
    expect(screen.queryByRole("navigation", { name: m.shell_nav_utilities() })).toBeNull()

    const palette = await openPalette(user)
    const options = within(palette).getAllByRole("option").map((option) => option.textContent)
    expect(options).toEqual(expect.arrayContaining([m.nav_home(), m.nav_sessions()]))
    expect(options).not.toContain(m.nav_projects())
    await closePalette(user)

    await user.keyboard("?")
    const help = await screen.findByRole("dialog", { name: m.shortcuts_title() })
    expect(within(help).getByText(m.shortcuts_go_to({ name: m.nav_sessions() }))).toBeInTheDocument()
    expect(within(help).queryByText(m.shortcuts_go_to({ name: m.nav_projects() }))).toBeNull()
  })

  it("opens a page by its G key with single-key shortcuts on, never while typing in a field", async () => {
    const user = userEvent.setup()
    libraryHost()
    const { history } = renderShell(["/", "/projects"], "/")
    await screen.findByRole("heading", { level: 1, name: "page /" })

    await user.click(screen.getByRole("textbox", { name: "Notes" }))
    await user.keyboard("gp?")
    expect(history.location.pathname).toBe("/")
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue("gp?")
    expect(screen.queryByRole("dialog", { name: m.shortcuts_title() })).toBeNull()

    await user.click(screen.getByRole("button", { name: "Opener" }))
    await user.keyboard("gp")
    await waitFor(() => expect(history.location.pathname).toBe("/projects"))
    expect(await screen.findByRole("heading", { level: 1, name: "page /projects" })).toBeInTheDocument()
  })

  it("fires no single-key shortcut while the setting is off", async () => {
    const user = userEvent.setup()
    libraryHost()
    const { history } = renderShell(["/", "/projects"], "/")
    await screen.findByRole("heading", { level: 1, name: "page /" })
    const rail = () => document.querySelector("aside")?.getAttribute("data-sidebar")
    setSingleKeyShortcuts(false)
    await user.click(screen.getByRole("button", { name: "Opener" }))
    await user.keyboard("gp")
    await user.keyboard("?")
    await user.keyboard("[[")
    await user.keyboard("/")
    expect(history.location.pathname).toBe("/")
    expect(screen.queryByRole("dialog", { name: m.shortcuts_title() })).toBeNull()
    expect(rail()).toBe("full")
    expect(screen.getByRole("textbox", { name: "Filter" })).not.toHaveFocus()
    // ⌘K / Ctrl+K stays on.
    expect(await openPalette(user)).toBeInTheDocument()
  })

  it("fires no single-key shortcut while a dialog is open", async () => {
    const user = userEvent.setup()
    libraryHost()
    const { history } = renderShell(["/", "/projects"], "/")
    await screen.findByRole("heading", { level: 1, name: "page /" })
    const rail = () => document.querySelector("aside")?.getAttribute("data-sidebar")
    await user.click(screen.getByRole("button", { name: "Opener" }))
    await user.keyboard("?")
    const help = await screen.findByRole("dialog", { name: m.shortcuts_title() })
    // Focus is inside the dialog, on no text field.
    await waitFor(() => expect(help.contains(document.activeElement)).toBe(true))
    await user.keyboard("gp")
    await user.keyboard("[[")
    expect(history.location.pathname).toBe("/")
    expect(rail()).toBe("full")
  })

  it("opens the palette with Ctrl+K from a text field, and Escape gives focus back to the opener", async () => {
    const user = userEvent.setup()
    libraryHost()
    const { history } = renderShell(["/", "/sessions"], "/")
    await screen.findByRole("heading", { level: 1, name: "page /" })

    const notes = screen.getByRole("textbox", { name: "Notes" })
    await user.click(notes)
    await openPalette(user)
    await closePalette(user)
    await waitFor(() => expect(notes).toHaveFocus())

    const opener = screen.getByRole("button", { name: "Opener" })
    await user.click(opener)
    await openPalette(user)
    await closePalette(user)
    await waitFor(() => expect(opener).toHaveFocus())
    expect(history.location.pathname).toBe("/")
  })

  it("runs the highlighted palette result on Enter and toggles the sidebar with [", async () => {
    const user = userEvent.setup()
    libraryHost()
    const { history } = renderShell(["/", "/sessions"], "/")
    await screen.findByRole("heading", { level: 1, name: "page /" })
    const rail = () => document.querySelector("aside")?.getAttribute("data-sidebar")
    await user.click(screen.getByRole("button", { name: "Opener" }))
    expect(rail()).toBe("full")
    await user.keyboard("[[")
    expect(rail()).toBe("rail")
    await user.keyboard("[[")
    expect(rail()).toBe("full")

    await openPalette(user)
    await user.keyboard(m.nav_sessions())
    await user.keyboard("{Enter}")
    await waitFor(() => expect(history.location.pathname).toBe("/sessions"))
  })
})

describe("app Actions", { timeout: SHELL_TEST_MS }, () => {
  it("are one descriptor in the More menu and the palette", async () => {
    const user = userEvent.setup()
    libraryHost()
    renderShell(["/"], "/")
    await screen.findByRole("heading", { level: 1, name: "page /" })

    await user.click(screen.getByRole("button", { name: m.common_more() }))
    await user.click(await screen.findByRole("menuitem", { name: new RegExp(m.shortcuts_show()) }))
    expect(await screen.findByRole("dialog", { name: m.shortcuts_title() })).toBeInTheDocument()
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog", { name: m.shortcuts_title() })).toBeNull())

    const palette = await openPalette(user)
    await user.click(within(palette).getByRole("option", { name: m.shortcuts_show() }))
    expect(await screen.findByRole("dialog", { name: m.shortcuts_title() })).toBeInTheDocument()
  })
})

describe("issue counters", { timeout: SHELL_TEST_MS }, () => {
  it("open each registered owning page, filtered to the affected rows", async () => {
    const user = userEvent.setup()
    libraryHost()
    const { history } = renderShell(["/", "/sessions", "/projects/$projectId"], "/")
    await screen.findByRole("heading", { level: 1, name: "page /" })

    await user.click(await screen.findByRole("button", { name: m.status_bar_warnings({ count: 2 }) }))
    const menu = await screen.findByRole("menu")
    const sessions = m.status_bar_issue_page({ page: m.nav_sessions(), count: "3" })
    const project = m.status_bar_issue_page({ page: "Cygnus HOO", count: "2" })
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([sessions, project])
    await user.click(within(menu).getByRole("menuitem", { name: project }))
    await waitFor(() => expect(history.location.pathname).toBe(`/projects/${PROJECT}`))
    expect(history.location.search).toBe("?issues=with-issues")

    await user.click(screen.getByRole("button", { name: m.status_bar_warnings({ count: 2 }) }))
    await user.click(await screen.findByRole("menuitem", { name: sessions }))
    await waitFor(() => expect(history.location.pathname).toBe("/sessions"))
  })

  it("show a count with no menu while none of its owning pages is registered", async () => {
    libraryHost()
    renderShell(["/"], "/")
    await screen.findByRole("heading", { level: 1, name: "page /" })
    const status = windowStatusBar()
    expect(await within(status).findByRole("img", { name: m.status_bar_errors({ count: 1 }) })).toBeInTheDocument()
    expect(within(status).queryByRole("button", { name: m.status_bar_errors({ count: 1 }) })).toBeNull()
  })

  it("badge the source list's Sessions and Projects rows", async () => {
    libraryHost()
    renderShell(["/", "/sessions", "/projects"], "/")
    const nav = await screen.findByRole("navigation", { name: m.shell_nav_main() })
    await waitFor(() => expect(within(nav).getByText(m.shell_nav_sessions_badge({ count: 3 }))).toBeInTheDocument())
    expect(within(nav).getByText(m.shell_nav_projects_badge({ count: 2 }))).toBeInTheDocument()
  })
})
