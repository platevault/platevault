import type { Meta, StoryObj } from "@storybook/react-vite"
import { FeedbackCatalogue } from "./feedback"

const meta = { component: FeedbackCatalogue } satisfies Meta<typeof FeedbackCatalogue>

export default meta

export const Entry: StoryObj<typeof meta> = {}
