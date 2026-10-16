import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { createSeed } from "@/domain/seed"
import type { ReminderNotice } from "@/domain/types"
import { msg } from "@/lib/i18n"
import { recordActivity, SCHEMA_VERSION, store } from "./core"
import { markNoticesRead, useNotices } from "./notifications"
import { initialSliceStates, sliceVersions } from "./slices"

beforeEach(() => {
  store.replace({ ...createSeed("empty"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates(), activity: [], noticesRead: [] })
})

const notice = (delivery: ReminderNotice["delivery"]): ReminderNotice => ({ delivery, windows: [], names: ["M 31"], more: 0, href: "/targets?view=planned" })

describe("reminders in the notification bell (PLAN-AC-15)", () => {
  it("lists a delivered reminder as an unread notice and a missed window in Activity only", () => {
    recordActivity({ kind: "reminder-missed", title: msg("plan_reminder_missed_closed"), detail: null, operationId: null, href: "/targets?view=planned", reminder: notice("missed") })
    recordActivity({ kind: "reminder", title: msg("plan_reminders_gathered", { names: "M 31" }), detail: null, operationId: null, href: "/targets?view=planned", reminder: notice("coalesced") })
    const { result } = renderHook(() => useNotices())

    expect(store.getState().activity).toHaveLength(2)
    const coalesced = store.getState().activity.find((e) => e.kind === "reminder")!
    expect(result.current.notices.map((n) => n.id)).toEqual([coalesced.id])
    expect(result.current.unread.map((n) => n.id)).toEqual([coalesced.id])
  })

  it("never counts a missed window as unread, even after marking the history read", () => {
    recordActivity({ kind: "reminder-missed", title: msg("plan_reminder_missed_closed"), detail: null, operationId: null, href: null, reminder: notice("missed") })
    const { result } = renderHook(() => useNotices())
    expect(result.current.unread).toEqual([])
    act(() => markNoticesRead())
    expect(store.getState().noticesRead).toEqual([])
  })
})
