/**
 * S6 Review (slice D): frame review inside a run's Review step, Review all
 * across a run group's panels (D-W41), review of a Project's candidate
 * sessions, opened filtered to Unreviewed (PIX-FR-18), and review of one
 * library session from Sessions (marks are library-level only; no Project
 * reject). Each renders the one review workspace (`frame-review.tsx`) as a
 * full-height flex child with its own toolbar; mount it without page padding.
 * Route search params read: `?filter=all|picked|rejected|unreviewed`,
 * `?panel=<panelId>`, `?assetId=`.
 */
import { FrameReview } from "./frame-review"

export function ReviewStep({ runId }: { runId: string }) {
  return <FrameReview key={runId} context={{ kind: "run", runId }} />
}

export function GroupReviewStep({ groupId }: { groupId: string }) {
  return <FrameReview key={groupId} context={{ kind: "group", groupId }} />
}

export function CandidateReview({ projectId }: { projectId: string }) {
  return <FrameReview key={projectId} context={{ kind: "candidates", projectId }} />
}

export function SessionReview({ sessionId }: { sessionId: string }) {
  return <FrameReview key={sessionId} context={{ kind: "session", sessionId }} />
}
