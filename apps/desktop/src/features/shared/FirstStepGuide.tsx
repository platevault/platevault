import { useEffect, useMemo, useState } from "react";

import { Box, Button, Group, Paper, Text, Title } from "@mantine/core";

import type { AppRouteId } from "../../app/routes";
import {
  guideActionEvent,
  startFirstStepGuideEvent,
  stopFirstStepGuideEvent,
  type GuideActionId,
} from "./guideEvents";

type GuideStep = {
  id: string;
  route: AppRouteId;
  target: string;
  title: string;
  body: string;
  completion:
    | {
        type: "route";
      }
    | {
        type: "action";
        id: GuideActionId;
      };
};

type CoachPosition = {
  top: number;
  left: number;
};

type HighlightRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const guideStorageKey = "astro-plan:first-step-guide";
const guideStepStorageKey = `${guideStorageKey}:step`;
const openFirstRunWizardEvent = "astro-plan:open-first-run-wizard";
const guideOverlayZIndex = 2600;
const guideCardZIndex = 2620;
const guideTargetPadding = 8;
const guideTargetRetryDelayMs = 100;
const guideTargetRetryBudgetMs = 3000;
const guideTargetSettleWindowMs = 700;

const guideSteps: GuideStep[] = [
  {
    id: "open-inbox",
    route: "inbox",
    target: "nav-inbox",
    title: "Open Inbox",
    body: "Start with incoming material. The guide follows the real controls and advances only after the highlighted action runs.",
    completion: { type: "route" },
  },
  {
    id: "scan-inbox",
    route: "inbox",
    target: "inbox-scan",
    title: "Scan Inbox",
    body: "Run an Inbox scan so the app classifies incoming folders before anything is moved into Inventory.",
    completion: { type: "action", id: "inbox.scan-complete" },
  },
  {
    id: "move-to-library",
    route: "inbox",
    target: "inbox-select-darks",
    title: "Select Darks",
    body: "Select the sample master darks. The detail panel should show the selected item before any action is available.",
    completion: { type: "action", id: "inbox.select-item.darks" },
  },
  {
    id: "move-darks-to-library",
    route: "inbox",
    target: "inbox-move-library-darks",
    title: "Move Darks",
    body: "Move the selected master darks into Inventory. No source files are changed in this prototype action.",
    completion: { type: "action", id: "inbox.move-to-library.darks" },
  },
  {
    id: "select-bias",
    route: "inbox",
    target: "inbox-select-bias",
    title: "Select Bias",
    body: "Select the sample master bias so it can be promoted as a separate calibration item.",
    completion: { type: "action", id: "inbox.select-item.bias" },
  },
  {
    id: "move-bias-to-library",
    route: "inbox",
    target: "inbox-move-library-bias",
    title: "Move Bias",
    body: "Move the selected master bias into Inventory.",
    completion: { type: "action", id: "inbox.move-to-library.bias" },
  },
  {
    id: "select-flats",
    route: "inbox",
    target: "inbox-select-flats",
    title: "Select Flats",
    body: "Select the sample flats. Flats stay separate from the light session and are linked during project setup.",
    completion: { type: "action", id: "inbox.select-item.flats" },
  },
  {
    id: "move-flats-to-library",
    route: "inbox",
    target: "inbox-move-library-flats",
    title: "Move Flats",
    body: "Move the selected flats into Inventory.",
    completion: { type: "action", id: "inbox.move-to-library.flats" },
  },
  {
    id: "select-lights",
    route: "inbox",
    target: "inbox-select-lights",
    title: "Select Lights",
    body: "Select the sample lights session. Lights become the project source in the later setup step.",
    completion: { type: "action", id: "inbox.select-item.lights" },
  },
  {
    id: "move-lights-to-library",
    route: "inbox",
    target: "inbox-move-library-lights",
    title: "Move Lights",
    body: "Move the selected lights session into Inventory.",
    completion: { type: "action", id: "inbox.move-to-library.lights" },
  },
  {
    id: "open-library",
    route: "library",
    target: "nav-library",
    title: "Open Inventory",
    body: "Go to Inventory to review the item that was promoted out of Inbox.",
    completion: { type: "route" },
  },
  {
    id: "verify-darks",
    route: "library",
    target: "library-select-darks",
    title: "Verify Darks",
    body: "Select the master darks and verify the structured metadata in the side panel.",
    completion: { type: "action", id: "library.select-item.darks" },
  },
  {
    id: "confirm-darks",
    route: "library",
    target: "library-confirm-darks",
    title: "Confirm Darks",
    body: "Confirm the dark master after reviewing its metadata.",
    completion: { type: "action", id: "library.confirm-item.darks" },
  },
  {
    id: "verify-bias",
    route: "library",
    target: "library-select-bias",
    title: "Verify Bias",
    body: "Select the master bias and verify its metadata before confirmation.",
    completion: { type: "action", id: "library.select-item.bias" },
  },
  {
    id: "confirm-bias",
    route: "library",
    target: "library-confirm-bias",
    title: "Confirm Bias",
    body: "Confirm the bias master.",
    completion: { type: "action", id: "library.confirm-item.bias" },
  },
  {
    id: "verify-flats",
    route: "library",
    target: "library-select-flats",
    title: "Verify Flats",
    body: "Select the flats and verify their filter and setup metadata.",
    completion: { type: "action", id: "library.select-item.flats" },
  },
  {
    id: "confirm-flats",
    route: "library",
    target: "library-confirm-flats",
    title: "Confirm Flats",
    body: "Confirm the flats as usable calibration material.",
    completion: { type: "action", id: "library.confirm-item.flats" },
  },
  {
    id: "verify-lights",
    route: "library",
    target: "library-select-lights",
    title: "Verify Lights",
    body: "Select the lights session and verify the acquisition metadata.",
    completion: { type: "action", id: "library.select-item.lights" },
  },
  {
    id: "confirm-lights",
    route: "library",
    target: "library-confirm-lights",
    title: "Confirm Lights",
    body: "Confirm the lights as an immutable acquisition session.",
    completion: { type: "action", id: "library.confirm-item.lights" },
  },
  {
    id: "open-projects",
    route: "projects",
    target: "nav-projects",
    title: "Open Projects",
    body: "Move into Projects after a session is available for mapping.",
    completion: { type: "route" },
  },
  {
    id: "open-project-setup",
    route: "projects",
    target: "projects-add-project",
    title: "Add Project",
    body: "Open the project setup pane. Project path, name, workflow, and source/flat selection are handled there.",
    completion: { type: "action", id: "projects.open-project-setup" },
  },
  {
    id: "project-basics",
    route: "projects",
    target: "project-setup-next-project",
    title: "Project Details",
    body: "Review the project name, root, target, and workflow, then continue to source selection.",
    completion: { type: "action", id: "projects.setup.project" },
  },
  {
    id: "project-lights",
    route: "projects",
    target: "project-setup-next-lights",
    title: "Lights And Flats",
    body: "Select one or more light sessions. Each selected light session can also point to flats.",
    completion: { type: "action", id: "projects.setup.lights" },
  },
  {
    id: "project-calibration",
    route: "projects",
    target: "project-setup-next-calibration",
    title: "Darks And Bias",
    body: "Select the dark and bias masters separately from the light sessions.",
    completion: { type: "action", id: "projects.setup.calibration" },
  },
  {
    id: "create-project",
    route: "projects",
    target: "project-create-project",
    title: "Create Project",
    body: "Review the setup details and create the project. This adds the new project to the Projects table.",
    completion: { type: "action", id: "projects.create-project" },
  },
];

