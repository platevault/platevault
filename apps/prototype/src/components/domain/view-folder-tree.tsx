/**
 * ViewFolderTree (L2-domain; F4 decision record §4, plan "View and Apply",
 * VSEL-FR-14): the View the next Apply builds, folder by folder, as the Apply
 * sheet shows it. It renders the planned tree as given (`applyPlan(…).tree`,
 * from `viewTree`): `GROUP_<name>/` or `PANEL_<name>/` only with several
 * groups, `NIGHT_YYYY-MM-DD/` (and `-2` for a second flat set that night)
 * with `Lights/<filter>/` and the `Flats/<filter>/` assigned to those lights,
 * and `Darks/` and `Bias/` at the top, in each group, or in a night when the
 * Project mixes versions with the same settings.
 *
 * Each folder counts the entries directly inside it: links with Symlinks;
 * with Copies an independent copy per folder, made from the original and
 * cloned where the volume supports it (never a hard link), with its bytes.
 *
 * Keyboard (WAI-ARIA tree view): the tree is one Tab stop on its current
 * folder; ↑/↓ move between visible folders, → opens a folder or moves into
 * it, ← closes it or moves to its parent, Home/End go to the first or last
 * folder, Enter or Space opens or closes. Every folder starts open.
 */
import { ChevronRight, Folder, FolderOpen } from "lucide-react"
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionError, TableSkeleton } from "@/components/app/feedback"
import type { ViewFolderNode } from "@/domain/project-view"
import type { InputMode } from "@/domain/types"
import { formatBytes, formatCount } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Indent per depth, on the spacing scale; deeper folders keep the last step. */
const INDENT = ["pl-0", "pl-4", "pl-8", "pl-12", "pl-16", "pl-20", "pl-24"] as const

interface VisibleFolder {
  node: ViewFolderNode
  level: number
  parent: string | null
  /** Position among its siblings, from 1, and how many siblings it has. */
  position: number
  siblings: number
}

/** The folders on screen, depth first: a closed folder hides what is inside it. */
function visibleFolders(root: ViewFolderNode, closed: ReadonlySet<string>): VisibleFolder[] {
  const out: VisibleFolder[] = []
  const walk = (node: ViewFolderNode, level: number, parent: string | null, position: number, siblings: number) => {
    out.push({ node, level, parent, position, siblings })
    if (closed.has(node.path)) return
    node.children.forEach((child, i) => walk(child, level + 1, node.path, i + 1, node.children.length))
  }
  walk(root, 1, null, 1, 1)
  return out
}

function totals(node: ViewFolderNode): { entries: number; bytes: number } {
  return node.children.reduce(
    (sum, child) => {
      const inner = totals(child)
      return { entries: sum.entries + inner.entries, bytes: sum.bytes + inner.bytes }
    },
    { entries: node.entries, bytes: node.bytes },
  )
}

export interface ViewFolderTreeProps {
  /** The planned View: `applyPlan(world, project).tree`, or `viewTree(entries, mode)`. */
  tree: ViewFolderNode
  /** Symlinks place a link per entry; Copies an independent copy per folder. */
  mode: InputMode
  /** Names the tree: "New View". */
  label: string
  loading?: boolean
  /** The plan could not be read: the error with Retry, in its place. */
  error?: { message: string; onRetry: () => void }
  /** Shown when the plan places nothing; default "Nothing to place yet…". */
  empty?: ReactNode
}

export function ViewFolderTree({ tree, mode, label, loading = false, error, empty }: ViewFolderTreeProps) {
  const m = useMessages()
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set())
  const [current, setCurrent] = useState(tree.path)
  const items = useRef(new Map<string, HTMLLIElement>())
  const sum = totals(tree)
  if (loading) return <TableSkeleton rows={4} columns={2} label={m.view_tree_loading()} />
  if (error) return <ActionError message={error.message} onRetry={error.onRetry} />
  if (sum.entries === 0) return <p className="text-muted-foreground">{empty ?? m.view_tree_empty()}</p>

  const visible = visibleFolders(tree, closed)
  const active = visible.some((f) => f.node.path === current) ? current : tree.path
  const toggle = (path: string, open: boolean) =>
    setClosed((was) => {
      const next = new Set(was)
      if (open) next.delete(path)
      else next.add(path)
      return next
    })
  const go = (path: string) => {
    setCurrent(path)
    items.current.get(path)?.focus()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const at = visible.findIndex((f) => f.node.path === active)
    const folder = visible[at]
    if (!folder) return
    const parent = folder.node.children.length > 0
    const open = parent && !closed.has(folder.node.path)
    const moves: Record<string, () => void> = {
      ArrowDown: () => visible[at + 1] && go(visible[at + 1]!.node.path),
      ArrowUp: () => visible[at - 1] && go(visible[at - 1]!.node.path),
      Home: () => go(visible[0]!.node.path),
      End: () => go(visible[visible.length - 1]!.node.path),
      ArrowRight: () => (open ? go(folder.node.children[0]!.path) : parent && toggle(folder.node.path, true)),
      ArrowLeft: () => (open ? toggle(folder.node.path, false) : folder.parent !== null && go(folder.parent)),
      Enter: () => parent && toggle(folder.node.path, !open),
      " ": () => parent && toggle(folder.node.path, !open),
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    move()
  }

  const count = (node: ViewFolderNode) =>
    mode === "copy" ? `${m.wrapup_copies({ count: node.entries })} · ${formatBytes(node.bytes)}` : m.view_tree_links({ count: node.entries })

  return (
    <div className="space-y-2" data-view-folder-tree="">
      <ul role="tree" aria-label={label} className="rounded-md border border-border bg-card py-1 font-mono text-xs" onKeyDown={onKeyDown}>
        {visible.map(({ node, level, position, siblings }) => {
          const parent = node.children.length > 0
          const open = parent && !closed.has(node.path)
          const Icon = open ? FolderOpen : Folder
          return (
            <li
              key={node.path}
              ref={(element) => {
                if (element) items.current.set(node.path, element)
                else items.current.delete(node.path)
              }}
              role="treeitem"
              aria-level={level}
              aria-posinset={position}
              aria-setsize={siblings}
              aria-expanded={parent ? open : undefined}
              tabIndex={node.path === active ? 0 : -1}
              data-path={node.path}
              className={cn("flex min-h-(--row-h) items-center gap-1.5 px-2 hover:bg-foreground/[0.04]", INDENT[Math.min(level - 1, INDENT.length - 1)])}
              onClick={() => {
                setCurrent(node.path)
                if (parent) toggle(node.path, !open)
              }}
              onFocus={() => setCurrent(node.path)}
            >
              <ChevronRight aria-hidden="true" className={cn("size-3.5 shrink-0 text-muted-foreground", !parent && "invisible", open && "rotate-90")} />
              <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{node.name}</span>
              {node.entries > 0 ? <span className="ml-auto shrink-0 pl-3 font-sans text-muted-foreground tabular-nums">{count(node)}</span> : null}
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        {mode === "copy"
          ? m.view_tree_copies_note({ count: sum.entries, n: formatCount(sum.entries), size: formatBytes(sum.bytes) })
          : m.view_tree_links_note({ count: sum.entries, n: formatCount(sum.entries) })}
      </p>
    </div>
  )
}
