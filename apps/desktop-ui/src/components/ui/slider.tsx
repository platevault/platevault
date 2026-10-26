import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "cn"

/**
 * One value on a horizontal track (Base UI slider). The root's `aria-labelledby` names the thumb's range input;
 * `aria-describedby` and `getAriaValueText` go to that input. The 16 px thumb takes pointer input over 24 × 24 px
 * (its `::after`), and the control is 24 px tall, so the whole track line is a target (WCAG 2.5.8).
 */
function Slider({
  className,
  "aria-describedby": describedBy,
  getAriaValueText,
  ...props
}: SliderPrimitive.Root.Props<number> & Pick<SliderPrimitive.Thumb.Props, "aria-describedby" | "getAriaValueText">) {
  return (
    <SliderPrimitive.Root data-slot="slider" thumbAlignment="edge" className={cn("w-full", className)} {...props}>
      <SliderPrimitive.Control data-slot="slider-control" className="relative flex h-6 w-full touch-none items-center select-none data-disabled:cursor-not-allowed data-disabled:opacity-50">
        <SliderPrimitive.Track data-slot="slider-track" className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted">
          <SliderPrimitive.Indicator data-slot="slider-range" className="h-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          aria-describedby={describedBy}
          getAriaValueText={getAriaValueText}
          className="relative block size-4 shrink-0 rounded-full border border-primary bg-background shadow-sm transition-[box-shadow] after:absolute after:-inset-1 hover:ring-3 hover:ring-ring/30 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 data-dragging:ring-3 data-dragging:ring-ring/50 data-disabled:pointer-events-none"
        />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
