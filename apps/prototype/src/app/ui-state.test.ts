import { describe, expect, it } from "vitest"
import { RECENT_LIMIT, rememberRecent } from "./ui-state"

// The store is module-level; read it through the hook's snapshot source.
async function recent() {
  const { useShellUi } = await import("./ui-state")
  let value: ReturnType<typeof useShellUi> | undefined
  const { renderHook } = await import("@testing-library/react")
  renderHook(() => {
    value = useShellUi()
  })
  return value!.recent
}

describe("Recent menus", () => {
  it("cap at their length and move a revisited record to the top", async () => {
    for (let i = 0; i < RECENT_LIMIT + 2; i++) rememberRecent("sessions", `s${i}`)
    let sessions = (await recent()).sessions
    expect(sessions).toHaveLength(RECENT_LIMIT)
    expect(sessions[0]).toBe(`s${RECENT_LIMIT + 1}`)
    rememberRecent("sessions", "s3")
    sessions = (await recent()).sessions
    expect(sessions[0]).toBe("s3")
    expect(sessions.filter((id) => id === "s3")).toHaveLength(1)
    expect(sessions).toHaveLength(RECENT_LIMIT)
  })

  it("keeps the existing key for recent Projects", () => {
    rememberRecent("projects", "prj_a")
    expect(JSON.parse(localStorage.getItem("platevault.recentProjects") ?? "[]")[0]).toBe("prj_a")
  })
})
