import type { Meta, StoryObj } from "@storybook/react-vite"
import { PaletteCatalogue } from "./palette"

const meta = { component: PaletteCatalogue } satisfies Meta<typeof PaletteCatalogue>

export default meta

export const Entry: StoryObj<typeof meta> = {}
