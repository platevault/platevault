/**
 * Link parts shared by the shell, the step pages and the lists:
 *
 * - `CurrentLink`: a router link whose `aria-current` the caller sets.
 * - `useFollowLink`: opens a `StepLink` and focuses its target element once
 *   the route has rendered.
 */
import { createLink, useRouter } from "@tanstack/react-router"
import type { AnchorHTMLAttributes, Ref } from "react"
import type { StepLink } from "./contracts"

/**
 * TanStack Link marks every active link `aria-current="page"`, so a section
 * row, a record row and its step row would all claim the page. This anchor
 * sets aria-current from `current` only: the deepest row is the page, a step
 * bar item is the step.
 */
function CurrentAnchor({ current = false, ref, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { current?: "page" | "step" | false; ref?: Ref<HTMLAnchorElement> }) {
  return <a ref={ref} {...props} aria-current={current || undefined} data-current={current ? "" : undefined} />
}

export const CurrentLink = createLink(CurrentAnchor)

/** Every action runner holds one, so it reads the router without a warning where none is mounted (a component test); a link is followed only inside one. */
export function useFollowLink() {
  const router = useRouter({ warn: false })
  return (link: StepLink) => {
    void router.navigate({ to: link.to as never, params: link.params as never, search: link.search as never }).then(() => {
      if (link.focusId) requestAnimationFrame(() => document.getElementById(link.focusId!)?.focus())
    })
  }
}
