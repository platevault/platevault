import type { Meta, StoryObj } from "@storybook/react-vite"
import { ShellPartsCatalogue } from "./shell-parts"

const meta = { component: ShellPartsCatalogue } satisfies Meta<typeof ShellPartsCatalogue>

export default meta

export const Entry: StoryObj<typeof meta> = {}
