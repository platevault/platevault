/**
 * T3 pages: Views list, View creation and the View workspace host with its
 * Sessions, Frames and Refresh areas.
 * Route paths are fixed by the foundation in src/routes.tsx (HLD §5).
 * T3 replaces these bodies; it must keep the exported keys. The workspace
 * layout hosts T4 and T5 child routes and must keep rendering <Outlet />.
 */
import { Outlet } from "@tanstack/react-router"
import { PlaceholderPage } from "@/components/app/page"

const owner = { track: "T3", name: "View workspace and frame review" } as const

export const t3Pages = {
  views: () => <PlaceholderPage title="Views" route="/views" owner={owner} covers="J21, J25 entry; VSEL-FR-01" />,
  viewNew: () => <PlaceholderPage title="New View" route="/views/new" owner={owner} covers="J20 step 6, J21 step 2, J26 step 4; VSEL-FR-01, RES-FR-05" />,
  viewWorkspace: () => (
    <PlaceholderPage title="View workspace" route="/views/$viewId/*" owner={owner} covers="J21-J27 host; VSEL-FR-02, VSEL-FR-13">
      <Outlet />
    </PlaceholderPage>
  ),
  viewSessions: () => (
    <PlaceholderPage level={2} title="Sessions in this View" route="/views/$viewId/sessions" owner={owner} covers="J21; product flow C1-C6; VSEL-FR-03 to VSEL-FR-09" />
  ),
  viewFrames: () => (
    <PlaceholderPage level={2} title="Review frames" route="/views/$viewId/frames" owner={owner} covers="J22; product flow D1-D6; PIX-FR-01 to PIX-FR-09, VSEL-FR-10, VSEL-FR-11" />
  ),
  viewRefresh: () => (
    <PlaceholderPage level={2} title="Refresh selection" route="/views/$viewId/refresh" owner={owner} covers="J25; product flow G; VSEL-FR-12, VSEL-FR-14" />
  ),
}
