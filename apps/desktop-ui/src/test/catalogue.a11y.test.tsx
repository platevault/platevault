/**
 * axe-core over every catalogue entry (CATALOGUE in app/catalogue/registry.ts),
 * rendered as the design-system page renders it: WCAG 2.x A and AA rules.
 *
 * Off here, with the reason: `color-contrast` needs the cascade and layout,
 * which jsdom does not compute from the Tailwind sheet, so it would pass or
 * fail on nothing (contrast is checked in the browser by ui-review). Each
 * entry is a fragment, so page-level best-practice rules (one main landmark,
 * a level-one heading, content inside landmarks) are out of scope.
 */
import "./jsdom-render"
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, waitFor } from "@testing-library/react"
import axe from "axe-core"
import type { ComponentType } from "react"
import { describe, expect, it } from "vitest"
import { CATALOGUE } from "@/app/catalogue/registry"

const OPTIONS: axe.RunOptions = {
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
  rules: { "color-contrast": { enabled: false } },
}

/** One line per failing node: the rule, the node's selector and axe's summary, so a failure names what to fix. */
function violations(results: axe.AxeResults) {
  return results.violations.flatMap((violation) => violation.nodes.map((node) => `${violation.id} ${node.target.join(" ")}: ${node.failureSummary ?? violation.help}`))
}

/** Renders an entry inside a router (entries hold route links) and runs axe over what it rendered. */
async function axeEntry(Entry: ComponentType) {
  const router = createRouter({ routeTree: createRootRoute({ component: () => <Entry /> }), history: createMemoryHistory({ initialEntries: ["/"] }) })
  const { container } = render(<RouterProvider router={router} />)
  // Fails rather than passing vacuously when the entry renders nothing.
  await waitFor(() => expect(container.querySelector("section, h2, h3")).not.toBeNull())
  return violations(await axe.run(container, OPTIONS))
}

describe("catalogue under axe", () => {
  it("reports a specimen that breaks a rule, so a clean result means the rules ran", async () => {
    const Unnamed = () => (
      <section>
        <h2>Unnamed control</h2>
        <button type="button" />
      </section>
    )
    expect(await axeEntry(Unnamed)).toEqual([expect.stringMatching(/^button-name /)])
  })

  it.each(CATALOGUE.map(({ id, Entry }) => [id, Entry] as const))("%s has no violations", async (_id, Entry) => {
    expect(await axeEntry(Entry)).toEqual([])
  })
})
