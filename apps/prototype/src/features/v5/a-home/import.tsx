/**
 * S13 Import (slice A): the Lightroom-style workflow entry (D-W11, D-W12,
 * D-W24, D-W20). `ImportSheet` is the sheet host mounted once at the app
 * root (toolbar Import, Home and the palette open it with
 * `openSheet({ kind: "import" })`); `ImportRoute` is the `/import` deep link,
 * which shows Home with the sheet over it. Foundation placeholder; slice A
 * replaces this file and may register the "import" operation handler.
 */
import { useEffect } from "react"
import { PlaceholderSheet } from "@/app/placeholder-sheet"
import { SCREENS } from "@/app/screens"
import { openSheet, useShellUi } from "@/app/ui-state"
import { useStore } from "@/store/core"
import { HomePage } from "./home"

export function ImportSheet() {
  const { sheet } = useShellUi()
  const sources = useStore((s) => Object.values(s.catalog.importSources))
  return (
    <PlaceholderSheet
      open={sheet?.kind === "import"}
      screen={SCREENS.S13}
      facts={[{ label: "Saved sources", value: sources.map((src) => src.name).join(", ") || "None yet" }]}
    />
  )
}

export function ImportRoute() {
  useEffect(() => {
    openSheet({ kind: "import" })
  }, [])
  return <HomePage />
}
