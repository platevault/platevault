import { afterEach, describe, expect, it } from "vitest"
import { setLocale } from "@/app/preferences"
import { DEFAULT_LOCALE } from "@/lib/i18n"
import { formatFov } from "./equipment-records"

const FOV = { widthDeg: 5.384, heightDeg: 3.591, pixelScaleArcsec: 3.104 }

afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

describe("formatFov", () => {
  it("reads the field and the pixel scale in the reader's digits", () => {
    expect(formatFov(FOV)).toBe("5.38° × 3.59° · 3.10″/px")
    setLocale("pt-BR")
    expect(formatFov(FOV)).toBe("5,38° × 3,59° · 3,10″/px")
  })
})
