/**
 * T2 pages: library home, Targets, Sessions, Projects and Activity.
 * Route paths are fixed by the foundation in src/routes.tsx (HLD §5).
 * T2 replaces these bodies; it must keep the exported keys.
 */
import { PlaceholderPage } from "@/components/app/page"

const owner = { track: "T2", name: "Library: Targets, Sessions, Projects" } as const

export const t2Pages = {
  targets: () => <PlaceholderPage title="Targets" route="/targets" owner={owner} covers="J20 step 1; LIB-FR-08, LIB-FR-10 default home" />,
  target: () => <PlaceholderPage title="Target" route="/targets/$targetId" owner={owner} covers="J20 steps 1-2; product flow B1; LIB-FR-08, LIB-FR-13" />,
  sessions: () => <PlaceholderPage title="Sessions" route="/sessions" owner={owner} covers="J19 step 6; LIB-FR-04, LIB-FR-06, LIB-FR-07" />,
  session: () => (
    <PlaceholderPage title="Inspect session" route="/sessions/$sessionId" owner={owner} covers="J19 steps 6-7; LIB-FR-05, LIB-FR-09, LIB-FR-11, LIB-FR-12" />
  ),
  projects: () => <PlaceholderPage title="Projects" route="/projects" owner={owner} covers="J20; PRJ-FR-07" />,
  projectNew: () => <PlaceholderPage title="New Project" route="/projects/new" owner={owner} covers="J20 steps 2-4; PRJ-FR-01 to PRJ-FR-05" />,
  project: () => (
    <PlaceholderPage title="Project" route="/projects/$projectId" owner={owner} covers="J20 steps 3-6; PRJ-FR-04, PRJ-FR-06, PRJ-FR-08" />
  ),
  activity: () => <PlaceholderPage title="Activity" route="/activity" owner={owner} covers="LIB-FR-10 operation outcomes, refusals, failed writes" />,
}
