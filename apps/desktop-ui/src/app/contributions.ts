/**
 * Feature shell contributions, in fixed order (shell-owned). The shell
 * renders each `Overlay` once at the root and each `SidebarFooter` in the
 * sidebar, and the palette lists each `useCommands` result. A feature area
 * adds its `shell.tsx` export here when it lands.
 */
import { homeShell } from "@/features/library/shell"
import { projectsShell } from "@/features/projects/shell"
import { reviewShell } from "@/features/review/shell"
import { targetsShell } from "@/features/targets/shell"
import type { ShellContribution } from "./shell-contract"

export const SHELLS: readonly ShellContribution[] = [homeShell, reviewShell, projectsShell, targetsShell]
