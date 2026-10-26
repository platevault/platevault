// check-copy's W2 button checks over Action labels, with failing and passing
// fixtures. Run: pnpm test:lint-rules.
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { actionLabelKeys, copyFindings, SPEC_LONG_BUTTONS } from "../../scripts/check-copy.mjs"

const SOURCE = `
const m = useMessages()
const removeLabel = m.fixture_remove_sessions({ count: 2 })
export const actions: Action[] = [
  { id: "review", label: m.fixture_review_new_frames({ n: "3" }), run: () => follow(link) },
  { id: "pick", label: busy ? m.fixture_pick_busy() : m.fixture_pick(), run },
  { id: "remove", label: removeLabel, kind: "destructive", run: () => remove() },
]
const facet = { id: "filter", label: m.fixture_filter_facet_label(), kind: "single" }
`

describe("check-copy Action labels (W2)", () => {
  it("finds the keys an Action takes as its label, direct, branched or through a const", () => {
    assert.deepEqual([...actionLabelKeys("fixture.tsx", SOURCE)].sort(), ["fixture_pick", "fixture_pick_busy", "fixture_remove_sessions", "fixture_review_new_frames"])
  })
  it("fails an Action label over 3 words whatever its key", () => {
    const catalog = { fixture_review_new_frames: "Review {n} new frames", fixture_pick: "Pick" }
    const findings = copyFindings(catalog, actionLabelKeys("fixture.tsx", SOURCE))
    assert.deepEqual(findings["button-length"], ["fixture_review_new_frames"])
  })
  it("passes a short Action label, and a long label that is no Action's", () => {
    const catalog = { fixture_review_new_frames: "Review frames", fixture_filter_facet_label: "Filter by the camera model" }
    assert.deepEqual(copyFindings(catalog, actionLabelKeys("fixture.tsx", SOURCE))["button-length"], [])
  })
  it("checks an Action label for title case like a button key", () => {
    const findings = copyFindings({ fixture_pick: "Pick Reference Frame" }, actionLabelKeys("fixture.tsx", SOURCE))
    assert.deepEqual(findings["title-case"], ["fixture_pick"])
  })
  it("exempts a spec-mandated label from button-length only, and every entry cites a decision", () => {
    const actions = new Set(["equipment_add_value_to_rig", "fixture_review_new_frames"])
    const findings = copyFindings({ equipment_add_value_to_rig: "Add {value} Filter to {rig}", fixture_review_new_frames: "Review {n} new frames" }, actions)
    assert.deepEqual(findings["button-length"], ["fixture_review_new_frames"])
    assert.deepEqual(findings["title-case"], ["equipment_add_value_to_rig"])
    for (const [key, decision] of Object.entries(SPEC_LONG_BUTTONS)) assert.match(decision, /^D-W\d+$/, key)
  })
})
