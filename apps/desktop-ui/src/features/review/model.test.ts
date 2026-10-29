import { describe, expect, it } from "vitest"
import { admitted, afterHeightKey, currentAfterMark, currentIn, listHeightOf, NO_SELECTION, selectionAfter, stepFrom, type TableHeight } from "./model"

const IDS = ["a", "b", "c", "d"]

describe("table heights (PIX-AC-15)", () => {
  it("goes strip, full, rows on three T presses from rows", () => {
    let state: { view: "table" | "filmstrip" | "grid"; height: TableHeight } = { view: "table", height: "rows" }
    const seen: TableHeight[] = []
    for (let i = 0; i < 3; i++) {
      state = afterHeightKey(state.view, state.height)
      seen.push(state.height)
    }
    expect(seen).toEqual(["strip", "full", "rows"])
  })

  it("goes back to the table from the filmstrip or the grid, at the height it had", () => {
    expect(afterHeightKey("grid", "full")).toEqual({ view: "table", height: "full" })
    expect(afterHeightKey("filmstrip", "rows")).toEqual({ view: "table", height: "rows" })
  })

  it("fills the grid and keeps the filmstrip to one line", () => {
    expect(listHeightOf("grid", "rows")).toBe("full")
    expect(listHeightOf("filmstrip", "full")).toBe("strip")
    expect(listHeightOf("table", "rows")).toBe("rows")
  })
})

describe("current frame", () => {
  it("falls back to the first frame shown when the filter hides the stored one", () => {
    expect(currentIn(IDS, "c")).toBe("c")
    expect(currentIn(["a", "b"], "c")).toBe("a")
    expect(currentIn([], "c")).toBeNull()
  })

  it("steps and holds at both ends", () => {
    expect(stepFrom(IDS, "b", 1)).toBe("c")
    expect(stepFrom(IDS, "d", 1)).toBeNull()
    expect(stepFrom(IDS, "a", -1)).toBeNull()
    expect(stepFrom(IDS, "a", 7)).toBe("d")
  })

  it("filters by the frame's label", () => {
    const frames = [
      { id: "a", label: "picked" as const },
      { id: "b", label: "rejected" as const },
      { id: "c", label: "unreviewed" as const },
    ]
    expect(admitted(frames, "rejected").map((f) => f.id)).toEqual(["b"])
    expect(admitted(frames, "all")).toHaveLength(3)
  })
})

describe("selection", () => {
  it("starts a ⌘-click from the current frame and toggles Space on it", () => {
    expect([...selectionAfter(NO_SELECTION, IDS, "a", "c", "toggle").ids]).toEqual(["a", "c"])
    expect([...selectionAfter(NO_SELECTION, IDS, "a", "a", "toggle").ids]).toEqual(["a"])
  })

  it("selects the range from the current frame, as picked by hand", () => {
    const range = selectionAfter(NO_SELECTION, IDS, "d", "b", "range")
    expect([...range.ids]).toEqual(["b", "c", "d"])
    expect(range.origin).toBe("hand")
  })

  it("clears on a plain click", () => {
    expect(selectionAfter({ ids: new Set(["a"]), origin: "all" }, IDS, "a", "b", "set")).toBe(NO_SELECTION)
  })
})

describe("advance after a mark (D-W53, PIX-AC-12)", () => {
  const base = { ordered: IDS, current: "b", marked: ["b"], quality: "unusable" as const, filter: "all" as const, autoAdvance: true, always: false }

  it("goes to the next frame in list order with auto-advance", () => {
    expect(currentAfterMark(base)).toBe("c")
  })

  it("stays with auto-advance off, and still advances on Shift", () => {
    expect(currentAfterMark({ ...base, autoAdvance: false })).toBeNull()
    expect(currentAfterMark({ ...base, autoAdvance: false, always: true })).toBe("c")
  })

  it("moves off a frame the mark takes out of the filtered list, back one at the end", () => {
    expect(currentAfterMark({ ...base, autoAdvance: false, filter: "unreviewed" })).toBe("c")
    expect(currentAfterMark({ ...base, current: "d", marked: ["d"], filter: "unreviewed" })).toBe("c")
  })

  it("keeps the current frame on a selection mark unless the filter now hides it", () => {
    expect(currentAfterMark({ ...base, marked: ["b", "c"] })).toBeNull()
    expect(currentAfterMark({ ...base, marked: ["b", "c"], filter: "unreviewed" })).toBe("d")
  })
})
