/// <reference types="@testing-library/jest-dom" />
/**
 * ProjectsList tests — spec 008 list from real command response.
 *
 * Tests:
 * 1. Renders project names from a mock ProjectSummaryDto[] response.
 * 2. Shows empty state when no projects.
 * 3. Shows loading state.
 * 4. Calls onSelect with the correct project id on click.
 * 5. Shows drift warning badge when channelDrift is true.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ProjectsList } from './ProjectsList';
import type { ProjectSummaryDto } from '@/bindings/index';

const mockProjects: ProjectSummaryDto[] = [
  {
    id: 'proj-001',
    name: 'NGC 7000 Narrowband',
    tool: 'PixInsight',
    lifecycle: 'processing',
    path: 'projects/NGC7000_NB',
    channelDrift: false,
    sourceCount: 3,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-10T00:00:00Z',
  },
  {
    id: 'proj-002',
    name: 'M31 LRGB',
    tool: 'PixInsight',
    lifecycle: 'ready',
    path: 'projects/M31_LRGB',
    channelDrift: true,
    sourceCount: 2,
    createdAt: '2026-06-02T00:00:00Z',
    updatedAt: '2026-06-09T00:00:00Z',
  },
];

describe('ProjectsList', () => {
  it('renders project names from the list', () => {
    render(
      <ProjectsList
        projects={mockProjects}
        selectedId={undefined}
        onSelect={vi.fn()}
        lifecycle={[]}
        onLifecycleChange={vi.fn()}
      />,
    );
    expect(screen.getByText('NGC 7000 Narrowband')).toBeInTheDocument();
    expect(screen.getByText('M31 LRGB')).toBeInTheDocument();
  });

  it('shows empty state when no projects', () => {
    render(
      <ProjectsList
        projects={[]}
        selectedId={undefined}
        onSelect={vi.fn()}
        lifecycle={[]}
        onLifecycleChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/no projects found/i)).toBeInTheDocument();
  });

  it('shows loading state when loading and no projects', () => {
    render(
      <ProjectsList
        projects={[]}
        selectedId={undefined}
        onSelect={vi.fn()}
        lifecycle={[]}
        onLifecycleChange={vi.fn()}
        loading
      />,
    );
    expect(screen.getByText(/loading projects/i)).toBeInTheDocument();
  });

  it('calls onSelect with the project id on click', () => {
    const onSelect = vi.fn();
    render(
      <ProjectsList
        projects={mockProjects}
        selectedId={undefined}
        onSelect={onSelect}
        lifecycle={[]}
        onLifecycleChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('NGC 7000 Narrowband'));
    expect(onSelect).toHaveBeenCalledWith('proj-001');
  });

  it('shows channel drift warning for projects with drift', () => {
    render(
      <ProjectsList
        projects={mockProjects}
        selectedId={undefined}
        onSelect={vi.fn()}
        lifecycle={[]}
        onLifecycleChange={vi.fn()}
      />,
    );
    // M31 LRGB has channelDrift: true → shows ⚠ channels
    expect(screen.getByTitle('Channel drift detected')).toBeInTheDocument();
  });

  it('marks the selected project with the selected CSS class', () => {
    const { container } = render(
      <ProjectsList
        projects={mockProjects}
        selectedId="proj-001"
        onSelect={vi.fn()}
        lifecycle={[]}
        onLifecycleChange={vi.fn()}
      />,
    );
    // ListItem renders a div with alm-list-item--selected when selected
    const selectedItems = container.querySelectorAll('.alm-list-item--selected');
    expect(selectedItems).toHaveLength(1);
    // The selected item should contain the NGC 7000 name
    expect(selectedItems[0]).toHaveTextContent('NGC 7000 Narrowband');
  });
});
