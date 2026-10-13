import type { Meta, StoryObj } from "@storybook/react-vite"
import { AppFrameCatalogue } from "./app-frame"

const meta = { component: AppFrameCatalogue } satisfies Meta<typeof AppFrameCatalogue>

export default meta

export const Entry: StoryObj<typeof meta> = {}
