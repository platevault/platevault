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
import { m } from '@/lib/i18n';
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

/**
 * Sample library records the states are shown against: catalogue
 * designations, filter bands, folder paths and file names. They are data, not
 * prose, so they stay as written in every locale.
 */
const SAMPLE = {
  originalsFolder: '2026-04-12/NGC7000',
  darkMaster: 'masterDark_300s_-10C.xisf',
  finalOutput: 'NGC7000_HOO_final.xisf',
  deepPath:
    '/Volumes/AstroArchive/astro/raw/2026-04-12/NGC7000_North_America_Nebula_Cygnus_Wall_mosaic_panel_03_of_09/Ha_300s_gain100_offset30_-10C/NGC7000_Ha_300s_0041.fits',
  longPath:
    '/astro/raw/2026-03-28/IC1396_Elephant_Trunk_Nebula_reprocessed_after_gradient_correction/SII_600s/IC1396_SII_600s_0012.fits',
} as const;

const meta = {
  // eslint-disable-next-line alm/no-user-string -- Storybook meta title is the story ID path; the CSF indexer requires a static literal
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
    <Frame note={m.story_frame_status_note()}>
      <Matrix
        entries={[
          [
            m.story_status_row_observed(),
            <Pill key="p">{m.story_status_observed()}</Pill>,
          ],
          [
            m.story_status_confirmed(),
            <Pill key="p" variant="ok">
              {m.story_status_confirmed()}
            </Pill>,
          ],
          [
            m.inbox_state_needs_review(),
            <Pill key="p" variant="warn">
              {m.inbox_state_needs_review()}
            </Pill>,
          ],
          [
            m.story_status_row_refused(),
            <Pill key="p" variant="danger">
              {m.story_status_destination_conflict()}
            </Pill>,
          ],
          [
            m.cmp_source_inferred(),
            <Pill key="p" variant="info">
              {m.story_status_inferred_confidence({ confidence: '0.71' })}
            </Pill>,
          ],
          [
            m.story_status_row_planned(),
            <Pill key="p" variant="accent">
              {m.story_status_planned()}
            </Pill>,
          ],
          [
            m.story_status_row_not_applicable(),
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
        <Banner variant="info">{m.story_warning_lookup_off()}</Banner>
        <Banner variant="warn">{m.story_warning_drive_detached()}</Banner>
        <Banner variant="danger">{m.story_warning_plan_stale()}</Banner>
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
    <Frame note={m.story_frame_actions_note()}>
      <Matrix
        entries={[
          [
            m.story_action_row_primary(),
            <Btn key="b" variant="primary">
              {m.story_action_confirm_folders()}
            </Btn>,
          ],
          [
            m.story_action_row_secondary(),
            <Btn key="b">{m.common_rescan()}</Btn>,
          ],
          [
            m.story_action_row_quiet(),
            <Btn key="b" variant="ghost">
              {m.common_cancel()}
            </Btn>,
          ],
          [
            m.story_action_row_reversible(),
            <Btn key="b" variant="danger">
              {m.plans_review_discard_btn()}
            </Btn>,
          ],
          [
            m.story_action_row_irreversible(),
            <Btn key="b" variant="destructive">
              {m.archive_delete_permanently_btn()}
            </Btn>,
          ],
          [
            m.story_action_row_waiting(),
            <Btn key="b" variant="primary" disabled>
              {m.story_action_confirm_needs_frame_type()}
            </Btn>,
          ],
          [
            m.story_action_row_sizes(),
            <Row key="r">
              <Btn size="xs">{m.story_size_xs()}</Btn>
              <Btn size="sm">{m.story_size_sm()}</Btn>
              <Btn size="md">{m.story_size_md()}</Btn>
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
            m.story_reading_row_from_file(),
            <KV
              key="k"
              label={m.projects_dim_target()}
              value="NGC 7000"
              provenance={m.story_provenance_file_header()}
            />,
          ],
          [
            m.story_reading_row_corrected(),
            <KV
              key="k"
              label={m.common_filter()}
              value="Ha"
              provenance={m.story_provenance_corrected_on({
                date: '2026-05-18',
              })}
            />,
          ],
          [
            m.story_reading_row_exact_path(),
            <KV
              key="k"
              label={m.sessions_frame_inventory_col_path()}
              value="/astro/raw/2026-04-12/NGC7000"
              mono
            />,
          ],
          [
            m.story_reading_row_never_measured(),
            <KV
              key="k"
              label={m.story_label_observer_site()}
              value={<Pill variant="ghost">{m.cmp_unresolved_chip()}</Pill>}
            />,
          ],
          [
            m.story_reading_row_coverage_goal(),
            <CoverageBar
              key="c"
              label={m.story_coverage_ha_integration()}
              value={6.5}
              max={12}
            />,
          ],
          [
            m.story_reading_row_coverage_unit(),
            <CoverageBar
              key="c"
              label={m.story_coverage_frames_kept()}
              value={41}
              max={46}
              unit={` ${m.sessions_calendar_frames_suffix()}`}
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
            m.story_protection_row_originals(),
            <Row key="r">
              <Lock reason={m.story_lock_originals()} />
              <span>
                {m.story_protection_originals_sample({
                  folder: SAMPLE.originalsFolder,
                })}
              </span>
            </Row>,
          ],
          [
            m.settings_cleanup_type_master(),
            <Row key="r">
              <Lock reason={m.story_lock_masters()} />
              <span>{SAMPLE.darkMaster}</span>
            </Row>,
          ],
          [
            m.story_protection_row_outputs(),
            <Row key="r">
              <Lock reason={m.story_lock_outputs()} />
              <span>{SAMPLE.finalOutput}</span>
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
        <Skeleton count={5} label={m.story_skeleton_reading_ledger()} />
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
          title={m.story_empty_no_new_folders_title()}
          description={m.story_empty_no_new_folders_desc()}
          action={<Btn>{m.common_rescan()}</Btn>}
        />
        <EmptyState
          title={m.story_empty_filtered_title()}
          description={m.story_empty_filtered_desc_nine()}
          action={<Btn variant="ghost">{m.common_clear_filters()}</Btn>}
        />
        <EmptyState
          title={m.story_empty_drive_detached_title()}
          description={m.story_empty_drive_detached_desc()}
          action={<Btn>{m.settings_advanced_updates_check_retry()}</Btn>}
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
    <Frame note={m.story_frame_dense_note()}>
      <Table
        columns={[
          {
            key: 'night',
            label: m.sessions_col_night(),
            ariaSort: 'descending',
          },
          { key: 'target', label: m.projects_dim_target() },
          { key: 'filter', label: m.common_filter() },
          {
            key: 'frames',
            label: m.session_mat_col_frames(),
            className: 'pv-cell--num',
          },
          { key: 'state', label: m.sessions_col_state() },
        ]}
        rows={[
          {
            night: '2026-04-12',
            target: 'NGC 7000',
            filter: 'Ha',
            frames: 41,
            state: <Pill variant="ok">{m.story_status_confirmed()}</Pill>,
            _onClick: () => undefined,
            _selected: true,
          },
          {
            night: '2026-04-12',
            target: 'NGC 7000',
            filter: 'OIII',
            frames: 38,
            state: <Pill variant="ok">{m.story_status_confirmed()}</Pill>,
            _onClick: () => undefined,
            _selected: false,
          },
          {
            night: '2026-03-28',
            target: 'IC 1396',
            filter: 'SII',
            frames: 24,
            state: <Pill variant="warn">{m.inbox_state_needs_review()}</Pill>,
            _onClick: () => undefined,
            _selected: false,
          },
          {
            night: '2025-11-19',
            target: 'M31',
            filter: 'L',
            frames: 60,
            state: (
              <Pill variant="warn">{m.story_status_source_unavailable()}</Pill>
            ),
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
          { key: 'path', label: m.sessions_frame_inventory_col_path() },
          { key: 'kind', label: m.sessions_frame_inventory_col_type() },
          { key: 'state', label: m.sessions_col_state() },
        ]}
        rows={[
          {
            path: SAMPLE.deepPath,
            kind: m.inbox_kind_light(),
            state: (
              <Pill variant="warn">{m.story_status_source_unavailable()}</Pill>
            ),
          },
          {
            path: SAMPLE.longPath,
            kind: m.inbox_kind_light(),
            state: <Pill variant="ok">{m.story_status_confirmed()}</Pill>,
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
          m.story_choice_row_on(),
          <Toggle
            key="t"
            checked={scanning}
            onChange={setScanning}
            aria-label={m.story_choice_scan_at_startup()}
          >
            {m.story_choice_scan_at_startup()}
          </Toggle>,
        ],
        [
          m.story_choice_row_on_held(),
          <Toggle
            key="t"
            checked={protectOriginals}
            onChange={setProtectOriginals}
            disabled
            aria-label={m.story_choice_protect_originals()}
          >
            {m.story_choice_protect_originals_always()}
          </Toggle>,
        ],
        [
          m.story_choice_row_one_of_few(),
          <SegControl
            key="s"
            options={[
              { value: 'compact', label: m.setup_config_density_compact() },
              {
                value: 'comfortable',
                label: m.setup_config_density_comfortable(),
              },
              { value: 'spacious', label: m.setup_config_density_spacious() },
            ]}
            value={density}
            onChange={setDensity}
            aria-label={m.targets_legacy_row_density_aria()}
          />,
        ],
        [
          m.story_choice_row_one_risky(),
          <SegControl
            key="s"
            options={[
              { value: 'archive', label: m.verb_archive() },
              { value: 'trash', label: m.inbox_action_trash() },
              { value: 'delete', label: m.archive_delete_permanently_btn() },
            ]}
            value={destination}
            onChange={setDestination}
            danger
            dangerValue="delete"
            aria-label={m.story_choice_reclaim_destination()}
          />,
        ],
        [
          m.story_choice_row_one_of_many(),
          <RadioGroup
            key="r"
            options={[
              {
                value: 'flag_missing',
                label: m.story_choice_flag_missing(),
                desc: m.story_choice_flag_missing_desc(),
              },
              {
                value: 'remove',
                label: m.story_choice_remove_missing(),
                desc: m.story_choice_remove_missing_desc(),
              },
            ]}
            value="flag_missing"
            onChange={() => undefined}
          />,
        ],
        [
          m.story_choice_row_measured(),
          <NumberField
            key="n"
            id="story-aging-limit"
            label={m.story_choice_master_age_label()}
            hint={m.story_choice_master_age_hint()}
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
    <Frame note={m.story_frame_choices_note()}>
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
      canvas.getByRole('radiogroup', {
        name: m.targets_legacy_row_density_aria(),
      }),
    );
    const spacious = density.getByRole('radio', {
      name: m.setup_config_density_spacious(),
    });
    await expect(spacious).not.toBeChecked();
    await userEvent.click(spacious);
    await expect(spacious).toBeChecked();
    await expect(
      density.getByRole('radio', {
        name: m.setup_config_density_comfortable(),
      }),
    ).not.toBeChecked();

    const held = canvas.getByRole('checkbox', {
      name: m.story_choice_protect_originals(),
    });
    await expect(held).toBeChecked();
    await expect(held).toBeDisabled();

    const days = canvas.getByLabelText(m.story_choice_master_age_label(), {
      exact: false,
    });
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
          {m.story_action_approve_plan()}
        </Btn>
        <Btn variant="ghost" onClick={fn()}>
          {m.story_action_review_first()}
        </Btn>
        <Btn variant="destructive" disabled onClick={fn()}>
          {m.archive_delete_permanently_btn()}
        </Btn>
      </Row>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const approve = canvas.getByRole('button', {
      name: m.story_action_approve_plan(),
    });
    const review = canvas.getByRole('button', {
      name: m.story_action_review_first(),
    });
    const remove = canvas.getByRole('button', {
      name: m.archive_delete_permanently_btn(),
    });

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
