import { nativeQuitCopy, useNativeMenuLocale, useNativeQuitRequest } from "./native-shell"
import { useMessages } from "@/app/preferences"
import { ConfirmDialog } from "@/components/app/confirm-dialog"

/** Keeps the native menu bar and tray in the active locale, and asks before a Quit that would interrupt running work, naming that work. */
export function NativeShellHost() {
  const m = useMessages()
  useNativeMenuLocale()
  const quit = useNativeQuitRequest()
  const copy = nativeQuitCopy(m, quit.request?.work ?? null)
  return (
    <ConfirmDialog
      open={quit.request !== null}
      onOpenChange={(open) => {
        if (!open) void quit.answer(false)
      }}
      title={copy.title}
      summary={copy.summary}
      confirm={{ label: m.shell_quit_app(), kind: "destructive" }}
      onConfirm={() => quit.answer(true)}
    />
  )
}
