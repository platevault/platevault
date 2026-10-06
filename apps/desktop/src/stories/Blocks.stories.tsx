// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The named states of every building block, side by side.
 *
 * A reviewer reads this product by comparing rows, so the blocks it is built
 * from are presented the same way: one state per line, labelled, all visible at
 * once. Values come from the shared scale, never typed in here.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Frame, Matrix, Row, Stack } from '@/stories/StoryFrame';
import {
  Banner,
  CoverageBar,
  EmptyState,
  KV,
  Lock,
  NumberField,
  Pill,
  RadioGroup,
  SegControl,
  Skeleton,
  Table,
  Toggle,
} from '@/ui';
import { Btn } from '@/ui/Btn';

const meta = {
  title: 'Primitives/States',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Every state each building block can be in. A state that is not here is a state the product cannot show.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Status: Story = {
  name: 'Status marks',
  parameters: {
    docs: {
      description: {
        story:
          'Confidence, review state and refusals are all carried by a status mark with its own words. Colour repeats the meaning; it never carries it alone.',
      },
    },
  },
  render: () => (
    <Frame note="Each mark states its meaning in words, so it survives being read in greyscale or by a screen reader.">
      <Matrix
        entries={[
          ['Observed on disk', <Pill key="p">Observed</Pill>],
          [
            'Confirmed',
            <Pill key="p" variant="ok">
              Confirmed
            </Pill>,
          ],
          [
            'Needs review',
            <Pill key="p" variant="warn">
              Needs review
            </Pill>,
          ],
          [
            'Refused',
            <Pill key="p" variant="danger">
              Destination conflict
            </Pill>,
          ],
          [
            'Inferred',
            <Pill key="p" variant="info">
              Inferred · 0.71
            </Pill>,
          ],
          [
            'Planned, not applied',
            <Pill key="p" variant="accent">
              Planned
            </Pill>,
          ],
          [
            'Not applicable',
            <Pill key="p" variant="ghost">
              —
            </Pill>,
          ],
        ]}
      />
    </Frame>
  ),
};

export const Warnings: Story = {
  name: 'Warnings and refusals',
  parameters: {
    docs: {
      description: {
        story:
          'A warning says what happened, why, and what the reviewer can do next. It never hides an internal fault behind a generic apology.',
      },
    },
  },
  render: () => (
    <Frame>
      <Stack>
        <Banner variant="info">
          Online target lookup is off. Unfamiliar designations stay unresolved
          until you turn it on in Settings → Target Resolution.
        </Banner>
        <Banner variant="warn">
          AstroArchive is not attached. Its 1 root and 4 sessions are listed
          from the last scan and cannot be opened, moved or cleaned up right
          now.
        </Banner>
        <Banner variant="danger">
          This plan was drafted against a source that has since changed. Draft
          it again before approving — nothing has been moved.
        </Banner>
      </Stack>
    </Frame>
  ),
};

export const Actions: Story = {
  name: 'Actions',
  parameters: {
    docs: {
      description: {
        story:
          'One primary action per surface. Danger is for a choice that can be undone; destructive is for one that cannot, and it is never the default.',
      },
    },
  },
  render: () => (
    <Frame note="An unavailable action stays visible and says what it is waiting for, rather than disappearing.">
      <Matrix
        entries={[
          [
            'Primary',
            <Btn key="b" variant="primary">
              Confirm 3 folders
            </Btn>,
          ],
          ['Secondary', <Btn key="b">Rescan</Btn>],
          [
            'Quiet',
            <Btn key="b" variant="ghost">
              Cancel
            </Btn>,
          ],
          [
            'Reversible',
            <Btn key="b" variant="danger">
              Discard plan
            </Btn>,
          ],
          [
            'Irreversible',
            <Btn key="b" variant="destructive">
              Delete permanently
            </Btn>,
          ],
          [
            'Waiting on something',
            <Btn key="b" variant="primary" disabled>
              Confirm (choose a frame type first)
            </Btn>,
          ],
          [
            'Sizes',
            <Row key="r">
              <Btn size="xs">Extra small</Btn>
              <Btn size="sm">Small</Btn>
              <Btn size="md">Medium</Btn>
            </Row>,
          ],
        ]}
      />
    </Frame>
  ),
};

export const Reading: Story = {
  name: 'Reading a record',
  parameters: {
    docs: {
      description: {
        story:
          'A field states where its value came from. A value that was never measured reads as unresolved, not as zero.',
      },
    },
  },
  render: () => (
    <Frame>
      <Matrix
        entries={[
          [
            'Read from the file',
            <KV
              key="k"
              label="Target"
              value="NGC 7000"
              provenance="From the file header"
            />,
          ],
          [
            'Corrected by a reviewer',
            <KV
              key="k"
              label="Filter"
              value="Ha"
              provenance="Corrected 2026-05-18"
            />,
          ],
          [
            'Exact path',
            <KV
              key="k"
              label="Path"
              value="/astro/raw/2026-04-12/NGC7000"
              mono
            />,
          ],
          [
            'Never measured',
            <KV
              key="k"
              label="Observer site"
              value={<Pill variant="ghost">Unresolved</Pill>}
            />,
          ],
          [
            'Coverage against a goal',
            <CoverageBar key="c" label="Ha integration" value={6.5} max={12} />,
          ],
          [
            'Coverage, other unit',
            <CoverageBar
              key="c"
              label="Frames kept"
              value={41}
              max={46}
              unit=" frames"
            />,
          ],
        ]}
      />
    </Frame>
  ),
};

export const Protection: Story = {
  name: 'Protected material',
  parameters: {
    docs: {
      description: {
        story:
          'Protected material is visibly locked and says why. The reason is reachable by keyboard, because the padlock is the only place it is written.',
      },
    },
  },
  render: () => (
    <Frame>
      <Matrix
        entries={[
          [
            'Original captures',
            <Row key="r">
              <Lock reason="Original captures are never cleanup candidates." />
              <span>2026-04-12/NGC7000 · 41 light frames</span>
            </Row>,
          ],
          [
            'Calibration masters',
            <Row key="r">
              <Lock reason="Calibration masters are reusable library records." />
              <span>masterDark_300s_-10C.xisf</span>
            </Row>,
          ],
          [
            'Final outputs',
            <Row key="r">
              <Lock reason="Final outputs are protected until the project is archived." />
              <span>NGC7000_HOO_final.xisf</span>
            </Row>,
          ],
        ]}
      />
    </Frame>
  ),
};

export const Waiting: Story = {
  name: 'Waiting for the library',
  parameters: {
    docs: {
      description: {
        story:
          'A surface that is still reading shows the shape of what is coming, announced to assistive technology rather than left silent.',
      },
    },
  },
  render: () => (
    <Frame>
      <Stack>
        <Skeleton count={5} label="Reading the acquisition ledger" />
        <Skeleton variant="block" count={2} width="26rem" />
      </Stack>
    </Frame>
  ),
};

export const Nothing: Story = {
  name: 'Nothing to show',
  parameters: {
    docs: {
      description: {
        story:
          'An empty surface says which kind of empty it is: nothing here yet, nothing matching, or nothing readable. Each one offers a different next step.',
      },
    },
  },
  render: () => (
    <Frame>
      <Stack>
        <EmptyState
          title="No new folders"
          description="Everything found on your sources has been reconciled. Rescan after your next session."
          action={<Btn>Rescan</Btn>}
        />
        <EmptyState
          title="No sessions match these filters"
          description="Nine sessions are hidden by the frame type and filter choices above."
          action={<Btn variant="ghost">Clear filters</Btn>}
        />
        <EmptyState
          title="AstroArchive is not attached"
          description="Its 4 sessions are listed from the last scan. Attach the drive to open, move or clean up anything on it."
          action={<Btn>Check again</Btn>}
        />
      </Stack>
    </Frame>
  ),
};

export const DenseComparison: Story = {
  name: 'Dense comparison',
  parameters: {
    docs: {
      description: {
        story:
          'The primary way this product is read: stable columns, scannable rows, sort state announced. Selection is a row state, not a colour wash.',
      },
    },
  },
  render: () => (
    <Frame note="Rows are reachable by keyboard: arrow keys move between them, Enter and Space select.">
      <Table
        columns={[
          { key: 'night', label: 'Night', ariaSort: 'descending' },
          { key: 'target', label: 'Target' },
          { key: 'filter', label: 'Filter' },
          { key: 'frames', label: 'Frames', className: 'pv-cell--num' },
          { key: 'state', label: 'State' },
        ]}
        rows={[
          {
            night: '2026-04-12',
            target: 'NGC 7000',
            filter: 'Ha',
            frames: 41,
            state: <Pill variant="ok">Confirmed</Pill>,
            _onClick: () => undefined,
            _selected: true,
          },
          {
            night: '2026-04-12',
            target: 'NGC 7000',
            filter: 'OIII',
            frames: 38,
            state: <Pill variant="ok">Confirmed</Pill>,
            _onClick: () => undefined,
            _selected: false,
          },
          {
            night: '2026-03-28',
            target: 'IC 1396',
            filter: 'SII',
            frames: 24,
            state: <Pill variant="warn">Needs review</Pill>,
            _onClick: () => undefined,
            _selected: false,
          },
          {
            night: '2025-11-19',
            target: 'M31',
            filter: 'L',
            frames: 60,
            state: <Pill variant="warn">Source unavailable</Pill>,
            _onClick: () => undefined,
            _selected: false,
          },
        ]}
      />
    </Frame>
  ),
};

export const LongContent: Story = {
  name: 'Long names and deep paths',
  parameters: {
    docs: {
      description: {
        story:
          'Real libraries hold long designations and deep folder trees. A long value must not push a column off the surface or hide the state beside it.',
      },
    },
  },
  render: () => (
    <Frame>
      <Table
        columns={[
          { key: 'path', label: 'Path' },
          { key: 'kind', label: 'Type' },
          { key: 'state', label: 'State' },
        ]}
        rows={[
          {
            path: '/Volumes/AstroArchive/astro/raw/2026-04-12/NGC7000_North_America_Nebula_Cygnus_Wall_mosaic_panel_03_of_09/Ha_300s_gain100_offset30_-10C/NGC7000_Ha_300s_0041.fits',
            kind: 'Light',
            state: <Pill variant="warn">Source unavailable</Pill>,
          },
          {
            path: '/astro/raw/2026-03-28/IC1396_Elephant_Trunk_Nebula_reprocessed_after_gradient_correction/SII_600s/IC1396_SII_600s_0012.fits',
            kind: 'Light',
            state: <Pill variant="ok">Confirmed</Pill>,
          },
        ]}
      />
    </Frame>
  ),
};

/** A control needs a place to keep its value, or every keystroke is refused. */
function ChoiceBoard() {
  const [scanning, setScanning] = useState(true);
  const [protectOriginals, setProtectOriginals] = useState(true);
  const [density, setDensity] = useState('comfortable');
  const [destination, setDestination] = useState('archive');
  const [threshold, setThreshold] = useState('365');

  return (
    <Matrix
      entries={[
        [
          'On',
          <Toggle
            key="t"
            checked={scanning}
            onChange={setScanning}
            aria-label="Scan sources at startup"
          >
            Scan sources at startup
          </Toggle>,
        ],
        [
          'On, and held',
          <Toggle
            key="t"
            checked={protectOriginals}
            onChange={setProtectOriginals}
            disabled
            aria-label="Protect original captures"
          >
            Protect original captures — always on
          </Toggle>,
        ],
        [
          'One of a few',
          <SegControl
            key="s"
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'spacious', label: 'Spacious' },
            ]}
            value={density}
            onChange={setDensity}
            aria-label="Row density"
          />,
        ],
        [
          'One of a few, one risky',
          <SegControl
            key="s"
            options={[
              { value: 'archive', label: 'Archive' },
              { value: 'trash', label: 'Trash' },
              { value: 'delete', label: 'Delete permanently' },
            ]}
            value={destination}
            onChange={setDestination}
            danger
            dangerValue="delete"
            aria-label="Where reclaimed material goes"
          />,
        ],
        [
          'One of many, explained',
          <RadioGroup
            key="r"
            options={[
              {
                value: 'flag_missing',
                label: 'Flag missing files',
                desc: 'Keep the record and mark the file as missing.',
              },
              {
                value: 'remove',
                label: 'Remove missing files',
                desc: 'Drop the record when the file is gone.',
              },
            ]}
            value="flag_missing"
            onChange={() => undefined}
          />,
        ],
        [
          'A measured value',
          <NumberField
            key="n"
            id="story-aging-limit"
            label="Masters age out after (days)"
            hint="Older masters are offered with a lowered confidence."
            value={threshold}
            onChange={setThreshold}
            min={1}
          />,
        ],
      ]}
    />
  );
}

