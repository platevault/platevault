// All interactive primitives use @base-ui-components/react for accessibility.
// Only build custom components when Base UI has no equivalent (justify in file header).

export { Pill } from './Pill';
export type { PillProps } from './Pill';

export { Provenance } from './Provenance';
export type { ProvenanceProps } from './Provenance';

export { Lock } from './Lock';
export type { LockProps } from './Lock';

export { KV } from './KV';
export type { KVProps } from './KV';

export { Box } from './Box';
export type { BoxProps } from './Box';

export { Section } from './Section';
export type { SectionProps } from './Section';

export { Btn } from './Btn';
export type { BtnProps } from './Btn';

export { DirPicker } from './DirPicker';
export type { DirPickerProps } from './DirPicker';

export { Toolbar } from './Toolbar';
export type { ToolbarProps } from './Toolbar';

export { DataTable } from './DataTable';
export type { DataTableProps } from './DataTable';

export { WizardShell } from './WizardShell';
export type { WizardShellProps, WizardStep } from './WizardShell';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { ToastContainer } from './ToastContainer';

// DEPRECATED — kept until feature pages are migrated to new shared components:
// ThreePane -> ListDetailLayout, FilterBar -> ListSidebar, Confidence -> removed

/** @deprecated Use ListDetailLayout from @/components instead. Will be removed after page migration. */
export { Confidence } from './Confidence';
/** @deprecated Use ListDetailLayout from @/components instead. Will be removed after page migration. */
export type { ConfidenceProps } from './Confidence';

/** @deprecated Use ListSidebar from @/components instead. Will be removed after page migration. */
export { FilterBar } from './FilterBar';
/** @deprecated Use ListSidebar from @/components instead. Will be removed after page migration. */
export type { FilterBarProps } from './FilterBar';

