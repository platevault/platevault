import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card"
import { cn } from "cn"

/**
 * HoverCard (L1, on Base UI preview-card): a small data-bearing card that
 * opens on hover and on keyboard focus of its trigger, and closes on Escape,
 * an outside press, or when pointer and focus leave. It never holds the only
 * path to something: its trigger is itself a link or button to the full place
 * (design/R9-COMPOSITION-PLAN.md P9). Compose it through components/app/previews.tsx.
 */
function HoverCard<Payload>({ ...props }: PreviewCardPrimitive.Root.Props<Payload>) {
  return <PreviewCardPrimitive.Root data-slot="hover-card" {...props} />
}

/** Renders an `<a>` by default; pass `render` for a router link, a button, or a wrapper around a disabled control. */
function HoverCardTrigger<Payload>({ delay = 400, closeDelay = 200, ...props }: PreviewCardPrimitive.Trigger.Props<Payload>) {
  return <PreviewCardPrimitive.Trigger data-slot="hover-card-trigger" delay={delay} closeDelay={closeDelay} {...props} />
}

function HoverCardContent({
  className,
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  ...props
}: PreviewCardPrimitive.Popup.Props & Pick<PreviewCardPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <PreviewCardPrimitive.Portal>
      <PreviewCardPrimitive.Positioner align={align} alignOffset={alignOffset} side={side} sideOffset={sideOffset} className="isolate z-50">
        <PreviewCardPrimitive.Popup
          data-slot="hover-card-content"
          className={cn(
            "z-50 flex max-h-(--available-height) w-72 origin-(--transform-origin) flex-col gap-2 overflow-y-auto rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none",
            className
          )}
          {...props}
        />
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardContent, HoverCardTrigger }
