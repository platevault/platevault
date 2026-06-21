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
import {
  devContractsList,
  devCallsList,
  devExport,
  type ContractMeta,
  type ContractCall,
  getSettings,
} from '@/api/commands';
import { PageShell } from '@/components';
import { ContractList } from './ContractList';
import { CallList } from './CallList';
import { SchemaViewer } from './SchemaViewer';
import { pickDirectory } from '@/shared/native/picker';

// ── Disabled stub ─────────────────────────────────────────────────────────────

function DevModeDisabledStub() {
  return (
    <div
      className="alm-dev-stub alm-page__scroll"
      style={{ padding: 'var(--alm-sp-8)', textAlign: 'center', color: 'var(--alm-text-muted)' }}
      data-testid="dev-disabled-stub"
    >
      <h2 style={{ fontSize: 'var(--alm-text-lg)', marginBottom: 'var(--alm-sp-2)' }}>
        Developer mode disabled
      </h2>
      <p style={{ fontSize: 'var(--alm-text-sm)' }}>
        Enable <strong>devMode</strong> in Settings › Advanced, then restart the app to access
        developer diagnostics.
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ContractsPage() {
  const [devMode, setDevMode] = useState<boolean | null>(null);
  const [contracts, setContracts] = useState<ContractMeta[]>([]);
  const [calls, setCalls] = useState<ContractCall[]>([]);
  const [selectedContract, setSelectedContract] = useState<ContractMeta | null>(null);
  const [schemaViewerOpen, setSchemaViewerOpen] = useState(false);
  const [schemaPath, setSchemaPath] = useState('');
  const [schemaVersion, setSchemaVersion] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check devMode on mount.
  useEffect(() => {
    let cancelled = false;
    getSettings({ scope: 'advanced' })
      .then((data) => {
        if (cancelled) return;
        const vals = data.values as Record<string, unknown>;
        setDevMode(vals?.devMode === true);
      })
      .catch(() => {
        if (!cancelled) setDevMode(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Load contracts when devMode is confirmed on.
  const loadContracts = useCallback(() => {
    devContractsList()
      .then((resp) => setContracts(resp.contracts))
      .catch((e: unknown) => setError(String(e)));
  }, []);

  const loadCalls = useCallback(() => {
    devCallsList()
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
      const resp = await devExport({
        outputPath,
        includeContracts: true,
        includeCalls: true,
      });
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
        <div className="alm-page__scroll" style={{ padding: 'var(--alm-sp-8)', color: 'var(--alm-text-muted)' }}>
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
    <div
      className="alm-dev-contracts alm-page__scroll"
      style={{ padding: 'var(--alm-sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-4)' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--alm-border)',
          paddingBottom: 'var(--alm-sp-3)',
        }}
      >
        <h1 style={{ fontSize: 'var(--alm-text-lg)', fontWeight: 600 }}>
          Developer Contract Diagnostics
        </h1>
        <div style={{ display: 'flex', gap: 'var(--alm-sp-2)' }}>
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
        <div
          role="alert"
          style={{ color: 'var(--alm-danger)', fontSize: 'var(--alm-text-sm)' }}
        >
          Error: {error}
        </div>
      )}

      {exportResult && (
        <div
          role="status"
          style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)' }}
        >
          {exportResult}
        </div>
      )}

      <section>
        <h2 style={{ fontSize: 'var(--alm-text-md)', fontWeight: 600, marginBottom: 'var(--alm-sp-2)' }}>
          Contracts ({contracts.length})
        </h2>
        <ContractList
          contracts={contracts}
          onViewSchema={handleViewSchema}
        />
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--alm-text-md)', fontWeight: 600, marginBottom: 'var(--alm-sp-2)' }}>
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
