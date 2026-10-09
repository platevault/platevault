/**
 * S16 Settings › Naming (slice E): per-type naming templates with the nine
 * tokens and fallbacks, the chip editor and a live preview, used by Import
 * and Archive (D-W20, STO-IMP-FR-07). Foundation placeholder; slice E
 * replaces this file.
 */
import { PlaceholderPage } from "@/components/app/page"
import { SCREENS } from "@/app/screens"
import { DEFAULT_NAMING, NAMING_TOKENS, namingTemplate } from "@/domain/templates"
import type { NamingFrameType } from "@/domain/types"
import { useStore } from "@/store/core"

export function NamingSettingsPage() {
  const naming = useStore((s) => s.settings.naming)
  return (
    <PlaceholderPage
      screen={{ ...SCREENS.S16, title: "Naming", route: "/settings/naming" }}
      level={2}
      facts={[
        { label: "Tokens", value: NAMING_TOKENS.map((t) => `{${t.token}} → ${t.fallback}`).join(" · ") },
        ...(Object.keys(DEFAULT_NAMING) as NamingFrameType[]).map((type) => ({ label: type, value: <code className="font-mono text-xs">{namingTemplate(naming, type)}</code> })),
      ]}
    />
  )
}
