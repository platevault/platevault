/**
 * What jsdom lacks for rendering catalogue specimens and running axe over
 * them: layout observers, scrolling (the router restores scroll on load),
 * and the 2D canvas the plate and cutout specimens draw on. Import it for
 * its effect, before the components render.
 *
 * The canvas context accepts the draws the components make and paints
 * nothing; jsdom has no ImageData, so a plain one stands in.
 */

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Element.prototype.scrollIntoView ??= () => {}

// jsdom defines scrollTo, but as a stub that reports "Not implemented".
window.scrollTo = () => {}

globalThis.ImageData ??= class {
  readonly colorSpace = "srgb" as const
  readonly data: Uint8ClampedArray<ArrayBuffer>
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4)
  }
} as unknown as typeof ImageData

const context = {
  putImageData() {},
  getImageData: (_x: number, _y: number, width: number, height: number) => new ImageData(width, height),
  clearRect() {},
  fillRect() {},
  fillText() {},
  measureText: () => ({ width: 0 }),
}

HTMLCanvasElement.prototype.getContext = function getContext() {
  return context
} as unknown as HTMLCanvasElement["getContext"]
