import type { PointerEvent } from "react"

/**
 * T2 (plan §6.2): text cut off by `truncate` shows its full text on hover,
 * and only while it is cut; text that fits carries no tooltip. Use as the
 * cut element's `onPointerEnter`; `full` replaces the element's own text.
 */
export function titleWhenCut(event: PointerEvent<HTMLElement>, full?: string) {
  const element = event.currentTarget
  if (element.scrollWidth > element.clientWidth) element.title = full ?? element.textContent ?? ""
  else element.removeAttribute("title")
}
