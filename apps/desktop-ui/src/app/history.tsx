/**
 * Back and Forward (shell-owned): icon-only history buttons at the
 * toolbar's leading edge, outside the source list. Back follows the router's
 * own history; Forward is possible after a Back until the next navigation.
 */
import { type RouterHistory, useRouter } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useSyncExternalStore } from "react"
import { IconButton } from "@/components/app/actions"
import { useMessages } from "./preferences"

/** The furthest history index reached since the last push, so Forward knows whether it can go. */
let furthest = -1

function useHistoryPosition(history: RouterHistory): { canBack: boolean; canForward: boolean } {
  const snapshot = () => {
    const index = history.location.state.__TSR_index ?? 0
    furthest = Math.max(furthest, index)
    return `${index}/${furthest}/${history.canGoBack() ? 1 : 0}`
  }
  const value = useSyncExternalStore(
    (listener) =>
      history.subscribe(({ action }) => {
        // A new entry drops everything ahead of it.
        if (action.type === "PUSH") furthest = history.location.state.__TSR_index ?? 0
        listener()
      }),
    snapshot,
  )
  const [index, max, back] = value.split("/").map(Number)
  return { canBack: back === 1, canForward: (index ?? 0) < (max ?? 0) }
}

export function HistoryControl() {
  const m = useMessages()
  const { history } = useRouter()
  const { canBack, canForward } = useHistoryPosition(history)
  return (
    <div role="group" aria-label={m.history_label()} data-history="">
      <IconButton label={m.history_back()} icon={ChevronLeft} disabled={!canBack} focusableWhenDisabled onClick={() => history.back()} />
      <IconButton label={m.history_forward()} icon={ChevronRight} disabled={!canForward} focusableWhenDisabled onClick={() => history.forward()} />
    </div>
  )
}
