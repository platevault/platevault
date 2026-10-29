import { describe, expect, it } from "vitest"
import type { Session } from "@/api/ipc"
import { formatExposure, formatNight } from "@/lib/format"
import { m } from "@/lib/i18n"
import { keyParts, sessionLabel } from "./session-label"

const session = (key: string, framing?: Session["framing"]): Session => ({ id: "s1", key, groupingRevision: 1, decisionRevision: 1, assetIds: [], provisional: [], dateBasis: null, framing })
const framing = (ordinal: number, label: string | null = null): NonNullable<Session["framing"]> => ({ ordinal, anchorAssetId: "a1", raDeg: null, decDeg: null, label, splitLimits: { maxCentreOffsetArcmin: null, maxRotationDeg: null } })

describe("session label", () => {
  it("reads the night, filter and exposure a capture key names", () => {
    expect(keyParts("capture-v1|type=light|night=2026-09-12@date-loc-noon|filter=Ha|exposure_s=300")).toEqual({ night: "2026-09-12", filter: "Ha", exposure: 300 })
    expect(sessionLabel(m, session("capture-v1|type=light|night=2026-09-12@date-loc-noon|filter=Ha|exposure_s=300"))).toBe(`${formatNight("2026-09-12")} · Ha · ${formatExposure(300)}`)
  })

  it("treats filter=? as no filter, and words a session without one", () => {
    expect(keyParts("capture-v1|type=light|night=2026-09-12@x|filter=?").filter).toBeNull()
    expect(sessionLabel(m, session("capture-v1|type=light|night=2026-09-12@x|filter=?"))).toBe(m.domain_session_no_filter({ night: formatNight("2026-09-12") }))
    expect(sessionLabel(m, session("capture-v1|type=light"))).toBe(m.domain_session_no_filter({ night: "–" }))
  })

  it("names no exposure the key doesn't carry", () => {
    expect(keyParts("capture-v1|type=light|filter=L").exposure).toBeNull()
    expect(keyParts("capture-v1|type=light|filter=L|exposure_s=").exposure).toBeNull()
    expect(keyParts("capture-v1|type=light|filter=L|exposure_s=abc").exposure).toBeNull()
  })

  it("adds the framing only past the first, and the user's label over the ordinal", () => {
    const key = "capture-v1|type=light|night=2026-09-12@x|filter=OIII"
    expect(sessionLabel(m, session(key, framing(1)))).toBe(`${formatNight("2026-09-12")} · OIII`)
    expect(sessionLabel(m, session(key, framing(2)))).toBe(`${formatNight("2026-09-12")} · OIII · ${m.domain_session_framing({ n: 2 })}`)
    expect(sessionLabel(m, session(key, framing(3, "West")))).toBe(`${formatNight("2026-09-12")} · OIII · West`)
  })
})
