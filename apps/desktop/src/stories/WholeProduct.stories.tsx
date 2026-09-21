// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The whole product, driven the way it is used.
 *
 * Each entry is one job carried out end to end on the sample library: moving
 * between parts of the library, narrowing a list, opening a record, reviewing a
 * planned change before it happens, and changing a durable choice. These are the
 * entries to open when the question is whether the product works, not whether a
 * component looks right.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { AppAt } from '@/stories/AppAt';

const meta = {
  title: 'Workflows/The whole product',
  component: AppAt,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'One job per entry, carried out on the sample library from the destination it starts at.',
      },
    },
  },
  args: { at: '/inbox' },
} satisfies Meta<typeof AppAt>;

export default meta;
type Story = StoryObj<typeof meta>;

const SETTLE = { timeout: 20_000 };
/**
 * Waits until the product has finished reading the library, and hands back the
 * library's own navigation. It is named, so a surface that carries a second
 * navigation of its own is still recognised.
 */
async function ready(root: HTMLElement): Promise<HTMLElement> {
  return waitFor(
    () =>
      within(root).getByRole('navigation', {
        name: 'Main navigation',
      }),
    SETTLE,
  );
}

/** Rows a reviewer can actually choose, once the list has arrived. */
async function selectableRows(scope: HTMLElement): Promise<HTMLElement[]> {
  return waitFor(() => {
    const rows = within(scope)
      .getAllByRole('row')
      .filter((r) => r.getAttribute('tabindex') === '0');
    if (rows.length === 0) throw new Error('the list has no rows yet');
    return rows;
  }, SETTLE);
}

