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
 * 6. (T055) Lifecycle filter is multiselect — selecting multiple states shows matching projects.
 * 7. (T055) Selecting a single state shows only matching projects.
 * 8. (T055) "All" checkbox clears the filter.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  it('renders rich meta: tool, source count, and formatted updated date', () => {
    render(
      <ProjectsList
        projects={mockProjects}
        selectedId={undefined}
        onSelect={vi.fn()}
        lifecycle={[]}
        onLifecycleChange={vi.fn()}
      />,
    );
    // tool segment is present on every row
    expect(screen.getAllByText('PixInsight').length).toBeGreaterThan(0);
    // source count segment (NGC 7000 has 3 sources)
    expect(screen.getByText('3 sources')).toBeInTheDocument();
    // updated date is formatted as "yyyy-MM-dd HH:mm" (local); assert the date part
    expect(screen.getAllByText(/2026-06-1[09] \d{2}:\d{2}/).length).toBeGreaterThan(0);
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

// ── T055: Lifecycle multiselect filter (FR-022 / spec-009 SC-004) ─────────────

const multiProjects: ProjectSummaryDto[] = [
  {
    id: 'p1', name: 'A Processing', tool: 'PixInsight', lifecycle: 'processing',
    path: 'p/a', channelDrift: false, sourceCount: 1,
    createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-10T00:00:00Z',
  },
  {
    id: 'p2', name: 'B Ready', tool: 'PixInsight', lifecycle: 'ready',
    path: 'p/b', channelDrift: false, sourceCount: 0,
    createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-09T00:00:00Z',
  },
  {
    id: 'p3', name: 'C Blocked', tool: 'PixInsight', lifecycle: 'blocked',
    path: 'p/c', channelDrift: false, sourceCount: 0,
    createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-08T00:00:00Z',
  },
  {
    id: 'p4', name: 'D Archived', tool: 'PixInsight', lifecycle: 'archived',
    path: 'p/d', channelDrift: false, sourceCount: 0,
    createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-07T00:00:00Z',
  },
];

describe('T055: ProjectsList lifecycle multiselect filter (FR-022)', () => {
  it('shows all projects when no lifecycle filter is active', () => {
    render(
      <ProjectsList
        projects={multiProjects}
        selectedId={undefined}
        onSelect={vi.fn()}
        lifecycle={[]}
        onLifecycleChange={vi.fn()}
      />,
    );
    expect(screen.getByText('A Processing')).toBeInTheDocument();
    expect(screen.getByText('B Ready')).toBeInTheDocument();
    expect(screen.getByText('C Blocked')).toBeInTheDocument();
    expect(screen.getByText('D Archived')).toBeInTheDocument();
  });

  it('shows only matching projects when a single lifecycle is selected', () => {
    render(
      <ProjectsList
        projects={multiProjects}
        selectedId={undefined}
        onSelect={vi.fn()}
        lifecycle={['ready']}
        onLifecycleChange={vi.fn()}
      />,
    );
    expect(screen.getByText('B Ready')).toBeInTheDocument();
    expect(screen.queryByText('A Processing')).not.toBeInTheDocument();
    expect(screen.queryByText('C Blocked')).not.toBeInTheDocument();
    expect(screen.queryByText('D Archived')).not.toBeInTheDocument();
  });

  it('shows projects matching ANY of the selected lifecycle states (multiselect)', () => {
    render(
      <ProjectsList
        projects={multiProjects}
        selectedId={undefined}
        onSelect={vi.fn()}
        lifecycle={['processing', 'blocked']}
        onLifecycleChange={vi.fn()}
      />,
    );
    expect(screen.getByText('A Processing')).toBeInTheDocument();
    expect(screen.getByText('C Blocked')).toBeInTheDocument();
    expect(screen.queryByText('B Ready')).not.toBeInTheDocument();
    expect(screen.queryByText('D Archived')).not.toBeInTheDocument();
  });

  it('calls onLifecycleChange when a state checkbox is toggled', () => {
    const onLifecycleChange = vi.fn();
    render(
      <ProjectsList
        projects={multiProjects}
        selectedId={undefined}
        onSelect={vi.fn()}
        lifecycle={[]}
        onLifecycleChange={onLifecycleChange}
      />,
    );
    // Open the filter dropdown
    fireEvent.click(screen.getByLabelText('Filter lifecycle'));
    // Check 'Processing'
    const processingCheckbox = screen.getByLabelText('Processing');
    fireEvent.click(processingCheckbox);
    expect(onLifecycleChange).toHaveBeenCalledWith(['processing']);
  });

  it('filter button shows "State: all" when no filter is active', () => {
    render(
      <ProjectsList
        projects={multiProjects}
        selectedId={undefined}
        onSelect={vi.fn()}
        lifecycle={[]}
        onLifecycleChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Filter lifecycle')).toHaveTextContent('State: all');
  });

  it('filter button shows the state name when exactly one state is selected', () => {
    render(
      <ProjectsList
        projects={multiProjects}
        selectedId={undefined}
        onSelect={vi.fn()}
        lifecycle={['archived']}
        onLifecycleChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Filter lifecycle')).toHaveTextContent('State: Archived');
  });

  it('filter button shows count when multiple states are selected', () => {
    render(
      <ProjectsList
        projects={multiProjects}
        selectedId={undefined}
        onSelect={vi.fn()}
        lifecycle={['ready', 'blocked']}
        onLifecycleChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Filter lifecycle')).toHaveTextContent('State: 2 selected');
  });

  // T160: the base-ui Menu migration fixes the prior dropdown's missing
  // click-outside + Escape-to-close behavior. These assert the BEHAVIOR
  // (popup open ⇒ dismissed), not the markup.

  it('closes the filter dropdown when Escape is pressed', async () => {
    render(
      <ProjectsList
        projects={multiProjects}
        selectedId={undefined}
        onSelect={vi.fn()}
        lifecycle={[]}
        onLifecycleChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Filter lifecycle'));
    // Popup is open: a state option is reachable.
    expect(await screen.findByLabelText('Processing')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText('Processing'), { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByLabelText('Processing')).not.toBeInTheDocument();
    });
  });

  it('closes the filter dropdown on an outside pointer press (click-outside)', async () => {
    render(
      <>
        <button type="button">outside</button>
        <ProjectsList
          projects={multiProjects}
          selectedId={undefined}
          onSelect={vi.fn()}
          lifecycle={[]}
          onLifecycleChange={vi.fn()}
        />
      </>,
    );
    fireEvent.click(screen.getByLabelText('Filter lifecycle'));
    expect(await screen.findByLabelText('Processing')).toBeInTheDocument();

    // Press outside the popup — base-ui dismisses on outside pointerdown.
    const outside = screen.getByRole('button', { name: 'outside' });
    fireEvent.pointerDown(outside);
    fireEvent.click(outside);

    await waitFor(() => {
      expect(screen.queryByLabelText('Processing')).not.toBeInTheDocument();
    });
  });
});
