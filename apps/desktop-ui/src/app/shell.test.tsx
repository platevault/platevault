/**
 * The composed shell over the real providers and router (astro-plan-iczs2):
 * boot reads the library's startup state, navigation reaches only registered
 * routes, the keyboard model (spec 063 FR-042), the palette and the More
 * menu sharing one descriptor, counters opening the affected rows (D-W92,
 * D-W144), failures staying visible and the native Quit confirmation.
 */
import { createMemoryHistory, createRootRoute, createRoute, createRouter, type RouterHistory } from "@tanstack/react-router"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import type { Issue, IssueView, LocationState, NativeQuitRequest } from "@/api/ipc"
import { NATIVE_QUIT_CONFIRM_EVENT } from "@/api/ipc"
import { createQueryClient } from "@/api/query"
import { m } from "@/lib/i18n"
import { createAppRouter } from "@/routes"
import { setSingleKeyShortcuts } from "./preferences"
import { AppRoot } from "./root"
import { AppShell, NotFoundPage, RootLayout, RouteErrorPage, ShellErrorPage } from "./shell"
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
  }
}

/** The shell with test pages at `paths`, each titled by its path, plus one that fails to render. */
function shellRouter(paths: string[], history: RouterHistory) {
  const root = createRootRoute({ component: RootLayout, errorComponent: ShellErrorPage, notFoundComponent: NotFoundPage })
  const app = createRoute({ getParentRoute: () => root, id: "app", component: AppShell, errorComponent: ShellErrorPage })
  const pages = paths.map((path) => createRoute({ getParentRoute: () => app, path, component: () => <h1>{`page ${path}`}</h1> }))
  const broken = createRoute({
    getParentRoute: () => app,
    path: "/broken",
    component: () => {
      throw new Error("render failed")
    },
  })
  return createRouter({ routeTree: root.addChildren([app.addChildren([...pages, broken])]), history, defaultErrorComponent: RouteErrorPage })
}

function renderShell(paths: string[], at: string) {
  const history = createMemoryHistory({ initialEntries: [at] })
  const router = shellRouter(paths, history)
  render(<AppRoot router={router as never} client={createQueryClient()} />)
  return { history }
}

afterEach(() => {
  // Unmount while the IPC mock still answers the listeners' detach.
  cleanup()
  clearMocks()
  closePanel()
  setSingleKeyShortcuts(true)
})

