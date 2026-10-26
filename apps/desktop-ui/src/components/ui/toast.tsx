import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import { XIcon } from "lucide-react"
import { useMessages } from "@/app/preferences"
import { buttonVariants } from "@/components/ui/button"

/**
 * Toast (L1, on Base UI toast): the outcome of an operation whose effect is
 * off-screen (trash, archive, rescan, import), at the bottom trailing corner.
 * RootLayout mounts one `Toaster`; anything, a store action included, adds a
 * toast through `showToast`. The viewport is a polite live region that exists
 * before any toast, so each new toast is announced (WCAG 4.1.3). A toast
 * pauses while hovered or focused, and F6 moves focus to the viewport.
 */
const manager = ToastPrimitive.createToastManager()

export interface ToastOptions {
  title: string
  /** One follow-up: Undo, or Show the result. */
  action?: { label: string; onClick: () => void }
}

/** Adds a toast; returns its id. Running the action closes the toast. */
function showToast({ title, action }: ToastOptions): string {
  const id: string = manager.add({
    title,
    actionProps: action
      ? {
          children: action.label,
          onClick: () => {
            action.onClick()
            manager.close(id)
          },
        }
      : undefined,
    timeout: action ? 8000 : 5000,
  })
  return id
}

function ToastList() {
  const m = useMessages()
  const { toasts } = ToastPrimitive.useToastManager()
  return toasts.map((toast) => (
    <ToastPrimitive.Root
      key={toast.id}
      toast={toast}
      data-slot="toast"
      className="flex items-start gap-2 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none focus-visible:ring-2 focus-visible:ring-ring data-ending-style:opacity-0 data-limited:hidden data-starting-style:translate-y-2 data-starting-style:opacity-0 motion-safe:transition-[opacity,translate] motion-safe:duration-150"
    >
      <ToastPrimitive.Content className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <ToastPrimitive.Title className="min-w-0 flex-1 text-pretty" />
        {toast.actionProps ? <ToastPrimitive.Action className={buttonVariants({ variant: "outline", size: "xs" })} /> : null}
      </ToastPrimitive.Content>
      <ToastPrimitive.Close className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
        <XIcon aria-hidden="true" />
        <span className="sr-only">{m.verb_dismiss()}</span>
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  ))
}

/** Mount once, in RootLayout. */
function Toaster() {
  const m = useMessages()
  return (
    <ToastPrimitive.Provider toastManager={manager} limit={3}>
      <ToastPrimitive.Portal>
        {/* bottom-10 clears the 24 px status bar. */}
        <ToastPrimitive.Viewport data-slot="toaster" aria-label={m.status_bar_notifications()} className="fixed end-4 bottom-10 z-50 flex w-80 flex-col gap-2 outline-none">
          <ToastList />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  )
}

export { showToast, Toaster }
