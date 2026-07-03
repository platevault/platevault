/**
 * SchemaViewer vitest unit tests (spec 021 T024).
 *
 * Tests:
 * - Renders schema content when devSchemaGet returns found=true.
 * - Renders schema.missing error state when devSchemaGet returns found=false.
 * - Copy button is present when content is loaded.
 * - Loading state while fetch is in progress.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SchemaViewer } from './SchemaViewer';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockDevSchemaGet } = vi.hoisted(() => ({ mockDevSchemaGet: vi.fn() }));

// Adapt the raw payload into the generated `{ status: 'ok', data }` Result the
// real `unwrap` consumes (spec 037); mockResolvedValue/mockRejectedValue sites
// stay unchanged.
vi.mock('@/bindings/index', () => ({
  commands: {
    devSchemaGet: (...a: unknown[]) =>
      Promise.resolve(mockDevSchemaGet(...a)).then((data) => ({ status: 'ok', data })),
  },
}));

const SAMPLE_SCHEMA = JSON.stringify(
  {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'dev.contracts.list',
    type: 'object',
  },
  null,
  2,
);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SchemaViewer (T024)', () => {
  it('renders schema content when found=true', async () => {
    mockDevSchemaGet.mockResolvedValue({ found: true, content: SAMPLE_SCHEMA });

    render(
      <SchemaViewer
        schemaPath="/some/path/schema.json"
        contractVersion="1.0.0"
        contractName="dev.contracts.list"
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('schema-content')).toBeTruthy();
    });
    expect(screen.getByTestId('schema-content').textContent).toContain('dev.contracts.list');
  });

  it('renders schema.missing error state when found=false', async () => {
    mockDevSchemaGet.mockResolvedValue({ found: false });

    render(
      <SchemaViewer
        schemaPath="/missing/schema.json"
        contractVersion="1.0.0"
        contractName="missing.contract"
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('schema-missing')).toBeTruthy();
    });
    expect(screen.getByTestId('schema-missing').textContent).toContain('schema.missing');
  });

  it('renders schema.missing when devSchemaGet rejects', async () => {
    mockDevSchemaGet.mockRejectedValue(new Error('network error'));

    render(
      <SchemaViewer
        schemaPath="/some/path.json"
        contractVersion="1.0.0"
        contractName="failing.contract"
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('schema-missing')).toBeTruthy();
    });
  });

  it('passes schemaPath directly to devSchemaGet', async () => {
    mockDevSchemaGet.mockResolvedValue({ found: true, content: SAMPLE_SCHEMA });

    render(
      <SchemaViewer
        schemaPath="/exact/path/to/schema.json"
        contractVersion="1.0.0"
        contractName="some.contract"
        onClose={() => {}}
      />,
    );

    await waitFor(() => screen.getByTestId('schema-content'));

    expect(mockDevSchemaGet).toHaveBeenCalledWith({ schemaPath: '/exact/path/to/schema.json' });
  });

  it('renders the copy button when content is loaded', async () => {
    mockDevSchemaGet.mockResolvedValue({ found: true, content: SAMPLE_SCHEMA });

    render(
      <SchemaViewer
        schemaPath="/path.json"
        contractVersion="1.0.0"
        contractName="test"
        onClose={() => {}}
      />,
    );

    await waitFor(() => screen.getByTestId('schema-content'));
    expect(screen.getByRole('button', { name: /Copy/i })).toBeTruthy();
  });

  it('renders close button', async () => {
    mockDevSchemaGet.mockResolvedValue({ found: true, content: SAMPLE_SCHEMA });

    render(
      <SchemaViewer
        schemaPath="/path.json"
        contractVersion="1.0.0"
        contractName="test"
        onClose={() => {}}
      />,
    );

    await waitFor(() => screen.getByTestId('schema-content'));
    expect(screen.getByRole('button', { name: /Close/i })).toBeTruthy();
  });

  it('calls onClose when Close button is clicked', async () => {
    mockDevSchemaGet.mockResolvedValue({ found: true, content: SAMPLE_SCHEMA });
    const onClose = vi.fn();

    render(
      <SchemaViewer
        schemaPath="/path.json"
        contractVersion="1.0.0"
        contractName="test"
        onClose={onClose}
      />,
    );

    await waitFor(() => screen.getByRole('button', { name: /Close/i }));
    screen.getByRole('button', { name: /Close/i }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows contract name and version in the dialog label', async () => {
    mockDevSchemaGet.mockResolvedValue({ found: true, content: SAMPLE_SCHEMA });

    render(
      <SchemaViewer
        schemaPath="/path.json"
        contractVersion="2.5.0"
        contractName="my.contract"
        onClose={() => {}}
      />,
    );

    await waitFor(() => screen.getByTestId('schema-content'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toContain('my.contract');
    expect(dialog.getAttribute('aria-label')).toContain('2.5.0');
  });
});
