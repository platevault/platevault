/**
 * Spec 008 project store — reactive query + mutation hooks.
 *
 * Replaces PROJECTS_DATA fixture reads with real commands from
 * `@/api/commands`. The query stores are module-level singletons so all
 * components share the same cache and invalidation signal.
 */

import {
  createQueryStore,
  createParameterizedStore,
  useQuery,
  useParameterizedQuery,
  invalidateStores,
} from '@/data/store';
import {
  listProjects008,
  getProject008,
  createProject,
  updateProject,
  addProjectSource,
  removeProjectSource,
  reinferProjectChannels,
  dismissProjectChannelDrift,
} from '@/api/commands';
import type { ProjectSummaryDto, ProjectDetailDto } from '@/bindings/index';
import type {
  ProjectCreateRequest,
  ProjectCreateResult,
  ProjectUpdateRequest,
  ProjectUpdateResult,
  ProjectSourceAddRequest,
  ProjectSourceAddResult,
  ProjectSourceRemoveRequest,
  ProjectSourceRemoveResult,
  ProjectChannelsReinferRequest,
  ProjectChannelsReinferResult,
  ProjectChannelsDismissDriftRequest,
  ProjectChannelsDismissDriftResult,
} from '@/bindings/index';

// ── Query stores ──────────────────────────────────────────────────────────────

/** Module-level singleton for the project list. */
export const projectListStore = createQueryStore<ProjectSummaryDto[]>(() =>
  listProjects008(),
);

/** Per-id parameterised store for project detail. */
export const projectDetailStore = createParameterizedStore<string, ProjectDetailDto>(
  (id) => getProject008({ id }),
);

// ── Query hooks ───────────────────────────────────────────────────────────────

/** Subscribe to the project list. Triggers a fetch on first mount. */
export function useProjects() {
  return useQuery(projectListStore);
}

/** Subscribe to a single project's detail. */
export function useProjectDetail(id: string) {
  return useParameterizedQuery(projectDetailStore, id);
}

// ── Mutation helpers ──────────────────────────────────────────────────────────

/** Invalidate list + optionally a specific detail cache. */
function invalidateProject(id?: string) {
  invalidateStores(projectListStore);
  if (id) projectDetailStore.invalidate(id);
}

/**
 * Create a project. Invalidates the project list on success.
 *
 * Returns the full result including `planId` for the folder-structure plan.
 */
export async function useCreateProject(
  req: ProjectCreateRequest,
): Promise<ProjectCreateResult> {
  const result = await createProject(req);
  invalidateProject();
  return result;
}

/**
 * Update project name/tool/notes. Invalidates list + detail.
 */
export async function useUpdateProject(
  req: ProjectUpdateRequest,
): Promise<ProjectUpdateResult> {
  const result = await updateProject(req);
  invalidateProject(req.projectId);
  return result;
}

/**
 * Add a source link to a project.
 */
export async function useAddProjectSource(
  req: ProjectSourceAddRequest,
): Promise<ProjectSourceAddResult> {
  const result = await addProjectSource(req);
  invalidateProject(req.projectId);
  return result;
}

/**
 * Remove a source link from a project.
 */
export async function useRemoveProjectSource(
  req: ProjectSourceRemoveRequest,
): Promise<ProjectSourceRemoveResult> {
  const result = await removeProjectSource(req);
  invalidateProject(req.projectId);
  return result;
}

/**
 * Re-infer channels from all linked sources, discarding manual overrides.
 */
export async function useReinferChannels(
  req: ProjectChannelsReinferRequest,
): Promise<ProjectChannelsReinferResult> {
  const result = await reinferProjectChannels(req);
  invalidateProject(req.projectId);
  return result;
}

/**
 * Dismiss the channel-drift banner without re-inferring.
 */
export async function useDismissChannelDrift(
  req: ProjectChannelsDismissDriftRequest,
): Promise<ProjectChannelsDismissDriftResult> {
  const result = await dismissProjectChannelDrift(req);
  invalidateProject(req.projectId);
  return result;
}
