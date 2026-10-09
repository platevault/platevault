/**
 * The route's open context (foundation-owned): which Project, run, run group
 * and step the current route opens. The toolbar's Next, the Recent group and
 * slice shells read it.
 */
import { useRouterState } from "@tanstack/react-router"
import { useMemo } from "react"
import type { RunStep } from "@/domain/types"

export interface ActiveRoute {
  pathname: string
  /** The route's search params, e.g. `candidates` on a Project's candidate review. */
  search: Record<string, unknown>
  projectId: string | null
  runId: string | null
  groupId: string | null
  step: RunStep | null
}

/** Which Project, run or group the current route opens. */
export function useActiveRoute(): ActiveRoute {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> })
  return useMemo(() => {
    const project = pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null
    const run = pathname.match(/^\/projects\/[^/]+\/runs\/([^/]+)(?:\/([^/]+))?/)
    const group = pathname.match(/^\/projects\/[^/]+\/groups\/([^/]+)(?:\/([^/]+))?/)
    return {
      pathname,
      search,
      projectId: project,
      runId: run?.[1] ?? null,
      groupId: group?.[1] ?? null,
      step: ((run?.[2] ?? group?.[2]) as RunStep | undefined) ?? null,
    }
  }, [pathname, search])
}
