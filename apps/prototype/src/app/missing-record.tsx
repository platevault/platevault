/**
 * The page a record route shows when its id is not in the catalog (an old
 * link, or a run emptied from the Trash). Foundation-owned; every record
 * screen uses it so the wording and the way back stay the same.
 */
import { Link } from "@tanstack/react-router"
import { FileQuestion } from "lucide-react"
import { EmptyState } from "@/components/app/feedback"
import { PageBody, useDocumentTitle } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { useMessages } from "./preferences"

/** `noun` names the record kind ("Project"); `backLabel` the way back. */
export function MissingRecord({ noun, backTo, backLabel }: { noun: string; backTo: string; backLabel: string }) {
  const m = useMessages()
  useDocumentTitle(m.record_missing_doc_title({ noun }))
  return (
    <PageBody className="mx-auto w-full max-w-lg">
      <EmptyState
        icon={FileQuestion}
        titleAs="h1"
        title={m.record_missing_title({ noun })}
        description={m.record_missing_description()}
        action={
          <Button size="sm" render={<Link to={backTo} />}>
            {backLabel}
          </Button>
        }
      />
    </PageBody>
  )
}
