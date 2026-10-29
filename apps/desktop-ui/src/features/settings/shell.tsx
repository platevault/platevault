/**
 * The Settings area's shell contribution (src/app/shell-contract.ts): the
 * orientation walk, mounted once at the app root so it spans every page it
 * visits.
 */
import type { ShellContribution } from "@/app/shell-contract"
import { OrientationWalk } from "./walk"

export const settingsShell: ShellContribution = { Overlay: OrientationWalk }
