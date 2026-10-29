/**
 * The intake Review step's body until the router registers the review
 * workspace (`SessionReview` of features/review, PR #1920, astro-plan-jd2rc):
 * a visible "unavailable" state, never a stand-in review. The lead swaps
 * this for `SessionReview` in src/routes.tsx at integration.
 */
import type { SessionReviewProps } from "@/app/shell-contract"
import { useMessages } from "@/app/preferences"
import { Unavailable } from "./parts"

export function ReviewNotRegistered(_props: SessionReviewProps) {
  const m = useMessages()
  return <Unavailable what={m.sessions_column_review()} />
}
