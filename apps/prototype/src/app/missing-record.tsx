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

export function MissingRecord({ noun, backTo, backLabel }: { noun: string; backTo: string; backLabel: string }) {
  useDocumentTitle(`${noun} not found`)
  return (
    <PageBody className="mx-auto w-full max-w-lg">
      <EmptyState
        icon={FileQuestion}
        titleAs="h1"
        title={`This ${noun} is not in the catalog`}
        description="The link may come from an older prototype build, or the record was removed by Empty Trash. Your library is unchanged."
        action={
          <Button size="sm" render={<Link to={backTo} />}>
            {backLabel}
          </Button>
        }
      />
    </PageBody>
  )
}
