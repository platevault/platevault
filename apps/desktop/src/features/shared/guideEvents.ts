export const startFirstStepGuideEvent = "astro-plan:start-first-step-guide";
export const stopFirstStepGuideEvent = "astro-plan:stop-first-step-guide";
export const resetFirstStepGuideStateEvent = "astro-plan:reset-first-step-guide-state";
export const cleanupFirstStepGuideStateEvent = "astro-plan:cleanup-first-step-guide-state";
export const guideActionEvent = "astro-plan:guide-action";
export const libraryCandidateEvent = "astro-plan:library-candidate-added";
export const guidedCreatedProjectStorageKey = "astro-plan:guided-created-project";
export const guidedSampleProjectId = "guided-sample-project";
export const guidedLibraryItemsStorageKey = "astro-plan:guided-library-items";
export const guidedConfirmedItemsStorageKey = "astro-plan:guided-confirmed-items";
const guideStorageKey = "astro-plan:first-step-guide";
const guideStepStorageKey = `${guideStorageKey}:step`;

type GuideCleanupEventDetail = {
  projectId?: string;
};

type GuidedCreatedProjectRecord = {
  projectId?: string;
};

export type GuidedFrameKind = "darks" | "bias" | "flats" | "lights";

export type GuideActionId =
  | "inbox.scan-complete"
  | `inbox.select-item.${GuidedFrameKind}`
  | `inbox.move-to-library.${GuidedFrameKind}`
  | `library.select-item.${GuidedFrameKind}`
  | `library.confirm-item.${GuidedFrameKind}`
  | "projects.open-project-setup"
  | "projects.setup.project"
  | "projects.setup.lights"
  | "projects.setup.calibration"
  | "projects.create-project";

export function isFirstStepGuideActive(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(guideStorageKey) === "active";
}

function readGuidedCreatedProjectId() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawCreatedProject = window.localStorage.getItem(guidedCreatedProjectStorageKey);
  if (!rawCreatedProject) {
    return null;
  }

  try {
    return (JSON.parse(rawCreatedProject) as GuidedCreatedProjectRecord).projectId ?? null;
  } catch {
    window.localStorage.removeItem(guidedCreatedProjectStorageKey);
    return null;
  }
}

function clearFirstStepGuideSampleStorageState() {
  window.localStorage.removeItem(guidedLibraryItemsStorageKey);
  window.localStorage.removeItem(guidedConfirmedItemsStorageKey);
  window.localStorage.removeItem(guidedCreatedProjectStorageKey);
  window.localStorage.removeItem(guideStorageKey);
  window.localStorage.removeItem(guideStepStorageKey);
}

export function resetFirstStepGuideSampleState(detail: GuideCleanupEventDetail = {}) {
  if (typeof window === "undefined") {
    return;
  }

  const projectId = detail.projectId ?? readGuidedCreatedProjectId() ?? undefined;

  clearFirstStepGuideSampleStorageState();

  window.dispatchEvent(
    new CustomEvent(resetFirstStepGuideStateEvent, {
      detail: {
        projectId,
      },
    }),
  );
}

export function cleanupFirstStepGuideSampleState(detail: GuideCleanupEventDetail = {}) {
  if (typeof window === "undefined") {
    return;
  }

  const projectId = detail.projectId ?? readGuidedCreatedProjectId() ?? undefined;

  clearFirstStepGuideSampleStorageState();

  window.dispatchEvent(
    new CustomEvent(cleanupFirstStepGuideStateEvent, {
      detail: {
        projectId,
      },
    }),
  );
}

export function completeFirstStepGuideSampleState() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(guidedLibraryItemsStorageKey);
  window.localStorage.removeItem(guidedConfirmedItemsStorageKey);
  window.localStorage.removeItem(guideStorageKey);
  window.localStorage.removeItem(guideStepStorageKey);
}

export function startFirstStepGuide() {
  window.dispatchEvent(new CustomEvent(startFirstStepGuideEvent));
}

export function stopFirstStepGuide() {
  window.dispatchEvent(new CustomEvent(stopFirstStepGuideEvent));
}

export function emitGuideAction(id: GuideActionId) {
  window.dispatchEvent(new CustomEvent(guideActionEvent, { detail: { id } }));
}
