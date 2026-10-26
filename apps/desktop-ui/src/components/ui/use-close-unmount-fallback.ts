import * as React from "react"

/** Longer than every dialog and sheet exit transition (100-200 ms), so visible popups still animate out. */
const CLOSE_UNMOUNT_FALLBACK_MS = 400

interface PopupActions {
  unmount: () => void
  close: () => void
}

export interface PopupRootCloseProps<Details extends { isCanceled: boolean }> {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean, details: Details) => void
  onOpenChangeComplete?: (open: boolean) => void
  actionsRef?: React.RefObject<PopupActions | null>
}

/**
 * Base UI unmounts a closed dialog or sheet only after requestAnimationFrame
 * and its exit animation finish. Background tabs pause both, so a popup
 * closed there stayed mounted and kept the page inert. This wraps a popup
 * Root's open props: it unmounts through Base UI's own `actionsRef.unmount` at
 * once while the document is hidden (or when it becomes hidden), else after a
 * bound longer than the exit transition. Focus still returns to the element
 * that opened the popup. Spread the result onto the Root, after other props.
 */
export function useCloseUnmountFallback<Details extends { isCanceled: boolean }>({
  open,
  defaultOpen,
  onOpenChange,
  onOpenChangeComplete,
  actionsRef,
}: PopupRootCloseProps<Details>) {
  const actions = React.useRef<PopupActions | null>(null)
  React.useImperativeHandle(actionsRef, () => ({ unmount: () => actions.current?.unmount(), close: () => actions.current?.close() }), [])
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false)
  const isOpen = open ?? uncontrolledOpen
  // True once Base UI reports the close complete (its own unmount or ours); false while mounted.
  const closeComplete = React.useRef(!isOpen)

  React.useEffect(() => {
    if (isOpen) {
      closeComplete.current = false
      return undefined
    }
    const finish = () => {
      if (!closeComplete.current) actions.current?.unmount()
    }
    if (document.hidden) {
      finish()
      return undefined
    }
    const timer = window.setTimeout(finish, CLOSE_UNMOUNT_FALLBACK_MS)
    const onVisibilityChange = () => {
      if (document.hidden) finish()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [isOpen])

  return {
    open,
    defaultOpen,
    actionsRef: actions,
    onOpenChange: (next: boolean, details: Details) => {
      onOpenChange?.(next, details)
      // A handler may cancel the change; only a change that happens moves the mirror.
      if (open === undefined && !details.isCanceled) setUncontrolledOpen(next)
    },
    onOpenChangeComplete: (next: boolean) => {
      if (!next) closeComplete.current = true
      onOpenChangeComplete?.(next)
    },
  }
}
