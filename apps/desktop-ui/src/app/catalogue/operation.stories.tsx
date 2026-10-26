import type { Meta, StoryObj } from "@storybook/react-vite"
import { OperationCatalogue } from "./operation"

const meta = { component: OperationCatalogue } satisfies Meta<typeof OperationCatalogue>

export default meta

export const Entry: StoryObj<typeof meta> = {}
