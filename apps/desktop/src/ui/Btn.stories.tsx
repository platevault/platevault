// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Btn } from './Btn';

const meta = {
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
  args: { children: 'Rescan' },
} satisfies Meta<typeof Btn>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Primary: Story = {
  args: { variant: 'primary', children: 'Confirm 3 items' },
};

export const Danger: Story = {
  args: { variant: 'danger', children: 'Discard plan' },
};

export const Destructive: Story = {
  args: { variant: 'destructive', children: 'Delete permanently' },
};

export const Ghost: Story = {
  args: { variant: 'ghost', children: 'Cancel' },
};

export const Disabled: Story = {
  name: 'Unavailable',
  args: {
    variant: 'primary',
    disabled: true,
    children: 'Confirm (needs a filter)',
  },
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Btn size="xs">Extra small</Btn>
      <Btn size="sm">Small</Btn>
      <Btn size="md">Medium</Btn>
    </div>
  ),
};

export const ActivatesFromTheKeyboard: Story = {
  args: { variant: 'primary', children: 'Approve plan', onClick: fn() },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', {
      name: 'Approve plan',
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
    children: 'Confirm (needs a filter)',
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button');
    await expect(button).toBeDisabled();
    await userEvent.click(button, { pointerEventsCheck: 0 });
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};
