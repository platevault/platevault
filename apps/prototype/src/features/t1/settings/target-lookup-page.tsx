/**
 * Settings › Target lookup (LIB-AC-12, LIB-FR-13, D18). Online Target
 * resolution is optional enrichment with provider provenance; local search and
 * indexing never depend on it. The test lookup is a prototype fixture response
 * and honours the "Fail next Target resolver lookup" simulation fault.
 */
import { Search } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { KeyValueList } from "@/components/app/data"
import { ActionError, DetailSkeleton, Notice } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { normalizeName, SKY_OBJECTS } from "@/domain/sky"
import type { AppSettings } from "@/domain/types"
import { formatDateTime, formatDec, formatRa } from "@/lib/format"
import { nowIso, store, updateSlice, useStore } from "@/store/core"
import type { TargetLookupTest } from "@/store/slices/t1"
import { TextField } from "../components/form-field"
import { save } from "../lib/writes"

const HREF = "/settings/targets"

const PROVIDERS: Array<{ value: AppSettings["targetLookup"]["provider"]; title: string; description: string }> = [
  { value: "cds-sesame", title: "CDS Sesame", description: "Queries SIMBAD, NED and VizieR in turn. Best coverage." },
  { value: "simbad", title: "SIMBAD only", description: "One provider. Fewer galaxy and catalogue aliases." },
]

const PROVIDER_LABEL: Record<AppSettings["targetLookup"]["provider"], string> = { "cds-sesame": "CDS Sesame", simbad: "SIMBAD" }

/** Simulated provider round trip; long enough to show the loading state. */
const LOOKUP_MS = 700

