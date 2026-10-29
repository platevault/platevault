/**
 * The native menu bar, tray and Quit, as the UI drives them.
 *
 * - `useNativeMenuLocale` sends the active locale's catalogue labels to the
 *   host on mount and whenever the locale changes.
 * - `useNativeQuitRequest` holds the host's pending Quit while an import, an
 *   index or an Apply runs (D-W157). Its `answer` resolves the library call's
 *   result unchanged, for a ConfirmDialog to show a failure. A Quit the UI
 *   never saw (one emitted while the webview reloaded) keeps PlateVault open;
 *   choosing Quit again asks again.
 * - `nativeQuitCopy` words that Quit's confirmation, naming the work it
 *   would interrupt.
 */
import { useEffect, useState } from "react"
import { useLibraryEvent } from "./events"
import {
  type ActionResult,
  library,
  NATIVE_QUIT_CONFIRM_EVENT,
  type NativeMenuLabels,
  type NativeQuitRequest,
  type QuitWork,
} from "./ipc"
import { useMessages } from "@/app/preferences"
import { formatCount, formatList } from "@/lib/format"
import type { Messages } from "@/lib/i18n"

/** The labels of every native menu-bar and tray item, from `m`'s catalogue. */
export function nativeMenuLabels(m: Messages): NativeMenuLabels {
  return {
    about: m.menu_about(),
    quit: m.shell_quit_app(),
    edit: m.menu_edit(),
    undo: m.menu_undo(),
    redo: m.menu_redo(),
    cut: m.menu_cut(),
    copy: m.menu_copy(),
    paste: m.menu_paste(),
    selectAll: m.menu_select_all(),
    window: m.menu_window(),
    minimise: m.menu_minimise(),
    closeWindow: m.menu_close_window(),
    show: m.menu_show(),
  }
}

/** Keep the native menu bar and tray in the active locale. */
export function useNativeMenuLocale(): void {
  const m = useMessages()
  useEffect(() => {
    void library.libraryNativeMenuSetLabels(nativeMenuLabels(m))
  }, [m])
}

/**
 * The title and summary of the Quit confirmation: "Quit with 3 tasks
 * running?", then "Running: 1 import, 1 index and Apply in Cygnus. …". When
 * the host could not read the running work (`null`), it asks without naming it.
 */
export function nativeQuitCopy(m: Messages, work: QuitWork | null): { title: string; summary: string } {
  if (!work) return { title: m.menu_quit_confirm_title(), summary: m.menu_quit_confirm_unknown() }
  const items = [
    ...(work.imports > 0 ? [m.menu_quit_work_imports({ count: work.imports, n: formatCount(work.imports) })] : []),
    ...(work.indexes > 0 ? [m.menu_quit_work_indexes({ count: work.indexes, n: formatCount(work.indexes) })] : []),
    ...work.applies.map((project) => m.menu_quit_work_apply({ project })),
  ]
  const count = work.imports + work.indexes + work.applies.length
  return {
    title: m.shell_quit_title({ count, n: formatCount(count) }),
    summary: m.menu_quit_confirm_work({ count, work: formatList(items) }),
  }
}

/** The host's pending Quit, if any, and the answer to it. */
export function useNativeQuitRequest(): {
  request: NativeQuitRequest | null
  answer: (confirmed: boolean) => Promise<ActionResult<null>> | undefined
} {
  const [request, setRequest] = useState<NativeQuitRequest | null>(null)
  useLibraryEvent(NATIVE_QUIT_CONFIRM_EVENT, setRequest)
  const answer = (confirmed: boolean) => {
    if (!request) return undefined
    const pending = library.libraryNativeQuitAnswer(request.requestId, confirmed)
    void pending.then((result) => {
      if (result.ok || !confirmed) setRequest(null)
    })
    return pending
  }
  return { request, answer }
}
