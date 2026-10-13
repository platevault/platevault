/**
 * Settings › Target lookup (LIB-AC-12, LIB-FR-13, D18; plan §4a, C T1-T4).
 * Online Target resolution is optional enrichment with provider
 * provenance; local search and indexing never depend on it. The test lookup
 * answers from the bundled resolver data and honours the "Fail next Target
 * resolver lookup" simulation fault.
 */
import { Search } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import { KeyValueList } from "@/components/app/data"
import { ActionError, DetailSkeleton, Notice, useSaveState } from "@/components/app/feedback"
import { SegmentedField, SwitchField, TextField } from "@/components/app/fields"
import { Section } from "@/components/app/page"
import { SettingsRow, SettingsSection } from "@/components/app/settings"
import { SettingsPage } from "@/components/templates/settings-page"
import { objectTypeRef } from "@/domain/labels"
import { BUNDLED_CATALOGUE, resolverEntryFor } from "@/domain/sky"
import type { AppSettings } from "@/domain/types"
import { formatCount, formatDateTime, formatDec, formatRa } from "@/lib/format"
import { type Messages, msg, say } from "@/lib/i18n"
import { nowIso, store, updateSlice, useStore } from "@/store/core"
import type { TargetLookupTest } from "@/store/slices/e"
import { save as commitSetting } from "../lib/writes"

const HREF = "/settings/targets"

type Provider = AppSettings["targetLookup"]["provider"]

/** Provider names are proper nouns: not translated. */
const PROVIDER_LABEL: Record<Provider, string> = { "cds-sesame": "CDS Sesame", simbad: "SIMBAD" }

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

function record(test: TargetLookupTest) {
  updateSlice("e", (slice) => ({ ...slice, lastLookupTest: test }))
}

/** The test lookup's outcome: the resolved names and position, or why nothing resolved. */
function TestOutcome({ last, onRetry }: { last: TargetLookupTest; onRetry: () => void }) {
  const m = useMessages()
  if (last.outcome === "resolved" && last.result) {
    const source = PROVIDER_LABEL[last.provider]
    return (
      <KeyValueList
        items={[
          { label: m.settings_lookup_result(), value: `${outcomeMessage(m, last)} · ${formatDateTime(last.at)}` },
          { label: m.settings_lookup_name(), value: last.result.name, source },
          { label: m.settings_lookup_coordinates(), value: `${formatRa(last.result.ra)} ${formatDec(last.result.dec)}`, source },
          { label: m.settings_lookup_object_type(), value: say(m, objectTypeRef(last.result.objectType)), source },
          { label: m.settings_lookup_aliases(), value: last.result.aliases.join(", "), source },
        ]}
      />
    )
  }
  if (last.outcome === "failed") return <ActionError message={outcomeMessage(m, last)} onRetry={onRetry} />
  return (
    <Notice tone="info" title={last.outcome === "off" ? m.settings_lookup_off_title() : m.sessions_no_match()}>
      {outcomeMessage(m, last)}
    </Notice>
  )
}

export function TargetLookupPage() {
  const m = useMessages()
  const lookup = useStore((s) => s.settings.targetLookup)
  const targets = useStore((s) => Object.keys(s.catalog.targets).length)
  const last = useStore((s) => s.slices.e.lastLookupTest)
  const [query, setQuery] = useState("NGC 7000")
  const [queryError, setQueryError] = useState<string | undefined>()
  const [running, setRunning] = useState(false)
  const timer = useRef<number | null>(null)
  const { save, indicator } = useSaveState()

  useEffect(() => () => window.clearTimeout(timer.current ?? undefined), [])

  function change(next: AppSettings["targetLookup"]) {
    save(() =>
      commitSetting(
        {
          label: msg("store_label_target_lookup"),
          saved: next.enabled ? msg("store_saved_lookup_on", { provider: PROVIDER_LABEL[next.provider] }) : msg("store_saved_lookup_off"),
          detail: next.enabled ? null : msg("store_lookup_off_detail"),
          href: HREF,
        },
        (s) => ({ ...s, settings: { ...s.settings, targetLookup: next } }),
      ),
    )
  }

  /** Runs one test lookup; the promise settles when the simulated provider answers, so the button shows it busy. */
  function runTest(): Promise<void> | void {
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
    return new Promise((resolve) => {
      timer.current = window.setTimeout(() => {
        setRunning(false)
        resolve()
        if (store.getState().faults.failNextResolverLookup) {
          store.setState((s) => ({ ...s, faults: { ...s.faults, failNextResolverLookup: false } }))
          record({ at: nowIso(), query: text, provider, outcome: "failed", result: null })
          return
        }
        const match = resolverEntryFor(text)
        record(
          match
            ? { at: nowIso(), query: text, provider, outcome: "resolved", result: { name: match.designation, ra: match.ra, dec: match.dec, objectType: match.objectType, aliases: match.aliases } }
            : { at: nowIso(), query: text, provider, outcome: "not-found", result: null },
        )
      }, LOOKUP_MS)
    })
  }

  return (
    <SettingsPage title={m.settings_target_lookup()}>
      <SettingsSection title={m.settings_lookup_online_title()} actions={indicator}>
        <SwitchField label={m.settings_lookup_online()} checked={lookup.enabled} onChange={(enabled) => change({ ...lookup, enabled })} />
        <SegmentedField
          label={m.settings_lookup_provider()}
          value={lookup.provider}
          options={[
            { value: "cds-sesame", label: PROVIDER_LABEL["cds-sesame"] },
            { value: "simbad", label: m.settings_lookup_simbad_only() },
          ]}
          disabled={!lookup.enabled}
          onChange={(provider) => change({ ...lookup, provider })}
        />
        <SettingsRow label={m.settings_lookup_local()}>
          {m.settings_lookup_targets({ count: targets, n: formatCount(targets) })} · {m.settings_lookup_catalogue_objects({ count: BUNDLED_CATALOGUE.length, n: formatCount(BUNDLED_CATALOGUE.length) })}
        </SettingsRow>
      </SettingsSection>

      <Section title={m.settings_lookup_test_heading()} level={3}>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void runTest()
          }}
        >
          <TextField
            label={m.settings_lookup_query()}
            value={query}
            onChange={setQuery}
            error={queryError}
            action={<ActionButton action={{ id: "lookup-test", label: running ? m.settings_lookup_running() : m.settings_lookup_test(), icon: Search, run: runTest }} />}
          />
        </form>
        <div aria-live="polite">{running ? <DetailSkeleton label={m.settings_lookup_running_named({ name: query.trim() })} /> : last ? <TestOutcome last={last} onRetry={() => void runTest()} /> : null}</div>
      </Section>
    </SettingsPage>
  )
}
