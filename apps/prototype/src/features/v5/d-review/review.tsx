/**
 * Review (slice D; P-REV2): the session intake Review step body. Marks are
 * library-level only (P-REJ2). The intake StepPage hosts it with `fill`;
 * it renders no header, step strip or footer of its own. Route search
 * params read: `?assetId=` opens that frame.
 */
import type { SessionReviewProps } from "@/components/app/contracts"
import { ReviewWorkspace } from "./frame-review"

/** The Review step body of session intake. */
export function SessionReview({ sessionId, onFinished }: SessionReviewProps) {
  return <ReviewWorkspace key={sessionId} context={{ kind: "session", sessionId }} onFinished={onFinished} />
}
