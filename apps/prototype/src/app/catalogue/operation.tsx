/**
 * Catalogue entry (R9-COMPOSITION-PLAN §8.3): a running operation. Choose a
 * location with the Label and Select primitives, start indexing it, and the
 * newest operation shows in an OperationPanel with its progress and Cancel.
 * Every visible string comes from the message catalogue.
 */
import { Play } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { OperationPanel } from "@/components/app/operation-panel"
import { Section } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useStore } from "@/store/core"
import { startIndexing } from "@/store/operations"

export function OperationCatalogue() {
  const m = useMessages()
  const locations = useStore((s) => Object.values(s.catalog.locations))
  const latest = useStore((s) => Object.values(s.operations).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0])
  const [locationId, setLocationId] = useState<string | null>(null)
  return (
    <Section title={m.ds_operation_title()} description={m.ds_operation_description()}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label id="sample-op-label">{m.ds_op_location()}</Label>
            <Select items={locations.map((l) => ({ value: l.id, label: l.displayName }))} value={locationId} onValueChange={(value) => setLocationId(value as string)}>
              <SelectTrigger aria-labelledby="sample-op-label" className="w-64">
                <SelectValue placeholder={m.ds_op_choose_location()} />
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button disabled={!locationId} aria-describedby={locationId ? undefined : "sample-op-reason"} onClick={() => locationId && startIndexing([locationId])}>
            <Play data-icon="inline-start" aria-hidden="true" />
            {m.setup_start_indexing()}
          </Button>
          {!locationId ? (
            <p id="sample-op-reason" className="pb-2 text-xs text-muted-foreground">
              {m.ds_op_choose_first()}
            </p>
          ) : null}
        </div>
        {locations.length === 0 ? <p className="text-sm text-muted-foreground">{m.ds_op_no_locations()}</p> : null}
        {latest ? <OperationPanel operationId={latest.id} /> : <p className="text-sm text-muted-foreground">{m.ds_op_none()}</p>}
      </div>
    </Section>
  )
}
