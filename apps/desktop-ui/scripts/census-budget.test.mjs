import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { checkBudget } from "./census.mjs"
describe("census route budgets", () => {
  it("fails when a count exceeds its route/viewport budget", () => {
    const metrics = { btn: 3, combos: 1, dt: 0, raw: 0, sort: 0, headers: 0, ttl: 0, ttlTruncation: 0, tip: 0, pill: 0, handRolled: 0, menus: 0, overflowX: 0 }
    const result = { ...metrics, pageErrors: [] }
    const budget = { ...metrics, pageErrors: 0 }
    assert.deepEqual(checkBudget(result, budget), [])

    budget.btn = 2
    assert.deepEqual(checkBudget(result, budget), ["btn=3 exceeds 2"])
  })
})

describe("ESLint disable directive policy", () => {
  it("rejects blanket, rule-less and short-reason disables but ignores strings", async () => {
    const { invalidDisableDirectives } = await import("./check-eslint-directives.mjs")
    const source = [
      "/* eslint-disable */",
      "/* eslint-disable no-alert -- bad */",
      "// eslint-disable-next-line no-alert -- this reason has enough words",
      "const text = 'eslint-disable no-alert';",
    ].join("\n")
    assert.deepEqual(invalidDisableDirectives("page.tsx", source), [
      "page.tsx:1: eslint-disable requires named rule(s) and a reason of at least 3 words",
      "page.tsx:2: eslint-disable requires named rule(s) and a reason of at least 3 words",
    ])
  })

  it("reads a directive between JSX attributes after a template literal with a substitution", async () => {
    const { invalidDisableDirectives } = await import("./check-eslint-directives.mjs")
    // A token scanner without parser context reads the closing backtick of `${v}°` as the
    // start of a new template literal and swallows every comment after it.
    const source = [
      "export const A = () => <Slider format={(v) => `${v}°`} />",
      "export const B = () => (",
      "  <Select",
      "    // eslint-disable-next-line pv/no-user-string -- short",
      '    options={[{ value: "ha", label: "Ha" }]}',
      "  />",
      ")",
    ].join("\n")
    assert.deepEqual(invalidDisableDirectives("page.tsx", source), ["page.tsx:4: eslint-disable requires named rule(s) and a reason of at least 3 words"])
  })
})
