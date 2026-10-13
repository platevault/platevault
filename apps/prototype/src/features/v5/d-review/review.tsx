/**
 * Review (slice D; P-REV2): the session intake Review step body. Marks are
 * library-level only (P-REJ2). The intake StepPage hosts it with `fill`;
 * it renders no header, step strip or footer of its own. Route search
 * params read: `?assetId=` opens that frame.
 *
 * ReviewStep, GroupReviewStep and CandidateReview are the pre-P-REV2 hosts
 * (a run's Review step, a group's Review all, a Project's candidates). They
 * stay until their importers move to session intake, and mark the library
 * only; W4 (astro-plan-o1wsa) deletes them.
 */
import type { SessionReviewProps } from "@/components/app/contracts"
import type { ProjectId, RunGroupId, RunId } from "@/domain/types"
import { ReviewWorkspace } from "./frame-review"

/** The Review step body of session intake. */
export function SessionReview({ sessionId, onFinished }: SessionReviewProps) {
  return <ReviewWorkspace key={sessionId} context={{ kind: "session", sessionId }} onFinished={onFinished} />
}

/** @deprecated P-REV2: review moved to session intake. Importer: c-runs/run.tsx (W3P6Runs); W4 deletes it. */
export function ReviewStep({ runId }: { runId: RunId }) {
  return <ReviewWorkspace key={runId} context={{ kind: "run", runId }} />
}

/** @deprecated P-REV2: review moved to session intake. Importer: c-runs/group.tsx (W3P6Runs); W4 deletes it. */
export function GroupReviewStep({ groupId }: { groupId: RunGroupId }) {
  return <ReviewWorkspace key={groupId} context={{ kind: "group", groupId }} />
}

/** @deprecated P-REV2: review moved to session intake. Importer: b-projects/project.tsx (W3P5Projects); W4 deletes it. */
export function CandidateReview({ projectId }: { projectId: ProjectId }) {
  return <ReviewWorkspace key={projectId} context={{ kind: "candidates", projectId }} />
}
