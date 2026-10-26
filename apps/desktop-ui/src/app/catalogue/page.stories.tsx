import type { Meta, StoryObj } from "@storybook/react-vite"
import { PageCatalogue } from "./page"

const meta = { component: PageCatalogue } satisfies Meta<typeof PageCatalogue>

export default meta

export const Entry: StoryObj<typeof meta> = {}
