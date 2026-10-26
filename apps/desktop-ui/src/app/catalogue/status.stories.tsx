import type { Meta, StoryObj } from "@storybook/react-vite"
import { StatusCatalogue } from "./status"

const meta = { component: StatusCatalogue } satisfies Meta<typeof StatusCatalogue>

export default meta

export const Entry: StoryObj<typeof meta> = {}
