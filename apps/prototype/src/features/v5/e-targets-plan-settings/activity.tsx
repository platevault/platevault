/**
 * S17 Activity (slice E, carried over from v4's T2 activity page):
 * operations and refusals. The v4 source is
 * `src/features/t2/pages/activity.tsx` at commit 6ef221b1.
 * Foundation placeholder; slice E replaces this file.
 */
import { PlaceholderPage } from "@/components/app/page"
import { SCREENS } from "@/app/screens"
import { useStore } from "@/store/core"

export function ActivityPage() {
  const activity = useStore((s) => s.activity)
  return (
    <PlaceholderPage
      screen={SCREENS.S17}
      facts={activity.slice(0, 5).map((event) => ({ label: event.kind, value: `${event.title}${event.detail ? `: ${event.detail}` : ""}` }))}
    />
  )
}
