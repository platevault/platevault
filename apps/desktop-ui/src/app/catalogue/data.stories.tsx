import type { Meta, StoryObj } from "@storybook/react-vite"
import { DataCatalogue } from "./data"

const meta = { component: DataCatalogue } satisfies Meta<typeof DataCatalogue>

export default meta

export const Entry: StoryObj<typeof meta> = {}
