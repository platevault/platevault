import type { Meta, StoryObj } from "@storybook/react-vite"
import { WorkspaceCatalogue } from "./workspace"

const meta = { component: WorkspaceCatalogue } satisfies Meta<typeof WorkspaceCatalogue>

export default meta

export const Entry: StoryObj<typeof meta> = {}
