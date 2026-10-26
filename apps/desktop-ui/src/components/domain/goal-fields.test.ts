import { describe, expect, it } from "vitest"
import { formatCount, formatHours, numberText } from "@/lib/format"
import { m } from "@/lib/i18n"
import { kindsLine, qualityBarFor } from "./goal-fields"

describe("kindsLine", () => {
  it("words time with a FWHM limit", () => {
    expect(kindsLine(m, { integrationS: 10 * 3600, frameCount: null, qualityBar: qualityBarFor(2.5) })).toBe(`${formatHours(10 * 3600)} · ${m.domain_quality_max_fwhm({ arcsec: numberText(2.5) })}`)
  })

  it("words a frame count, leaving Usable unsaid", () => {
    expect(kindsLine(m, { integrationS: null, frameCount: 120, qualityBar: qualityBarFor(null) })).toBe(m.project_frames_count({ count: 120, n: formatCount(120) }))
  })

  it("reads Not set without an amount or a limit", () => {
    expect(kindsLine(m, { integrationS: null, frameCount: null, qualityBar: qualityBarFor(null) })).toBe(m.status_not_set())
  })
})
