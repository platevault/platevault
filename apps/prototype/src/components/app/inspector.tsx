/**
 * Inspector pane (HARNESS V1): the trailing split of a macOS window (Xcode,
 * Keynote, Finder's preview pane). It shares one width and one shown/hidden
 * preference across pages (`ui-state`, like AppKit split-view autosave),
 * resizes on a `SplitHandle`, stays in view while the content scrolls, and
 * scrolls on its own. ⌥⌘0 or the page's toggle button shows or hides it.
 * Below 1024 px it stacks under the content so nothing reflows sideways.
 */
import type { CSSProperties, ReactNode } from "react"
import { INSPECTOR_WIDTH, setInspectorWidth, useShellUi } from "@/app/ui-state"
import { SplitHandle } from "@/components/app/split"
import { cn } from "@/lib/utils"

export interface InspectorSplitProps {
  /** The page content left of the inspector. */
  content: ReactNode
  /** Inspector content; usually `InspectorSection`s. */
  inspector: ReactNode
  /** Accessible name of the inspector landmark, e.g. "Frame inspector". */
  label: string
  /** id of the inspector, for the toggle button's `aria-controls`. */
  id: string
  className?: string
}

export function InspectorSplit({ content, inspector, label, id, className }: InspectorSplitProps) {
  const { inspectorOpen, inspectorWidth } = useShellUi()
  return (
    <div className={cn("flex min-w-0 items-start max-lg:flex-col max-lg:gap-5", className)} style={{ "--inspector-w": `${inspectorWidth}px` } as CSSProperties}>
      <div className="min-w-0 flex-1 self-stretch lg:pr-4">{content}</div>
      {inspectorOpen ? (
        <>
          <SplitHandle
            label="Resize inspector"
            value={inspectorWidth}
            min={INSPECTOR_WIDTH.min}
            max={INSPECTOR_WIDTH.max}
            initial={INSPECTOR_WIDTH.initial}
            onChange={setInspectorWidth}
            pane="after"
            className="self-stretch max-lg:hidden"
          />
          <aside
            id={id}
            aria-label={label}
            data-inspector=""
            className={cn(
              "min-w-0 shrink-0 max-lg:w-full",
              // Pinned under the toolbar while the content scrolls; flush with the window's trailing edge; scrolls itself when taller than the window.
              "lg:sticky lg:top-0 lg:-mr-5 lg:max-h-[calc(100dvh-var(--toolbar-h)-var(--statusbar-h))] lg:w-(--inspector-w) lg:overflow-y-auto lg:border-y lg:bg-card",
            )}
          >
            {inspector}
          </aside>
        </>
      ) : null}
    </div>
  )
}

/** One inspector group: an 11 px semibold header over a hairline, as in Xcode's inspectors. */
export function InspectorSection({ title, children, actions, className }: { title: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={cn("border-b px-3 py-2.5 last:border-b-0 max-lg:rounded-lg max-lg:border max-lg:last:border-b", className)}>
      <div className="mb-2 flex min-h-5 items-center justify-between gap-2" data-chrome="">
        <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  )
}
