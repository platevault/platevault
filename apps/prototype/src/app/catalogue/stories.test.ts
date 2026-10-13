import type { Meta } from "@storybook/react-vite"
import { describe, expect, it } from "vitest"
import { CATALOGUE } from "./registry"

const stories = import.meta.glob<Meta>("./*.stories.tsx", { eager: true, import: "default" })

describe("catalogue stories", () => {
  // `<id>.stories.tsx` makes the entry id the story's title (.storybook/main.ts).
  it.each(CATALOGUE.map((entry) => [entry.id, entry.Entry] as const))("%s has a story that renders the registered entry", (id, Entry) => {
    expect(stories[`./${id}.stories.tsx`]?.component).toBe(Entry)
  })
})
