// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shared product patterns, in isolation.
 *
 * These are the arrangements every surface in the product is built from: the
 * list beside its contextual detail, the filter row above it, what a surface
 * shows while it is reading or when it has nothing, how a record's lifecycle
 * reads, and how a consequential choice is confirmed. Reviewing them here means
 * a fault is found once rather than on seven surfaces.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import {
  ConfirmModal,
  DetailPanel,
  FactsKV,
  FilterToolbar,
  Lifecycle,
  ListPageLayout,
  MetricLine,
  SortHeader,
  StatusTag,
  TableStateGate,
  ariaSortFor,
  renderValue,
} from '@/components';
import { Frame, Matrix, Stack } from '@/stories/StoryFrame';
import { Btn, EmptyState, KV, Lock, Pill, Table } from '@/ui';

const meta = {
  title: 'Patterns/Product patterns',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The arrangements shared by every surface: list beside detail, the filter row, the reading/empty/unreadable states, lifecycle, and confirmation of a consequential choice.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const LEDGER_COLUMNS = [
  { key: 'night', label: 'Night' },
  { key: 'target', label: 'Target' },
  { key: 'filter', label: 'Filter' },
  { key: 'frames', label: 'Frames', className: 'pv-cell--num' },
  { key: 'state', label: 'State' },
];

const LEDGER_ROWS = [
  {
    id: 'ha',
    night: '2026-04-12',
    target: 'NGC 7000',
    filter: 'Ha',
    frames: 41,
    state: <StatusTag variant="ok">Confirmed</StatusTag>,
  },
  {
    id: 'oiii',
    night: '2026-04-12',
    target: 'NGC 7000',
    filter: 'OIII',
    frames: 38,
    state: <StatusTag variant="ok">Confirmed</StatusTag>,
  },
  {
    id: 'sii',
    night: '2026-03-28',
    target: 'IC 1396',
    filter: 'SII',
    frames: 24,
    state: <StatusTag variant="warn">Needs review</StatusTag>,
  },
  {
    id: 'lum',
    night: '2025-11-19',
    target: 'M31',
    filter: 'L',
    frames: 60,
    state: <StatusTag variant="warn">Source unavailable</StatusTag>,
  },
];

/** The list-beside-detail arrangement every working surface uses. */
function ListWithDetail({
  placement,
}: {
  placement: 'side' | 'bottom' | 'adaptive';
}) {
  const [selected, setSelected] = useState<string | null>('ha');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const shown = LEDGER_ROWS.filter(
    (r) =>
      (filter === '' || r.filter === filter) &&
      (search === '' ||
        r.target.toLowerCase().includes(search.toLowerCase().trim())),
  );
  const chosen = shown.find((r) => r.id === selected);

  const columns = LEDGER_COLUMNS.map((c) =>
    c.key === 'night'
      ? {
          ...c,
          ariaSort: ariaSortFor(true, sortDir),
          label: (
            <SortHeader
              label="Night"
              active
              dir={sortDir}
              ariaLabel="Sort by night"
              onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
            />
          ),
        }
      : c,
  );

  return (
    <ListPageLayout
      detailPlacement={placement}
      detailLabel="Session details"
      dockId="patterns.ledger"
      topBarProps={{
        title: <h1>Sessions</h1>,
        summary: `${shown.length} of ${LEDGER_ROWS.length} shown`,
        filters: (
          <FilterToolbar
            search={{
              value: search,
              onChange: setSearch,
              placeholder: 'Search sessions',
              ariaLabel: 'Search sessions',
            }}
            fields={[
              {
                key: 'filter',
                label: 'Filter',
                value: filter,
                onChange: setFilter,
                allLabel: 'All filters',
                options: [
                  { value: 'Ha', label: 'Ha' },
                  { value: 'OIII', label: 'OIII' },
                  { value: 'SII', label: 'SII' },
                  { value: 'L', label: 'L' },
                ],
              },
            ]}
          />
        ),
        actions: <Btn variant="primary">Start a project</Btn>,
      }}
      detail={
        chosen ? (
          <DetailPanel
            variant="sessions"
            title={`${chosen.target} · ${chosen.filter}`}
            titleExtra={chosen.state}
            subtitle={`${chosen.frames} frames captured on ${chosen.night}, 300 s each`}
            actions={
              <>
                <Btn size="sm">Show in file manager</Btn>
                <Btn size="sm" variant="ghost">
                  Add a note
                </Btn>
              </>
            }
          >
            <Stack>
              <MetricLine
                metrics={[
                  { value: chosen.frames, label: 'frames' },
                  { value: '3.4 h', label: 'integration' },
                  { value: '−10 °C', label: 'sensor' },
                  { value: '1', label: 'linked project' },
                ]}
              />
              <FactsKV
                label="Optical train"
                value="FSQ-106 + ASI2600MM"
                provenance="From the file header"
              />
              <FactsKV
                label="Observer site"
                value={renderValue(null, { applicability: 'applicable' })}
                provenance="Never recorded"
              />
              <FactsKV
                label="Calibration"
                value="masterDark_300s_-10C · masterFlat_Ha"
                provenance="Accepted by you on 2026-05-02"
              />
            </Stack>
          </DetailPanel>
        ) : null
      }
      onCloseDetail={() => setSelected(null)}
    >
      <Table
        columns={columns}
        rows={shown.map((r) => ({
          ...r,
          id: undefined,
          _onClick: () => setSelected(r.id),
          _selected: r.id === selected,
          // The chosen row is marked to the eye as well as to assistive
          // software, the way every working surface marks it. Without this the
          // reference arrangement would demonstrate a selection nobody can see.
          _rowClassName:
            r.id === selected ? 'pv-densetable__row--selected' : undefined,
          _testid: `ledger-row-${r.id}`,
        }))}
      />
    </ListPageLayout>
  );
}

export const ListBesideDetail: Story = {
  name: 'A list beside its detail',
  parameters: {
    docs: {
      description: {
        story:
          'The primary list stays the subject. The selected record’s detail appears beside it, with its own scroll, so filtering or sorting never costs the reviewer their place.',
      },
    },
  },
  render: () => <ListWithDetail placement="side" />,
};

export const DetailUnderTheList: Story = {
  name: 'Detail under the list, for narrow windows',
  parameters: {
    docs: {
      description: {
        story:
          'When the window is too narrow for a side panel the detail docks under the list instead of columns being dropped. Nothing is hidden; the arrangement changes.',
      },
    },
  },
  render: () => <ListWithDetail placement="bottom" />,
};

export const FilteringKeepsSelection: Story = {
  name: 'Filtering narrows the list and keeps the selection',
  parameters: {
    docs: {
      description: {
        story:
          'A filter is a view over the same records. The chosen record stays chosen and its detail stays open while the list around it narrows.',
      },
    },
  },
  render: () => <ListWithDetail placement="side" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The detail is a labelled supporting landmark named for what it holds, so
    // it can be reached directly rather than by position beside the list.
    const detail = () =>
      within(canvas.getByRole('complementary', { name: 'Session details' }));

    const marked = () =>
      canvas
        .getAllByRole('row')
        .filter((r) => r.getAttribute('aria-selected') === 'true');

    await expect(canvas.getByText('4 of 4 shown')).toBeVisible();
    await expect(marked()).toHaveLength(1);
    await expect(detail().getByText('NGC 7000 · Ha')).toBeVisible();

    const search = canvas.getByRole('searchbox', { name: 'Search sessions' });
    await userEvent.type(search, 'NGC');
    await expect(canvas.getByText('2 of 4 shown')).toBeVisible();
    // The selection survives the narrowing: the row stays marked in the list
    // and its detail stays open beside it.
    await expect(marked()).toHaveLength(1);
    await expect(detail().getByText('NGC 7000 · Ha')).toBeVisible();

    await userEvent.clear(search);
    await expect(canvas.getByText('4 of 4 shown')).toBeVisible();
    await expect(marked()).toHaveLength(1);
    await expect(detail().getByText('NGC 7000 · Ha')).toBeVisible();
  },
};