export function TargetLookupPage() {
  const lookup = useStore((s) => s.settings.targetLookup)
  const targets = useStore((s) => Object.keys(s.catalog.targets).length)
  const last = useStore((s) => s.slices.t1.lastLookupTest)
  const [query, setQuery] = useState("NGC 7000")
  const [running, setRunning] = useState(false)
  const [writeError, setWriteError] = useState<{ message: string; retry: () => void } | null>(null)
  const [queryError, setQueryError] = useState<string | undefined>()
  const timer = useRef<number | null>(null)
  const ids = { enabled: useId(), provider: useId(), query: useId() }

  useEffect(() => () => window.clearTimeout(timer.current ?? undefined), [])

  function change(next: AppSettings["targetLookup"]) {
    const attempt = () => {
      const result = save(
        {
          label: "Target lookup setting",
          saved: next.enabled ? `Online Target lookup on (${PROVIDER_LABEL[next.provider]})` : "Online Target lookup off",
          detail: next.enabled ? null : "Local Target search keeps working offline.",
          href: HREF,
        },
        (s) => ({ ...s, settings: { ...s.settings, targetLookup: next } }),
      )
      setWriteError(result.ok ? null : { message: result.message, retry: attempt })
    }
    attempt()
  }

  function record(test: TargetLookupTest) {
    updateSlice("t1", (slice) => ({ ...slice, lastLookupTest: test }))
  }

  function runTest() {
    const text = query.trim()
    if (!text) {
      setQueryError("Name to look up: enter a Target name or alias, for example NGC 7000.")
      return
    }
    setQueryError(undefined)
    const { provider, enabled } = store.getState().settings.targetLookup
    if (!enabled) {
      record({ at: nowIso(), query: text, provider, outcome: "off", message: "Online lookup is off, so nothing was sent. Local Targets and the bundled catalog still search offline.", result: null })
      return
    }
    setRunning(true)
    timer.current = window.setTimeout(() => {
      setRunning(false)
      const failed = store.getState().faults.failNextResolverLookup
      if (failed) {
        store.setState((s) => ({ ...s, faults: { ...s.faults, failNextResolverLookup: false } }))
        record({
          at: nowIso(),
          query: text,
          provider,
          outcome: "failed",
          message: `${PROVIDER_LABEL[provider]} did not respond: the lookup failed as if offline. No Target was changed; local Targets and indexed sessions stay usable.`,
          result: null,
        })
        return
      }
      const key = normalizeName(text)
      const match = SKY_OBJECTS.find((o) => normalizeName(o.name) === key || o.aliases.some((a) => normalizeName(a) === key))
      record(
        match
          ? {
              at: nowIso(),
              query: text,
              provider,
              outcome: "resolved",
              message: `Resolved by ${PROVIDER_LABEL[provider]}.`,
              result: { name: match.name, ra: match.ra, dec: match.dec, objectType: match.objectType, aliases: match.aliases },
            }
          : { at: nowIso(), query: text, provider, outcome: "not-found", message: `${PROVIDER_LABEL[provider]} returned no object named ${text}.`, result: null },
      )
    }, LOOKUP_MS)
  }

  return (
    <div>
      <PageHeader
        level={2}
        title="Target lookup"
        description="Optional online enrichment for Targets: coordinates, aliases and object type, each labelled with its provider. Capture metadata is never replaced."
      />
      <PageBody className="max-w-3xl">
        <Notice tone="info" title="Local search always works">
          Searching by name, alias or coordinates uses your {targets === 1 ? "1 Target" : `${targets} Targets`} and the bundled offline catalog of {SKY_OBJECTS.length} objects. It needs no
          account or network.
        </Notice>
        {writeError ? <ActionError message={writeError.message} onRetry={writeError.retry} /> : null}

        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-0.5">
            <label htmlFor={ids.enabled} className="text-sm font-medium">
              Look up Targets online
            </label>
            <p id={`${ids.enabled}-hint`} className="text-xs text-muted-foreground">
              Sends Target names to the provider below when you add or enrich a Target. A failed lookup never blocks indexing.
            </p>
          </div>
          <Switch id={ids.enabled} aria-describedby={`${ids.enabled}-hint`} checked={lookup.enabled} onCheckedChange={(checked) => change({ ...lookup, enabled: checked })} />
        </div>

        <Section title="Provider" id={ids.provider}>
          <RadioGroup
            aria-labelledby={`${ids.provider}-title`}
            aria-describedby={lookup.enabled ? undefined : `${ids.provider}-off`}
            disabled={!lookup.enabled}
            value={lookup.provider}
            onValueChange={(value) => change({ ...lookup, provider: value as AppSettings["targetLookup"]["provider"] })}
            className="grid-cols-2"
          >
            {PROVIDERS.map((p) => (
              <FieldLabel key={p.value} htmlFor={`${ids.provider}-${p.value}`}>
                <Field orientation="horizontal" className="items-start" data-disabled={lookup.enabled ? undefined : true}>
                  <FieldContent>
                    <FieldTitle>{p.title}</FieldTitle>
                    <FieldDescription className="text-xs">{p.description}</FieldDescription>
                  </FieldContent>
                  <RadioGroupItem id={`${ids.provider}-${p.value}`} value={p.value} />
                </Field>
              </FieldLabel>
            ))}
          </RadioGroup>
          {lookup.enabled ? null : (
            <p id={`${ids.provider}-off`} className="text-xs text-muted-foreground">
              Turn on online lookup to choose a provider.
            </p>
          )}
        </Section>

        <Section title="Test a lookup" id="lookup-test" description="Prototype: the response is fixture data, and no request leaves this browser.">
          <form
            noValidate
            className="flex flex-wrap items-start gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              runTest()
            }}
          >
            <TextField id={ids.query} label="Name to look up" value={query} onChange={setQuery} error={queryError} className="w-64" />
            <Button type="submit" className="mt-5" disabled={running} aria-busy={running || undefined}>
              <Search aria-hidden="true" data-icon="inline-start" />
              {running ? "Looking up…" : "Test lookup"}
            </Button>
          </form>
          <div aria-live="polite">
            {running ? (
              <DetailSkeleton label={`Looking up ${query.trim()}`} />
            ) : last ? (
              last.outcome === "resolved" && last.result ? (
                <div className="space-y-2 rounded-lg border p-3">
                  <p className="text-sm">
                    {last.message} <span className="text-muted-foreground">Prototype: fixture response · {formatDateTime(last.at)}</span>
                  </p>
                  <KeyValueList
                    items={[
                      { label: "Name", value: last.result.name, source: PROVIDER_LABEL[last.provider] },
                      { label: "Coordinates", value: `${formatRa(last.result.ra)} ${formatDec(last.result.dec)}`, source: PROVIDER_LABEL[last.provider] },
                      { label: "Object type", value: last.result.objectType, source: PROVIDER_LABEL[last.provider] },
                      { label: "Aliases", value: last.result.aliases.join(", "), source: PROVIDER_LABEL[last.provider] },
                    ]}
                  />
                </div>
              ) : (
                <Notice tone={last.outcome === "failed" ? "warning" : "info"} title={last.outcome === "failed" ? "Lookup failed" : last.outcome === "off" ? "Online lookup is off" : "No match"}>
                  {last.message}
                </Notice>
              )
            ) : null}
          </div>
        </Section>
      </PageBody>
    </div>
  )
}
