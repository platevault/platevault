/**
 * Client-side form schemas for project create / edit forms — spec 042 US5 (T170).
 *
 * These zod schemas drive react-hook-form validation in:
 *   - features/projects/create/CreateProjectDialog.tsx
 *   - features/projects/edit/EditProjectPane.tsx
 *   - features/projects/wizard/StepName.tsx (+ WizardPage orchestration)
 *
 * IMPORTANT: these are *UX* schemas, not the source of truth. The backend
 * (`projects.create` / `projects.update`) remains the authority and re-validates
 * every request. The shapes here MIRROR the generated contract request types in
 * `@/bindings/index` (`ProjectCreateRequest`, `ProjectUpdateRequest`) so the
 * client never invents fields the backend doesn't accept. The submitted payload
 * is assembled from these validated values plus the non-user-editable fields
 * (`requestId`, `initialSources`, `canonicalTargetId`, `projectId`) at the call
 * site, byte-identical to the pre-RHF behaviour.
 */

import { z } from 'zod';
import type { ProjectTool } from '@/bindings/index';
import { m } from '@/lib/i18n';

// ── Shared limits (kept in sync with the prior manual validation) ─────────────

// Parity with crates/domain/core/src/project/validate.rs MAX_NAME_LEN.
// No generated tauri-specta binding exposes this constant today; if one is
// added, prefer asserting against it instead of this duplicated literal.
// schemas.test.ts pins this value so a drift is caught on either side.
export const MAX_NAME_LEN = 120;
export const MAX_NOTES_LEN = 4096;

/**
 * Processing-tool values the create/edit forms expose. The generated
 * `ProjectTool` enum is `"PixInsight" | "Siril" | "Planetary Suite"`; the forms
 * only offer PixInsight / Siril, so the schema constrains to those two while
 * remaining assignable to `ProjectTool`.
 */
export const PROJECT_TOOL_VALUES = [
  'PixInsight',
  'Siril',
] as const satisfies readonly ProjectTool[];

export const projectToolSchema = z.enum(PROJECT_TOOL_VALUES);

// ── Create project (CreateProjectDialog) ──────────────────────────────────────

/**
 * Fields the user edits in CreateProjectDialog. The non-editable contract fields
 * (requestId, initialSources, notes-coalescing, canonicalTargetId) are added at
 * submit time, so this schema deliberately covers only the user-facing inputs.
 *
 * Validation rules mirror the original manual `validate()`:
 *   - name: required (after trim), ≤ MAX_NAME_LEN
 *   - tool: required, one of the offered tools
 *   - path: required (after trim)
 *   - notes: optional, ≤ MAX_NOTES_LEN
 */
export const createProjectFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, m.projects_schema_name_required())
    .max(
      MAX_NAME_LEN,
      m.projects_schema_name_too_long({ max: String(MAX_NAME_LEN) }),
    ),
  tool: projectToolSchema.refine((v) => Boolean(v), {
    message: m.projects_schema_tool_required(),
  }),
  path: z.string().trim().min(1, m.projects_schema_path_required()),
  notes: z
    .string()
    .max(
      MAX_NOTES_LEN,
      m.projects_schema_notes_too_long({ max: String(MAX_NOTES_LEN) }),
    ),
});

export type CreateProjectFormValues = z.infer<typeof createProjectFormSchema>;

// ── Edit project (EditProjectPane) ────────────────────────────────────────────

/**
 * Fields the user edits in EditProjectPane. The original manual validation only
 * enforced the name rule (required, ≤120); tool and notes had no inline error.
 * We preserve that exactly — tool/notes are present in the schema (so RHF tracks
 * them) but carry no failing constraint beyond the contract enum / notes length
 * that the prior form also implicitly allowed.
 */
export const editProjectFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, m.projects_schema_edit_name_required())
    .max(
      MAX_NAME_LEN,
      m.projects_schema_name_too_long({ max: String(MAX_NAME_LEN) }),
    ),
  tool: projectToolSchema,
  notes: z
    .string()
    .max(
      MAX_NOTES_LEN,
      m.projects_schema_notes_too_long({ max: String(MAX_NOTES_LEN) }),
    ),
});

export type EditProjectFormValues = z.infer<typeof editProjectFormSchema>;

// ── Wizard step: name & workflow profile (StepName) ───────────────────────────

/**
 * The wizard's name step. `workflowProfile` is a wizard-only concept that
 * WizardPage maps onto the contract `tool` enum at create time, so the schema
 * keeps the profile union as-is and only enforces the same "name required" gate
 * that `canAdvance()` enforced (length > 0 after trim).
 */
export const wizardNameSchema = z.object({
  name: z.string().trim().min(1, m.projects_schema_name_required()),
  workflowProfile: z.enum(['pixinsight', 'siril', 'planetary']),
});

export type WizardNameValues = z.infer<typeof wizardNameSchema>;
