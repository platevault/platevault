import { useNativeMenuLocale, useNativeQuitRequest } from "./native-shell"
import { useMessages } from "@/app/preferences"
import { ConfirmDialog } from "@/components/app/confirm-dialog"

/** Keeps the native menu bar and tray in the active locale, and asks before a Quit that would interrupt running work. */
export function NativeShellHost() {
  const m = useMessages()
  useNativeMenuLocale()
  const quit = useNativeQuitRequest()
  return (
    <ConfirmDialog
      open={quit.request !== null}
      onOpenChange={(open) => {
        if (!open) void quit.answer(false)
      }}
      title={m.menu_quit_confirm_title()}
      summary={m.menu_quit_confirm_summary()}
      confirm={{ label: m.shell_quit_app(), kind: "destructive" }}
      onConfirm={() => quit.answer(true)}
    />
  )
}
