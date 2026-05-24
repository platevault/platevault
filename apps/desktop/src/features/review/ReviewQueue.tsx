import { useRef, useEffect } from 'react';
import { clsx } from 'clsx';
import type { ReviewItem } from '@/api/types';
import { Confidence, Pill } from '@/ui';

export interface ReviewQueueProps {
  items: ReviewItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

const KIND_VARIANT: Record<string, 'info' | 'neutral'> = {
  session: 'info',
  unclassified_file: 'neutral',
};

const KIND_LABEL: Record<string, string> = {
  session: 'Session',
  unclassified_file: 'File',
};

/**
 * Left pane queue list. Items sorted by confidence ascending so the
 * lowest-confidence items (needing most attention) appear first.
 */
export function ReviewQueue({ items, activeIndex, onSelect }: ReviewQueueProps) {
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
      style={{ overflow: 'auto', height: '100%' }}
    >
      {items.map((item, index) => {
        const isActive = index === activeIndex;
        const label =
          item.kind === 'session'
            ? item.suggested_target ?? item.session_id ?? 'Unknown session'
            : item.file_path?.split('/').pop() ?? 'Unknown file';

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
            <span className="alm-review-queue__confidence">
              <Confidence level={item.confidence} />
            </span>
            <span className="alm-review-queue__label" title={label}>
              {label}
            </span>
            <Pill
              label={KIND_LABEL[item.kind] ?? item.kind}
              variant={KIND_VARIANT[item.kind] ?? 'neutral'}
              size="sm"
            />
          </button>
        );
      })}
    </div>
  );
}
