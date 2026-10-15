/**
 * Quit guard (Round 6): while an import, index or prepare runs, quitting
 * asks first. Prototype › Quit asks "Quit while 2 tasks run? They resume
 * next launch." with Quit and Cancel, then relaunches the prototype (a
 * reload), and the next launch resumes the work it left running. Closing
 * the browser window or tab asks through `beforeunload`, the browser's own
 * prompt, whose wording a page cannot set; work closed that way reads
 * Interrupted with Resume, as after any restart.
 */
import { useEffect } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import type { Operation, OperationKind } from "@/domain/types"
import { formatCount } from "@/lib/format"
import { store, useStore } from "@/store/core"
import { resumeOperation } from "@/store/operations"
import { useMessages } from "./preferences"

/** The work a quit would stop mid-way. */
const GUARDED: ReadonlySet<OperationKind> = new Set(["import", "index", "prepare"])

/** Operations Prototype › Quit left running; the next launch resumes them. */
const RESUME_KEY = "platevault.resumeOnLaunch"

let quitting = false
let launched = false

export function guardedWork(operations: Record<string, Operation>): Operation[] {
  return Object.values(operations).filter((op) => GUARDED.has(op.kind) && op.status === "running")
}

/** Quit and relaunch: remember the running work, then reload (the store persists on `pagehide`). */
export function quitPrototype() {
  const ids = guardedWork(store.getState().operations).map((op) => op.id)
  try {
    if (ids.length > 0) localStorage.setItem(RESUME_KEY, JSON.stringify(ids))
  } catch {
    // Storage unavailable: the work reads Interrupted with Resume instead.
  }
  quitting = true
  window.location.reload()
}

/** Once per launch: resume the work the last Quit left running (loading marked it Interrupted). */
function resumeAfterQuit() {
  if (launched) return
  launched = true
  let ids: unknown = null
  try {
    ids = JSON.parse(localStorage.getItem(RESUME_KEY) ?? "null")
    localStorage.removeItem(RESUME_KEY)
  } catch {
    return
  }
  if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") resumeOperation(id)
}

/** Mounted once at the root: resumes after a Quit, and asks before the window closes while guarded work runs. */
export function useQuitGuard() {
  const running = useStore((s) => guardedWork(s.operations).length > 0)
  useEffect(resumeAfterQuit, [])
  useEffect(() => {
    if (!running) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (quitting) return
      event.preventDefault()
      // Older engines show the prompt only with a return value.
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [running])
}

/** "Quit while 2 tasks run? They resume next launch." */
export function QuitDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const count = useStore((s) => guardedWork(s.operations).length)
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.shell_quit_title({ count, n: formatCount(count) })}
      summary={m.shell_quit_resume({ count })}
      confirm={{ label: m.shell_quit() }}
      onConfirm={quitPrototype}
    />
  )
}
