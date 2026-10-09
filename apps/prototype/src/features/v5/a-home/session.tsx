/**
 * S12 Session detail (slice A): one library session, its Target and rig
 * evidence, and Add to Project or Create Project (D-W59).
 * Foundation placeholder; slice A replaces this file.
 */
import { Link, useParams } from "@tanstack/react-router"
import { MissingRecord } from "@/app/missing-record"
import { PlaceholderPage } from "@/components/app/page"
import { SCREENS } from "@/app/screens"
import { rigName, sessionRigId, sessionTargetId } from "@/domain/derive"
import { sessionLongLabel } from "@/domain/membership"
import { useStore } from "@/store/core"

export function SessionPage() {
  const { sessionId } = useParams({ strict: false }) as { sessionId?: string }
  const catalog = useStore((s) => s.catalog)
  const session = sessionId ? catalog.sessions[sessionId] : undefined
  if (!session) return <MissingRecord noun="session" backTo="/sessions" backLabel="Open Sessions" />
  const targetId = sessionTargetId(session)
  return (
    <PlaceholderPage
      screen={{ ...SCREENS.S12, route: "/sessions/$sessionId" }}
      title={sessionLongLabel(session)}
      eyebrow={<Link to="/sessions">Sessions</Link>}
      facts={[
        { label: "Target", value: targetId ? (catalog.targets[targetId]?.name ?? targetId) : `Needs a Target (${session.target.status})` },
        { label: "Rig", value: sessionRigId(session) ? rigName(catalog, sessionRigId(session)) : `Needs review (${session.equipment.status})` },
      ]}
    />
  )
}
