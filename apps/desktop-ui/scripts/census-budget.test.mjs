import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { checkBudget } from "./census.mjs"
describe("census route budgets", () => {
  it("fails when a census measurement violates the per-route policy", () => {
    const rules = { raw: 0, pill: 0, handRolled: 0, overflowX: 0, tipMaximum: 1, tipApprovals: [], combosMaximum: 4, sortEqualsHeaders: true, pageErrors: 0 }
    const result = { route: "/", raw: 0, pill: 0, handRolled: 0, overflowX: 0, ttl: 1, ttlTruncation: 1, tip: 0, combos: 4, sort: 2, headers: 2, pageErrors: [] }
    assert.deepEqual(checkBudget(result, rules), [])

    result.combos = 5
    assert.deepEqual(checkBudget(result, rules), ["combos=5 exceeds 4"])
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

  it("finds directive-like comments after JSX text, template expressions and regex literals", async () => {
    const { invalidDisableDirectives } = await import("./check-eslint-directives.mjs")
    const source = [
      `export const A = () => <div>It's a name. {/* eslint-disable */}</div>`,
      "const t = `value ${1}°`; /* eslint no-restricted-syntax: off */",
      "const r = /['\"]/; /* eslint-no-undef: off */",
    ].join("\n")
    assert.deepEqual(invalidDisableDirectives("page.tsx", source), [
      "page.tsx:1: eslint-disable requires named rule(s) and a reason of at least 3 words",
      "page.tsx:2: unsupported inline eslint configuration",
      "page.tsx:3: unsupported inline eslint configuration",
    ])
  })

  it("rejects short disables between JSX attributes", async () => {
    const { invalidDisableDirectives } = await import("./check-eslint-directives.mjs")
    const source = ["const C = () => <Select", "  // eslint-disable-next-line no-alert -- short", "  value={value}", "/>"].join("\n")
    assert.equal(invalidDisableDirectives("page.tsx", source).length, 1)
  })
})
