import type { StorybookConfig } from "@storybook/react-vite"

// The composition catalogue as stories: one `src/app/catalogue/<id>.stories.tsx` per registry entry, so each
// story's title is its entry id. The builder reads the app's own vite.config.ts (aliases, Paraglide, Tailwind).
const config: StorybookConfig = {
  stories: [{ directory: "../src/app/catalogue", files: "*.stories.tsx", titlePrefix: "catalogue" }],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true },
  // The entries take no props, so docgen has nothing to document.
  typescript: { reactDocgen: false },
}

export default config
