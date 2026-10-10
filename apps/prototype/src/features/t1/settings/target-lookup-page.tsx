/**
 * Settings › Target lookup (LIB-AC-12, LIB-FR-13, D18). Online Target
 * resolution is optional enrichment with provider provenance; local search and
 * indexing never depend on it. The test lookup is a prototype fixture response
 * and honours the "Fail next Target resolver lookup" simulation fault.
 */
import { Loader2, Search } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { KeyValueList } from "@/components/app/data"
import { ActionError, DetailSkeleton, Notice } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { Pill } from "@/components/app/pill"
import { HelpTip } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { BUNDLED_CATALOGUE, resolverEntryFor } from "@/domain/sky"
import type { AppSettings } from "@/domain/types"
import { formatCount, formatDateTime, formatDec, formatRa } from "@/lib/format"
import { type Messages, msg, say } from "@/lib/i18n"
import { objectTypeRef } from "@/domain/labels"
import { nowIso, store, updateSlice, useStore } from "@/store/core"
import type { TargetLookupTest } from "@/store/slices/e"
import { TextField } from "../components/form-field"
import { save } from "../lib/writes"
import { ReturnNotice } from "./settings-layout"

const HREF = "/settings/targets"

type Provider = AppSettings["targetLookup"]["provider"]

/** Provider names are proper nouns: not translated. */
const PROVIDER_LABEL: Record<Provider, string> = { "cds-sesame": "CDS Sesame", simbad: "SIMBAD" }

function providers(m: Messages): Array<{ value: Provider; title: string; description: string }> {
  return [
    { value: "cds-sesame", title: PROVIDER_LABEL["cds-sesame"], description: m.settings_lookup_sesame_sources() },
    { value: "simbad", title: m.settings_lookup_simbad_only(), description: PROVIDER_LABEL.simbad },
  ]
}

/** The test outcome in the current language. */
function outcomeMessage(m: Messages, test: TargetLookupTest): string {
  const provider = PROVIDER_LABEL[test.provider]
  switch (test.outcome) {
    case "resolved":
      return m.settings_lookup_resolved({ provider })
    case "not-found":
      return m.settings_lookup_not_found({ provider, query: test.query })
    case "failed":
      return m.settings_lookup_failed({ provider })
    case "off":
      return m.settings_lookup_off()
  }
}

/** Simulated provider round trip; long enough to show the loading state. */
const LOOKUP_MS = 700

