// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createRootMock,
  renderMock,
  routerSubscribeMock,
  themesAtCreateRoot,
  themesAtRender,
} = vi.hoisted(() => {
  const themesAtCreateRoot: Array<string | null> = [];
  const themesAtRender: Array<string | null> = [];
  const renderMock = vi.fn(() => {
    themesAtRender.push(document.documentElement.getAttribute('data-theme'));
  });
  const createRootMock = vi.fn(() => {
    themesAtCreateRoot.push(
      document.documentElement.getAttribute('data-theme'),
    );
    return { render: renderMock };
  });

  return {
    createRootMock,
    renderMock,
    routerSubscribeMock: vi.fn(() => vi.fn()),
    themesAtCreateRoot,
    themesAtRender,
  };
});

vi.mock('react-dom/client', () => ({ createRoot: createRootMock }));
vi.mock('@tanstack/react-router', () => ({ RouterProvider: () => null }));
vi.mock('@tanstack/react-query', () => ({
  QueryClientProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }));
vi.mock('./app/router', () => ({
  router: { subscribe: routerSubscribeMock },
}));
vi.mock('./app/AppErrorBoundary', () => ({
  AppErrorBoundary: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./data/queryClient', () => ({ queryClient: {} }));
vi.mock('./data/locale', () => ({
  registerLocaleStrategy: vi.fn(),
  LocaleProvider: ({ children }: { children: ReactNode }) => children,
}));

describe('desktop startup theme ordering', () => {
  beforeEach(() => {
    vi.resetModules();
    createRootMock.mockClear();
    renderMock.mockClear();
    routerSubscribeMock.mockClear();
    themesAtCreateRoot.length = 0;
    themesAtRender.length = 0;
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.body.innerHTML = '<div id="root"></div>';
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.body.innerHTML = '';
  });

  it('sets the document theme before createRoot and render', async () => {
    await import('./main');

    expect(createRootMock).toHaveBeenCalledOnce();
    expect(renderMock).toHaveBeenCalledOnce();
    expect(themesAtCreateRoot).toEqual(['observatory-cool']);
    expect(themesAtRender).toEqual(['observatory-cool']);
  });
});
