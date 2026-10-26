/**
 * Catalogue entry (R9-COMPOSITION-PLAN §8.3): a running operation. Choose a
 * location with the Label and Select primitives, start indexing it, and the
 * run shows in an OperationPanel with its progress and per-file outcomes.
 * Pause, Resume and Cancel are the panel's callbacks; the entry applies them
 * to a local run (fixtures/operations.ts) that moves on one file at a time,
 * as library progress events would, and settles partial. Every visible
 * string comes from the message catalogue.
 */
import { Play } from "lucide-react"
import { useEffect, useState } from "react"
import { useMessages } from "@/app/preferences"
import { type OperationView, OperationPanel } from "@/components/app/operation-panel"
import { Section } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { advanceRun, indexingRun, SAMPLE_LOCATIONS, stopRun } from "./fixtures/operations"

const STEP_MS = 600

const nowIso = () => new Date().toISOString()

export function OperationCatalogue() {
  const m = useMessages()
  const [locationId, setLocationId] = useState<string | null>(null)
  const [run, setRun] = useState<OperationView | null>(null)
  const running = run?.status === "running"
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setRun((op) => (op ? advanceRun(op, nowIso()) : op)), STEP_MS)
    return () => clearInterval(timer)
  }, [running])
  const location = SAMPLE_LOCATIONS.find((l) => l.id === locationId)
  const start = () => location && setRun(indexingRun(location, nowIso()))
  return (
    <Section title={m.ds_operation_title()} description={m.ds_operation_description()}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label id="sample-op-label">{m.ds_op_location()}</Label>
            <Select items={SAMPLE_LOCATIONS.map((l) => ({ value: l.id, label: l.name }))} value={locationId} onValueChange={(value) => setLocationId(value as string)}>
              <SelectTrigger aria-labelledby="sample-op-label" className="w-64">
                <SelectValue placeholder={m.ds_op_choose_location()} />
              </SelectTrigger>
              <SelectContent>
                {SAMPLE_LOCATIONS.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button disabled={!location || running} aria-describedby={location ? undefined : "sample-op-reason"} onClick={start}>
            <Play data-icon="inline-start" aria-hidden="true" />
            {m.setup_start_indexing()}
          </Button>
          {!location ? (
            <p id="sample-op-reason" className="pb-2 text-xs text-muted-foreground">
              {m.ds_op_choose_first()}
            </p>
          ) : null}
        </div>
        {run ? (
          <OperationPanel
            operation={run}
            onPause={() => setRun((op) => op && stopRun(op, "paused", nowIso()))}
            onResume={() => setRun((op) => op && { ...op, status: "running" })}
            onCancel={() => setRun((op) => op && stopRun(op, "canceled", nowIso()))}
            onRetry={start}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{m.ds_op_none()}</p>
        )}
      </div>
    </Section>
  )
}
