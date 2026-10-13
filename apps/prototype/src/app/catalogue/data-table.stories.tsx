import type { Meta, StoryObj } from "@storybook/react-vite"
import { DataTableCatalogue } from "./data-table"

const meta = { component: DataTableCatalogue } satisfies Meta<typeof DataTableCatalogue>

export default meta

export const Entry: StoryObj<typeof meta> = {}