export function FirstStepGuide({ activeRouteId }: { activeRouteId: AppRouteId }) {
  const [isVisible, setIsVisible] = useState(() => window.localStorage.getItem(guideStorageKey) === "active");
  const [stepIndex, setStepIndex] = useState(() => {
    const storedStep = Number(window.localStorage.getItem(guideStepStorageKey) ?? 0);
    return Number.isFinite(storedStep) ? Math.min(Math.max(storedStep, 0), guideSteps.length - 1) : 0;
  });
  const [position, setPosition] = useState<CoachPosition>({ top: 96, left: 320 });
  const [highlightRect, setHighlightRect] = useState<HighlightRect | null>(null);

  const step = guideSteps[stepIndex];
  const visibleStep = useMemo(() => (isVisible ? step : null), [isVisible, step]);
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const overlayPanels = useMemo(() => {
    if (!highlightRect) {
      return [
        {
          top: 0,
          left: 0,
          width: viewportWidth,
          height: viewportHeight,
        },
      ];
    }

    const panelTop = Math.max(0, highlightRect.top);
    const panelLeft = Math.max(0, highlightRect.left);
    const panelRight = Math.min(viewportWidth, highlightRect.left + highlightRect.width);
    const panelBottom = Math.min(viewportHeight, highlightRect.top + highlightRect.height);

    if (panelTop >= panelBottom || panelLeft >= panelRight) {
      return [
        {
          top: 0,
          left: 0,
          width: viewportWidth,
          height: viewportHeight,
        },
      ];
    }

    return [
      {
        top: 0,
        left: 0,
        width: viewportWidth,
        height: panelTop,
      },
      {
        top: panelTop,
        left: 0,
        width: panelLeft,
        height: panelBottom - panelTop,
      },
      {
        top: panelTop,
        left: panelRight,
        width: Math.max(0, viewportWidth - panelRight),
        height: panelBottom - panelTop,
      },
      {
        top: panelBottom,
        left: 0,
        width: viewportWidth,
        height: Math.max(0, viewportHeight - panelBottom),
      },
    ].filter((panel) => panel.width > 0 && panel.height > 0);
  }, [highlightRect, viewportHeight, viewportWidth]);

  useEffect(() => {
    const startGuide = () => {
      window.localStorage.setItem(guideStorageKey, "active");
      window.localStorage.setItem(guideStepStorageKey, "0");
      setStepIndex(0);
      setIsVisible(true);
    };

    window.addEventListener(startFirstStepGuideEvent, startGuide);
    return () => window.removeEventListener(startFirstStepGuideEvent, startGuide);
  }, []);

  useEffect(() => {
    const stopGuide = () => {
      window.localStorage.removeItem(guideStorageKey);
      window.localStorage.removeItem(guideStepStorageKey);
      setIsVisible(false);
    };

    window.addEventListener(stopFirstStepGuideEvent, stopGuide);
    window.addEventListener(openFirstRunWizardEvent, stopGuide);
    return () => {
      window.removeEventListener(stopFirstStepGuideEvent, stopGuide);
      window.removeEventListener(openFirstRunWizardEvent, stopGuide);
    };
  }, []);

  useEffect(() => {
    if (!visibleStep || visibleStep.completion.type !== "route" || activeRouteId !== visibleStep.route) {
      return;
    }

    const timeoutId = window.setTimeout(() => advanceGuide(), 280);
    return () => window.clearTimeout(timeoutId);
  }, [activeRouteId, visibleStep]);

  useEffect(() => {
    if (!visibleStep || visibleStep.completion.type !== "action") {
      return;
    }

    const expectedActionId = visibleStep.completion.id;
    const onGuideAction = (event: Event) => {
      const action = event as CustomEvent<{ id?: GuideActionId }>;
      if (action.detail?.id === expectedActionId) {
        advanceGuide();
      }
    };

    window.addEventListener(guideActionEvent, onGuideAction);
    return () => window.removeEventListener(guideActionEvent, onGuideAction);
  }, [visibleStep]);

  useEffect(() => {
    if (!visibleStep) {
      setHighlightRect(null);
      return;
    }

    const targetSelector = `[data-guide-target="${visibleStep.target}"]`;
    const defaultPosition = {
      top: Math.max(80, window.innerHeight - 248),
      left: Math.max(16, window.innerWidth - 376),
    };
    const coachHeight = 214;

    const toCoachPosition = (rect: DOMRect): CoachPosition => {
      const coachWidth = Math.min(344, window.innerWidth - 32);
      const clampedWidth = Math.max(0, coachWidth);
      const maxLeft = Math.max(16, window.innerWidth - coachWidth - 16);
      const maxTop = Math.max(16, window.innerHeight - coachHeight - 16);

      const aboveTop = Math.max(16, rect.top - coachHeight - 12);
      const belowTop = Math.max(16, rect.bottom + 12);
      const rightLeft = Math.min(Math.max(16, rect.right + 12), maxLeft);
      const leftLeft = Math.min(Math.max(16, rect.left - coachWidth - 12), maxLeft);
      const inlineLeft = Math.min(Math.max(16, rect.left), maxLeft);

      const candidateLeft = Math.min(Math.max(16, rect.left), maxLeft);
      const clampX = (left: number) => Math.max(16, Math.min(left, maxLeft));
      const clampY = (top: number) => Math.max(16, Math.min(top, maxTop));

      const expandedTarget = {
        left: rect.left - guideTargetPadding,
        right: rect.right + guideTargetPadding,
        top: rect.top - guideTargetPadding,
        bottom: rect.bottom + guideTargetPadding,
      };

      const overlap = (left: number, top: number) => {
        const overlapLeft = Math.max(left, expandedTarget.left);
        const overlapRight = Math.min(left + clampedWidth, expandedTarget.right);
        const overlapTop = Math.max(top, expandedTarget.top);
        const overlapBottom = Math.min(top + coachHeight, expandedTarget.bottom);
        const overlapWidth = Math.max(0, overlapRight - overlapLeft);
        const overlapHeight = Math.max(0, overlapBottom - overlapTop);
        return overlapWidth * overlapHeight;
      };

      const safe = (left: number, top: number) => overlap(left, top) === 0;

      const candidatePositions: CoachPosition[] = [
        { top: clampY(belowTop), left: clampX(candidateLeft) },
        { top: clampY(aboveTop), left: clampX(candidateLeft) },
        { top: clampY(rect.top), left: clampX(rightLeft) },
        { top: clampY(rect.top), left: clampX(leftLeft) },
      ];

      const safePosition = candidatePositions.find((position) => safe(position.left, position.top));
      if (safePosition) {
        return safePosition;
      }

      return candidatePositions.reduce((best, candidate) => {
        const candidateOverlap = overlap(candidate.left, candidate.top);
        if (candidateOverlap === 0) {
          return candidate;
        }

        const bestOverlap = overlap(best.left, best.top);
        return candidateOverlap < bestOverlap ? candidate : best;
      }, candidatePositions[0]);
    };

    const setDefaultGuideState = () => {
      setHighlightRect(null);
      setPosition(defaultPosition);
    };

    let currentTarget: HTMLElement | null = null;
    let lastTargetRect: DOMRect | null = null;
    let retryAttempts = 0;
    let settleWindowExpiresAt = 0;
    const maxAttempts = Math.max(1, Math.floor(guideTargetRetryBudgetMs / guideTargetRetryDelayMs));
    let retryId: number | null = null;
    let settleRafId: number | null = null;

    const deactivateTarget = () => {
      if (currentTarget) {
        currentTarget.removeAttribute("data-guide-active");
        currentTarget = null;
      }
    };

    const scheduleSettleRefresh = () => {
      if (settleRafId !== null) {
        return;
      }

      settleRafId = window.requestAnimationFrame(() => {
        settleRafId = null;
        if (performance.now() < settleWindowExpiresAt) {
          updatePosition();
        }
      });
    };

    const hasRectSettled = (nextRect: DOMRect | null) => {
      if (!lastTargetRect || !nextRect) {
        return false;
      }

      const tolerance = 0.25;
      return (
        Math.abs(lastTargetRect.top - nextRect.top) < tolerance &&
        Math.abs(lastTargetRect.left - nextRect.left) < tolerance &&
        Math.abs(lastTargetRect.width - nextRect.width) < tolerance &&
        Math.abs(lastTargetRect.height - nextRect.height) < tolerance
      );
    };

    const updatePosition = () => {
      const nextTarget = document.querySelector<HTMLElement>(targetSelector);
      const targetRect = nextTarget?.getBoundingClientRect();
      if (!nextTarget || !targetRect || targetRect.width <= 0 || targetRect.height <= 0) {
        settleWindowExpiresAt = 0;
        lastTargetRect = null;
        deactivateTarget();
        setDefaultGuideState();

        if (retryAttempts < maxAttempts) {
          retryAttempts += 1;
          scheduleUpdate(guideTargetRetryDelayMs);
        }
        return;
      }

      if (currentTarget !== nextTarget) {
        deactivateTarget();
        currentTarget = nextTarget;
        currentTarget.setAttribute("data-guide-active", "true");
      }

      if (!hasRectSettled(targetRect)) {
        settleWindowExpiresAt = performance.now() + guideTargetSettleWindowMs;
      }
      lastTargetRect = targetRect;
      retryAttempts = maxAttempts;

      const nextHighlightRect = {
        top: Math.max(0, targetRect.top - guideTargetPadding),
        left: Math.max(0, targetRect.left - guideTargetPadding),
        width: Math.min(targetRect.width + guideTargetPadding * 2, window.innerWidth),
        height: Math.min(targetRect.height + guideTargetPadding * 2, window.innerHeight),
      };
      const nextPosition = toCoachPosition(targetRect);
      setHighlightRect(nextHighlightRect);
      setPosition(nextPosition);

      if (performance.now() < settleWindowExpiresAt) {
        scheduleSettleRefresh();
      }
    };

    const scheduleUpdate = (delay: number) => {
      if (retryId !== null) {
        window.clearTimeout(retryId);
      }
      retryId = window.setTimeout(() => {
        retryId = null;
        updatePosition();
      }, delay);
    };

    scheduleUpdate(0);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      if (retryId !== null) {
        window.clearTimeout(retryId);
      }
      if (settleRafId !== null) {
        window.cancelAnimationFrame(settleRafId);
      }
      deactivateTarget();
      setHighlightRect(null);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [visibleStep]);

  if (!visibleStep) {
    return null;
  }

  return (
    <>
      <Box
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: guideOverlayZIndex,
          background: "color-mix(in oklch, var(--canvas) 72%, transparent)",
          pointerEvents: "none",
        }}
      >
        {overlayPanels.map((panel) => (
          <Box
            key={`${panel.top}-${panel.left}-${panel.width}-${panel.height}`}
            style={{
              position: "fixed",
              top: panel.top,
              left: panel.left,
              width: panel.width,
              height: panel.height,
              background: "color-mix(in oklch, var(--canvas) 72%, transparent)",
              pointerEvents: highlightRect ? "auto" : "none",
            }}
          />
        ))}
      </Box>
      <Paper
        shadow="xl"
        radius="md"
        p="md"
        withBorder
        style={{
          position: "fixed",
          zIndex: guideCardZIndex,
          top: position.top,
          left: position.left,
          width: "min(21.5rem, calc(100vw - 2rem))",
          borderColor: "var(--border)",
          background: "var(--surface)",
          boxShadow: "0 1.4rem 4rem color-mix(in oklch, var(--text-1) 24%, transparent)",
          pointerEvents: "auto",
        }}
        aria-live="polite"
      >
        <Group justify="space-between" gap="sm">
          <Text fw={800} size="xs" c="var(--text-3)" tt="uppercase" style={{ letterSpacing: "0.08em" }}>
            Step {stepIndex + 1} of {guideSteps.length}
          </Text>
          <Button
            variant="subtle"
            size="xs"
            onClick={finishGuide}
            p="0"
            h="auto"
            c="var(--accent)"
            fw={850}
            style={{ textTransform: "uppercase" }}
          >
            Skip guide
          </Button>
        </Group>
        <Title order={3} size="1rem" fw={600} lh={1.25}>
          {visibleStep.title}
        </Title>
        <Text size="xs" c="var(--text-2)" lh={1.45}>
          {visibleStep.body}
        </Text>
        <Text fw={800} size="xs" c="var(--text-3)" tt="uppercase" style={{ marginTop: "var(--space-3)" }}>
          Use the highlighted control to continue.
        </Text>
      </Paper>
    </>
  );

  function advanceGuide() {
    setStepIndex((currentIndex) => {
      const nextIndex = currentIndex + 1;
      if (nextIndex >= guideSteps.length) {
        finishGuide();
        return currentIndex;
      }

      window.localStorage.setItem(guideStepStorageKey, String(nextIndex));
      return nextIndex;
    });
  }

  function finishGuide() {
    window.localStorage.setItem(guideStorageKey, "completed");
    window.localStorage.removeItem(guideStepStorageKey);
    setIsVisible(false);
  }
}
