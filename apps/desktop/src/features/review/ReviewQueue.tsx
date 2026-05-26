import { useRef, useEffect } from 'react';
import { clsx } from 'clsx';
import type { ReviewItem } from '@/bindings/types';
import { Confidence, Pill } from '@/ui';

export interface ReviewQueueProps {
  items: ReviewItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
  sortValue: string;
  onSortChange: (value: string) => void;
  acquisitionCount: number;
  calibrationCount: number;
}

/**
 * Left pane queue list — session-centric. Items sorted by confidence ascending
 * so the lowest-confidence sessions (needing most attention) appear first.
 * Matches wireframe: review-queue.jsx listPane.
 */
export function ReviewQueue({
  items,
  activeIndex,
  onSelect,
  sortValue,
  onSortChange,
  acquisitionCount,
  calibrationCount,
}: ReviewQueueProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Scroll active item into view when activeIndex changes
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex]);

  return (
    <div
      ref={listRef}
      className="alm-review-queue"
      role="listbox"
      aria-label="Review queue"
    >
      {/* Header */}
      <div className="alm-review-queue__header">
        <div className="alm-review-queue__title">Sessions to review</div>
        <div className="alm-review-queue__counts">
          {acquisitionCount} acquisition · {calibrationCount} calibration
        </div>
      </div>

      {/* Sort dropdown */}
      <div className="alm-review-queue__sort">
        <select
          className="alm-review-queue__sort-select"
          value={sortValue}
          onChange={(e) => onSortChange(e.target.value)}
        >
          <option value="confidence">Sorted: confidence ↑</option>
          <option value="date">Sorted: date ↓</option>
          <option value="target">Sorted: target</option>
        </select>
      </div>

      {/* Queue items */}
      <div className="alm-review-queue__items">
        {items.map((item, index) => {
          const isActive = index === activeIndex;
          const isCalibration = item.id.startsWith('cal-');
          const label = item.suggested_target
            ? `${item.suggested_target}${item.suggested_filter ? ` · ${item.suggested_filter}` : ''}`
            : item.session_id ?? 'Unknown session';
          // Append night from evidence if available
          const night = item.evidence.night?.value;
          const fullLabel = night ? `${label} · ${String(night).split(' ')[0]}` : label;
          const reason = item.blocking_reasons[0] ?? '';

          return (
            <button
              key={item.id}
              ref={isActive ? activeRef : undefined}
              type="button"
              role="option"
              aria-selected={isActive}
              className={clsx(
                'alm-review-queue__item',
                isActive && 'alm-review-queue__item--active',
              )}
              onClick={() => onSelect(index)}
            >
              <div className="alm-review-queue__item-top">
                <Pill
                  label={isCalibration ? 'cal' : 'acq'}
                  variant={isCalibration ? 'info' : 'ghost'}
                  size="sm"
                />
                <span
                  className={clsx(
                    'alm-review-queue__item-label',
                    isActive && 'alm-review-queue__item-label--active',
                  )}
                  title={fullLabel}
                >
                  {fullLabel}
                </span>
              </div>
              <div className="alm-review-queue__item-confidence">
                <Confidence level={item.confidence} />
              </div>
              {reason && (
                <div className="alm-review-queue__item-reason">
                  ↳ {reason}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