export const Navigating: Story = {
  name: 'Moving through the library',
  parameters: {
    docs: {
      description: {
        story:
          'Every part of the library is one move away, and each destination reports how much is in it before it is opened. The place a reviewer is in is always marked.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const navRoot = await ready(canvasElement);
    const nav = within(navRoot);

    await expect(nav.getByRole('link', { name: 'Inbox' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    for (const name of ['Sessions', 'Calibration', 'Targets', 'Projects']) {
      await userEvent.click(nav.getByRole('link', { name }));
      await waitFor(async () => {
        await expect(nav.getByRole('link', { name })).toHaveAttribute(
          'aria-current',
          'page',
        );
      }, SETTLE);
      // The destination actually produced records, not an empty frame.
      await selectableRows(canvasElement);
    }
  },
};

export const NarrowingAList: Story = {
  name: 'Narrowing a long list',
  args: { at: '/sessions' },
  parameters: {
    docs: {
      description: {
        story:
          'Searching narrows the acquisition ledger in place. Clearing the search restores every row, so a filter can never lose a record.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    const canvas = within(canvasElement);
    const before = (await selectableRows(canvasElement)).length;

    const search = canvas.getByRole('searchbox');
    await userEvent.type(search, 'NGC 7000');
    await waitFor(async () => {
      const now = (await selectableRows(canvasElement)).length;
      await expect(now).toBeLessThan(before);
    }, SETTLE);

    // Being in the box has to look different from not being in it. Recolouring
    // the 1px border was the whole indicator here, which is why this asserts a
    // ring rather than merely "some style changed": typing put the caret in the
    // box, so it is focused now and unfocused a moment later.
    await expect(document.activeElement).toBe(search);
    const focused = getComputedStyle(search).boxShadow;
    search.blur();
    await waitFor(async () => {
      await expect(document.activeElement).not.toBe(search);
    }, SETTLE);
    await expect(getComputedStyle(search).boxShadow).toBe('none');
    await expect(focused).not.toBe('none');

    await userEvent.clear(search);
    await waitFor(async () => {
      const now = (await selectableRows(canvasElement)).length;
      await expect(now).toBe(before);
    }, SETTLE);
  },
};

export const OpeningARecord: Story = {
  name: 'Opening a record from the list',
  args: { at: '/calibration' },
  parameters: {
    docs: {
      description: {
        story:
          'Choosing a master opens its provenance and its candidate matches beside the list. The list keeps its place and the chosen row stays marked.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    const canvas = within(canvasElement);
    const rows = await selectableRows(canvasElement);
    const first = rows[0];
    if (!first) throw new Error('the masters list has no rows');

    await userEvent.click(first);
    await waitFor(async () => {
      await expect(first).toHaveAttribute('aria-selected', 'true');
    }, SETTLE);

    // Exactly one record is marked as the chosen one, and it is re-read here
    // rather than reused from before the click: the list redraws around the
    // selection.
    const chosen = await waitFor(() => {
      const marked = canvas
        .getAllByRole('row')
        .filter((r) => r.getAttribute('aria-selected') === 'true');
      const only = marked[0];
      if (marked.length !== 1 || !only) {
        throw new Error(`${marked.length} rows are marked as chosen, not one`);
      }
      return only;
    }, SETTLE);

    // The record's name, without the badges that share its cell. A badge says
    // what kind of record this is and how old it is; the name says which record
    // it is. Every badge is taken off, not just the leading one, so a record
    // carrying an age warning is compared the same way as one that is not.
    const nameCell = within(chosen).getAllByRole('cell')[0];
    if (!nameCell) throw new Error('the chosen row carries no cells');
    const badges = within(nameCell).queryAllByTestId('pill');
    const name = badges
      .reduce(
        (text, badge) => text.replace(badge.textContent ?? '', ''),
        nameCell.textContent ?? '',
      )
      .replace(/\s+/g, ' ')
      .trim();
    if (name === '') throw new Error('the chosen row names no record');

    // The chosen record's own detail appears beside the list, as a labelled
    // supporting landmark, and it names the record the marked row names.
    const detail = await waitFor(
      () => canvas.getByRole('complementary', { name: 'Master details' }),
      SETTLE,
    );
    await expect(detail).toBeVisible();
    await expect(detail.textContent ?? '').toContain(name);
  },
};

export const TheListHoldsItsShapeBesideADetail: Story = {
  name: 'The list holds its shape beside a detail',
  args: { at: '/calibration' },
  parameters: {
    docs: {
      description: {
        story:
          'A reviewer moves the open record’s detail to the right of the list, taking most of the width away from it. The list stays a list: one row height throughout, and every column — including the one it is sorted by — still on screen.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    const canvas = within(canvasElement);
    const rows = await selectableRows(canvasElement);
    const first = rows[0];
    if (!first) throw new Error('the masters list has no rows');

    await userEvent.click(first);
    await waitFor(async () => {
      await expect(
        canvas.getByRole('complementary', { name: 'Master details' }),
      ).toBeVisible();
    }, SETTLE);

    // Squeezed through the product's own placement control rather than by
    // resizing the window, so this is the narrowest the list can be asked to
    // get by someone using it.
    await userEvent.click(canvas.getByRole('radio', { name: 'Right' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('radio', { name: 'Right' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    }, SETTLE);

    const scroller = canvas.getByTestId('masters-virtual-sizer');
    await waitFor(async () => {
      // ONE row height for the whole list. The record's name shares its cell
      // with a kind badge and an age badge; when that cell was allowed to wrap,
      // the same eleven records rendered at three different heights and the
      // list stopped being scannable.
      const heights = (await selectableRows(canvasElement)).map((r) =>
        Math.round(r.getBoundingClientRect().height),
      );
      const [reference] = heights;
      for (const height of heights) await expect(height).toBe(reference);
      // And the table never asks for more width than the list has, so nothing
      // is parked off the right edge waiting to be scrolled to.
      await expect(scroller.scrollWidth).toBeLessThanOrEqual(
        scroller.clientWidth,
      );
    }, SETTLE);

    // Every column heading of THE LIST is inside the list, and the one it is
    // ordered by is among them — that is the heading a reviewer needs in order
    // to know what they are reading. Scoped to the list on purpose: the open
    // record's detail carries tables of its own, and their headings say nothing
    // about whether the list fits.
    const edge = scroller.getBoundingClientRect().right;
    const headings = within(canvas.getByTestId('masters-list')).getAllByRole(
      'columnheader',
    );
    await expect(headings.length).toBeGreaterThan(1);
    for (const heading of headings) {
      await expect(heading.getBoundingClientRect().right).toBeLessThanOrEqual(
        edge + 1,
      );
    }
    const orderedBy = headings.find((h) => h.getAttribute('aria-sort'));
    if (!orderedBy) throw new Error('no column reports itself as the sorted one');
    await expect(orderedBy).toBeVisible();

    // Put the placement back, so the next reviewer opens on the automatic rule.
    await userEvent.click(canvas.getByRole('radio', { name: 'Auto' }));
  },
};

export const KeyboardOnly: Story = {
  name: 'Working without a pointer',
  args: { at: '/sessions' },
  parameters: {
    docs: {
      description: {
        story:
          'A row is chosen from the keyboard: move into the list, step through it with the arrow keys, and open the focused record with Enter.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    const rows = await selectableRows(canvasElement);
    if (rows.length < 2) throw new Error('the ledger needs at least two rows');

    // The list is entered at its first row, then stepped through. Rows are
    // re-read after each keystroke: the list redraws around the selection, so a
    // node captured beforehand is no longer the node on screen.
    rows[0]?.focus();
    await expect(document.activeElement).toHaveAttribute('data-row-index', '0');

    // Stepping down scrolls the next row into view before focusing it, so the
    // move lands a frame later rather than on the keystroke itself.
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(async () => {
      await expect(document.activeElement).toHaveAttribute(
        'data-row-index',
        '1',
      );
    }, SETTLE);

    await userEvent.keyboard('{Enter}');
    await waitFor(async () => {
      const chosen = (await selectableRows(canvasElement)).filter(
        (r) => r.getAttribute('aria-selected') === 'true',
      );
      await expect(chosen.length).toBe(1);
      await expect(chosen[0]).toHaveAttribute('data-row-index', '1');
    }, SETTLE);
  },
};

export const FindingAnythingByName: Story = {
  name: 'Finding anything by name',
  args: { at: '/sessions' },
  parameters: {
    docs: {
      description: {
        story:
          'One prompt reaches every part of the library and every target alias, so a reviewer who knows a name never has to remember where it lives.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    const overlay = within(document.body);

    await userEvent.keyboard('{Meta>}k{/Meta}');
    const prompt = await waitFor(() => overlay.getByRole('dialog'), SETTLE);
    await expect(prompt).toBeVisible();

    await userEvent.keyboard('{Escape}');
    await waitFor(async () => {
      await expect(overlay.queryByRole('dialog')).toBeNull();
    }, SETTLE);
  },
};

export const ReviewingAPlannedChange: Story = {
  name: 'Reviewing a change before it happens',
  args: { at: '/inbox' },
  parameters: {
    docs: {
      description: {
        story:
          'Nothing on disk moves without a reviewable plan. The plan lists every source, every destination, every precondition and every protected item, and approval is a separate deliberate step.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    const canvas = within(canvasElement);
    const overlay = within(document.body);

    const review = await waitFor(
      () => canvas.getByRole('button', { name: /review plans/i }),
      SETTLE,
    );
    await userEvent.click(review);

    const plan = await waitFor(() => overlay.getByRole('dialog'), SETTLE);
    await expect(plan).toBeVisible();

    // A plan is a proposal until it is approved, so leaving it changes nothing.
    await userEvent.keyboard('{Escape}');
    await waitFor(async () => {
      await expect(overlay.queryByRole('dialog')).toBeNull();
    }, SETTLE);
    await expect(
      canvas.getByRole('button', { name: /review plans/i }),
    ).toBeVisible();
  },
};

export const ChangingADurableChoice: Story = {
  name: 'Changing a durable choice',
  args: { at: '/settings/general' },
  parameters: {
    docs: {
      description: {
        story:
          'Appearance, row density and font size take effect while they are being chosen and are kept for next time. There is no save step, so a choice cannot be lost by leaving the pane.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    const canvas = within(canvasElement);

    const frame = canvas.getByTestId('frame');
    await expect(frame.className).toMatch(/density-comfortable/);

    const row = await waitFor(
      () => canvas.getByText('Display Density').parentElement,
      SETTLE,
    );
    if (!row) throw new Error('the density choice is not on this pane');
    const choice = within(row).getByRole('combobox');

    await userEvent.selectOptions(choice, 'spacious');

    // Applied to the whole product at once, not only to the pane it was
    // chosen on, and without a save step.
    await waitFor(async () => {
      await expect(canvas.getByTestId('frame').className).toMatch(
        /density-spacious/,
      );
    }, SETTLE);
  },
};

export const AnUnavailableDriveIsStated: Story = {
  name: 'An unavailable drive is stated, not guessed',
  args: { at: '/sessions' },
  parameters: {
    docs: {
      description: {
        story:
          'A registered source that is not attached is named where the library’s health is reported, and its records stay listed from the last scan. The product never implies that anything on it can be moved right now.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const navRoot = await ready(canvasElement);
    const nav = within(navRoot);

    // Named, alongside the count of what is actually reachable.
    await waitFor(async () => {
      await expect(nav.getByText(/AstroArchive/)).toBeVisible();
    }, SETTLE);
    await expect(
      nav.getByRole('link', { name: /roots.*online/i }),
    ).toBeVisible();

    // The unreachable drive's own nights stay listed from the last scan, so
    // nothing disappears from the ledger while a drive is detached.
    await expect(
      (await selectableRows(canvasElement)).length,
    ).toBeGreaterThan(0);
  },
};
