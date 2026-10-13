/**
 * The composition catalogue (plan R9-COMPOSITION-PLAN.md §8.4): every shared component shows each variant and
 * state here. Units add an entry file in this folder; the lead registers it below. `components` lists the
 * exported names an entry covers, which `scripts/check-catalogue.mjs` reads.
 */
import type { ComponentType } from "react"
import { ActionsCatalogue } from "./actions"
import { AppFrameCatalogue } from "./app-frame"
import { DataTableCatalogue } from "./data-table"
import { DialogsCatalogue } from "./dialogs"
import { DomainCatalogue } from "./domain"
import { FeedbackCatalogue } from "./feedback"
import { FieldsCatalogue } from "./fields"
import { GradeBadgesCatalogue } from "./grade-badges"
import { PaletteCatalogue } from "./palette"
import { PickersCatalogue } from "./pickers"
import { PreviewsCatalogue } from "./previews"
import { RunStepCatalogue } from "./run-step"
import { ShellPartsCatalogue } from "./shell-parts"
import { StatusCatalogue } from "./status"
import { StatusBarCatalogue } from "./status-bar"
import { StepFlowCatalogue } from "./step-flow"
import { TemplatesCatalogue } from "./templates"
import { WalkCatalogue } from "./walk"
import { WorkspaceCatalogue } from "./workspace"

export interface CatalogueEntry {
  id: string
  /** Exported component names the entry demonstrates. */
  components: string[]
  Entry: ComponentType
}

export const CATALOGUE: CatalogueEntry[] = [
  {
    id: "actions",
    components: ["ActionBar", "ActionButton", "ActionMenu", "MenuItems", "IconButton", "RowActions", "RowContextMenu", "Button"],
    Entry: ActionsCatalogue,
  },
  {
    id: "feedback",
    components: ["Refusal", "ActionError", "Notice", "PageNotice", "NoticeSlot", "Toaster", "EmptyState", "SaveState"],
    Entry: FeedbackCatalogue,
  },
  { id: "status", components: ["StatusBadge", "Pill", "Tag", "CountBadge"], Entry: StatusCatalogue },
  { id: "previews", components: ["HoverCard", "HoverCardTrigger", "HoverCardContent", "Preview", "BlockersPreview", "UsedByPreview"], Entry: PreviewsCatalogue },
  { id: "dialogs", components: ["ConfirmDialog", "FormDialog", "DialogFooter"], Entry: DialogsCatalogue },
  { id: "pickers", components: ["NightPicker", "SitePicker", "SiteLocationField", "TargetPicker", "DisplayMenu"], Entry: PickersCatalogue },
  {
    id: "domain",
    components: ["Plate", "Histogram", "MoonLine", "DarkLine", "AltitudeSpark", "MosaicField", "SiteMap", "CornerGrid", "FrameThumbnails", "SessionPlots", "StarCutouts"],
    Entry: DomainCatalogue,
  },
  { id: "step-flow", components: ["StepStrip", "StepFooter"], Entry: StepFlowCatalogue },
  {
    id: "data-table",
    components: [
      "DataTable",
      "FilterBar",
      "FilterControls",
      "TableToolbar",
      "SelectionBar",
      "Table",
      "TableHeader",
      "TableBody",
      "TableFooter",
      "TableHead",
      "TableRow",
      "TableCell",
      "TableCaption",
    ],
    Entry: DataTableCatalogue,
  },
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
  {
    id: "templates",
    components: ["ListPage", "DetailPage", "StepPage", "SettingsPage", "ListSection", "DetailDock", "DetailPanel", "ViewTabs", "PageHeader", "Box", "BoxTable"],
    Entry: TemplatesCatalogue,
  },
  { id: "grade-badges", components: ["GradeBadges"], Entry: GradeBadgesCatalogue },
  { id: "app-frame", components: ["AppFrame", "SetupFrame", "MainArea"], Entry: AppFrameCatalogue },
  {
    id: "status-bar",
    components: [
      "StatusBar",
      "StatusGroup",
      "StatusLink",
      "StatusText",
      "StatusSelection",
      "StatusOperation",
      "MiniProgress",
      "ListPopover",
      "ListRows",
      "ListOperationRow",
      "ListSection",
      "ListEmpty",
      "ListFold",
      "ListNotice",
    ],
    Entry: StatusBarCatalogue,
  },
  { id: "palette", components: ["CommandPalette", "PaletteTrigger"], Entry: PaletteCatalogue },
  { id: "run-step", components: ["StepGlyph", "StepRail", "GateLabel", "CurrentLink", "useFollowLink", "gateWord", "stepName"], Entry: RunStepCatalogue },
  { id: "walk", components: ["CoachWalk"], Entry: WalkCatalogue },
  { id: "workspace", components: ["Workspace"], Entry: WorkspaceCatalogue },
]
