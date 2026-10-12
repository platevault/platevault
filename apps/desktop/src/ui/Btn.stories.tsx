// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { m } from '@/lib/i18n';
import { Btn } from './Btn';

const meta = {
  // eslint-disable-next-line alm/no-user-string -- Storybook meta title is the story ID path; the CSF indexer requires a static literal
  title: 'Primitives/Button',
  component: Btn,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The action control. One primary action per surface; danger and destructive are reserved for choices that change or remove data on disk.',
      },
    },
  },
  args: { children: m.common_rescan() },
} satisfies Meta<typeof Btn>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Primary: Story = {
  args: { variant: 'primary', children: m.story_action_confirm_items() },
};

export const Danger: Story = {
  args: { variant: 'danger', children: m.plans_review_discard_btn() },
};

export const Destructive: Story = {
  args: {
    variant: 'destructive',
    children: m.archive_delete_permanently_btn(),
  },
};

export const Ghost: Story = {
  args: { variant: 'ghost', children: m.common_cancel() },
};

export const Disabled: Story = {
  name: 'Unavailable',
  args: {
    variant: 'primary',
    disabled: true,
    children: m.story_action_confirm_needs_filter(),
  },
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Btn size="xs">{m.story_size_xs()}</Btn>
      <Btn size="sm">{m.story_size_sm()}</Btn>
      <Btn size="md">{m.story_size_md()}</Btn>
    </div>
  ),
};

export const ActivatesFromTheKeyboard: Story = {
  args: {
    variant: 'primary',
    children: m.story_action_approve_plan(),
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', {
      name: m.story_action_approve_plan(),
    });
    await userEvent.tab();
    await expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

export const UnavailableActionCannotFire: Story = {
  args: {
    variant: 'primary',
    disabled: true,
    children: m.story_action_confirm_needs_filter(),
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button');
    await expect(button).toBeDisabled();
    await userEvent.click(button, { pointerEventsCheck: 0 });
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};
