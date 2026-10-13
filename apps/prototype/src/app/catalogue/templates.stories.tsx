import type { Meta, StoryObj } from "@storybook/react-vite"
import { TemplatesCatalogue } from "./templates"

const meta = { component: TemplatesCatalogue } satisfies Meta<typeof TemplatesCatalogue>

export default meta

export const Entry: StoryObj<typeof meta> = {}
