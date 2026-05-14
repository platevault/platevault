export const startFirstStepGuideEvent = "astro-plan:start-first-step-guide";
export const stopFirstStepGuideEvent = "astro-plan:stop-first-step-guide";
export const guideActionEvent = "astro-plan:guide-action";
export const libraryCandidateEvent = "astro-plan:library-candidate-added";
export const guidedLibraryItemsStorageKey = "astro-plan:guided-library-items";
export const guidedConfirmedItemsStorageKey = "astro-plan:guided-confirmed-items";

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

export function startFirstStepGuide() {
  window.dispatchEvent(new CustomEvent(startFirstStepGuideEvent));
}

export function stopFirstStepGuide() {
  window.dispatchEvent(new CustomEvent(stopFirstStepGuideEvent));
}

export function emitGuideAction(id: GuideActionId) {
  window.dispatchEvent(new CustomEvent(guideActionEvent, { detail: { id } }));
}
