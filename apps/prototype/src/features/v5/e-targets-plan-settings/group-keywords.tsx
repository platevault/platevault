/**
 * Settings › Naming › Group keywords (PRJ-FR-28; astro-plan-qk9ri.5). One
 * row per grouping keyword, in `GROUP_KEYWORD_KINDS` order: its name, what
 * it does (the folder prefix WBPP groups by) and its own Edit. Each Project
 * uses these names unless it sets its own. A name is refused inline, under
 * its field, while it cannot name View folders beside the others
 * (`keywordRefusalsFor`).
 */
import { Pencil } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Action } from "@/components/app/contracts"
import { TextField } from "@/components/app/fields"
import { blockedByErrors, FormDialog } from "@/components/app/form-dialog"
import { SettingsRow, SettingsSection } from "@/components/app/settings"
import { GROUP_KEYWORD, GROUP_KEYWORD_KINDS } from "@/domain/labels"
import type { GroupKeywordKind } from "@/domain/types"
import { say } from "@/lib/i18n"
import { keywordRefusalsFor, setGroupKeyword } from "@/store/actions/settings"
import { useStore } from "@/store/core"

/** Edits one grouping keyword's name; the draft starts from the saved name each time it opens. */
function KeywordDialog({ kind, open, onClose }: { kind: GroupKeywordKind; open: boolean; onClose: () => void }) {
  const m = useMessages()
  const keywords = useStore((s) => s.settings.keywords)
  const [draft, setDraft] = useState(keywords[kind])
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setDraft(keywords[kind])
  }
  const name = draft.trim()
  const errors = keywordRefusalsFor({ ...keywords, [kind]: name }, kind).map((reason) => say(m, reason))
  const label = m.settings_save()
  const confirm: Action = {
    id: `save-keyword-${kind}`,
    label,
    kind: "primary",
    unavailable: blockedByErrors(label, Object.fromEntries(errors.map((error, i) => [String(i), error]))),
    run: () => setGroupKeyword(kind, name),
  }
  return (
    <FormDialog open={open} onOpenChange={(value) => !value && onClose()} title={m.settings_label_group_keywords()} size="sm" confirm={confirm}>
      <TextField label={say(m, GROUP_KEYWORD[kind].label)} description={say(m, GROUP_KEYWORD[kind].help(errors.length === 0 ? name : keywords[kind]))} value={draft} onChange={setDraft} error={errors} mono autoFocus />
    </FormDialog>
  )
}

export function GroupKeywordsSection() {
  const m = useMessages()
  const keywords = useStore((s) => s.settings.keywords)
  const [editing, setEditing] = useState<GroupKeywordKind | null>(null)
  // The dialogs sit outside the section, so their fields render as dialog fields rather than settings rows.
  return (
    <>
      <SettingsSection title={m.settings_label_group_keywords()}>
        {GROUP_KEYWORD_KINDS.map((kind) => (
          <SettingsRow key={kind} label={say(m, GROUP_KEYWORD[kind].label)} help={say(m, GROUP_KEYWORD[kind].help(keywords[kind]))}>
            <code>{keywords[kind]}</code>
            <ActionButton action={{ id: `edit-keyword-${kind}`, label: m.settings_edit(), icon: Pencil, opensDialog: true, run: () => setEditing(kind) }} />
          </SettingsRow>
        ))}
      </SettingsSection>
      {GROUP_KEYWORD_KINDS.map((kind) => (
        <KeywordDialog key={kind} kind={kind} open={editing === kind} onClose={() => setEditing(null)} />
      ))}
    </>
  )
}
