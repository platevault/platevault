/**
 * DuplicatesBadge (L2-domain, F5): the badge a session row carries wherever
 * session rows appear (Sessions, a session's details, Home's suggestions,
 * a Target's or a Project's session rows) when its frames have extra
 * byte-identical copies in library storage (`sessionDuplicateCopies`,
 * domain/storage.ts). Display only: the Duplicates review under Settings ›
 * Locations cleans them up, and no Project carries a badge of its own.
 */
import { Copy } from "lucide-react"
import { useMessages } from "@/app/preferences"
import { Pill } from "@/components/app/pill"

export function DuplicatesBadge({ count }: { count: number }) {
  const m = useMessages()
  return (
    <Pill tone="warning" icon={Copy}>
      {m.duplicates_badge({ count })}
    </Pill>
  )
}
