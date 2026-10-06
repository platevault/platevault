// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import '../src/styles/reset.css';
import '../src/styles/tokens.css';
import '../src/styles/components.css';

import type { Decorator, Preview } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { LocaleProvider } from '../src/data/locale';
import { LogPanelProvider } from '../src/app/LogPanelContext';
import { OperationStatusProvider } from '../src/app/OperationStatusContext';
import { PageStatusProvider } from '../src/app/PageStatusContext';
import { ToastContainer } from '../src/ui/ToastContainer';
import { applyDensity, THEMES, type ThemeId } from '../src/data/theme';

/** Appearance choices a reviewer can flip from the toolbar, per story. */
const THEME_OPTIONS = THEMES.map((t) => ({ value: t.id, title: t.label }));

const withAppearance: Decorator = (Story, context) => {
  const theme = context.globals['theme'] as ThemeId;
  const density = context.globals['density'] as string;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    applyDensity(density);
    document.documentElement.style.setProperty('color-scheme', theme.includes('dark') || theme === 'observatory-cool' ? 'dark' : 'light');
  }, [theme, density]);

  return <Story />;
};

/**
 * Every story gets its own record cache, so a story that changes a record
 * (confirming an item, accepting a match) cannot leak that change into the
 * next story a reviewer opens.
 */
const withProviders: Decorator = (Story) => {
  const client = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
          mutations: { retry: false },
        },
      }),
    [],
  );

  return (
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <OperationStatusProvider>
          <LogPanelProvider>
            <PageStatusProvider>
              <Story />
              <ToastContainer />
            </PageStatusProvider>
          </LogPanelProvider>
        </OperationStatusProvider>
      </LocaleProvider>
    </QueryClientProvider>
  );
};

const preview: Preview = {
  decorators: [withProviders, withAppearance],
  initialGlobals: {
    theme: 'warm-slate' satisfies ThemeId,
    density: 'comfortable',
  },
  globalTypes: {
    theme: {
      description: 'Appearance',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: THEME_OPTIONS,
        dynamicTitle: true,
      },
    },
    density: {
      description: 'Row density',
      toolbar: {
        title: 'Density',
        icon: 'component',
        items: [
          { value: 'compact', title: 'Compact · 24px rows' },
          { value: 'comfortable', title: 'Comfortable · 32px rows' },
          { value: 'spacious', title: 'Spacious · 40px rows' },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'todo' },
    controls: { expanded: true },
    options: {
      storySort: {
        order: [
          'Primitives',
          'Patterns',
          'Surfaces',
          'Workflows',
        ],
      },
    },
  },
};

export default preview;
