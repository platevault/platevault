import { describe, expect, it } from "vitest"
import { type KeyContext, reviewKey } from "./keys"

const ctx = (patch: Partial<KeyContext> = {}): KeyContext => ({ singleKeys: true, target: document.body, zoomedPlate: false, ...patch })
const key = (k: string, init: Partial<Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">> = {}) => ({ key: k, code: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init })

describe("reviewKey (PIX-FR-13)", () => {
  it("names every Review key", () => {
    expect(reviewKey(key("j"), ctx())).toEqual({ id: "step", delta: 1 })
    expect(reviewKey(key("k"), ctx())).toEqual({ id: "step", delta: -1 })
    expect(reviewKey(key("ArrowRight"), ctx())).toEqual({ id: "step", delta: 1 })
    expect(reviewKey(key("ArrowLeft"), ctx())).toEqual({ id: "step", delta: -1 })
    expect(reviewKey(key("ArrowDown"), ctx())).toEqual({ id: "row", delta: 1 })
    expect(reviewKey(key("p"), ctx())).toEqual({ id: "mark", quality: "usable", always: false })
    expect(reviewKey(key("x"), ctx())).toEqual({ id: "mark", quality: "unusable", always: false })
    expect(reviewKey(key("u"), ctx())).toEqual({ id: "mark", quality: "unreviewed", always: false })
    expect(reviewKey(key("P", { shiftKey: true }), ctx())).toEqual({ id: "mark", quality: "usable", always: true })
    expect(reviewKey(key("X", { shiftKey: true }), ctx())).toEqual({ id: "mark", quality: "unusable", always: true })
    for (const [k, id] of [["z", "zoom"], ["f", "fullscreen"], ["c", "compare"], ["g", "grid"], ["t", "height"]] as const) expect(reviewKey(key(k), ctx())).toEqual({ id })
    expect(reviewKey(key(" "), ctx())).toEqual({ id: "toggle-selected" })
    expect(reviewKey(key("Escape"), ctx())).toEqual({ id: "escape" })
  })

  it("takes ⌘ or Ctrl chords for select all, the corner inspector and Finish review", () => {
    expect(reviewKey(key("a", { metaKey: true }), ctx())).toEqual({ id: "select-all" })
    expect(reviewKey(key("a", { ctrlKey: true }), ctx())).toEqual({ id: "select-all" })
    expect(reviewKey(key("i", { metaKey: true }), ctx())).toEqual({ id: "corners" })
    expect(reviewKey(key("Enter", { metaKey: true }), ctx())).toEqual({ id: "finish" })
    expect(reviewKey(key("k", { metaKey: true }), ctx())).toBeNull()
  })

  it("filters with ⌥1 to ⌥4 by key position, whatever character Option types", () => {
    expect(reviewKey(key("¡", { altKey: true, code: "Digit1" }), ctx())).toEqual({ id: "filter", filter: "all" })
    expect(reviewKey(key("™", { altKey: true, code: "Digit2" }), ctx())).toEqual({ id: "filter", filter: "picked" })
    expect(reviewKey(key("£", { altKey: true, code: "Digit3" }), ctx())).toEqual({ id: "filter", filter: "rejected" })
    expect(reviewKey(key("¢", { altKey: true, code: "Digit4" }), ctx())).toEqual({ id: "filter", filter: "unreviewed" })
    expect(reviewKey(key("∞", { altKey: true, code: "Digit5" }), ctx())).toBeNull()
  })

  it("leaves single keys alone while the single-key setting is off (WCAG 2.1.4); chords and arrows stay", () => {
    expect(reviewKey(key("p"), ctx({ singleKeys: false }))).toBeNull()
    expect(reviewKey(key(" "), ctx({ singleKeys: false }))).toBeNull()
    expect(reviewKey(key("ArrowRight"), ctx({ singleKeys: false }))).toEqual({ id: "step", delta: 1 })
    expect(reviewKey(key("a", { metaKey: true }), ctx({ singleKeys: false }))).toEqual({ id: "select-all" })
  })

  it("leaves the arrows to a control that owns them and to a zoomed plate that pans", () => {
    const slider = document.createElement("div")
    slider.setAttribute("role", "slider")
    const plate = document.createElement("div")
    plate.setAttribute("data-plate", "")
    expect(reviewKey(key("ArrowRight"), ctx({ target: slider }))).toBeNull()
    expect(reviewKey(key("ArrowRight"), ctx({ target: plate, zoomedPlate: true }))).toBeNull()
    expect(reviewKey(key("ArrowRight"), ctx({ target: plate }))).toEqual({ id: "step", delta: 1 })
  })

  it("leaves Space to a focused control outside the frame list", () => {
    const button = document.createElement("span")
    document.body.append(button)
    expect(reviewKey(key(" "), ctx({ target: button }))).toBeNull()
    const thumb = document.createElement("span")
    thumb.setAttribute("data-frame-item", "")
    expect(reviewKey(key(" "), ctx({ target: thumb }))).toEqual({ id: "toggle-selected" })
    button.remove()
  })

  it("ignores Shift on the keys Shift does not change", () => {
    expect(reviewKey(key("J", { shiftKey: true }), ctx())).toBeNull()
    expect(reviewKey(key("U", { shiftKey: true }), ctx())).toBeNull()
  })
})
