/**
 * Guided first-project-flow anchor id constants (spec 010, T004).
 *
 * These values are written as `data-guide-anchor="<value>"` attributes on
 * real UI elements and read by the overlay renderer to position hints.
 *
 * The CI anchor validation test (T026) enumerates all values from this module
 * and asserts each is present in at least one rendered component.
 *
 * Naming: matches the `anchor` column from the GuidedFlowStep registry in
 * `crates/app/core/src/guided_flow.rs`.
 */

/** Anchor on the "Confirm" action control in InboxPage / ActionSidebar. */
export const ANCHOR_INBOX_CONFIRM_ROW = 'inbox.confirm-row';

/** Anchor on the "New project" / "Create project" CTA in ProjectsPage. */
export const ANCHOR_PROJECTS_CREATE_CTA = 'projects.create-cta';

/** Anchor on the "Open in {tool}" button in ProjectDetail. */
export const ANCHOR_PROJECT_OPEN_IN_TOOL = 'project.open-in-tool';

/** Ordered list of all registered anchor ids.
 *  Used by the CI anchor validation test to enumerate expected anchors. */
export const ALL_ANCHOR_IDS: readonly string[] = [
  ANCHOR_INBOX_CONFIRM_ROW,
  ANCHOR_PROJECTS_CREATE_CTA,
  ANCHOR_PROJECT_OPEN_IN_TOOL,
] as const;

/** The data attribute name used in JSX. */
export const GUIDE_ANCHOR_ATTR = 'data-guide-anchor';
