/**
 * T3 pages: Views list, View creation and the View workspace host with its
 * Sessions, Frames and Refresh areas. Route paths are fixed by the foundation
 * in src/routes.tsx (HLD §4); the workspace layout hosts T4 and T5 child
 * routes through <Outlet />.
 */
import { FramesArea } from "./frames-area"
import { RefreshArea } from "./refresh-area"
import { SessionsArea } from "./sessions-area"
import { NewViewPage, ViewsPage } from "./views-pages"
import { ViewWorkspacePage } from "./workspace"

export const t3Pages = {
  views: ViewsPage,
  viewNew: NewViewPage,
  viewWorkspace: ViewWorkspacePage,
  viewSessions: SessionsArea,
  viewFrames: FramesArea,
  viewRefresh: RefreshArea,
}
