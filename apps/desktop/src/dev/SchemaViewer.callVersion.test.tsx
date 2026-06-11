/**
 * SchemaViewer call-version pinning tests (spec 021 T025).
 *
 * Verifies that "view schema for this call" uses the call's `contractVersion`,
 * not the registry's current version, so historical calls show the correct schema.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SchemaViewer } from './SchemaViewer';

vi.mock('@/api/commands', () => ({
  devSchemaGet: vi.fn(),
}));

import { devSchemaGet } from '@/api/commands';
const mockDevSchemaGet = vi.mocked(devSchemaGet);

const SCHEMA_CONTENT = JSON.stringify({ title: 'mock' }, null, 2);

beforeEach(() => {
  vi.clearAllMocks();
  mockDevSchemaGet.mockResolvedValue({ found: true, content: SCHEMA_CONTENT });
});

describe('SchemaViewer call-version pinning (T025)', () => {
  it('displays the contractVersion passed as prop, not any "current" version', async () => {
    // Simulates a call recorded with an older version (1.0.0) while the
    // current registry version might be 2.0.0.
    render(
      <SchemaViewer
        schemaPath="/path/to/schema.json"
        contractVersion="1.0.0"
        contractName="dev.contracts.list"
        onClose={() => {}}
      />,
    );

    await waitFor(() => screen.getByTestId('schema-content'));

    // The dialog label must show the pinned call version.
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toContain('1.0.0');
    expect(dialog.getAttribute('aria-label')).not.toContain('2.0.0');
  });

  it('fetches schema using the schemaPath prop (path is version-specific)', async () => {
    const pinned = '/path/v1.0.0/schema.json';

    render(
      <SchemaViewer
        schemaPath={pinned}
        contractVersion="1.0.0"
        contractName="dev.contracts.list"
        onClose={() => {}}
      />,
    );

    await waitFor(() => screen.getByTestId('schema-content'));
    expect(mockDevSchemaGet).toHaveBeenCalledWith(pinned);
  });

  it('re-fetches when schemaPath changes (different call version)', async () => {
    const { rerender } = render(
      <SchemaViewer
        schemaPath="/v1/schema.json"
        contractVersion="1.0.0"
        contractName="dev.contracts.list"
        onClose={() => {}}
      />,
    );

    await waitFor(() => screen.getByTestId('schema-content'));
    expect(mockDevSchemaGet).toHaveBeenCalledWith('/v1/schema.json');

    rerender(
      <SchemaViewer
        schemaPath="/v2/schema.json"
        contractVersion="2.0.0"
        contractName="dev.contracts.list"
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(mockDevSchemaGet).toHaveBeenCalledWith('/v2/schema.json');
    });
    expect(mockDevSchemaGet).toHaveBeenCalledTimes(2);
  });
});
