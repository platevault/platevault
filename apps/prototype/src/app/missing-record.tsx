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

/** `title` names what is missing as one complete message ("This Project is not in the catalog"), so its noun agrees in every language; `backLabel` is the way back. */
export function MissingRecord({ title, backTo, backLabel }: { title: string; backTo: string; backLabel: string }) {
  const m = useMessages()
  useDocumentTitle(title)
  return (
    <PageBody className="mx-auto w-full max-w-lg">
      <EmptyState
        icon={FileQuestion}
        titleAs="h1"
        title={title}
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
