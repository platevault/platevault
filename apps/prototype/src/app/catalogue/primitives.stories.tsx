import type { Meta, StoryObj } from "@storybook/react-vite"
import { PrimitivesCatalogue } from "./primitives"

const meta = { component: PrimitivesCatalogue } satisfies Meta<typeof PrimitivesCatalogue>

export default meta

export const Entry: StoryObj<typeof meta> = {}
