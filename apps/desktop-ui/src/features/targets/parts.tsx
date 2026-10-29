/**
 * Pieces the Targets list and a Target page share: the Favourite action,
 * a gated part's unavailable state, a planning value the library could not
 * compute, and one window as the library computed it.
 */
import type { QueryClient } from "@tanstack/react-query"
import { Star } from "lucide-react"
import { failureOf, library, type ObservingWindow_Serialize, type PlanningUnknownReason } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import type { Action } from "@/components/app/contracts"
import { Notice, UnknownValue } from "@/components/app/feedback"
import { failureMessage } from "@/components/app/run-result"
import { siteTimeRange } from "@/components/domain/sky-lines"
import { formatHours } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { targetsWrite } from "./queries"
import { unknownReasonText } from "./targets-model"

/** Add to or Remove from favourites (PLAN-TGT-FR-17): every label says Favourite, never Star. */
export function favouriteAction(m: Messages, client: QueryClient, targetId: string, favourite: boolean): Action {
  return {
    id: favourite ? "favourite-remove" : "favourite-add",
    label: favourite ? m.targets_favourite_remove() : m.targets_favourite_add(),
    icon: Star,
    run: () => targetsWrite(client, () => library.targetsSetFavourite(targetId, !favourite)),
  }
}

/** A failed read's message in the reader's language. */
export function readFailure(m: Messages, error: unknown): string {
  const failure = failureOf(error)
  return failure ? failureMessage(m, failure) : m.action_failure_unreachable()
}

/** A part whose library read or write does not exist yet; the caller's comment names the bead that adds it. */
export function Unavailable({ what }: { what: string }) {
  const m = useMessages()
  return <Notice tone="info" title={m.home_unavailable({ what })} />
}

/** The `unavailable` of an action whose library command does not exist yet. */
export function notYet(m: Messages, label: string): Action["unavailable"] {
  return { action: m.actions_blocked({ action: label }), reason: m.home_unavailable({ what: label }), blockers: [] }
}

/** A planning value the library left out, with its reason as visible text. */
export function Unknown({ reason }: { reason: PlanningUnknownReason | null }) {
  const m = useMessages()
  return <UnknownValue reason={reason ? unknownReasonText(m, reason) : undefined} />
}

/** "21:40-02:30 CEST · 4h50 · max 62° · Backyard": one window with its site and zone basis. */
export function windowText(m: Messages, w: ObservingWindow_Serialize): string {
  const parts = [siteTimeRange(w.startUtc, w.endUtc, w.timeZone), formatHours(w.durationMinutes * 60)]
  if (w.peakAltitudeDeg !== null) parts.push(m.plan_event_max_alt({ altitude: Math.round(w.peakAltitudeDeg) }))
  parts.push(w.siteName)
  return parts.join(" · ")
}
