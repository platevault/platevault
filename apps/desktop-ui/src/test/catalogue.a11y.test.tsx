/**
 * axe-core over every catalogue entry (CATALOGUE in app/catalogue/registry.ts),
 * rendered as the design-system page renders it, with the rules in ./axe.ts.
 * An entry is judged once its lazy parts have loaded: a Suspense fallback
 * carries `data-pending`, and the run waits until none is left.
 */
import "./jsdom-render"
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, waitFor } from "@testing-library/react"
import { type ComponentType, lazy, Suspense } from "react"
import { describe, expect, it } from "vitest"
import { CATALOGUE } from "@/app/catalogue/registry"
import { Spinner } from "@/components/ui/spinner"
import { axeViolations } from "./axe"

/** Renders an entry inside a router (entries hold route links) and runs axe over what it rendered, once it has loaded. */
async function axeEntry(Entry: ComponentType) {
  const router = createRouter({ routeTree: createRootRoute({ component: () => <Entry /> }), history: createMemoryHistory({ initialEntries: ["/"] }) })
  const { container } = render(<RouterProvider router={router} />)
  // Fails rather than passing vacuously when the entry renders nothing.
  await waitFor(() => expect(container.querySelector("section, h2, h3")).not.toBeNull())
  // A loading stand-in is not the specimen: judge what replaces it.
  await waitFor(() => expect(container.querySelector("[data-pending]")).toBeNull(), { timeout: 10_000 })
  return axeViolations(container)
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

  it("judges a lazy specimen after it loads, not its loading fallback", async () => {
    const Late = lazy(() => new Promise<{ default: ComponentType }>((resolve) => setTimeout(() => resolve({ default: () => <button type="button" /> }), 50)))
    const Entry = () => (
      <section>
        <h2>Late control</h2>
        <Suspense fallback={<Spinner data-pending />}>
          <Late />
        </Suspense>
      </section>
    )
    expect(await axeEntry(Entry)).toEqual([expect.stringMatching(/^button-name /)])
  })

  it.each(CATALOGUE.map(({ id, Entry }) => [id, Entry] as const))("%s has no violations", async (_id, Entry) => {
    expect(await axeEntry(Entry)).toEqual([])
  })
})