export const Choices: Story = {
  name: 'Making a choice',
  parameters: {
    docs: {
      description: {
        story:
          'Every choice control keeps what it is given, so a reviewer can actually try it here. A held-open choice explains itself rather than looking broken.',
      },
    },
  },
  render: () => (
    <Frame note="Choices save as they are made. There is no separate save step to forget.">
      <ChoiceBoard />
    </Frame>
  ),
};

export const AChoiceIsKept: Story = {
  name: 'A choice is kept, and a held one is refused',
  parameters: {
    docs: {
      description: {
        story:
          'Proof that a control is live: changing it changes what it reports. Proof that a held-open control is honest: it cannot be changed.',
      },
    },
  },
  render: () => (
    <Frame>
      <ChoiceBoard />
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const density = within(
      canvas.getByRole('radiogroup', { name: 'Row density' }),
    );
    const spacious = density.getByRole('radio', { name: 'Spacious' });
    await expect(spacious).not.toBeChecked();
    await userEvent.click(spacious);
    await expect(spacious).toBeChecked();
    await expect(
      density.getByRole('radio', { name: 'Comfortable' }),
    ).not.toBeChecked();

    const held = canvas.getByRole('checkbox', {
      name: 'Protect original captures',
    });
    await expect(held).toBeChecked();
    await expect(held).toBeDisabled();

    const days = canvas.getByLabelText(/Masters age out after/);
    await userEvent.clear(days);
    await userEvent.type(days, '180');
    await expect(days).toHaveValue(180);
  },
};

export const KeyboardOnly: Story = {
  name: 'Reachable without a pointer',
  parameters: {
    docs: {
      description: {
        story:
          'Every action is reachable by keyboard and shows where focus is. An unavailable action is skipped rather than silently swallowing the key.',
      },
    },
  },
  args: {},
  render: () => (
    <Frame>
      <Row>
        <Btn variant="primary" onClick={fn()}>
          Approve plan
        </Btn>
        <Btn variant="ghost" onClick={fn()}>
          Review first
        </Btn>
        <Btn variant="destructive" disabled onClick={fn()}>
          Delete permanently
        </Btn>
      </Row>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const approve = canvas.getByRole('button', { name: 'Approve plan' });
    const review = canvas.getByRole('button', { name: 'Review first' });
    const remove = canvas.getByRole('button', { name: 'Delete permanently' });

    await userEvent.tab();
    await expect(approve).toHaveFocus();
    await userEvent.tab();
    await expect(review).toHaveFocus();
    // The unavailable action is not a stop, so it can never be triggered by
    // someone tabbing quickly through the row.
    await userEvent.tab();
    await expect(remove).not.toHaveFocus();
  },
};
