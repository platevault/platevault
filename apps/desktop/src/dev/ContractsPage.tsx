// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * /dev/contracts — Developer Contract Diagnostics page (spec 021).
 *
 * Reachable only via Cmd+K "Developer / Contracts" when devMode is on.
 * When devMode is off, renders a disabled stub (FR-010, US4 acceptance 2).
 *
 * This file is tree-shaken in production builds because:
 * - The route is only registered in dev-tools builds (router.tsx).
 * - The Cmd+K palette entry is only added when devMode is on (CommandPalette.tsx).
 */

import { useState, useEffect, useCallback } from 'react';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type { ContractMeta, ContractCall } from '@/bindings/index';
import { PageShell } from '@/components';
import { ContractList } from './ContractList';
import { CallList } from './CallList';
import { SchemaViewer } from './SchemaViewer';
import { pickDirectory } from '@/shared/native/picker';

// ── Disabled stub ─────────────────────────────────────────────────────────────

function DevModeDisabledStub() {
  return (
    <div
      className="alm-dev-stub alm-page__scroll alm-dev-contracts-page__stub-body"
      data-testid="dev-disabled-stub"
    >
      <h2 className="alm-dev-contracts-page__stub-heading">
        Developer mode disabled
      </h2>
      <p className="alm-dev-contracts-page__stub-text">
        Enable <strong>devMode</strong> in Settings › Advanced, then restart the
        app to access developer diagnostics.
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ContractsPage() {
  const [devMode, setDevMode] = useState<boolean | null>(null);
  const [contracts, setContracts] = useState<ContractMeta[]>([]);
  const [calls, setCalls] = useState<ContractCall[]>([]);
  const [selectedContract, setSelectedContract] = useState<ContractMeta | null>(
    null,
  );
  const [schemaViewerOpen, setSchemaViewerOpen] = useState(false);
  const [schemaPath, setSchemaPath] = useState('');
  const [schemaVersion, setSchemaVersion] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check devMode on mount.
  useEffect(() => {
    let cancelled = false;
    commands
      .settingsGet('advanced')
      .then(unwrap)
      .then((data) => {
        if (cancelled) return;
        const vals = data.values as Record<string, unknown>;
        setDevMode(vals?.devMode === true);
      })
      .catch(() => {
        if (!cancelled) setDevMode(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load contracts when devMode is confirmed on.
  const loadContracts = useCallback(() => {
    commands
      .devContractsList({ requestId: null })
      .then(unwrap)
      .then((resp) => setContracts(resp.contracts))
      .catch((e: unknown) => setError(String(e)));
  }, []);

  const loadCalls = useCallback(() => {
    commands
      .devCallsList({ requestId: null, limit: null })
      .then(unwrap)
      .then((resp) => setCalls(resp.calls))
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (devMode === true) {
      loadContracts();
      loadCalls();
    }
  }, [devMode, loadContracts, loadCalls]);

  const handleViewSchema = useCallback((contract: ContractMeta) => {
    setSelectedContract(contract);
    setSchemaPath(contract.schemaPath);
    setSchemaVersion(contract.version);
    setSchemaViewerOpen(true);
  }, []);

  const handleViewSchemaForCall = useCallback(
    (call: ContractCall) => {
      const contract = contracts.find((c) => c.name === call.contract);
      if (contract) {
        setSelectedContract(contract);
        setSchemaPath(contract.schemaPath);
        setSchemaVersion(call.contractVersion);
        setSchemaViewerOpen(true);
      }
    },
    [contracts],
  );

  const handleExport = useCallback(async () => {
    // T075 / FR-030: pick an absolute directory so the output path is never
    // relative (which would trigger path.write.denied from the Rust side).
    const dirResult = await pickDirectory(undefined, 'export');
    if (dirResult.cancelled || !dirResult.path) return;

    const sep = dirResult.path.includes('\\') ? '\\' : '/';
    const outputPath = `${dirResult.path}${sep}${Date.now()}-dev-export.json`;

    setExporting(true);
    setExportResult(null);
    try {
      const resp = unwrap(
        await commands.devExport({
          requestId: null,
          outputPath,
          includeContracts: true,
          includeCalls: true,
        }),
      );
      setExportResult(
        `Exported ${resp.contractCount} contracts and ${resp.callCount} calls to ${resp.writtenPath}`,
      );
    } catch (e: unknown) {
      setExportResult(`Export failed: ${String(e)}`);
    } finally {
      setExporting(false);
    }
  }, []);

  // Still loading devMode state.
  if (devMode === null) {
    return (
      <PageShell>
        <div className="alm-page__scroll alm-dev-contracts-page__loading">
          Loading…
        </div>
      </PageShell>
    );
  }

  // DevMode is off — show stub, do not subscribe to call stream.
  if (!devMode) {
    return (
      <PageShell>
        <DevModeDisabledStub />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="alm-dev-contracts alm-page__scroll alm-dev-contracts-page__body">
        <div className="alm-dev-contracts-page__header">
          <h1 className="alm-dev-contracts-page__title">
            Developer Contract Diagnostics
          </h1>
          <div className="alm-dev-contracts-page__actions">
            <button
              type="button"
              className="alm-btn alm-btn--sm"
              onClick={loadCalls}
              aria-label="Refresh calls"
            >
              Refresh calls
            </button>
            <button
              type="button"
              className="alm-btn alm-btn--sm"
              onClick={handleExport}
              disabled={exporting}
              aria-label="Export diagnostics"
            >
              {exporting ? 'Exporting…' : 'Export'}
            </button>
          </div>
        </div>

        {error && (
          <div role="alert" className="alm-dev-contracts-page__error">
            Error: {error}
          </div>
        )}

        {exportResult && (
          <div role="status" className="alm-dev-contracts-page__export-result">
            {exportResult}
          </div>
        )}

        <section>
          <h2 className="alm-dev-contracts-page__section-heading">
            Contracts ({contracts.length})
          </h2>
          <ContractList contracts={contracts} onViewSchema={handleViewSchema} />
        </section>

        <section>
          <h2 className="alm-dev-contracts-page__section-heading">
            Recent Calls ({calls.length})
          </h2>
          <CallList
            calls={calls}
            contracts={contracts}
            onViewSchema={handleViewSchemaForCall}
          />
        </section>

        {schemaViewerOpen && (
          <SchemaViewer
            schemaPath={schemaPath}
            contractVersion={schemaVersion}
            contractName={selectedContract?.name ?? ''}
            onClose={() => setSchemaViewerOpen(false)}
          />
        )}
      </div>
    </PageShell>
  );
}
