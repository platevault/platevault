// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { AppAt } from '@/stories/AppAt';

/**
 * Every complete working surface, opened on the sample library.
 *
 * A surface here is the whole thing a reviewer sees at that destination:
 * navigation, the primary list, the filters above it, the contextual detail
 * beside it and the status footer under it. The scripted walkthrough on each
 * one proves the surface is live rather than a picture of one.
 */
const meta = {
  title: 'Surfaces/Working surfaces',
  component: AppAt,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The product at each destination, populated with the sample library. Each surface opens where its workflow starts.',
      },
    },
  },
} satisfies Meta<typeof AppAt>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Waits for the surface to finish reading the library, then hands it back.
 *
 * The library's own navigation is named, so a surface that carries a second
 * one of its own — Settings has a pane list — is still recognised as settled.
 */
async function surface(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(
    () =>
      expect(
        canvas.getByRole('navigation', { name: 'Main navigation' }),
      ).toBeVisible(),
    { timeout: 20_000 },
  );
  return canvas;
}

/**
 * The whole window, for the surfaces the product layers over everything else:
 * orientation, dialogs, plan review, toasts.
 */
function overlay() {
  return within(document.body);
}

export const Inbox: Story = {
  name: 'Inbox — reconcile what arrived',
  args: { at: '/inbox' },
  parameters: {
    docs: {
      description: {
        story:
          'New folders as they were found on disk, each one independently actionable. Classification, mandatory metadata and destination are settled here, before anything moves.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = await surface(canvasElement);
    // A populated inbox: the primary list is a table of real rows.
    await waitFor(
      async () => {
        const rows = canvas.getAllByRole('row');
        await expect(rows.length).toBeGreaterThan(1);
      },
      { timeout: 15_000 },
    );
  },
};

export const Sessions: Story = {
  name: 'Sessions — the acquisition ledger',
  args: { at: '/sessions' },
  parameters: {
    docs: {
      description: {
        story:
          'Confirmed acquisition groupings and the frames under them. Selecting a night opens its provenance, equipment, per-frame inventory and linked projects beside the list.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = await surface(canvasElement);
    await waitFor(
      async () => {
        await expect(canvas.getAllByRole('row').length).toBeGreaterThan(1);
      },
      { timeout: 15_000 },
    );
  },
};

export const Calibration: Story = {
  name: 'Calibration — masters and reuse',
  args: { at: '/calibration' },
  parameters: {
    docs: {
      description: {
        story:
          'Calibration is a first-class part of the library, not a detail of one project. Masters carry their own provenance, and a candidate match states why it fits or why it is refused.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = await surface(canvasElement);
    await waitFor(
      async () => {
        await expect(canvas.getAllByRole('row').length).toBeGreaterThan(1);
      },
      { timeout: 15_000 },
    );
  },
};

export const Targets: Story = {
  name: 'Targets — identity and tonight',
  args: { at: '/targets' },
  parameters: {
    docs: {
      description: {
        story:
          'The targets a user owns, searchable by designation, common name or alias. Coverage, linked nights and tonight’s observing guidance hang off the canonical record.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = await surface(canvasElement);
    await waitFor(
      async () => {
        await expect(canvas.getAllByRole('row').length).toBeGreaterThan(1);
      },
      { timeout: 15_000 },
    );
  },
};

export const Projects: Story = {
  name: 'Projects — processing envelopes',
  args: { at: '/projects' },
  parameters: {
    docs: {
      description: {
        story:
          'A project draws on confirmed sessions and calibration without owning them. Lifecycle, source maps, observed artifacts and cleanup policy all read from one place.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = await surface(canvasElement);
    await waitFor(
      async () => {
        await expect(canvas.getAllByRole('row').length).toBeGreaterThan(1);
      },
      { timeout: 15_000 },
    );
  },
};

export const Archive: Story = {
  name: 'Archive — completed work',
  args: { at: '/archive' },
  parameters: {
    docs: {
      description: {
        story:
          'Work that has been put away, with the route back. Restoring is a reviewed operation like any other; permanent removal is disabled until it is deliberately enabled.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = await surface(canvasElement);
    await waitFor(
      async () => {
        await expect(canvas.getAllByRole('row').length).toBeGreaterThan(1);
      },
      { timeout: 15_000 },
    );
  },
};

export const Settings: Story = {
  name: 'Settings — durable choices',
  args: { at: '/settings' },
  parameters: {
    docs: {
      description: {
        story:
          'Sources, equipment, naming, thresholds, appearance and the audit query. Every pane saves as it is edited; there is no separate save step to forget.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = await surface(canvasElement);
    // Settings groups the durable choices into panes and lists them. The pane
    // on screen is the marked one; choosing another opens it in place, with no
    // separate save step in between. The destination is named by the library's
    // own navigation rather than by a heading over the pane (task #80), so the
    // pane list is what proves this surface arrived.
    const panes = await waitFor(
      () => {
        const items = within(
          canvas.getByRole('navigation', { name: 'Settings categories' }),
        ).getAllByRole('button');
        if (items.length < 2) {
          throw new Error('settings lists fewer than two panes');
        }
        return items;
      },
      { timeout: 15_000 },
    );

    const open = panes.find((p) => p.getAttribute('aria-current') === 'page');
    if (!open) throw new Error('no settings pane is marked as the open one');
    const next = panes.find((p) => p.getAttribute('aria-current') !== 'page');
    if (!next) throw new Error('every settings pane is marked as open');
    const openName = (open.textContent ?? '').trim();
    const nextName = (next.textContent ?? '').trim();
    const before = canvas.getByTestId('SettingsPage').textContent ?? '';

    await userEvent.click(next);
    await waitFor(
      async () => {
        const items = within(
          canvas.getByRole('navigation', { name: 'Settings categories' }),
        );
        await expect(
          items.getByRole('button', { name: nextName }),
        ).toHaveAttribute('aria-current', 'page');
        // Exactly one pane is open, so the previous mark is released.
        await expect(
          items.getByRole('button', { name: openName }),
        ).not.toHaveAttribute('aria-current', 'page');
        // And the chosen pane is the one on screen, not just the marked one.
        await expect(
          canvas.getByTestId('SettingsPage').textContent ?? '',
        ).not.toBe(before);
      },
      { timeout: 15_000 },
    );

    // Every pane is opened in turn and every control on it is required to say
    // what it is. A switch is the one that quietly goes unnamed: the state sits
    // on a transparent checkbox behind the drawn track, so the row label beside
    // it names nothing, and four switches across two panes were reachable but
    // anonymous.
    //
    // Each pane is looked up by NAME on every pass, never reused from the list
    // captured above: opening a pane redraws the pane list, and clicking a
    // detached button silently does nothing — which would have made every pass
    // after the first read the same pane and assert nothing at all.
    const paneNames = panes.map((p) => (p.textContent ?? '').trim());
    for (const paneName of paneNames) {
      const list = within(
        canvas.getByRole('navigation', { name: 'Settings categories' }),
      );
      await userEvent.click(list.getByRole('button', { name: paneName }));
      const open = await waitFor(
        () => {
          const marked = list.getByRole('button', { name: paneName });
          if (marked.getAttribute('aria-current') !== 'page') {
            throw new Error(`${paneName} did not open`);
          }
          const shown = canvas.getByTestId('SettingsPage');
          if ((shown.textContent ?? '').trim() === '') {
            throw new Error(`${paneName} rendered nothing`);
          }
          return shown;
        },
        { timeout: 15_000 },
      );

      const controls = within(open);
      for (const role of [
        'checkbox',
        'combobox',
        'textbox',
        'radio',
      ] as const) {
        for (const control of controls.queryAllByRole(role)) {
          await expect(
            control,
            `${paneName}: a ${role} carries no accessible name`,
          ).toHaveAccessibleName();
        }
      }
    }
  },
};

export const FirstRun: Story = {
  name: 'First run — register a library',
  args: { at: '/setup' },
  parameters: {
    docs: {
      description: {
        story:
          'The one sequence that runs before there is a library: language, appearance, where the files live, which processing tools exist, and where observing happens. It reports what the scan found rather than what it hopes to find.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(
      async () => {
        await expect(
          canvas.getByRole('heading', { level: 1 }),
        ).toBeInTheDocument();
      },
      { timeout: 15_000 },
    );
  },
};

export const FirstTimeOrientation: Story = {
  name: 'First time here — orientation over the Inbox',
  args: { at: '/inbox', firstTimeHere: true },
  parameters: {
    docs: {
      description: {
        story:
          'A first-time arrival is oriented once, over the real surface, and can leave at any point. It reports where things are; it never fabricates inventory to make the introduction look complete.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await surface(canvasElement);
    // Orientation is layered over the whole window, above the surface it
    // describes, so it is looked for there rather than inside the surface.
    await waitFor(
      async () => {
        await expect(
          overlay().getByRole('button', { name: /skip/i }),
        ).toBeVisible();
      },
      { timeout: 15_000 },
    );
    await expect(overlay().getByText(/step 1 of 6/i)).toBeVisible();
  },
};

export const SelectingARowOpensItsDetail: Story = {
  name: 'Selecting a night opens its detail',
  args: { at: '/sessions' },
  parameters: {
    docs: {
      description: {
        story:
          'Selection is the surface’s own state: choosing a row reveals that record’s contextual detail without leaving the list or losing the reviewer’s place in it.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = await surface(canvasElement);
    const rows = await waitFor(
      () => {
        const found = canvas
          .getAllByRole('row')
          .filter((r) => r.getAttribute('tabindex') === '0');
        if (found.length === 0) throw new Error('no selectable rows yet');
        return found;
      },
      { timeout: 15_000 },
    );

    const first = rows[0];
    if (!first) throw new Error('no selectable rows yet');
    await userEvent.click(first);

    await waitFor(
      async () => {
        await expect(first).toHaveAttribute('aria-selected', 'true');
      },
      { timeout: 10_000 },
    );
  },
};