describe("boot", () => {
  it("loads the app router, reads the startup state and fills the window", async () => {
    const host = libraryHost()
    const history = createMemoryHistory({ initialEntries: ["/design-system"] })
    render(<AppRoot router={createAppRouter(history)} client={createQueryClient()} />)

    expect(await screen.findByRole("heading", { level: 1, name: m.nav_design_system() })).toBeInTheDocument()
    const status = windowStatusBar()
    expect(await within(status).findByText(`${m.common_locations()}: ${m.status_bar_locations_online({ online: 1, total: 2 })}`)).toBeInTheDocument()
    expect(within(status).getByRole("button", { name: m.status_bar_errors({ count: 1 }) })).toBeInTheDocument()
    expect(within(status).getByRole("button", { name: m.status_bar_warnings({ count: 2 }) })).toBeInTheDocument()
    await waitFor(() => expect(host.calls).toEqual(expect.arrayContaining(["library_issues", "library_list_locations", "library_native_menu_set_labels"])))
  })

  it("says an unregistered page does not exist, inside the window, and offers the palette while Home is not built", async () => {
    const user = userEvent.setup()
    libraryHost()
    render(<AppRoot router={createAppRouter(createMemoryHistory({ initialEntries: ["/"] }))} client={createQueryClient()} />)
    expect(await screen.findByRole("heading", { level: 1, name: m.shell_not_found_title() })).toBeInTheDocument()
    expect(screen.getByRole("contentinfo", { name: m.status_bar() })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: m.shell_not_found_search_action() }))
    const palette = await screen.findByRole("dialog", { name: m.palette_title() })
    expect(within(palette).getByRole("option", { name: m.nav_design_system() })).toBeInTheDocument()
  })

  it("keeps a failed library read visible in the status bar", async () => {
    libraryHost({
      library_issues: () => {
        throw { code: "persistence_failure", retry: "retry", successors: [] }
      },
    })
    renderShell(["/"], "/")
    const status = await screen.findByRole("contentinfo", { name: m.status_bar() })
    expect(await within(status).findByRole("img", { name: m.status_bar_issues_failed() })).toBeInTheDocument()
  })

  it("shows a page that fails to render inside the window, with Retry", async () => {
    libraryHost()
    renderShell(["/"], "/broken")
    expect(await screen.findByRole("heading", { level: 1, name: m.shell_error_title() })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: m.verb_retry() })).toBeInTheDocument()
    expect(screen.getByRole("contentinfo", { name: m.status_bar() })).toBeInTheDocument()
  })

  it("asks before a native Quit that would interrupt work, and keeps a failed answer visible", async () => {
    const user = userEvent.setup()
    const host = libraryHost({
      library_native_quit_answer: () => {
        throw { code: "persistence_failure", retry: "retry", successors: [] }
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

describe("navigation", () => {
  it("lists only registered pages in the source list, the palette and Help", async () => {
    const user = userEvent.setup()
    libraryHost()
    renderShell(["/", "/sessions"], "/")
    await screen.findByRole("heading", { level: 1, name: "page /" })
    const nav = screen.getByRole("navigation", { name: m.shell_nav_main() })
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([m.nav_home(), expect.stringContaining(m.nav_sessions())])
    expect(screen.queryByRole("navigation", { name: m.shell_nav_utilities() })).toBeNull()

    await user.keyboard("{Control>}k{/Control}")
    const palette = await screen.findByRole("dialog", { name: m.palette_title() })
    const options = within(palette).getAllByRole("option").map((option) => option.textContent)
    expect(options).toEqual(expect.arrayContaining([m.nav_home(), m.nav_sessions()]))
    expect(options).not.toContain(m.nav_projects())
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog", { name: m.palette_title() })).toBeNull())

    await user.keyboard("?")
    const help = await screen.findByRole("dialog", { name: m.shortcuts_title() })
    expect(within(help).getByText(m.shortcuts_go_to({ name: m.nav_sessions() }))).toBeInTheDocument()
    expect(within(help).queryByText(m.shortcuts_go_to({ name: m.nav_projects() }))).toBeNull()
  })

  it("opens a page by its G key only while single-key shortcuts are on and focus is outside a field", async () => {
    const user = userEvent.setup()
    libraryHost()
    const { history } = renderShell(["/", "/sessions", "/projects"], "/")
    await screen.findByRole("heading", { level: 1, name: "page /" })

    setSingleKeyShortcuts(false)
    await user.keyboard("gp")
    expect(history.location.pathname).toBe("/")
    await user.keyboard("{Control>}k{/Control}")
    const palette = await screen.findByRole("dialog", { name: m.palette_title() })
    await user.keyboard("gs")
    expect(history.location.pathname).toBe("/")
    expect(within(palette).getByRole("combobox")).toHaveValue("gs")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog", { name: m.palette_title() })).toBeNull())

    setSingleKeyShortcuts(true)
    await user.keyboard("gp")
    await waitFor(() => expect(history.location.pathname).toBe("/projects"))
    expect(await screen.findByRole("heading", { level: 1, name: "page /projects" })).toBeInTheDocument()
  })

  it("runs the highlighted palette result on Enter and toggles the sidebar with [", async () => {
    const user = userEvent.setup()
    libraryHost()
    const { history } = renderShell(["/", "/sessions"], "/")
    await screen.findByRole("heading", { level: 1, name: "page /" })
    const rail = () => document.querySelector("aside")?.getAttribute("data-sidebar")
    expect(rail()).toBe("full")
    await user.keyboard("[[")
    expect(rail()).toBe("rail")
    await user.keyboard("[[")
    expect(rail()).toBe("full")

    await user.keyboard("{Control>}k{/Control}")
    await screen.findByRole("dialog", { name: m.palette_title() })
    await user.keyboard(m.nav_sessions())
    await user.keyboard("{Enter}")
    await waitFor(() => expect(history.location.pathname).toBe("/sessions"))
  })
})

describe("app Actions", () => {
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

    await user.keyboard("{Control>}k{/Control}")
    const palette = await screen.findByRole("dialog", { name: m.palette_title() })
    await user.click(within(palette).getByRole("option", { name: m.shortcuts_show() }))
    expect(await screen.findByRole("dialog", { name: m.shortcuts_title() })).toBeInTheDocument()
  })
})

describe("issue counters", () => {
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

  it("leave out an owning page that is not registered", async () => {
    const user = userEvent.setup()
    libraryHost()
    renderShell(["/"], "/")
    await screen.findByRole("heading", { level: 1, name: "page /" })
    await user.click(await screen.findByRole("button", { name: m.status_bar_errors({ count: 1 }) }))
    const menu = await screen.findByRole("menu")
    expect(within(menu).queryAllByRole("menuitem")).toEqual([])
  })

  it("badge the source list's Sessions and Projects rows", async () => {
    libraryHost()
    renderShell(["/", "/sessions", "/projects"], "/")
    const nav = await screen.findByRole("navigation", { name: m.shell_nav_main() })
    await waitFor(() => expect(within(nav).getByText(m.shell_nav_sessions_badge({ count: 3 }))).toBeInTheDocument())
    expect(within(nav).getByText(m.shell_nav_projects_badge({ count: 2 }))).toBeInTheDocument()
  })
})