export const SortingAnnouncesItself: Story = {
  name: 'Sorting announces its direction',
  parameters: {
    docs: {
      description: {
        story:
          'The sorted column says which way it is sorted, so the order is readable without comparing values by eye.',
      },
    },
  },
  render: () => <ListWithDetail placement="side" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = canvas.getByRole('columnheader', { name: /night/i });
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    await userEvent.click(canvas.getByRole('button', { name: 'Sort by night' }));
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
  },
};

export const SurfaceStates: Story = {
  name: 'Reading, empty, filtered-empty, unreadable',
  parameters: {
    docs: {
      description: {
        story:
          'The four states a surface can be in before it can show records. Each says something different, and each offers the step that resolves it.',
      },
    },
  },
  render: () => (
    <Frame note="These are the same four states on every working surface, so a reviewer learns them once.">
      <Stack>
        <TableStateGate
          loading
          isEmpty={false}
          skeletonLabel="Reading the acquisition ledger"
          empty={<EmptyState title="No sessions" />}
        >
          <Table columns={LEDGER_COLUMNS} rows={LEDGER_ROWS} />
        </TableStateGate>

        <TableStateGate
          loading={false}
          isEmpty
          empty={
            <EmptyState
              title="No sessions yet"
              description="Confirm folders in the Inbox and the nights they belong to appear here."
              action={<Btn>Open the Inbox</Btn>}
            />
          }
        >
          <Table columns={LEDGER_COLUMNS} rows={LEDGER_ROWS} />
        </TableStateGate>

        <TableStateGate
          loading={false}
          isEmpty
          isFilteredEmpty
          empty={<EmptyState title="No sessions yet" />}
          filteredEmpty={
            <EmptyState
              title="No sessions match these filters"
              description="Four sessions are hidden by the frame type and filter choices above."
              action={<Btn variant="ghost">Clear filters</Btn>}
            />
          }
        >
          <Table columns={LEDGER_COLUMNS} rows={LEDGER_ROWS} />
        </TableStateGate>

        <TableStateGate
          loading={false}
          isEmpty
          error="AstroArchive is not attached"
          empty={<EmptyState title="No sessions yet" />}
          errorEmpty={
            <EmptyState
              title="AstroArchive is not attached"
              description="Four sessions live on that drive. They are listed from the last scan and cannot be opened, moved or cleaned up until it is attached."
              action={<Btn>Check again</Btn>}
            />
          }
        >
          <Table columns={LEDGER_COLUMNS} rows={LEDGER_ROWS} />
        </TableStateGate>
      </Stack>
    </Frame>
  ),
};

