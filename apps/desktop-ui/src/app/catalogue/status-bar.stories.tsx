import type { Meta, StoryObj } from "@storybook/react-vite"
import { StatusBarCatalogue } from "./status-bar"

const meta = { component: StatusBarCatalogue } satisfies Meta<typeof StatusBarCatalogue>

export default meta

export const Entry: StoryObj<typeof meta> = {}
