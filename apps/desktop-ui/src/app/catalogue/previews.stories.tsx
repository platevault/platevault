import type { Meta, StoryObj } from "@storybook/react-vite"
import { PreviewsCatalogue } from "./previews"

const meta = { component: PreviewsCatalogue } satisfies Meta<typeof PreviewsCatalogue>

export default meta

export const Entry: StoryObj<typeof meta> = {}
