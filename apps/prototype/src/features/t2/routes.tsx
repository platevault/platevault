/**
 * T2 pages: library home, Targets, Sessions, Projects and Activity.
 * Route paths are fixed by the foundation in src/routes.tsx (HLD §4); the
 * export keys below are the contract.
 */
import { ActivityPage } from "./pages/activity"
import { ProjectPage } from "./pages/project"
import { ProjectNewPage } from "./pages/project-new"
import { ProjectsPage } from "./pages/projects"
import { SessionPage } from "./pages/session"
import { SessionsPage } from "./pages/sessions"
import { TargetPage } from "./pages/target"
import { TargetsPage } from "./pages/targets"

export const t2Pages = {
  targets: TargetsPage,
  target: TargetPage,
  sessions: SessionsPage,
  session: SessionPage,
  projects: ProjectsPage,
  projectNew: ProjectNewPage,
  project: ProjectPage,
  activity: ActivityPage,
}
