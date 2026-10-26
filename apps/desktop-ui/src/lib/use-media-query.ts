import { useSyncExternalStore } from "react"

/** Whether a CSS media query matches now; re-renders when it changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = window.matchMedia(query)
      list.addEventListener("change", listener)
      return () => list.removeEventListener("change", listener)
    },
    () => window.matchMedia(query).matches,
  )
}
