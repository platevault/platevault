import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from '@tanstack/react-router';
import {
  Joyride,
  ACTIONS,
  EVENTS,
  STATUS,
  type EventData,
  type Controls,
  type Step,
} from 'react-joyride';
import { usePreference } from '@/data/preferences';
import { completeTourStep } from '@/api/commands';

interface TourStep extends Step {
  /** Path prefix that must match `location.pathname` for the target to exist. */
  page: string;
  /** Preference key that tracks completion for this step. */
  stepKey: 'step1' | 'step2' | 'step3';
}

const TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="first-session"]',
    title: 'Confirm your first session',
    content:
      'Sessions are groups of frames sharing the same target, filter, and night. ' +
      'Review the auto-detected session and confirm it to proceed.',
    page: '/sessions',
    stepKey: 'step1',
  },
  {
    target: '[data-tour="new-project"]',
    title: 'Create your first project',
    content:
      'Projects tie sessions, calibration, and outputs together. ' +
      'Create one to start organizing your processing workflow.',
    page: '/projects',
    stepKey: 'step2',
  },
  {
    target: '[data-tour="open-tool"]',
    title: 'Open in your processing tool',
    content:
      'Once a project is prepared, open it directly in PixInsight or your configured tool. ' +
      'Source views and calibration links are set up for you.',
    page: '/projects',
    stepKey: 'step3',
  },
];

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [setupCompleted] = usePreference('setupCompleted');
  const [tourCompleted, setTourCompleted] = usePreference('tourCompleted');
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * Guards against STATUS.FINISHED / STATUS.SKIPPED events that Joyride fires
   * when we set run to false during a page-to-page transition. Without this
   * guard the tour ends prematurely instead of resuming on the next page.
   */
  const transitioningRef = useRef(false);
  const navigateRef = useRef(useNavigate());
  const navigate = useNavigate();
  navigateRef.current = navigate;
  const location = useLocation();

  const allDone =
    tourCompleted.step1 && tourCompleted.step2 && tourCompleted.step3;

  const activeStepIndex = useMemo(() => {
    if (!tourCompleted.step1) return 0;
    if (!tourCompleted.step2) return 1;
    if (!tourCompleted.step3) return 2;
    return -1;
  }, [tourCompleted]);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const markAllDone = useCallback(() => {
    setTourCompleted({ step1: true, step2: true, step3: true });
    completeTourStep({ step: 'step1' });
    completeTourStep({ step: 'step2' });
    completeTourStep({ step: 'step3' });
    setRun(false);
    transitioningRef.current = false;
    clearPoll();
  }, [setTourCompleted, clearPoll]);

  /**
   * Transition to a given step index.
   *
   * 1. Sets a transitioning guard so FINISHED/SKIPPED status events that fire
   *    when we set run to false are ignored instead of ending the tour.
   * 2. Stops the current tour run so the overlay disappears immediately.
   * 3. Navigates to the step page when the current route does not match.
   * 4. Polls the DOM until the target element appears, then restarts the tour
   *    at the new stepIndex and clears the guard.
   */
  const goToStep = useCallback(
    (idx: number) => {
      clearPoll();

      const step = TOUR_STEPS[idx];
      if (!step) {
        markAllDone();
        return;
      }

      // Set the guard BEFORE stopping so the resulting status event is ignored.
      transitioningRef.current = true;

      setRun(false);
      setStepIndex(idx);

      // Read the pathname fresh from the hash to avoid stale closure values.
      const currentPath =
        window.location.hash.replace(/^#/, '') || '/';
      if (!currentPath.startsWith(step.page)) {
        navigateRef.current({ to: step.page as '/' });
      }

      // Poll for the target element to appear after navigation and render.
      pollRef.current = setInterval(() => {
        if (document.querySelector(step.target as string)) {
          clearPoll();
          transitioningRef.current = false;
          setRun(true);
        }
      }, 200);
    },
    [markAllDone, clearPoll],
  );

  // Auto-start when setup is complete and tour has incomplete steps.
  useEffect(() => {
    if (!setupCompleted || allDone || activeStepIndex < 0) {
      setRun(false);
      clearPoll();
      return;
    }
    goToStep(activeStepIndex);
    return clearPoll;
  }, [setupCompleted, allDone, activeStepIndex, goToStep, clearPoll]);

  const handleEvent = useCallback(
    (data: EventData, _controls: Controls) => {
      const { action, index, status, type } = data;

      // While we are mid-transition (paused the tour to navigate between
      // pages), Joyride fires FINISHED/SKIPPED because run was set to false.
      // Ignore all events until the transition completes.
      if (transitioningRef.current) {
        return;
      }

      // Tour finished (last step completed) or skipped.
      if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
        markAllDone();
        return;
      }

      // User completed a step by clicking Next, Back, or Close.
      if (type === EVENTS.STEP_AFTER) {
        const step = TOUR_STEPS[index];
        if (step && !tourCompleted[step.stepKey]) {
          setTourCompleted({ ...tourCompleted, [step.stepKey]: true });
          completeTourStep({ step: step.stepKey });
        }

        if (action === ACTIONS.NEXT || action === ACTIONS.CLOSE) {
          const nextIndex = index + 1;
          if (nextIndex < TOUR_STEPS.length) {
            goToStep(nextIndex);
          } else {
            // Last step completed. Mark done explicitly because
            // STATUS.FINISHED may not fire reliably in controlled mode.
            markAllDone();
          }
        } else if (action === ACTIONS.PREV) {
          goToStep(Math.max(0, index - 1));
        }
      }

      // Target element not found: skip to the next step or finish.
      if (type === EVENTS.TARGET_NOT_FOUND) {
        if (index < TOUR_STEPS.length - 1) {
          goToStep(index + 1);
        } else {
          markAllDone();
        }
      }
    },
    [tourCompleted, setTourCompleted, markAllDone, goToStep],
  );

  return (
    <>
      {children}
      <Joyride
        steps={TOUR_STEPS}
        stepIndex={stepIndex}
        run={run}
        continuous
        onEvent={handleEvent}
        options={{
          skipBeacon: true,
          zIndex: 10000,
          primaryColor: '#1a1a1a',
          overlayClickAction: 'next',
        }}
        styles={{
          tooltip: {
            fontSize: 13,
            borderRadius: 6,
          },
        }}
        locale={{
          back: 'Back',
          close: 'Close',
          last: 'Done',
          next: 'Next',
          skip: 'Skip tour',
        }}
      />
    </>
  );
}
