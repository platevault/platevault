/**
 * The route's open context (foundation-owned): which Project the current
 * route opens. Slice shells read it for their palette commands.
 */
import { useRouterState } from "@tanstack/react-router"
import { useMemo } from "react"

export interface ActiveRoute {
  pathname: string
  /** The route's search params, e.g. `stage` on a Project's tab. */
  search: Record<string, unknown>
  projectId: string | null
}

/** Which Project the current route opens. */
export function useActiveRoute(): ActiveRoute {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> })
  return useMemo(() => ({ pathname, search, projectId: pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null }), [pathname, search])
}
