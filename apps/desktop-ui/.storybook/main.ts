import type { StorybookConfig } from "@storybook/react-vite"

const config: StorybookConfig = {
  stories: [{ directory: "../src", files: "**/*.stories.tsx" }],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true },
  typescript: { reactDocgen: false },
}

export default config
