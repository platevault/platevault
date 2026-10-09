/**
 * Slice shell contributions, in fixed order (foundation-owned). The shell
 * renders each `Overlay` once at the root and the palette lists each
 * `useCommands` result; slices edit only their own `shell.tsx`.
 */
import { aShell } from "@/features/v5/a-home/shell"
import { bShell } from "@/features/v5/b-projects/shell"
import { cShell } from "@/features/v5/c-runs/shell"
import { dShell } from "@/features/v5/d-review/shell"
import { eShell } from "@/features/v5/e-targets-plan-settings/shell"
import type { ShellContribution } from "./shell-contract"

export const SHELLS: ShellContribution[] = [aShell, bShell, cShell, dShell, eShell]
