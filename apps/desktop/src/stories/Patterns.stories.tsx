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
import { m } from '@/lib/i18n';
import { Frame, Matrix, Stack } from '@/stories/StoryFrame';
import { Btn, EmptyState, KV, Lock, Pill, Table } from '@/ui';

const meta = {
  // eslint-disable-next-line alm/no-user-string -- Storybook meta title is the story ID path; the CSF indexer requires a static literal
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

/** Filter bands are optical filter designations, the same in every locale. */
const FILTER_BANDS = ['Ha', 'OIII', 'SII', 'L'] as const;

/**
 * Sample library records: equipment models, file names and sizes are data,
 * not prose, so they stay as written in every locale.
 */
const SAMPLE = {
  opticalTrain: 'FSQ-106 + ASI2600MM',
  calibration: 'masterDark_300s_-10C · masterFlat_Ha',
  intermediate: 'NGC7000_HOO_integration_tmp.xisf',
  darkMaster: 'masterDark_300s_-10C.xisf',
  removedSize: '104.0 MB',
} as const;

function ledgerColumns() {
  return [
    { key: 'night', label: m.sessions_col_night() },
    { key: 'target', label: m.projects_dim_target() },
    { key: 'filter', label: m.common_filter() },
    {
      key: 'frames',
      label: m.session_mat_col_frames(),
      className: 'pv-cell--num',
    },
    { key: 'state', label: m.sessions_col_state() },
  ];
}

function ledgerRows() {
  return [
    {
      id: 'ha',
      night: '2026-04-12',
      target: 'NGC 7000',
      filter: 'Ha',
      frames: 41,
      state: <StatusTag variant="ok">{m.story_status_confirmed()}</StatusTag>,
    },
    {
      id: 'oiii',
      night: '2026-04-12',
      target: 'NGC 7000',
      filter: 'OIII',
      frames: 38,
      state: <StatusTag variant="ok">{m.story_status_confirmed()}</StatusTag>,
    },
    {
      id: 'sii',
      night: '2026-03-28',
      target: 'IC 1396',
      filter: 'SII',
      frames: 24,
      state: (
        <StatusTag variant="warn">{m.inbox_state_needs_review()}</StatusTag>
      ),
    },
    {
      id: 'lum',
      night: '2025-11-19',
      target: 'M31',
      filter: 'L',
      frames: 60,
      state: (
        <StatusTag variant="warn">
          {m.story_status_source_unavailable()}
        </StatusTag>
      ),
    },
  ];
}

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

  const rows = ledgerRows();
  const shown = rows.filter(
    (r) =>
      (filter === '' || r.filter === filter) &&
      (search === '' ||
        r.target.toLowerCase().includes(search.toLowerCase().trim())),
  );
  const chosen = shown.find((r) => r.id === selected);

  const columns = ledgerColumns().map((c) =>
    c.key === 'night'
      ? {
          ...c,
          ariaSort: ariaSortFor(true, sortDir),
          label: (
            <SortHeader
              label={m.sessions_col_night()}
              active
              dir={sortDir}
              ariaLabel={m.story_sort_by_night()}
              onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
            />
          ),
        }
      : c,
  );

  return (
    <ListPageLayout
      detailPlacement={placement}
      detailLabel={m.list_page_layout_bottom_detail_label()}
      dockId="patterns.ledger"
      topBarProps={{
        title: <h1>{m.common_sessions()}</h1>,
        summary: m.story_shown_count({
          shown: shown.length,
          total: rows.length,
        }),
        filters: (
          <FilterToolbar
            search={{
              value: search,
              onChange: setSearch,
              placeholder: m.sessions_search_aria(),
              ariaLabel: m.sessions_search_aria(),
            }}
            fields={[
              {
                key: 'filter',
                label: m.common_filter(),
                value: filter,
                onChange: setFilter,
                allLabel: m.story_all_filters(),
                options: FILTER_BANDS.map((band) => ({
                  value: band,
                  label: band,
                })),
              },
            ]}
          />
        ),
        actions: <Btn variant="primary">{m.story_action_start_project()}</Btn>,
      }}
      detail={
        chosen ? (
          <DetailPanel
            variant="sessions"
            title={`${chosen.target} · ${chosen.filter}`}
            titleExtra={chosen.state}
            subtitle={m.story_detail_subtitle({
              frames: chosen.frames,
              night: chosen.night,
            })}
            actions={
              <>
                <Btn size="sm">{m.reveal_label_linux()}</Btn>
                <Btn size="sm" variant="ghost">
                  {m.story_action_add_note()}
                </Btn>
              </>
            }
          >
            <Stack>
              <MetricLine
                metrics={[
                  {
                    value: chosen.frames,
                    label: m.sessions_calendar_frames_suffix(),
                  },
                  { value: '3.4 h', label: m.projects_metric_integration() },
                  { value: '−10 °C', label: m.story_metric_sensor() },
                  { value: '1', label: m.story_metric_linked_project() },
                ]}
              />
              <FactsKV
                label={m.story_label_optical_train()}
                value={SAMPLE.opticalTrain}
                provenance={m.story_provenance_file_header()}
              />
              <FactsKV
                label={m.story_label_observer_site()}
                value={renderValue(null, { applicability: 'applicable' })}
                provenance={m.story_value_never_recorded()}
              />
              <FactsKV
                label={m.sessions_calib_heading()}
                value={SAMPLE.calibration}
                provenance={m.story_provenance_accepted_on({
                  date: '2026-05-02',
                })}
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
      within(
        canvas.getByRole('complementary', {
          name: m.list_page_layout_bottom_detail_label(),
        }),
      );

    const marked = () =>
      canvas
        .getAllByRole('row')
        .filter((r) => r.getAttribute('aria-selected') === 'true');
    const shownCount = (shown: number) =>
      m.story_shown_count({ shown, total: 4 });

    await expect(canvas.getByText(shownCount(4))).toBeVisible();
    await expect(marked()).toHaveLength(1);
    await expect(detail().getByText('NGC 7000 · Ha')).toBeVisible();

    const search = canvas.getByRole('searchbox', {
      name: m.sessions_search_aria(),
    });
    await userEvent.type(search, 'NGC');
    await expect(canvas.getByText(shownCount(2))).toBeVisible();
    // The selection survives the narrowing: the row stays marked in the list
    // and its detail stays open beside it.
    await expect(marked()).toHaveLength(1);
    await expect(detail().getByText('NGC 7000 · Ha')).toBeVisible();

    await userEvent.clear(search);
    await expect(canvas.getByText(shownCount(4))).toBeVisible();
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
    const night = m.sessions_col_night().toLocaleLowerCase();
    const header = canvas.getByRole('columnheader', {
      name: (name) => name.toLocaleLowerCase().includes(night),
    });
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    await userEvent.click(
      canvas.getByRole('button', { name: m.story_sort_by_night() }),
    );
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
    <Frame note={m.story_frame_surface_states_note()}>
      <Stack>
        <TableStateGate
          loading
          isEmpty={false}
          skeletonLabel={m.story_skeleton_reading_ledger()}
          empty={<EmptyState title={m.story_empty_no_sessions()} />}
        >
          <Table columns={ledgerColumns()} rows={ledgerRows()} />
        </TableStateGate>

        <TableStateGate
          loading={false}
          isEmpty
          empty={
            <EmptyState
              title={m.story_empty_no_sessions_yet()}
              description={m.story_empty_no_sessions_yet_desc()}
              action={<Btn>{m.story_action_open_inbox()}</Btn>}
            />
          }
        >
          <Table columns={ledgerColumns()} rows={ledgerRows()} />
        </TableStateGate>

        <TableStateGate
          loading={false}
          isEmpty
          isFilteredEmpty
          empty={<EmptyState title={m.story_empty_no_sessions_yet()} />}
          filteredEmpty={
            <EmptyState
              title={m.story_empty_filtered_title()}
              description={m.story_empty_filtered_desc_four()}
              action={<Btn variant="ghost">{m.common_clear_filters()}</Btn>}
            />
          }
        >
          <Table columns={ledgerColumns()} rows={ledgerRows()} />
        </TableStateGate>

        <TableStateGate
          loading={false}
          isEmpty
          error={m.story_empty_drive_detached_title()}
          empty={<EmptyState title={m.story_empty_no_sessions_yet()} />}
          errorEmpty={
            <EmptyState
              title={m.story_empty_drive_detached_title()}
              description={m.story_empty_drive_detached_desc_four()}
              action={<Btn>{m.settings_advanced_updates_check_retry()}</Btn>}
            />
          }
        >
          <Table columns={ledgerColumns()} rows={ledgerRows()} />
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
          [
            m.story_lifecycle_row_setup_incomplete(),
            <Lifecycle key="l" state="setup_incomplete" />,
          ],
          [m.story_lifecycle_row_ready(), <Lifecycle key="l" state="ready" />],
          [
            m.story_lifecycle_row_prepared(),
            <Lifecycle key="l" state="prepared" />,
          ],
          [
            m.story_lifecycle_row_processing(),
            <Lifecycle key="l" state="processing" />,
          ],
          [
            m.story_lifecycle_row_completed(),
            <Lifecycle key="l" state="completed" />,
          ],
          [
            m.story_lifecycle_row_archived(),
            <Lifecycle key="l" state="archived" />,
          ],
          [m.lifecycle_state_blocked(), <Lifecycle key="l" state="blocked" />],
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
            m.story_reading_row_from_file(),
            <span key="v">
              {renderValue('−10.1 °C', {
                source: 'fits',
                applicability: 'applicable',
              })}
            </span>,
          ],
          [
            m.story_value_row_inferred(),
            <span key="v">
              {renderValue('NGC 7000', {
                source: 'inferred',
                applicability: 'applicable',
              })}
            </span>,
          ],
          [
            m.story_value_never_recorded(),
            <span key="v">
              {renderValue(null, { applicability: 'applicable' })}
            </span>,
          ],
          [
            m.story_value_row_not_applicable(),
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
        label={m.story_label_reclaimable()}
        value={m.story_reclaimable_value({ size: '180.0 MB' })}
        provenance={m.settings_datasources_scanned({ date: '2026-05-20' })}
      />
      <Table
        columns={[
          { key: 'item', label: m.plans_review_col_item() },
          {
            key: 'size',
            label: m.projects_cleanup_col_size(),
            className: 'pv-cell--num',
          },
          { key: 'why', label: m.story_col_why() },
        ]}
        rows={[
          {
            item: SAMPLE.intermediate,
            size: SAMPLE.removedSize,
            why: <Pill variant="warn">{m.story_status_intermediate()}</Pill>,
          },
          {
            item: SAMPLE.darkMaster,
            size: '62.0 MB',
            why: (
              <span>
                <Lock reason={m.story_lock_masters_never_cleanup()} />{' '}
                {m.settings_cleanup_protection_protected()}
              </span>
            ),
          },
        ]}
      />
      {removed ? (
        <Pill variant="ok">
          {m.story_removed_summary({ size: SAMPLE.removedSize })}
        </Pill>
      ) : (
        <Btn variant="destructive" onClick={() => setOpen(true)}>
          {m.archive_delete_permanently_btn()}
        </Btn>
      )}
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        title={m.story_confirm_delete_title()}
        message={m.story_confirm_delete_message({ size: SAMPLE.removedSize })}
        actionLabel={m.archive_delete_permanently_btn()}
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
    <Frame note={m.story_frame_confirm_note()}>
      <DestructiveChoice />
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialogs = within(document.body);
    const deleteName = m.archive_delete_permanently_btn();

    await userEvent.click(canvas.getByRole('button', { name: deleteName }));
    const dialog = await dialogs.findByRole('dialog');
    await expect(dialog).toHaveTextContent(
      m.story_confirm_delete_message({ size: SAMPLE.removedSize }),
    );

    // Backing out changes nothing.
    await userEvent.keyboard('{Escape}');
    await expect(
      canvas.getByRole('button', { name: deleteName }),
    ).toBeVisible();

    // Going through reports exactly what happened.
    await userEvent.click(canvas.getByRole('button', { name: deleteName }));
    const again = await dialogs.findByRole('dialog');
    await userEvent.click(
      within(again).getByRole('button', { name: deleteName }),
    );
    await expect(
      canvas.getByText(m.story_removed_summary({ size: SAMPLE.removedSize })),
    ).toBeVisible();
  },
};