export const LifecyclePositions: Story = {
  name: 'Where a project stands',
  parameters: {
    docs: {
      description: {
        story:
          'A project’s position is a named state, not a progress bar. Blocked states carry the reason with them rather than reading as a failure.',
      },
    },
  },
  render: () => (
    <Frame>
      <Matrix
        entries={[
          ['Not usable yet', <Lifecycle key="l" state="setup_incomplete" />],
          ['Ready to prepare', <Lifecycle key="l" state="ready" />],
          ['Sources prepared', <Lifecycle key="l" state="prepared" />],
          ['Being worked on', <Lifecycle key="l" state="processing" />],
          ['Finished', <Lifecycle key="l" state="completed" />],
          ['Put away', <Lifecycle key="l" state="archived" />],
          ['Blocked', <Lifecycle key="l" state="blocked" />],
        ]}
      />
    </Frame>
  ),
};

export const ValueOrigins: Story = {
  name: 'Where a value came from',
  parameters: {
    docs: {
      description: {
        story:
          'A field distinguishes measured, inferred, never-recorded and not-applicable. A missing number is never shown as zero.',
      },
    },
  },
  render: () => (
    <Frame>
      <Matrix
        entries={[
          [
            'Read from the file',
            <span key="v">
              {renderValue('−10.1 °C', {
                source: 'fits',
                applicability: 'applicable',
              })}
            </span>,
          ],
          [
            'Worked out',
            <span key="v">
              {renderValue('NGC 7000', {
                source: 'inferred',
                applicability: 'applicable',
              })}
            </span>,
          ],
          [
            'Never recorded',
            <span key="v">
              {renderValue(null, { applicability: 'applicable' })}
            </span>,
          ],
          [
            'Does not apply here',
            <span key="v">
              {renderValue(null, { applicability: 'not_applicable' })}
            </span>,
          ],
        ]}
      />
    </Frame>
  ),
};

