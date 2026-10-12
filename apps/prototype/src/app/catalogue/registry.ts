/**
 * The composition catalogue (plan R9-COMPOSITION-PLAN.md §8.4): every shared component shows each variant and
 * state here. Units add an entry file in this folder; the lead registers it below. `components` lists the
 * exported names an entry covers, which `scripts/check-catalogue.mjs` reads.
 */
import type { ComponentType } from "react"
import { FeedbackCatalogue } from "./feedback"
import { FieldsCatalogue } from "./fields"
import { PreviewsCatalogue } from "./previews"
import { ShellPartsCatalogue } from "./shell-parts"
import { StatusCatalogue } from "./status"

export interface CatalogueEntry {
  id: string
  /** Exported component names the entry demonstrates. */
  components: string[]
  Entry: ComponentType
}

export const CATALOGUE: CatalogueEntry[] = [
  {
    id: "feedback",
    components: ["Refusal", "ActionError", "Notice", "PageNotice", "NoticeSlot", "Toaster", "EmptyState", "SaveState"],
    Entry: FeedbackCatalogue,
  },
  { id: "status", components: ["StatusBadge", "Pill", "Tag", "CountBadge"], Entry: StatusCatalogue },
  { id: "previews", components: ["HoverCard", "HoverCardTrigger", "HoverCardContent", "Preview", "BlockersPreview", "UsedByPreview"], Entry: PreviewsCatalogue },
  {
    id: "fields",
    components: [
      "Field",
      "TextField",
      "NumberField",
      "SelectField",
      "ComboboxField",
      "SegmentedField",
      "SwitchField",
      "PathField",
      "TokenTemplateField",
      "ArgumentsField",
      "SettingsSection",
      "SettingsRow",
      "FolderPicker",
    ],
    Entry: FieldsCatalogue,
  },
  { id: "shell-parts", components: ["NavList", "ChecklistRing", "IssueRow", "ThemePicker", "ThemeMenuItems", "ThemeSwatch"], Entry: ShellPartsCatalogue },
]
