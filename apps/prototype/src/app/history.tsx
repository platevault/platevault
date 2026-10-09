/**
 * Back and Forward (foundation-owned): icon-only history buttons at the
 * toolbar's leading edge, outside the source list. Back follows the router's
 * own history; Forward is possible after a Back until the next navigation.
 */
import { useRouter } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useT } from "./preferences"

/** The furthest history index reached since the last push, so Forward knows whether it can go. */
let furthest = -1

function useHistoryPosition(): { canBack: boolean; canForward: boolean } {
  const { history } = useRouter()
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
  const t = useT()
  const { history } = useRouter()
  const { canBack, canForward } = useHistoryPosition()
  const item = (label: string, Icon: typeof ChevronLeft, enabled: boolean, go: () => void) => (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} disabled={!enabled} focusableWhenDisabled onClick={go} />}>
        <Icon aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
  return (
    <div className="flex shrink-0 items-center" role="group" aria-label={`${t("Back")} / ${t("Forward")}`}>
      {item(t("Back"), ChevronLeft, canBack, () => history.back())}
      {item(t("Forward"), ChevronRight, canForward, () => history.forward())}
    </div>
  )
}