/** A consequential choice, held behind an explicit confirmation. */
function DestructiveChoice() {
  const [open, setOpen] = useState(false);
  const [removed, setRemoved] = useState(false);

  return (
    <Stack>
      <KV
        label="Reclaimable"
        value="180.0 MB across 3 intermediate stacks"
        provenance="Scanned 2026-05-20"
      />
      <Table
        columns={[
          { key: 'item', label: 'Item' },
          { key: 'size', label: 'Size', className: 'pv-cell--num' },
          { key: 'why', label: 'Why' },
        ]}
        rows={[
          {
            item: 'NGC7000_HOO_integration_tmp.xisf',
            size: '104.0 MB',
            why: <Pill variant="warn">Intermediate</Pill>,
          },
          {
            item: 'masterDark_300s_-10C.xisf',
            size: '62.0 MB',
            why: (
              <span>
                <Lock reason="Calibration masters are reusable library records and are never offered for cleanup." />{' '}
                Protected
              </span>
            ),
          },
        ]}
      />
      {removed ? (
        <Pill variant="ok">Removed 104.0 MB · 1 item · audited</Pill>
      ) : (
        <Btn variant="destructive" onClick={() => setOpen(true)}>
          Delete permanently
        </Btn>
      )}
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete 1 item permanently?"
        message="104.0 MB will be removed from disk and cannot be recovered. The protected master is not included."
        actionLabel="Delete permanently"
        actionVariant="destructive"
        onConfirm={() => {
          setRemoved(true);
          setOpen(false);
        }}
      />
    </Stack>
  );
}

export const ConfirmingSomethingIrreversible: Story = {
  name: 'Confirming something irreversible',
  parameters: {
    docs: {
      description: {
        story:
          'An irreversible choice states exactly what will happen, in what quantity, and what is excluded from it. Protected material is visibly excluded rather than quietly skipped.',
      },
    },
  },
  render: () => (
    <Frame note="Cancel and Escape both leave everything as it was.">
      <DestructiveChoice />
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialogs = within(document.body);

    await userEvent.click(
      canvas.getByRole('button', { name: 'Delete permanently' }),
    );
    const dialog = await dialogs.findByRole('dialog');
    await expect(dialog).toHaveTextContent(/104\.0 MB/);
    await expect(dialog).toHaveTextContent(/cannot be recovered/);

    // Backing out changes nothing.
    await userEvent.keyboard('{Escape}');
    await expect(
      canvas.getByRole('button', { name: 'Delete permanently' }),
    ).toBeVisible();

    // Going through reports exactly what happened.
    await userEvent.click(
      canvas.getByRole('button', { name: 'Delete permanently' }),
    );
    const again = await dialogs.findByRole('dialog');
    await userEvent.click(
      within(again).getByRole('button', { name: 'Delete permanently' }),
    );
    await expect(
      canvas.getByText('Removed 104.0 MB · 1 item · audited'),
    ).toBeVisible();
  },
};
