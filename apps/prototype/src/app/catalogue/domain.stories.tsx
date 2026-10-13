import type { Meta, StoryObj } from "@storybook/react-vite"
import { DomainCatalogue } from "./domain"

const meta = { component: DomainCatalogue } satisfies Meta<typeof DomainCatalogue>

export default meta

export const Entry: StoryObj<typeof meta> = {}
