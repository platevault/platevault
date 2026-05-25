import { useState, useMemo } from 'react';
import { clsx } from 'clsx';
import type { CalibrationMasterFixture } from '@/data/fixtures/calibration';
import { Btn } from '@/ui';

export interface MastersListProps {
  masters: CalibrationMasterFixture[];
  selectedId?: string;
  onSelect: (id: string) => void;
  groupValue: string;
  onGroupChange: (value: string) => void;
}

// ─── Types ───────────────────────────────────────────────────────────────────

type SortBy = 'name' | 'age' | 'sessions';

// ─── Constants ───────────────────────────────────────────────────────────────

const KIND_ORDER = ['dark', 'flat', 'bias'] as const;
const KIND_LABELS: Record<string, string> = {
  dark: 'Darks',
  flat: 'Flats',
  bias: 'Bias',
};

const SORT_MODES: Array<{ value: SortBy; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'age', label: 'Age' },
  { value: 'sessions', label: 'Sessions' },
];

const KIND_FILTER_OPTIONS = [
  { key: 'dark', label: 'Darks' },
  { key: 'flat', label: 'Flats' },
  { key: 'bias', label: 'Bias' },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sortMasters(
  masters: CalibrationMasterFixture[],
  sortBy: SortBy,
): CalibrationMasterFixture[] {
  const arr = [...masters];
  switch (sortBy) {
    case 'name':
      return arr.sort((a, b) => a.name.localeCompare(b.name));
    case 'age':
      return arr.sort((a, b) => b.ageDays - a.ageDays);
    case 'sessions':
      return arr.sort((a, b) => b.sessions - a.sessions);
  }
}

function groupMasters(
  masters: CalibrationMasterFixture[],
  groupValue: string,
): { label: string; items: CalibrationMasterFixture[] }[] {
  if (groupValue === 'none') {
    return [{ label: '', items: masters }];
  }

  if (groupValue === 'camera') {
    const map = new Map<string, CalibrationMasterFixture[]>();
    for (const m of masters) {
      const arr = map.get(m.cam) ?? [];
      arr.push(m);
      map.set(m.cam, arr);
    }
    return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
  }

  if (groupValue === 'age') {
    const buckets: Array<{ label: string; test: (d: number) => boolean }> = [
      { label: '≤ 30d', test: (d) => d <= 30 },
      { label: '31–90d', test: (d) => d > 30 && d <= 90 },
      { label: '> 90d', test: (d) => d > 90 },
    ];
    return buckets
      .map(({ label, test }) => ({
        label,
        items: masters.filter((m) => test(m.ageDays)),
      }))
      .filter((g) => g.items.length > 0);
  }

  // Default: group by kind, respecting KIND_ORDER
  const map = new Map<string, CalibrationMasterFixture[]>();
  for (const m of masters) {
    const arr = map.get(m.kind) ?? [];
    arr.push(m);
    map.set(m.kind, arr);
  }
  return KIND_ORDER.filter((k) => map.has(k)).map((k) => ({
    label: KIND_LABELS[k] ?? k,
    items: map.get(k)!,
  }));
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Left pane: grouped master list with kind headers, mono names,
 * exposure/gain/camera metadata, and aging warnings.
 * Matches wireframe: calibration.jsx listPane.
 */
export function MastersList({
  masters,
  selectedId,
  onSelect,
  groupValue,
  onGroupChange,
}: MastersListProps) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [kindFilter, setKindFilter] = useState<Set<string>>(new Set());
  const [agingOnly, setAgingOnly] = useState(false);

  // Derived counts for header
  const totalDarks = useMemo(() => masters.filter((m) => m.kind === 'dark').length, [masters]);
  const totalFlats = useMemo(() => masters.filter((m) => m.kind === 'flat').length, [masters]);
  const totalBias = useMemo(() => masters.filter((m) => m.kind === 'bias').length, [masters]);

  // Filter
  const filtered = useMemo(() => {
    let result = masters;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.cam.toLowerCase().includes(q),
      );
    }

    if (kindFilter.size > 0) {
      result = result.filter((m) => kindFilter.has(m.kind));
    }

    if (agingOnly) {
      result = result.filter((m) => m.warn === 'aging');
    }

    return result;
  }, [masters, search, kindFilter, agingOnly]);

  // Sort then group
  const sorted = useMemo(() => sortMasters(filtered, sortBy), [filtered, sortBy]);
  const groups = useMemo(() => groupMasters(sorted, groupValue), [sorted, groupValue]);

  const toggleKind = (kind: string) => {
    setKindFilter((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const hasActiveFilters = kindFilter.size > 0 || agingOnly;

  return (
    <nav className="alm-masters-list" aria-label="Calibration masters">
      {/* Header */}
      <div className="alm-masters-list__header">
        <div className="alm-masters-list__title">Calibration masters</div>
        <div className="alm-masters-list__counts">
          {masters.length} masters · {totalDarks} darks · {totalFlats} flats · {totalBias} bias
        </div>
      </div>

      {/* Search */}
      <div className="alm-masters-list__group-bar">
        <input
          type="search"
          placeholder="Search name, camera..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="alm-masters-list__group-select"
          aria-label="Search calibration masters"
        />
      </div>

      {/* Controls: group + sort */}
      <div className="alm-proj-list__controls">
        <label className="alm-proj-list__control-label">
          <span className="alm-proj-list__control-text">Group</span>
          <select
            className="alm-proj-list__select"
            value={groupValue}
            onChange={(e) => onGroupChange(e.target.value)}
            aria-label="Group calibration masters by"
          >
            <option value="kind">Kind</option>
            <option value="camera">Camera</option>
            <option value="age">Age</option>
            <option value="none">None</option>
          </select>
        </label>
        <label className="alm-proj-list__control-label">
          <span className="alm-proj-list__control-text">Sort</span>
          <select
            className="alm-proj-list__select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            aria-label="Sort calibration masters by"
          >
            {SORT_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Filter chips */}
      <div className="alm-proj-list__chips">
        {KIND_FILTER_OPTIONS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={clsx(
              'alm-filter-chip alm-filter-chip--xs',
              kindFilter.has(f.key) && 'alm-filter-chip--active',
            )}
            onClick={() => toggleKind(f.key)}
            aria-pressed={kindFilter.has(f.key)}
            aria-label={`Filter by ${f.label}`}
          >
            {f.label}
          </button>
        ))}
        <button
          type="button"
          className={clsx(
            'alm-filter-chip alm-filter-chip--xs',
            agingOnly && 'alm-filter-chip--active',
          )}
          onClick={() => setAgingOnly((v) => !v)}
          aria-pressed={agingOnly}
          aria-label="Show only aging masters (over 90 days)"
        >
          aging (&gt;90d)
        </button>
        {hasActiveFilters && (
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => {
              setKindFilter(new Set());
              setAgingOnly(false);
            }}
          >
            Clear
          </Btn>
        )}
      </div>

      {/* Grouped items */}
      {groups.length === 0 && (
        <div className="alm-masters-list__item-meta" style={{ padding: '16px 12px' }}>
          No masters match your search
        </div>
      )}
      {groups.map((group) => (
        <div key={group.label || '__all'}>
          {group.label && (
            <div className="alm-masters-list__kind-header">
              {group.label}
            </div>
          )}
          {group.items.map((m) => {
            const isSelected = m.id === selectedId;
            return (
              <button
                key={m.id}
                type="button"
                className={clsx(
                  'alm-masters-list__item',
                  isSelected && 'alm-masters-list__item--selected',
                )}
                onClick={() => onSelect(m.id)}
                aria-current={isSelected ? 'true' : undefined}
              >
                <div
                  className={clsx(
                    'alm-masters-list__item-name alm-mono',
                    isSelected && 'alm-masters-list__item-name--active',
                  )}
                  title={m.name}
                >
                  {m.name}
                </div>
                <div className="alm-masters-list__item-meta">
                  <span className="alm-mono">
                    {m.exp} · g{m.gain}
                  </span>
                  <span>{m.cam.replace('ASI', '')}</span>
                  {m.warn && (
                    <span className="alm-masters-list__item-warn">
                      ⚠ {m.age}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
