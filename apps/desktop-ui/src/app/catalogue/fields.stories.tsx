import type { Meta, StoryObj } from "@storybook/react-vite"
import { FieldsCatalogue } from "./fields"

const meta = { component: FieldsCatalogue } satisfies Meta<typeof FieldsCatalogue>

export default meta

export const Entry: StoryObj<typeof meta> = {}
