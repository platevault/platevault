import type { Meta, StoryObj } from "@storybook/react-vite"
import { WalkCatalogue } from "./walk"

const meta = { component: WalkCatalogue } satisfies Meta<typeof WalkCatalogue>

export default meta

export const Entry: StoryObj<typeof meta> = {}
