/**
 * The composition catalogue (plan R9-COMPOSITION-PLAN.md §8.4): every shared component shows each variant and
 * state here. Units add an entry file in this folder; the lead registers it below. `components` lists the
 * exported names an entry covers, which `scripts/check-catalogue.mjs` reads.
 */
import type { ComponentType } from "react"
import { ActionsCatalogue } from "./actions"
import { AppFrameCatalogue } from "./app-frame"
import { ControlsCatalogue } from "./controls"
import { DataCatalogue } from "./data"
import { DataTableCatalogue } from "./data-table"
import { DialogsCatalogue } from "./dialogs"
import { DomainCatalogue } from "./domain"
import { F4Catalogue } from "./f4"
import { FeedbackCatalogue } from "./feedback"
import { FieldsCatalogue } from "./fields"
import { GoalFieldsCatalogue } from "./goal-fields"
import { GradeBadgesCatalogue } from "./grade-badges"
import { OperationCatalogue } from "./operation"
import { PageCatalogue } from "./page"
import { PaletteCatalogue } from "./palette"
import { PickersCatalogue } from "./pickers"
import { PreviewsCatalogue } from "./previews"
import { PrimitivesCatalogue } from "./primitives"
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
    components: ["ActionBar", "ActionButton", "ActionToggle", "ActionMenu", "MenuItems", "IconButton", "RowActions", "RowContextMenu", "Button", "QuickActionModeProvider"],
    Entry: ActionsCatalogue,
  },
  { id: "controls", components: ["Button", "Spinner", "ToggleGroup", "ToggleGroupItem", "Toggle"], Entry: ControlsCatalogue },
  {
    id: "feedback",
    components: ["Refusal", "ActionError", "Notice", "PageNotice", "NoticeSlot", "Toaster", "EmptyState", "SaveState", "UnknownValue", "TableSkeleton", "DetailSkeleton"],
    Entry: FeedbackCatalogue,
  },
  { id: "status", components: ["StatusBadge", "StatusBadges", "Pill", "Tag", "CountBadge"], Entry: StatusCatalogue },
  { id: "data", components: ["KeyValueList", "Stat", "PathText", "DateText", "ChannelCoverage", "FilterChips", "EvidenceList", "UnknownValue"], Entry: DataCatalogue },
  { id: "operation", components: ["OperationPanel", "Label", "Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue"], Entry: OperationCatalogue },
  { id: "page", components: ["PageBody", "Section"], Entry: PageCatalogue },
  { id: "previews", components: ["HoverCard", "HoverCardTrigger", "HoverCardContent", "Preview", "BlockersPreview", "BlockersBody", "Blockable", "UsedByPreview", "MasterPreview"], Entry: PreviewsCatalogue },
  { id: "dialogs", components: ["ConfirmDialog", "FileTable", "FormDialog", "DialogFooter"], Entry: DialogsCatalogue },
  { id: "pickers", components: ["NightPicker", "SitePicker", "SiteLocationField", "TargetPicker", "DisplayMenu"], Entry: PickersCatalogue },
  {
    id: "domain",
    components: ["Plate", "Histogram", "MoonLine", "DarkLine", "AltitudeSpark", "NightCalendar", "MoonPhase", "MosaicField", "SiteMap", "CornerGrid", "FrameThumbnails", "SessionPlots", "StarCutouts"],
    Entry: DomainCatalogue,
  },
  { id: "f4", components: ["CalibrationDiagram", "CalibrationChoices", "CalibrationChoiceBadge", "ViewFolderTree", "PlaceLink", "DuplicatesBadge", "ReadinessBadge"], Entry: F4Catalogue },
  { id: "goal-fields", components: ["GoalKindsFields", "GoalValuesEditor"], Entry: GoalFieldsCatalogue },
  { id: "step-flow", components: ["StepStrip", "StepFooter", "CurrentLink"], Entry: StepFlowCatalogue },
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
      "TextAreaField",
      "FieldGroup",
      "NumberField",
      "SliderField",
      "Slider",
      "SelectField",
      "ComboboxField",
      "SegmentedField",
      "SwitchField",
      "ChoiceListField",
      "PathField",
      "FilesField",
      "TokenTemplateField",
      "TokenTable",
      "ArgumentsField",
      "SettingsSection",
      "SettingsRow",
      "FolderPicker",
    ],
    Entry: FieldsCatalogue,
  },
  { id: "shell-parts", components: ["NavList", "ChecklistRing", "ThemePicker", "ThemeMenuItems", "ThemeSwatch"], Entry: ShellPartsCatalogue },
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
      "StatusCounter",
      "MiniProgress",
      "ListPopover",
      "ListRows",
      "ListOperationRow",
      "ListNotice",
    ],
    Entry: StatusBarCatalogue,
  },
  { id: "palette", components: ["CommandPalette", "PaletteTrigger"], Entry: PaletteCatalogue },
  { id: "walk", components: ["CoachWalk"], Entry: WalkCatalogue },
  { id: "workspace", components: ["Workspace"], Entry: WorkspaceCatalogue },
  {
    id: "primitives",
    components: [
      "AlertDialog",
      "AlertDialogTrigger",
      "AlertDialogContent",
      "AlertDialogHeader",
      "AlertDialogTitle",
      "AlertDialogDescription",
      "Dialog",
      "DialogTrigger",
      "DialogContent",
      "DialogHeader",
      "DialogTitle",
      "DialogDescription",
      "DialogClose",
      "Sheet",
      "SheetContent",
      "SheetHeader",
      "SheetTitle",
      "SheetDescription",
      "Popover",
      "PopoverTrigger",
      "PopoverContent",
      "PopoverTitle",
      "TooltipProvider",
      "Tooltip",
      "TooltipTrigger",
      "TooltipContent",
      "DropdownMenu",
      "DropdownMenuTrigger",
      "DropdownMenuContent",
      "DropdownMenuGroup",
      "DropdownMenuLabel",
      "DropdownMenuItem",
      "DropdownMenuCheckboxItem",
      "DropdownMenuRadioGroup",
      "DropdownMenuRadioItem",
      "DropdownMenuSeparator",
      "DropdownMenuShortcut",
      "DropdownMenuSub",
      "DropdownMenuSubTrigger",
      "DropdownMenuSubContent",
      "ContextMenu",
      "ContextMenuTrigger",
      "ContextMenuContent",
      "ContextMenuGroup",
      "ContextMenuLabel",
      "ContextMenuItem",
      "ContextMenuShortcut",
      "ContextMenuSeparator",
      "Input",
      "Textarea",
      "FieldLabel",
      "FieldError",
      "ClearableInput",
      "InputGroup",
      "InputGroupAddon",
      "InputGroupInput",
      "InputGroupButton",
      "Checkbox",
      "CheckboxGroup",
      "RadioGroup",
      "RadioGroupItem",
      "Switch",
      "Combobox",
      "ComboboxInput",
      "ComboboxContent",
      "ComboboxEmpty",
      "ComboboxList",
      "ComboboxGroup",
      "ComboboxLabel",
      "ComboboxCollection",
      "ComboboxItem",
      "SelectSeparator",
      "Badge",
      "Alert",
      "AlertTitle",
      "AlertDescription",
      "Kbd",
      "KbdGroup",
      "Separator",
      "Skeleton",
      "Progress",
      "ProgressLabel",
      "ProgressValue",
      "Empty",
      "EmptyHeader",
      "EmptyMedia",
      "EmptyDescription",
      "EmptyContent",
      "Breadcrumb",
      "BreadcrumbList",
      "BreadcrumbItem",
      "BreadcrumbLink",
      "BreadcrumbSeparator",
      "Tabs",
      "TabsList",
      "TabsTrigger",
      "TabsContent",
      "Collapsible",
      "CollapsibleTrigger",
      "CollapsibleContent",
      "ListDetail",
      "HelpTip",
      "NoteMarker",
      "LiveAnnouncer",
      "OperationLine",
    ],
    Entry: PrimitivesCatalogue,
  },
]