export function TargetLookupPage() {
  const m = useMessages()
  const lookup = useStore((s) => s.settings.targetLookup)
  const targets = useStore((s) => Object.keys(s.catalog.targets).length)
  const last = useStore((s) => s.slices.e.lastLookupTest)
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
          label: msg("store_label_target_lookup"),
          saved: next.enabled ? msg("store_saved_lookup_on", { provider: PROVIDER_LABEL[next.provider] }) : msg("store_saved_lookup_off"),
          detail: next.enabled ? null : msg("store_lookup_off_detail"),
          href: HREF,
        },
        (s) => ({ ...s, settings: { ...s.settings, targetLookup: next } }),
      )
      setWriteError(result.ok ? null : { message: result.message, retry: attempt })
    }
    attempt()
  }

  function record(test: TargetLookupTest) {
    updateSlice("e", (slice) => ({ ...slice, lastLookupTest: test }))
  }

  function runTest() {
    // Loading keeps the button enabled and focused (HLD §14); a second press while busy does nothing.
    if (running) return
    const text = query.trim()
    if (!text) {
      setQueryError(m.settings_lookup_query_empty())
      return
    }
    setQueryError(undefined)
    const { provider, enabled } = store.getState().settings.targetLookup
    if (!enabled) {
      record({ at: nowIso(), query: text, provider, outcome: "off", result: null })
      return
    }
    setRunning(true)
    timer.current = window.setTimeout(() => {
      setRunning(false)
      const failed = store.getState().faults.failNextResolverLookup
      if (failed) {
        store.setState((s) => ({ ...s, faults: { ...s.faults, failNextResolverLookup: false } }))
        record({ at: nowIso(), query: text, provider, outcome: "failed", result: null })
        return
      }
      const match = resolverEntryFor(text)
      record(
        match
          ? {
              at: nowIso(),
              query: text,
              provider,
              outcome: "resolved",
              result: { name: match.designation, ra: match.ra, dec: match.dec, objectType: match.objectType, aliases: match.aliases },
            }
          : { at: nowIso(), query: text, provider, outcome: "not-found", result: null },
      )
    }, LOOKUP_MS)
  }

  return (
    <div>
      <PageHeader level={2} title={m.settings_target_lookup()} />
      <PageBody>
        <ReturnNotice />
        <p className="flex flex-wrap items-center gap-1.5 text-sm" data-local-search>
          <Pill tone="success">{m.settings_lookup_local()}</Pill>
          <span className="text-muted-foreground tabular-nums">
            {m.settings_lookup_targets({ count: targets, n: formatCount(targets) })} ·{" "}
            {m.settings_lookup_catalogue_objects({ count: BUNDLED_CATALOGUE.length, n: formatCount(BUNDLED_CATALOGUE.length) })}
          </span>
        </p>
        {writeError ? <ActionError message={writeError.message} onRetry={writeError.retry} /> : null}

        <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
          <span className="inline-flex items-center gap-1.5">
            <label htmlFor={ids.enabled} className="text-sm font-medium">
              {m.settings_lookup_online()}
            </label>
            <HelpTip label={m.settings_lookup_online_about()}>{m.settings_lookup_online_help()}</HelpTip>
          </span>
          <Switch id={ids.enabled} checked={lookup.enabled} onCheckedChange={(checked) => change({ ...lookup, enabled: checked })} />
        </div>

        <Section title={m.settings_lookup_provider()} level={3} id={ids.provider}>
          <RadioGroup
            aria-labelledby={`${ids.provider}-title`}
            disabled={!lookup.enabled}
            value={lookup.provider}
            onValueChange={(value) => change({ ...lookup, provider: value as Provider })}
            className="grid-cols-2"
          >
            {providers(m).map((p) => (
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
        </Section>

        <Section title={m.settings_lookup_test_heading()} level={3} id="lookup-test" actions={<Pill tone="muted">{m.settings_lookup_fixture()}</Pill>}>
          <form
            noValidate
            className="max-w-sm"
            onSubmit={(event) => {
              event.preventDefault()
              runTest()
            }}
          >
            <TextField
              id={ids.query}
              label={m.settings_lookup_query()}
              value={query}
              onChange={setQuery}
              error={queryError}
              action={
                <Button type="submit" className="shrink-0" aria-busy={running || undefined}>
                  {running ? <Loader2 aria-hidden="true" data-icon="inline-start" className="motion-safe:animate-spin" /> : <Search aria-hidden="true" data-icon="inline-start" />}
                  {running ? m.settings_lookup_running() : m.settings_lookup_test()}
                </Button>
              }
            />
          </form>
          <div aria-live="polite">
            {running ? (
              <DetailSkeleton label={m.settings_lookup_running_named({ name: query.trim() })} />
            ) : last ? (
              last.outcome === "resolved" && last.result ? (
                <div className="space-y-2 rounded-lg border p-3">
                  <p className="text-sm">
                    {outcomeMessage(m, last)} <span className="text-muted-foreground">{formatDateTime(last.at)}</span>
                  </p>
                  <KeyValueList
                    items={[
                      { label: m.settings_lookup_name(), value: last.result.name, source: PROVIDER_LABEL[last.provider] },
                      { label: m.settings_lookup_coordinates(), value: `${formatRa(last.result.ra)} ${formatDec(last.result.dec)}`, source: PROVIDER_LABEL[last.provider] },
                      { label: m.settings_lookup_object_type(), value: say(m, objectTypeRef(last.result.objectType)), source: PROVIDER_LABEL[last.provider] },
                      { label: m.settings_lookup_aliases(), value: last.result.aliases.join(", "), source: PROVIDER_LABEL[last.provider] },
                    ]}
                  />
                </div>
              ) : (
                <Notice
                  tone={last.outcome === "failed" ? "warning" : "info"}
                  title={last.outcome === "failed" ? m.settings_lookup_failed_title() : last.outcome === "off" ? m.settings_lookup_off_title() : m.sessions_no_match()}
                >
                  {outcomeMessage(m, last)}
                </Notice>
              )
            ) : null}
          </div>
        </Section>
      </PageBody>
    </div>
  )
}
