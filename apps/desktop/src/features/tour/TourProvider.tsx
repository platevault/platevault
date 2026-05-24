import { useCallback, useMemo } from 'react';
import { Joyride, EVENTS, STATUS, type EventData, type Controls } from 'react-joyride';
import { usePreference } from '@/data/preferences';
import { completeTourStep } from '@/api/commands';

const TOUR_STEPS = [
  {
    target: '[data-tour="first-session"]',
    title: 'Confirm your first session',
    content:
      'Sessions are groups of frames sharing the same target, filter, and night. ' +
      'Review the auto-detected session and confirm it to proceed.',
    disableBeacon: true,
  },
  {
    target: '[data-tour="new-project"]',
    title: 'Create your first project',
    content:
      'Projects tie sessions, calibration, and outputs together. ' +
      'Create one to start organizing your processing workflow.',
    disableBeacon: true,
  },
  {
    target: '[data-tour="open-tool"]',
    title: 'Open in your processing tool',
    content:
      'Once a project is prepared, open it directly in PixInsight or your configured tool. ' +
      'Source views and calibration links are set up for you.',
    disableBeacon: true,
  },
];

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [setupCompleted] = usePreference('setupCompleted');
  const [tourCompleted, setTourCompleted] = usePreference('tourCompleted');

  const hasIncompleteSteps = useMemo(
    () => !tourCompleted.step1 || !tourCompleted.step2 || !tourCompleted.step3,
    [tourCompleted],
  );

  // Only show tour when setup is complete and there are incomplete steps
  const shouldRunTour = setupCompleted && hasIncompleteSteps;

  // Determine starting step index based on what's already completed
  const startStepIndex = useMemo(() => {
    if (!tourCompleted.step1) return 0;
    if (!tourCompleted.step2) return 1;
    if (!tourCompleted.step3) return 2;
    return 0;
  }, [tourCompleted]);

  const handleEvent = useCallback(
    (data: EventData, _controls: Controls) => {
      const { status, index, type } = data;

      // Mark step complete when user advances past it
      if (type === EVENTS.STEP_AFTER) {
        const stepKey = `step${index + 1}` as keyof typeof tourCompleted;
        if (!tourCompleted[stepKey]) {
          const updated = { ...tourCompleted, [stepKey]: true };
          setTourCompleted(updated);
          completeTourStep({ step: stepKey });
        }
      }

      // If tour is finished or skipped, mark all remaining steps done
      if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
        const allDone = { step1: true, step2: true, step3: true };
        setTourCompleted(allDone);
        if (!tourCompleted.step1) completeTourStep({ step: 'step1' });
        if (!tourCompleted.step2) completeTourStep({ step: 'step2' });
        if (!tourCompleted.step3) completeTourStep({ step: 'step3' });
      }
    },
    [tourCompleted, setTourCompleted],
  );

  return (
    <>
      {children}
      {shouldRunTour && (
        <Joyride
          steps={TOUR_STEPS}
          stepIndex={startStepIndex}
          continuous
          run={shouldRunTour}
          onEvent={handleEvent}
          options={{
            buttons: ['back', 'skip', 'primary'],
            overlayClickAction: 'next',
            blockTargetInteraction: false,
          }}
          styles={{
            tooltip: {
              fontSize: 13,
              borderRadius: 8,
              zIndex: 10000,
            },
            overlay: {
              zIndex: 9999,
            },
            buttonPrimary: {
              backgroundColor: '#1a1a1a',
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
      )}
    </>
  );
}
