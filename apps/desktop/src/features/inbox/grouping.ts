/**
 * Inbox grouping — re-export shim. The multi-level grouping engine was promoted
 * to the shared `@/lib/grouping` (every list page uses it now). Kept as a thin
 * re-export so existing inbox imports (`./grouping`) stay valid.
 */
export * from '@/lib/grouping';
